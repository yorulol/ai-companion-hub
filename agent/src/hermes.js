/**
 * Hermes agent integration — Nous Research Hermes-3 models served via the
 * local Ollama daemon. Detects the host hardware once at boot and picks the
 * Hermes tier that fits best (3B / 8B / 70B), so replies stay lightning-fast
 * on modest machines and use the deeper model when the machine can carry it.
 *
 * Hermes is enabled/disabled in the .env (HERMES_ENABLED) or from the panel;
 * when enabled it becomes the default chat provider and overrides the plain
 * Ollama chat model with the auto-selected Hermes tier.
 */
import os from "node:os";
import { spawnSync } from "node:child_process";

// Ollama library tags for Hermes 3 (official Nous Research uploads).
export const HERMES_TIERS = {
  small: { model: "hermes3:3b", minRamGb: 4, minVramGb: 0, label: "Hermes 3 · 3B (fast)" },
  medium: { model: "hermes3:8b", minRamGb: 12, minVramGb: 6, label: "Hermes 3 · 8B (balanced)" },
  large: { model: "hermes3:70b", minRamGb: 48, minVramGb: 24, label: "Hermes 3 · 70B (deep)" },
};

let CACHED_HW = null;
let CACHED_GPU = null;

function trySmi(bin) {
  try {
    const r = spawnSync(bin, ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      const lines = r.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const gpus = lines.map((ln) => {
        const [name, mem] = ln.split(",").map((s) => s.trim());
        return { name, vramMib: Number(mem) || 0 };
      }).filter((g) => g.vramMib > 0);
      if (gpus.length) return gpus;
    }
  } catch {}
  return null;
}

/** AMD detection via rocm-smi (Linux/Windows ROCm installs). */
function tryRocmSmi(bin) {
  try {
    const r = spawnSync(bin, ["--showproductname", "--showmeminfo", "vram", "--csv"], { encoding: "utf8", timeout: 5000 });
    if (r.status !== 0 || !r.stdout) return null;
    const gpus = [];
    let cur = null;
    for (const ln of r.stdout.split(/\r?\n/)) {
      const cols = ln.split(",").map((s) => s.trim());
      if (/card series|card model|GPU/i.test(cols[1] || "") && cols[2]) cur = { name: cols[2], vramMib: 0 };
      const memMatch = ln.match(/(\d+)\s*$/);
      if (/Total Memory|VRAM Total/i.test(ln) && memMatch) {
        const mib = Math.round(Number(memMatch[1]) / (1024 * 1024));
        if (cur) { cur.vramMib = mib; gpus.push(cur); cur = null; }
        else gpus.push({ name: "AMD GPU", vramMib: mib });
      }
    }
    const valid = gpus.filter((g) => g.vramMib > 0);
    return valid.length ? valid : null;
  } catch {}
  return null;
}

/** AMD detection via sysfs on Linux (vendor 0x1002), reading mem_info_vram_total. */
function trySysfsAmd() {
  try {
    const fs = require("node:fs");
    const base = "/sys/class/drm";
    if (!fs.existsSync(base)) return null;
    const gpus = [];
    for (const entry of fs.readdirSync(base)) {
      if (!/^card\d+$/.test(entry)) continue;
      const dev = `${base}/${entry}/device`;
      try {
        const vendor = fs.readFileSync(`${dev}/vendor`, "utf8").trim();
        if (vendor !== "0x1002") continue;
        const bytes = Number(fs.readFileSync(`${dev}/mem_info_vram_total`, "utf8").trim());
        if (bytes > 0) gpus.push({ name: "AMD GPU (sysfs)", vramMib: Math.round(bytes / (1024 * 1024)) });
      } catch {}
    }
    return gpus.length ? gpus : null;
  } catch {}
  return null;
}

/** Best-effort GPU detection: NVIDIA via nvidia-smi (PATH + common install paths),
 *  AMD via rocm-smi or Linux sysfs, then a Windows PowerShell CIM fallback. */
function detectGpu() {
  if (CACHED_GPU) return CACHED_GPU;
  const candidates = ["nvidia-smi"];
  if (process.platform === "win32") {
    candidates.push(
      "C:\\Windows\\System32\\nvidia-smi.exe",
      "C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe",
    );
  } else {
    candidates.push("/usr/bin/nvidia-smi", "/usr/local/bin/nvidia-smi");
  }
  for (const bin of candidates) {
    const gpus = trySmi(bin);
    if (gpus) {
      const vramGb = Math.round((gpus.reduce((a, g) => a + g.vramMib, 0) / 1024) * 10) / 10;
      CACHED_GPU = { gpus, vramGb, source: bin, name: gpus[0]?.name || "NVIDIA GPU" };
      return CACHED_GPU;
    }
  }
  // AMD: rocm-smi first, then Linux sysfs.
  const rocmBins = process.platform === "win32"
    ? ["C:\\Program Files\\AMD\\ROCm\\bin\\rocm-smi.exe", "rocm-smi"]
    : ["rocm-smi", "/opt/rocm/bin/rocm-smi", "/usr/bin/rocm-smi"];
  for (const bin of rocmBins) {
    const gpus = tryRocmSmi(bin);
    if (gpus) {
      const vramGb = Math.round((gpus.reduce((a, g) => a + g.vramMib, 0) / 1024) * 10) / 10;
      CACHED_GPU = { gpus, vramGb, source: bin, name: gpus[0]?.name || "AMD GPU" };
      return CACHED_GPU;
    }
  }
  if (process.platform !== "win32") {
    const gpus = trySysfsAmd();
    if (gpus) {
      const vramGb = Math.round((gpus.reduce((a, g) => a + g.vramMib, 0) / 1024) * 10) / 10;
      CACHED_GPU = { gpus, vramGb, source: "sysfs:/sys/class/drm", name: gpus[0].name };
      return CACHED_GPU;
    }
  }
  // Windows fallback: PowerShell CIM query for adapter RAM (NVIDIA or AMD).
  if (process.platform === "win32") {
    try {
      const r = spawnSync("powershell.exe", [
        "-NoProfile", "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object -Property Name,AdapterRAM | ConvertTo-Json -Compress",
      ], { encoding: "utf8", timeout: 6000 });
      if (r.status === 0 && r.stdout) {
        const raw = JSON.parse(r.stdout);
        const arr = Array.isArray(raw) ? raw : [raw];
        const gpus = arr.map((g) => ({ name: g.Name, vramMib: Math.round((Number(g.AdapterRAM) || 0) / (1024 * 1024)) }))
          .filter((g) => g.name && /nvidia|geforce|rtx|gtx|quadro|tesla|amd|radeon|\brx\s?\d/i.test(g.name) && g.vramMib > 0);
        if (gpus.length) {
          const vramGb = Math.round((gpus.reduce((a, g) => a + g.vramMib, 0) / 1024) * 10) / 10;
          CACHED_GPU = { gpus, vramGb, source: "powershell:Win32_VideoController", name: gpus[0].name };
          return CACHED_GPU;
        }
      }
    } catch {}
  }
  CACHED_GPU = { gpus: [], vramGb: 0, source: null, name: null };
  return CACHED_GPU;
}

function detectVramGb() {
  return detectGpu().vramGb;
}

export function detectHardware(force = false) {
  if (CACHED_HW && !force) return CACHED_HW;
  if (force) CACHED_GPU = null;
  const ramGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const cpus = os.cpus() || [];
  const gpu = detectGpu();
  CACHED_HW = {
    platform: process.platform,
    arch: process.arch,
    ramGb,
    vramGb: gpu.vramGb,
    gpuName: gpu.name,
    gpuSource: gpu.source,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model?.trim() || "unknown",
    hasGpu: gpu.vramGb > 0,
  };
  return CACHED_HW;
}

/** Pick the Hermes tier that fits the host. Honours HERMES_MODEL override. */
export function pickHermesModel(override) {
  if (override && String(override).trim()) return { model: String(override).trim(), tier: "override", label: `Hermes (custom: ${override})` };
  const hw = detectHardware();
  // Prefer VRAM when we have a GPU, otherwise fall back to system RAM.
  const budget = hw.hasGpu ? hw.vramGb : hw.ramGb / 2; // model needs roughly half the RAM headroom
  let pick = HERMES_TIERS.small;
  if (budget >= HERMES_TIERS.large.minVramGb || hw.ramGb >= HERMES_TIERS.large.minRamGb + 16) pick = HERMES_TIERS.large;
  else if (budget >= HERMES_TIERS.medium.minVramGb || hw.ramGb >= HERMES_TIERS.medium.minRamGb) pick = HERMES_TIERS.medium;
  return { model: pick.model, tier: Object.keys(HERMES_TIERS).find((k) => HERMES_TIERS[k] === pick), label: pick.label };
}

/** Tuning hints derived from the picked tier — used by the Ollama runner. */
export function hermesTuning(tier) {
  if (tier === "large") return { numCtx: 4096, numPredict: 1024, latencyBudgetMs: 30000 };
  if (tier === "medium") return { numCtx: 2560, numPredict: 768, latencyBudgetMs: 20000 };
  // Small tier tuned for lightning-fast casual replies on 6 GB GPUs
  // (RTX 1660 Ti class): tight context so prompt eval is quick, and a
  // modest response cap so short prompts finish in a couple seconds.
  return { numCtx: 1024, numPredict: 220, latencyBudgetMs: 5000 };
}

export function hermesStatusLine(config) {
  const h = config.providers.hermes;
  if (!h?.enabled) return "off";
  const hw = detectHardware();
  const picked = pickHermesModel(h.model);
  const gpuTag = hw.hasGpu ? `${hw.gpuName || "GPU"} · ${hw.vramGb} GB VRAM` : `${hw.ramGb} GB RAM (CPU only — no NVIDIA GPU detected)`;
  return `${picked.label} · ${gpuTag}`;
}
