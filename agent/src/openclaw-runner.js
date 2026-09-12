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

export async function startOpenClaw() {
  if (!config.providers.openclaw.enabled) return;
  if (!process.env.OPENCLAW_AUTOSTART || process.env.OPENCLAW_AUTOSTART === "false") return;

  if (await pingBase()) { log.ok("openclaw", "gateway already running"); return; }

  const bin = resolveBin();
  if (!bin) {
    log.warn("openclaw", "not installed. Run: npm run openclaw:setup");
    return;
  }

  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    log.warn("openclaw", `needs Node 22+, you're on v${process.versions.node}. Upgrade Node, then run: npm run openclaw:setup`);
    return;
  }

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
    });

    // Poll for readiness (up to 30s)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      if (await pingBase()) { log.ok("openclaw", "gateway ready"); return; }
    }
    log.warn("openclaw", "gateway did not respond within 30s — will keep retrying in background");
  } catch (e) {
    log.err("openclaw", `failed to spawn: ${e.message}`);
  }
}

process.on("exit", () => { try { child?.kill(); } catch {} });
process.on("SIGINT", () => { try { child?.kill(); } catch {} });
