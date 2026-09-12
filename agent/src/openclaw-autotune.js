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

/**
 * OpenClaw ships a small set of routing profiles for its free tier. We pick
 * the strongest that will actually fit on the user's machine — an oversized
 * profile spills to CPU/RAM and destroys tok/s, so we err on the safe side.
 * Each profile maps to a real OpenClaw model ID; users can override in .env.
 */
const TIERS = [
  { min: 22, label: "workstation",  model: "openclaw-pro",       ctx: 8192, threads: 0 },
  { min: 11, label: "high-end",     model: "openclaw-balanced",  ctx: 8192, threads: 0 },
  { min: 7,  label: "mainstream",   model: "openclaw-default",   ctx: 4096, threads: 0 },
  { min: 5,  label: "midrange",     model: "openclaw-fast",      ctx: 2048, threads: 0 },
  { min: 3,  label: "entry GPU",    model: "openclaw-mini",      ctx: 2048, threads: 0 },
  { min: 0,  label: "cpu-only",     model: "openclaw-mini",      ctx: 1536, threads: 0 },
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
 * Write an OpenClaw gateway config file with the tuned profile. OpenClaw
 * reads ~/.openclaw/config.json on boot; we write a minimal profile there
 * without clobbering fields the onboarding wizard may have set.
 */
async function writeOpenclawConfig(profile) {
  const cfgDir = path.join(os.homedir(), ".openclaw");
  const cfgPath = path.join(cfgDir, "config.json");
  await fs.mkdir(cfgDir, { recursive: true });
  let existing = {};
  try { existing = JSON.parse(await fs.readFile(cfgPath, "utf8")); } catch {}
  const merged = {
    ...existing,
    defaults: {
      ...(existing.defaults || {}),
      model: profile.model,
      context_size: profile.ctx,
      num_threads: profile.threads,
      free_only: true,
    },
    tuning: {
      ...(existing.tuning || {}),
      profile: profile.label,
      auto_tuned_by: "yoru",
      auto_tuned_at: new Date().toISOString(),
    },
  };
  await fs.writeFile(cfgPath, JSON.stringify(merged, null, 2), "utf8");
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
export async function autotuneOpenClaw() {
  if (!config.providers.openclaw.enabled) return null;

  const specs = await detectSpecs();
  const profile = pickProfile(specs);
  const fingerprint = `${specs.platform}|${specs.cpuCores}|${specs.ramGb}|${specs.gpu?.name || "none"}|${specs.gpu?.vramGb || 0}|${profile.model}`;

  let cached = null;
  try { cached = JSON.parse(await fs.readFile(AUTOTUNE_STAMP, "utf8")); } catch {}
  const alreadyTuned = cached?.fingerprint === fingerprint;

  if (!alreadyTuned) {
    log.info("openclaw", `autotuning for ${specs.gpu ? `${specs.gpu.name} · ${specs.gpu.vramGb} GB VRAM` : "CPU-only"} → profile "${profile.label}" (${profile.model})`);
  }

  // Only rewrite OPENCLAW_MODEL when it's the stock default or unset — never
  // stomp a user's manual choice.
  const currentModel = (process.env.OPENCLAW_MODEL || "").trim();
  const shouldSetModel = !currentModel || currentModel === "openclaw-default";
  const envUpdates = { OPENCLAW_AUTOSTART: "true" };
  if (shouldSetModel) envUpdates.OPENCLAW_MODEL = profile.model;

  try { await patchEnv(envUpdates); } catch (e) { log.warn("openclaw", `could not write .env: ${e.message}`); }
  if (shouldSetModel) {
    config.providers.openclaw.model = profile.model;
    process.env.OPENCLAW_MODEL = profile.model;
  }
  try { await writeOpenclawConfig(profile); } catch (e) { log.warn("openclaw", `could not write ~/.openclaw/config.json: ${e.message}`); }

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

  if (!alreadyTuned) log.ok("openclaw", `tuned → model=${profile.model} · ctx=${profile.ctx} · threads=${profile.threads || "auto"}`);
  return profile;
}
