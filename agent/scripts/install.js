#!/usr/bin/env node
/**
 * YORU one-shot installer / hardware autotuner.
 *
 * Runs automatically after `npm install` (postinstall) and can be re-run any
 * time with `npm run setup`. It:
 *   1. Checks the Node.js version and rebuilds native modules if needed.
 *   2. Creates .env from .env.example when missing.
 *   3. Detects CPU / RAM / GPU + VRAM on Linux, Windows and macOS.
 *   4. Picks the fastest chat + coding Ollama models that fit that hardware.
 *   5. Writes tuned OLLAMA_* settings into .env.
 *   6. Pre-pulls the chosen models if Ollama is already running.
 *
 * It NEVER fails the install: every step is guarded and the process exits 0.
 */
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ENV_PATH = path.join(ROOT, ".env");
const EXAMPLE_PATH = path.join(ROOT, ".env.example");

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  purple: "\x1b[38;5;141m", magenta: "\x1b[38;5;177m",
  green: "\x1b[38;5;120m", yellow: "\x1b[38;5;222m", red: "\x1b[38;5;210m",
  cyan: "\x1b[38;5;117m", grey: "\x1b[38;5;245m",
};
const line = (ch = "─") => C.purple + ch.repeat(62) + C.reset;
const say = (tag, msg, color = C.cyan) =>
  console.log(`${color}${C.bold} ${tag.padEnd(9)}${C.reset}${C.grey}│${C.reset} ${msg}`);
const ok = (m) => say("ok", m, C.green);
const info = (m) => say("info", m, C.cyan);
const warn = (m) => say("warn", m, C.yellow);

function banner() {
  console.log("\n" + line());
  console.log(`${C.magenta}${C.bold}   Y O R U ${C.reset}${C.grey}·${C.reset} ${C.purple}hardware-aware installer${C.reset}`);
  console.log(line() + "\n");
}

// ─────────────────────────── hardware detection ───────────────────────────

const bytesToGb = (b) => Math.round((b / 1024 ** 3) * 10) / 10;

async function tryRun(cmd, args, timeout = 8000) {
  try {
    const { stdout } = await run(cmd, args, { timeout, windowsHide: true });
    return String(stdout || "");
  } catch {
    return "";
  }
}

/** NVIDIA works identically on every OS when the driver is installed. */
async function detectNvidia() {
  const out = await tryRun("nvidia-smi", [
    "--query-gpu=name,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  const first = out.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  if (!first) return null;
  const [name, mib] = first.split(",").map((s) => s.trim());
  const vramGb = Math.round((Number(mib) / 1024) * 10) / 10;
  if (!Number.isFinite(vramGb) || vramGb <= 0) return null;
  return { vendor: "nvidia", name, vramGb };
}

async function detectAmdLinux() {
  const out = await tryRun("rocm-smi", ["--showmeminfo", "vram", "--csv"]);
  const m = out.match(/(\d{6,})/);
  if (m) {
    const vramGb = Math.round((Number(m[1]) / 1024 ** 3) * 10) / 10;
    if (vramGb > 0) return { vendor: "amd", name: "AMD GPU (ROCm)", vramGb };
  }
  const lspci = await tryRun("sh", ["-c", "lspci | grep -iE 'vga|3d|display'"]);
  const nameLine = lspci.split("\n").find(Boolean);
  if (nameLine && /amd|radeon/i.test(nameLine)) {
    return { vendor: "amd", name: nameLine.split(":").slice(2).join(":").trim() || "AMD GPU", vramGb: 0 };
  }
  if (nameLine) {
    return { vendor: "other", name: nameLine.split(":").slice(2).join(":").trim() || "GPU", vramGb: 0 };
  }
  return null;
}

async function detectWindowsGpu() {
  const ps = await tryRun("powershell", [
    "-NoProfile", "-Command",
    "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
  ], 15000);
  try {
    const parsed = JSON.parse(ps);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    // AdapterRAM is a 32-bit field and caps at 4 GB — treat it as a floor only.
    const best = list
      .map((g) => ({ name: String(g.Name || "GPU"), vramGb: bytesToGb(Number(g.AdapterRAM || 0)) }))
      .sort((a, b) => b.vramGb - a.vramGb)[0];
    if (best?.name) {
      const vendor = /nvidia|geforce|rtx|gtx/i.test(best.name) ? "nvidia"
        : /radeon|amd/i.test(best.name) ? "amd" : "other";
      return { vendor, name: best.name, vramGb: best.vramGb };
    }
  } catch { /* fall through */ }
  return null;
}

async function detectMacGpu() {
  const out = await tryRun("system_profiler", ["SPDisplaysDataType"], 15000);
  const nameLine = out.split("\n").find((l) => /Chipset Model:/.test(l));
  if (!nameLine) return null;
  const name = nameLine.split(":")[1]?.trim() || "Apple GPU";
  // Apple Silicon shares system memory with the GPU; ~65% is usable for models.
  const vramGb = Math.round(bytesToGb(os.totalmem()) * 0.65 * 10) / 10;
  return { vendor: "apple", name, vramGb, unified: true };
}

async function detectGpu() {
  const nv = await detectNvidia();
  if (nv) return nv;
  if (process.platform === "win32") return (await detectWindowsGpu()) || null;
  if (process.platform === "darwin") return (await detectMacGpu()) || null;
  return (await detectAmdLinux()) || null;
}

async function detectSpecs() {
  const cpus = os.cpus() || [];
  const gpu = await detectGpu();
  return {
    platform: process.platform,
    osLabel: process.platform === "win32" ? `Windows ${os.release()}`
      : process.platform === "darwin" ? `macOS ${os.release()}`
      : `Linux ${os.release()}`,
    cpuModel: (cpus[0]?.model || "Unknown CPU").replace(/\s+/g, " ").trim(),
    cpuCores: cpus.length || 4,
    ramGb: bytesToGb(os.totalmem()),
    gpu,
  };
}

// ───────────────────────────── model selection ─────────────────────────────

/**
 * Tiers are ordered strongest-first. `vram` is the minimum dedicated VRAM in GB
 * needed to keep the model AND its KV cache fully on the GPU — the moment a
 * model spills to system RAM, tok/s collapses, so we stay deliberately
 * conservative here. Speed beats size for chat; the coder can be heavier.
 */
const TIERS = [
  {
    vram: 22, label: "workstation",
    chat: "qwen2.5:14b-instruct-q4_K_M", code: "qwen2.5-coder:32b-instruct-q4_K_M",
    ctx: 8192, predict: 768, batch: 1024,
  },
  {
    vram: 15, label: "high-end",
    chat: "qwen2.5:14b-instruct-q4_K_M", code: "qwen2.5-coder:14b-instruct-q4_K_M",
    ctx: 8192, predict: 640, batch: 1024,
  },
  {
    vram: 11, label: "enthusiast",
    chat: "qwen2.5:7b-instruct-q4_K_M", code: "qwen2.5-coder:14b-instruct-q4_K_M",
    ctx: 8192, predict: 512, batch: 768,
  },
  {
    vram: 7.5, label: "mainstream",
    chat: "qwen2.5:7b-instruct-q4_K_M", code: "qwen2.5-coder:7b-instruct-q4_K_M",
    ctx: 4096, predict: 384, batch: 512,
  },
  {
    // RTX 1660 Ti / 2060 / 3050 class — 3B chat keeps replies snappy.
    vram: 5.5, label: "midrange",
    chat: "qwen2.5:3b-instruct-q4_K_M", code: "qwen2.5-coder:7b-instruct-q4_K_M",
    ctx: 2048, predict: 220, batch: 512,
  },
  {
    vram: 3.5, label: "entry GPU",
    chat: "qwen2.5:3b-instruct-q4_K_M", code: "qwen2.5-coder:3b-instruct-q4_K_M",
    ctx: 2048, predict: 200, batch: 384,
  },
  {
    vram: 0, label: "CPU-only / integrated",
    chat: "qwen2.5:1.5b-instruct-q4_K_M", code: "qwen2.5-coder:1.5b-instruct-q4_K_M",
    ctx: 1536, predict: 180, batch: 256,
  },
];

function pickModels(specs) {
  const gpu = specs.gpu;
  let vram = gpu?.vramGb ?? 0;

  // Windows' AdapterRAM caps at 4 GB and integrated GPUs report junk — when the
  // card is clearly a discrete NVIDIA part but reports <=4 GB, don't trust it.
  if (gpu && gpu.vendor === "nvidia" && vram <= 4.1 && process.platform === "win32") vram = 5.5;
  // Unified-memory Macs and CPU-only boxes are also limited by system RAM.
  const ramCeiling = Math.max(0, specs.ramGb - 6);
  const effective = gpu?.unified ? Math.min(vram, ramCeiling) : vram > 0 ? vram : Math.min(4, ramCeiling);

  const tier = TIERS.find((t) => effective >= t.vram) || TIERS[TIERS.length - 1];

  // Threads: leave headroom for the OS, and never exceed physical-ish cores.
  const threads = Math.max(2, Math.min(specs.cpuCores - 2, 16));

  return {
    ...tier,
    effectiveVram: effective,
    threads: gpu && !gpu.unified && vram >= 3.5 ? 0 : threads, // 0 = let Ollama decide on GPU rigs
    numGpu: gpu ? 999 : 0,
  };
}

// ───────────────────────────────── env file ─────────────────────────────────

async function ensureEnv() {
  try {
    await fs.access(ENV_PATH);
    return false;
  } catch {
    const example = await fs.readFile(EXAMPLE_PATH, "utf8").catch(() => "");
    await fs.writeFile(ENV_PATH, example, "utf8");
    return true;
  }
}

async function patchEnv(updates) {
  let text = await fs.readFile(ENV_PATH, "utf8").catch(() => "");
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^${key}=.*$`, "m");
    const row = `${key}=${value}`;
    if (re.test(text)) text = text.replace(re, row);
    else text += (text === "" || text.endsWith("\n") ? "" : "\n") + row + "\n";
  }
  if (!text.endsWith("\n")) text += "\n";
  await fs.writeFile(ENV_PATH, text, "utf8");
}

// ───────────────────────────────── ollama ─────────────────────────────────

const OLLAMA_URL = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/$/, "");

async function ollamaReachable() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

async function installedModels() {
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
    const b = await r.json();
    return (b.models || []).map((m) => m.name);
  } catch { return []; }
}

async function pull(model) {
  info(`pulling ${C.bold}${model}${C.reset}${C.grey} — one-time download, this can take a while…`);
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: model, stream: false }),
  });
  if (!res.ok) throw new Error(`pull failed (${res.status})`);
  ok(`${model} ready`);
}

function ollamaInstallHint() {
  if (process.platform === "win32") {
    warn("Ollama not detected. Install it from https://ollama.com/download/windows, then re-run: npm run setup");
  } else if (process.platform === "darwin") {
    warn("Ollama not detected. Install it: brew install ollama && ollama serve — then re-run: npm run setup");
  } else {
    warn("Ollama not detected. Install it:");
    console.log(`${C.grey}            curl -fsSL https://ollama.com/install.sh | sh${C.reset}`);
    console.log(`${C.grey}            ollama serve   ${C.dim}# then re-run: npm run setup${C.reset}`);
  }
}

// ───────────────────────────── native modules ─────────────────────────────

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 20) {
    warn(`Node ${process.versions.node} detected — YORU needs Node 20+ (22 recommended).`);
    console.log(`${C.grey}            curl -fsSL https://fnm.vercel.app/install | bash && fnm install 22${C.reset}`);
    return false;
  }
  ok(`Node ${process.versions.node}`);
  return true;
}

function verifyNativeModules() {
  // better-sqlite3 is compiled against a specific Node ABI. After a Node
  // upgrade the prebuilt binary stops loading, so rebuild it automatically.
  try {
    execFileSync(process.execPath, ["-e", "require('better-sqlite3')"], {
      cwd: ROOT, stdio: "ignore", timeout: 30000,
    });
    ok("native modules OK (better-sqlite3)");
  } catch {
    warn("better-sqlite3 was built for a different Node version — rebuilding…");
    try {
      execFileSync("npm", ["rebuild", "better-sqlite3"], { cwd: ROOT, stdio: "inherit", timeout: 10 * 60 * 1000 });
      ok("better-sqlite3 rebuilt");
    } catch {
      warn("Automatic rebuild failed. Run manually:  cd agent && npm rebuild better-sqlite3");
    }
  }
}

// ─────────────────────────────────── main ───────────────────────────────────

async function main() {
  banner();

  checkNode();
  verifyNativeModules();

  const created = await ensureEnv();
  ok(created ? ".env created from .env.example" : ".env found (existing values preserved)");

  info("scanning hardware…");
  const specs = await detectSpecs();
  const pickedModels = pickModels(specs);

  console.log("");
  console.log(`${C.purple}  system${C.reset}`);
  console.log(`${C.grey}   os     ${C.reset}${specs.osLabel}`);
  console.log(`${C.grey}   cpu    ${C.reset}${specs.cpuModel} ${C.grey}(${specs.cpuCores} threads)${C.reset}`);
  console.log(`${C.grey}   ram    ${C.reset}${specs.ramGb} GB`);
  console.log(`${C.grey}   gpu    ${C.reset}${specs.gpu ? `${specs.gpu.name}${specs.gpu.vramGb ? ` · ${specs.gpu.vramGb} GB VRAM` : ""}` : "none detected (CPU inference)"}`);
  console.log("");
  console.log(`${C.purple}  selected profile ${C.reset}${C.bold}${pickedModels.label}${C.reset} ${C.grey}(~${pickedModels.effectiveVram} GB usable)${C.reset}`);
  console.log(`${C.grey}   chat   ${C.reset}${C.green}${pickedModels.chat}${C.reset}`);
  console.log(`${C.grey}   code   ${C.reset}${C.green}${pickedModels.code}${C.reset}`);
  console.log(`${C.grey}   tuning ${C.reset}ctx ${pickedModels.ctx} · predict ${pickedModels.predict} · batch ${pickedModels.batch}`);
  console.log("");

  await patchEnv({
    OLLAMA_MODEL: pickedModels.chat,
    OLLAMA_CODE_MODEL: pickedModels.code,
    OLLAMA_NUM_CTX: pickedModels.ctx,
    OLLAMA_NUM_PREDICT: pickedModels.predict,
    OLLAMA_NUM_BATCH: pickedModels.batch,
    OLLAMA_NUM_GPU: pickedModels.numGpu,
    OLLAMA_NUM_THREAD: pickedModels.threads,
    OLLAMA_HISTORY_MESSAGES: pickedModels.ctx >= 4096 ? 8 : 4,
  });
  ok("tuned Ollama settings written to .env");

  if (await ollamaReachable()) {
    const have = await installedModels();
    const want = [pickedModels.chat, pickedModels.code];
    const missing = want.filter((m) => !have.includes(m));
    if (!missing.length) ok("all selected models already installed");
    for (const m of missing) {
      try { await pull(m); }
      catch (e) { warn(`could not pull ${m}: ${e.message} — Yoru will pull it on first use`); }
    }
  } else {
    ollamaInstallHint();
  }

  console.log("\n" + line());
  console.log(`${C.green}${C.bold}  Setup complete.${C.reset}  ${C.grey}Add your tokens to ${C.reset}agent/.env${C.grey}, then run:${C.reset} ${C.magenta}npm run yoru${C.reset}`);
  console.log(line() + "\n");
}

main().catch((err) => {
  console.log(`${C.yellow}[setup] skipped: ${err.message}${C.reset}`);
  process.exit(0);
});
