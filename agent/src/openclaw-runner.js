// Auto-start the local OpenClaw gateway if enabled.
import { spawn, execSync, execFile } from "node:child_process";
import { platform, homedir } from "node:os";
import { existsSync, promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./boot-ui.js";

const run = promisify(execFile);
const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_BIN = path.join(AGENT_DIR, "vendor", "openclaw", "node_modules", ".bin", platform() === "win32" ? "openclaw.cmd" : "openclaw");
const ENV_PATH = path.join(AGENT_DIR, ".env");

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

async function fetchTimeout(url, ms = 2500) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { signal: ac.signal }); }
  catch { return null; }
  finally { clearTimeout(t); }
}

/** Is an OpenAI-compatible gateway answering at this base (…/v1)? */
async function probe(base) {
  const root = base.replace(/\/v1$/, "");
  const h = await fetchTimeout(root + "/health");
  if (h && h.ok) return true;
  const m = await fetchTimeout(base + "/models");
  return !!(m && (m.ok || m.status === 401));
}

async function pingBase() {
  return probe(config.providers.openclaw.base);
}

async function patchEnvBase(url) {
  try {
    let text = await fsp.readFile(ENV_PATH, "utf8").catch(() => "");
    const re = /^OPENCLAW_BASE_URL=.*$/m;
    if (re.test(text)) text = text.replace(re, `OPENCLAW_BASE_URL=${url}`);
    else text += (text.endsWith("\n") || text === "" ? "" : "\n") + `OPENCLAW_BASE_URL=${url}\n`;
    await fsp.writeFile(ENV_PATH, text, "utf8");
  } catch {}
}

function adoptBase(url) {
  if (config.providers.openclaw.base === url) return;
  config.providers.openclaw.base = url;
  process.env.OPENCLAW_BASE_URL = url;
  log.ok("openclaw", `gateway found at ${url}`);
  patchEnvBase(url);
}

/** Ports OpenClaw commonly binds to. Skips Yoru's own 8787/8788/8789. */
const CANDIDATE_PORTS = [8080, 8081, 8088, 18080, 4141, 3000, 11435];

async function portsFromCli(bin) {
  if (!bin) return [];
  const out = await run(bin, ["gateway", "status"], { timeout: 8000, windowsHide: true })
    .then((r) => `${r.stdout || ""}${r.stderr || ""}`)
    .catch((e) => `${e?.stdout || ""}${e?.stderr || ""}`);
  const ports = [];
  for (const m of String(out).matchAll(/(?:https?:\/\/[^\s:]+:)?(\d{2,5})(?=\D|$)/g)) {
    const p = Number(m[1]);
    if (p >= 1024 && p <= 65535) ports.push(p);
  }
  return ports;
}

async function portsFromConfigFile() {
  try {
    const raw = await fsp.readFile(path.join(homedir(), ".openclaw", "config.json"), "utf8");
    const ports = [];
    for (const m of raw.matchAll(/"(?:port|gateway_port|listen_port)"\s*:\s*(\d{2,5})/g)) ports.push(Number(m[1]));
    for (const m of raw.matchAll(/https?:\/\/[^"]*?:(\d{2,5})/g)) ports.push(Number(m[1]));
    return ports;
  } catch { return []; }
}

/**
 * The gateway process can be alive on a port that isn't the one we assume
 * (that's the "service already running (pid …)" + no response case). Hunt for
 * the real one and adopt it.
 */
async function discoverBase(bin) {
  if (await pingBase()) return true;
  const seen = new Set();
  const ports = [...(await portsFromCli(bin)), ...(await portsFromConfigFile()), ...CANDIDATE_PORTS]
    .filter((p) => Number.isFinite(p) && ![8787, 8788, 8789].includes(p) && !seen.has(p) && seen.add(p));
  for (const port of ports) {
    for (const host of ["127.0.0.1", "localhost"]) {
      const base = `http://${host}:${port}/v1`;
      if (base === config.providers.openclaw.base) continue;
      if (await probe(base)) { adoptBase(base); return true; }
    }
  }
  return false;
}

/** Kill a stale/hung daemon so the next start actually binds. */
async function hardRestart(bin) {
  if (!bin) return;
  log.info("openclaw", "gateway is registered but not answering — restarting it…");
  for (const args of [["gateway", "stop"], ["gateway", "restart"]]) {
    const ok = await run(bin, args, { timeout: 15000, windowsHide: true }).then(() => true).catch(() => false);
    if (args[1] === "restart" && ok) return;
  }
  try {
    child = spawn(bin, ["gateway", "start"], { stdio: "ignore", shell: platform() === "win32", detached: false });
  } catch {}
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

  // A daemon may already be up on a port we don't know about.
  if (await discoverBase(bin)) return true;

  let sawAlreadyRunning = false;
  const noteLine = (line) => { if (/already running/i.test(line)) sawAlreadyRunning = true; };

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
        if (!line) return;
        noteLine(line);
        log.info("openclaw", line.split("\n")[0].slice(0, 160));
      });
      child.stderr.on("data", (b) => {
        const line = b.toString().trim();
        if (!line) return;
        noteLine(line);
        log.warn("openclaw", line.split("\n")[0].slice(0, 160));
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

  // Poll for readiness, with one hard restart if a stale daemon owns the pidfile.
  let restarted = false;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await pingBase()) { log.ok("openclaw", "gateway ready"); return true; }
    if (i === 8 && (await discoverBase(bin))) return true;
    if (!restarted && i >= 12 && (sawAlreadyRunning || child === null)) {
      restarted = true;
      await hardRestart(bin);
    }
    if (i === 40 && (await discoverBase(bin))) return true;
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
  if (await discoverBase(resolveBin())) return true;
  if (!ensuring) {
    ensuring = startOpenClaw({ force: true, autoInstall: true })
      .catch(() => false)
      .finally(() => { ensuring = null; });
  }
  return ensuring;
}

process.on("exit", () => { try { child?.kill(); } catch {} });
process.on("SIGINT", () => { try { child?.kill(); } catch {} });
