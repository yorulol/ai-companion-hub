// Auto-start the local OpenClaw gateway if enabled.
import { spawn, execSync } from "node:child_process";
import { platform } from "node:os";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./boot-ui.js";

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_BIN = path.join(AGENT_DIR, "vendor", "openclaw", "node_modules", ".bin", platform() === "win32" ? "openclaw.cmd" : "openclaw");

let child = null;

function has(cmd) {
  try {
    execSync(platform() === "win32" ? `where ${cmd}` : `command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch { return false; }
}

function resolveBin() {
  // Prefer the vendored local install; fall back to a global one.
  if (existsSync(LOCAL_BIN)) return LOCAL_BIN;
  if (has("openclaw")) return "openclaw";
  return null;
}

async function pingBase() {
  try {
    const r = await fetch(config.providers.openclaw.base.replace(/\/v1$/, "") + "/health", { method: "GET" }).catch(() => null);
    if (r && r.ok) return true;
  } catch {}
  try {
    const r = await fetch(config.providers.openclaw.base + "/models", { method: "GET" }).catch(() => null);
    return !!(r && (r.ok || r.status === 401));
  } catch { return false; }
}

export async function startOpenClaw({ force = false, autoInstall = false } = {}) {
  if (!config.providers.openclaw.enabled) return false;
  if (!force && (!process.env.OPENCLAW_AUTOSTART || process.env.OPENCLAW_AUTOSTART === "false")) return false;

  if (await pingBase()) { log.ok("openclaw", "gateway already running"); return true; }

  const [maj, min] = process.versions.node.split(".").map(Number);
  const nodeOk = (maj === 24 && min >= 16) || maj >= 26;
  if (!nodeOk) {
    log.warn("openclaw", `needs Node 24.16+ or 26.1+, you're on v${process.versions.node}. Upgrade Node, then run: npm run openclaw:setup`);
    return false;
  }

  let bin = resolveBin();
  if (!bin && autoInstall) {
    // Self-heal: run the hardware autotune (which installs OpenClaw locally).
    try {
      log.info("openclaw", "gateway missing — running auto-setup for this machine…");
      const { autotuneOpenClaw } = await import("./openclaw-autotune.js");
      await autotuneOpenClaw({ force: true });
    } catch (e) {
      log.warn("openclaw", `auto-setup failed: ${e.message}`);
    }
    bin = resolveBin();
  }
  if (!bin) {
    log.warn("openclaw", "not installed. Run: npm run openclaw:setup");
    return false;
  }

  if (child && !child.killed && child.exitCode === null) {
    // Already spawned; just wait for readiness below.
  } else {
    log.info("openclaw", `starting local gateway (${bin === "openclaw" ? "openclaw" : "local install"})…`);
    try {
      child = spawn(bin, ["gateway", "start"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: platform() === "win32",
        detached: false,
      });
      child.stdout.on("data", (b) => {
        const line = b.toString().trim();
        if (line) log.info("openclaw", line.split("\n")[0].slice(0, 160));
      });
      child.stderr.on("data", (b) => {
        const line = b.toString().trim();
        if (line) log.warn("openclaw", line.split("\n")[0].slice(0, 160));
      });
      child.on("exit", (code) => {
        if (code !== 0) log.warn("openclaw", `gateway exited (${code}). Re-run: npm run openclaw:setup`);
        child = null;
      });
    } catch (e) {
      log.err("openclaw", `failed to spawn: ${e.message}`);
      return false;
    }
  }

  // Poll for readiness (up to 45s)
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await pingBase()) { log.ok("openclaw", "gateway ready"); return true; }
  }
  log.warn("openclaw", "gateway did not respond in time — will keep retrying in background");
  return false;
}

/**
 * Idempotent, de-duplicated "make OpenClaw work right now" entry point used by
 * the AI router when a request hits an unreachable gateway. Installs + tunes
 * for the machine if needed, then starts and waits for readiness.
 */
let ensuring = null;
export async function ensureOpenClaw() {
  if (await pingBase()) return true;
  if (!ensuring) {
    ensuring = startOpenClaw({ force: true, autoInstall: true })
      .catch(() => false)
      .finally(() => { ensuring = null; });
  }
  return ensuring;
}


process.on("exit", () => { try { child?.kill(); } catch {} });
process.on("SIGINT", () => { try { child?.kill(); } catch {} });
