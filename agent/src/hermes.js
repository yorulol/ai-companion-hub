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

/** Best-effort GPU VRAM detection (NVIDIA via nvidia-smi). */
function detectVramGb() {
  try {
    const r = spawnSync("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], { encoding: "utf8", timeout: 3000 });
    if (r.status === 0 && r.stdout) {
      const mib = r.stdout.split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
      if (mib.length) return Math.round((mib.reduce((a, b) => a + b, 0) / 1024) * 10) / 10;
    }
  } catch {}
  return 0;
}

export function detectHardware(force = false) {
  if (CACHED_HW && !force) return CACHED_HW;
  const ramGb = Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
  const cpus = os.cpus() || [];
  const vramGb = detectVramGb();
  CACHED_HW = {
    platform: process.platform,
    arch: process.arch,
    ramGb,
    vramGb,
    cpuCount: cpus.length,
    cpuModel: cpus[0]?.model?.trim() || "unknown",
    hasGpu: vramGb > 0,
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
  return `${picked.label} · ${hw.hasGpu ? `${hw.vramGb} GB VRAM` : `${hw.ramGb} GB RAM (CPU)`}`;
}
