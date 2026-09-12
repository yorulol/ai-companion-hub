// Hardware detection + best-free-model picker for OpenClaw.
// Runs on `npm start` before the gateway boots so users on any machine get a
// sensible model/tuning profile without touching the config manually.
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { log } from "./boot-ui.js";
import { config } from "./config.js";

const run = promisify(execFile);
const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = path.join(AGENT_DIR, "vendor", "openclaw");
const LOCAL_BIN = path.join(VENDOR_DIR, "node_modules", ".bin", platform() === "win32" ? "openclaw.cmd" : "openclaw");
const ENV_PATH = path.join(AGENT_DIR, ".env");
const AUTOTUNE_STAMP = path.join(VENDOR_DIR, ".yoru-autotune.json");

const bytesToGb = (b) => Math.round((b / 1024 ** 3) * 10) / 10;

async function tryRun(cmd, args, timeout = 6000) {
  try { const { stdout } = await run(cmd, args, { timeout, windowsHide: true }); return String(stdout || ""); }
  catch { return ""; }
}

async function detectGpu() {
  const nv = await tryRun("nvidia-smi", ["--query-gpu=name,memory.total", "--format=csv,noheader,nounits"]);
  const nvLine = nv.split("\n").map((l) => l.trim()).filter(Boolean)[0];
  if (nvLine) {
    const [name, mib] = nvLine.split(",").map((s) => s.trim());
    const vramGb = Math.round((Number(mib) / 1024) * 10) / 10;
    if (Number.isFinite(vramGb) && vramGb > 0) return { vendor: "nvidia", name, vramGb };
  }
  if (process.platform === "darwin") {
    const out = await tryRun("system_profiler", ["SPDisplaysDataType"], 12000);
    const nameLine = out.split("\n").find((l) => /Chipset Model:/.test(l));
    if (nameLine) {
      const name = nameLine.split(":")[1]?.trim() || "Apple GPU";
      return { vendor: "apple", name, vramGb: Math.round(bytesToGb(os.totalmem()) * 0.6 * 10) / 10, unified: true };
    }
  }
  return null;
}

async function detectSpecs() {
  const cpus = os.cpus() || [];
  return {
    platform: process.platform,
    cpuCores: cpus.length || 4,
    ramGb: bytesToGb(os.totalmem()),
    gpu: await detectGpu(),
  };
}

/** Pick a real Ollama model that fits locally. OpenClaw is the agent gateway,
 * not a model provider, so its HTTP API uses these through ollama/<model>. */
const TIERS = [
  { min: 22, label: "workstation", model: "qwen2.5:14b-instruct-q4_K_M", ctx: 8192, threads: 0 },
  { min: 11, label: "high-end", model: "qwen2.5:7b-instruct-q4_K_M", ctx: 8192, threads: 0 },
  { min: 5, label: "midrange", model: "qwen2.5:3b-instruct-q4_K_M", ctx: 4096, threads: 0 },
  { min: 3, label: "entry GPU", model: "qwen2.5:3b-instruct-q4_K_M", ctx: 2048, threads: 0 },
  { min: 0, label: "cpu-only", model: "qwen2.5:1.5b-instruct-q4_K_M", ctx: 2048, threads: 0 },
];

function pickProfile(specs) {
  const gpu = specs.gpu;
  let vram = gpu?.vramGb ?? 0;
  if (gpu?.unified) vram = Math.min(vram, Math.max(0, specs.ramGb - 6));
  if (!gpu) vram = Math.min(4, Math.max(0, specs.ramGb - 6));
  const tier = TIERS.find((t) => vram >= t.min) || TIERS[TIERS.length - 1];
  const threads = Math.max(2, Math.min(specs.cpuCores - 2, 16));
  return { ...tier, threads: gpu && !gpu.unified && vram >= 4 ? 0 : threads, vram };
}

async function patchEnv(updates) {
  let text = await fs.readFile(ENV_PATH, "utf8").catch(() => "");
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*$`, "m");
    const row = `${k}=${v}`;
    if (re.test(text)) text = text.replace(re, row); else text += (text.endsWith("\n") || text === "" ? "" : "\n") + row + "\n";
  }
  if (!text.endsWith("\n")) text += "\n";
  await fs.writeFile(ENV_PATH, text, "utf8");
}

/**
 * Write the documented OpenClaw config without clobbering onboarding fields.
 * The OpenAI-compatible HTTP endpoint is disabled unless explicitly enabled.
 */
async function writeOpenclawConfig(profile) {
  const cfgDir = path.join(os.homedir(), ".openclaw");
  const cfgPath = path.join(cfgDir, "openclaw.json");
  await fs.mkdir(cfgDir, { recursive: true });
  let existing = {};
  try { existing = JSON.parse(await fs.readFile(cfgPath, "utf8")); } catch {}
  const token = (process.env.OPENCLAW_API_KEY || existing.gateway?.auth?.token || randomBytes(32).toString("hex")).trim();
  const modelId = (config.providers.ollama.model || profile.model).trim();
  const merged = {
    ...existing,
    gateway: {
      ...(existing.gateway || {}),
      mode: "local",
      port: existing.gateway?.port || 18789,
      bind: "loopback",
      auth: { ...(existing.gateway?.auth || {}), mode: "token", token },
      http: {
        ...(existing.gateway?.http || {}),
        endpoints: {
          ...(existing.gateway?.http?.endpoints || {}),
          chatCompletions: { enabled: true },
        },
      },
    },
    models: {
      ...(existing.models || {}),
      providers: {
        ...(existing.models?.providers || {}),
        ollama: {
          ...(existing.models?.providers?.ollama || {}),
          baseUrl: config.providers.ollama.url,
          apiKey: "ollama-local",
          api: "ollama",
          models: [{ id: modelId, name: modelId, input: ["text"], contextTokens: profile.ctx, params: { num_ctx: profile.ctx, keep_alive: "24h" } }],
        },
      },
    },
    agents: {
      ...(existing.agents || {}),
      defaults: { ...(existing.agents?.defaults || {}), model: { primary: `ollama/${modelId}` } },
    },
  };
  await fs.writeFile(cfgPath, JSON.stringify(merged, null, 2), "utf8");
  return { token, port: merged.gateway.port };
}

function nodeOk() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  return (maj === 24 && min >= 16) || maj >= 26;
}

/** Install openclaw locally & non-interactively into agent/vendor/openclaw. */
async function installVendored() {
  await fs.mkdir(VENDOR_DIR, { recursive: true });
  const pkg = path.join(VENDOR_DIR, "package.json");
  if (!existsSync(pkg)) {
    await fs.writeFile(pkg, JSON.stringify({ name: "yoru-openclaw-host", private: true, version: "0.0.0" }, null, 2));
  }
  await new Promise((resolve, reject) => {
    const p = spawn("npm", ["install", "--prefix", VENDOR_DIR, "openclaw@latest", "--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"], {
      stdio: "ignore", shell: platform() === "win32",
    });
    p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm exited ${code}`)));
    p.on("error", reject);
  });
  // Run openclaw's bundled-plugin postinstall by hand (ignore-scripts skipped it).
  const post = path.join(VENDOR_DIR, "node_modules", "openclaw", "scripts", "postinstall-bundled-plugins.mjs");
  if (existsSync(post)) {
    await new Promise((resolve) => {
      const p = spawn(process.execPath, [post], { cwd: path.dirname(path.dirname(post)), stdio: "ignore" });
      p.on("exit", () => resolve()); p.on("error", () => resolve());
    });
  }
}

/**
 * Runs before startOpenClaw(): detects specs, picks profile, writes .env +
 * openclaw config, and (if missing) installs openclaw locally. Idempotent —
 * re-runs only when the machine's spec fingerprint changes.
 */
export async function autotuneOpenClaw({ force = false } = {}) {
  if (!config.providers.openclaw.enabled) return null;

  const specs = await detectSpecs();
  const profile = pickProfile(specs);
  const fingerprint = `${specs.platform}|${specs.cpuCores}|${specs.ramGb}|${specs.gpu?.name || "none"}|${specs.gpu?.vramGb || 0}|${profile.model}`;

  let cached = null;
  try { cached = JSON.parse(await fs.readFile(AUTOTUNE_STAMP, "utf8")); } catch {}
  const alreadyTuned = !force && cached?.fingerprint === fingerprint && existsSync(LOCAL_BIN);


  if (!alreadyTuned) {
    log.info("openclaw", `autotuning for ${specs.gpu ? `${specs.gpu.name} · ${specs.gpu.vramGb} GB VRAM` : "CPU-only"} → profile "${profile.label}" (${profile.model})`);
  }

  try {
    const gateway = await writeOpenclawConfig(profile);
    const base = `http://127.0.0.1:${gateway.port}/v1`;
    await patchEnv({ OPENCLAW_AUTOSTART: "true", OPENCLAW_MODEL: "openclaw/default", OPENCLAW_API_KEY: gateway.token, OPENCLAW_BASE_URL: base });
    Object.assign(config.providers.openclaw, { model: "openclaw/default", key: gateway.token, base });
    Object.assign(process.env, { OPENCLAW_MODEL: "openclaw/default", OPENCLAW_API_KEY: gateway.token, OPENCLAW_BASE_URL: base });
  } catch (e) { log.warn("openclaw", `could not write OpenClaw config: ${e.message}`); }

  // Auto-install if missing (silent, no interactive onboarding).
  if (!existsSync(LOCAL_BIN)) {
    if (!nodeOk()) {
      log.warn("openclaw", `auto-install skipped — needs Node 24.16+ or 26.1+, you're on v${process.versions.node}`);
    } else {
      log.info("openclaw", "not installed — auto-installing locally (this runs once, ~30-90s)…");
      try { await installVendored(); log.ok("openclaw", "installed"); }
      catch (e) { log.warn("openclaw", `auto-install failed: ${e.message}. Run: npm run openclaw:setup`); }
    }
  }

  try {
    await fs.mkdir(VENDOR_DIR, { recursive: true });
    await fs.writeFile(AUTOTUNE_STAMP, JSON.stringify({ fingerprint, profile, specs, at: Date.now() }, null, 2));
  } catch {}

  if (!alreadyTuned) log.ok("openclaw", `tuned → ollama/${profile.model} · ctx=${profile.ctx} · threads=${profile.threads || "auto"}`);
  return profile;
}
