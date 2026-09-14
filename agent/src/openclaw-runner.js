// Auto-start the local OpenClaw gateway if enabled.
import { spawn, execSync, execFile } from "node:child_process";
import { platform, homedir } from "node:os";
import { existsSync, promises as fsp } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import path from "node:path";
import { config } from "./config.js";
import { log } from "./boot-ui.js";
import { OPENCLAW_NODE_REQUIREMENT, supportsOpenClawNode } from "./openclaw-runtime.js";

const run = promisify(execFile);
const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCAL_BIN = path.join(AGENT_DIR, "vendor", "openclaw", "node_modules", ".bin", platform() === "win32" ? "openclaw.cmd" : "openclaw");
const ENV_PATH = path.join(AGENT_DIR, ".env");

let child = null;
let startupAttempt = null;
let startupOptions = null;
let ensureAttempt = null;
let envWrite = Promise.resolve();
let skipConfiguredBaseOnce = false;
let lastFailure = "gateway has not completed a live model check";
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

async function fetchTimeout(url, ms = 4000, options = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try { return await fetch(url, { ...options, signal: ac.signal }); }
  catch { return null; }
  finally { clearTimeout(t); }
}

/** Is an OpenAI-compatible gateway answering at this base (…/v1)? */
async function probe(base) {
  const headers = config.providers.openclaw.key
    ? { Authorization: `Bearer ${config.providers.openclaw.key}` }
    : {};
  const m = await fetchTimeout(base + "/models", 4000, { headers });
  if (!m) return false;
  if (!m.ok) return false;
  const ct = m.headers.get("content-type") || "";
  if (!ct.includes("json")) return false;
  const body = await m.json().catch(() => null);
  const looksOpenAI = body && (Array.isArray(body.data) || Array.isArray(body.models));
  if (!looksOpenAI) return false;
  // A different service can expose /v1/models. Confirm OpenClaw's optional
  // chat route exists without causing a real generation: an empty request
  // should be rejected as bad input/auth, but must not be a 404.
  const chat = await fetchTimeout(base + "/chat/completions", 4000, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: "{}",
  });
  return Boolean(chat && chat.status !== 404);
}

async function pingBase() {
  return probe(config.providers.openclaw.base);
}

async function verifyGatewayModel(base = config.providers.openclaw.base) {
  const headers = {
    "content-type": "application/json",
    ...(config.providers.openclaw.key ? { Authorization: `Bearer ${config.providers.openclaw.key}` } : {}),
  };
  const started = Date.now();
  const response = await fetchTimeout(base + "/chat/completions", 180_000, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "openclaw/default",
      messages: [{ role: "user", content: "Reply with OK only." }],
      max_tokens: 4,
      temperature: 0,
    }),
  });
  if (!response) {
    lastFailure = `gateway model check got no response after ${Math.round((Date.now() - started) / 1000)}s`;
    return false;
  }
  const raw = await response.text().catch(() => "");
  if (!response.ok) {
    let detail = raw.slice(0, 240);
    try { detail = JSON.parse(raw)?.error?.message || detail; } catch {}
    if (response.status === 401 || response.status === 403) {
      lastFailure = `gateway rejected the API token (HTTP ${response.status}) — rerun: npm run openclaw:setup`;
    } else if (/not found|unknown model|no such model/i.test(detail)) {
      lastFailure = `gateway model missing in Ollama (HTTP ${response.status}): ${detail}`;
    } else if (/context|too large|num_ctx/i.test(detail)) {
      lastFailure = `gateway rejected the configured context window (HTTP ${response.status}): ${detail}`;
    } else {
      lastFailure = `gateway model check failed (HTTP ${response.status}): ${detail || "no detail"}`;
    }
    return false;
  }
  let body = null;
  try { body = JSON.parse(raw); } catch {}
  if (!body?.choices?.[0]?.message?.content?.trim()) {
    lastFailure = `gateway answered with empty content after ${Math.round((Date.now() - started) / 1000)}s`;
    return false;
  }
  return true;
}


async function patchEnvBase(url) {
  envWrite = envWrite.then(async () => {
    try {
      let text = await fsp.readFile(ENV_PATH, "utf8").catch(() => "");
      const re = /^OPENCLAW_BASE_URL=.*$/m;
      if (re.test(text)) text = text.replace(re, `OPENCLAW_BASE_URL=${url}`);
      else text += (text.endsWith("\n") || text === "" ? "" : "\n") + `OPENCLAW_BASE_URL=${url}\n`;
      await fsp.writeFile(ENV_PATH, text, "utf8");
    } catch {}
  });
  return envWrite;
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
    const raw = await fsp.readFile(path.join(homedir(), ".openclaw", "openclaw.json"), "utf8");
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
async function discoverBase(bin, { skipConfigured = false } = {}) {
  if (!skipConfigured && await pingBase()) {
    if (await verifyGatewayModel()) return true;
    lastFailure = "gateway answered, but its configured Ollama model failed the live chat check";
    return false;
  }
  const seen = new Set();
  const ports = [...(await portsFromCli(bin)), ...(await portsFromConfigFile()), ...CANDIDATE_PORTS]
    .filter((p) => Number.isFinite(p) && ![8787, 8788, 8789].includes(p) && !seen.has(p) && seen.add(p));
  for (const port of ports) {
    for (const host of ["127.0.0.1", "localhost"]) {
      const base = `http://${host}:${port}/v1`;
      if (base === config.providers.openclaw.base) continue;
      if (await probe(base)) {
        adoptBase(base);
        if (await verifyGatewayModel(base)) return true;
        lastFailure = `gateway at ${base} answered, but its configured Ollama model failed the live chat check`;
        return false;
      }
    }
  }
  return false;
}

/** Is anything at all holding this TCP port? (probe-agnostic) */
async function portBusy(port) {
  const { createConnection } = await import("node:net");
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port });
    const done = (v) => { try { sock.destroy(); } catch {} resolve(v); };
    sock.setTimeout(1200);
    sock.on("connect", () => done(true));
    sock.on("timeout", () => done(false));
    sock.on("error", () => done(false));
  });
}

/** Kill a spawned gateway and every child it created (Windows needs the tree). */
function killTree(proc) {
  if (!proc || proc.killed || proc.exitCode !== null) return;
  try {
    if (platform() === "win32") execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: "ignore" });
    else proc.kill("SIGTERM");
  } catch { try { proc.kill(); } catch {} }
}

async function stopUnhealthyService(bin) {
  const output = await run(bin, ["gateway", "stop", "--force", "--json"], {
    timeout: 30000,
    windowsHide: true,
  }).then((r) => `${r.stdout || ""}${r.stderr || ""}`).catch((e) => `${e?.stdout || ""}${e?.stderr || ""}`);

  // OpenClaw owns the native service, so let its service command clean up its
  // own PID and registration. Never scrape a PID and kill an unrelated process.
  for (let i = 0; i < 10; i++) {
    if (await pingBase()) return false;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (/error|failed|refus/i.test(output)) {
    log.warn("openclaw", "the stale managed service could not be stopped; starting an isolated foreground gateway instead");
  }
  return true;
}


async function startOpenClawOnce({ force = false, autoInstall = false } = {}) {
  if (!config.providers.openclaw.enabled) {
    lastFailure = "OpenClaw is disabled";
    return false;
  }
  if (!force && (!process.env.OPENCLAW_AUTOSTART || process.env.OPENCLAW_AUTOSTART === "false")) {
    lastFailure = "OpenClaw autostart is disabled";
    return false;
  }

  const configuredGatewayAnswered = await pingBase();
  if (configuredGatewayAnswered) {
    if (await verifyGatewayModel()) {
      lastFailure = "";
      log.ok("openclaw", "gateway and model already running");
      return true;
    }
    log.warn("openclaw", "gateway answered but its model failed — repairing it once");
  }

  if (!supportsOpenClawNode()) {
    lastFailure = `requires ${OPENCLAW_NODE_REQUIREMENT}; current runtime is v${process.versions.node}`;
    log.warn("openclaw", `${lastFailure}. Upgrade Node, then run: npm run openclaw:setup`);
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
      lastFailure = `automatic setup failed: ${e.message}`;
      log.warn("openclaw", `auto-setup failed: ${e.message}`);
    }
    bin = resolveBin();
  }
  if (!bin) {
    lastFailure = "OpenClaw is not installed";
    log.warn("openclaw", "not installed. Run: npm run openclaw:setup");
    return false;
  }

  // A daemon may already be up on a port we don't know about.
  if (!configuredGatewayAnswered && await discoverBase(bin)) {
    lastFailure = "";
    return true;
  }

  // `gateway start` controls an installed native service and is idempotent: it
  // will keep reporting an unhealthy registered PID forever. Yoru instead owns
  // one foreground `gateway run` process. Stop the stale service once, then run
  // a fresh process directly and wait for its actual HTTP API.
  await stopUnhealthyService(bin);

  const port = Number(new URL(config.providers.openclaw.base).port || 18789);

  // A previous `npm start` can leave an orphan gateway squatting on the port
  // (that's the "heartbeat on the first run, nothing on the second" case).
  // Give the stop command a moment, then free the port before we bind it.
  for (let i = 0; i < 12 && (await portBusy(port)); i++) {
    if (await pingBase()) break;
    if (i === 0) log.info("openclaw", `port ${port} still held by an old gateway — clearing it…`);
    if (i === 4) {
      try {
        if (platform() === "win32") {
          execSync(
            `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /PID %a /T /F`,
            { stdio: "ignore", shell: "cmd.exe" },
          );
        } else {
          execSync(`lsof -ti tcp:${port} | xargs -r kill -9`, { stdio: "ignore" });
        }
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (await pingBase()) {
    if (await verifyGatewayModel()) { lastFailure = ""; log.ok("openclaw", "gateway and model already running"); return true; }
  }

  let lastLine = "";
  if (child && !child.killed && child.exitCode === null) {
    // Already spawned; just wait for readiness below.
  } else {
    log.info("openclaw", `starting one local gateway (${bin === "openclaw" ? "openclaw" : "local install"})…`);
    try {
      child = spawn(bin, ["gateway", "run", "--port", String(port), "--bind", "loopback"], {
        stdio: ["ignore", "pipe", "pipe"],
        shell: platform() === "win32",
        detached: false,
        env: {
          ...process.env,
          OPENCLAW_GATEWAY_TOKEN: config.providers.openclaw.key || process.env.OPENCLAW_GATEWAY_TOKEN || "",
        },
      });
      child.stdout.on("data", (b) => {
        const line = b.toString().trim();
        if (!line) return;
        lastLine = line.split("\n").pop().slice(0, 200);
        log.info("openclaw", line.split("\n")[0].slice(0, 160));
      });
      child.stderr.on("data", (b) => {
        const line = b.toString().trim();
        if (!line) return;
        lastLine = line.split("\n").pop().slice(0, 200);
        log.warn("openclaw", line.split("\n")[0].slice(0, 160));
      });
      child.on("error", (e) => { lastLine = e.message; });
      child.on("exit", (code) => {
        if (code !== 0) log.warn("openclaw", `gateway exited (${code}). Re-run: npm run openclaw:setup`);
        child = null;
      });
    } catch (e) {
      lastFailure = `failed to start the gateway process: ${e.message}`;
      log.err("openclaw", `failed to spawn: ${e.message}`);
      return false;
    }
  }

  // Wait for the one process above. Do not restart inside this loop: a failure
  // is surfaced once and OpenRouter/Ollama remain available as fallbacks.
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await pingBase()) {
      if (await verifyGatewayModel()) { lastFailure = ""; log.ok("openclaw", "gateway and model ready"); return true; }
      lastFailure = "gateway started, but its configured Ollama model failed the live chat check";
      log.warn("openclaw", "gateway started but its configured model failed the live check");
      break;
    }
    if (i === 8 && (await discoverBase(bin))) return true;
    if (!child || child.exitCode !== null) break;
  }
  if (!lastFailure || lastFailure === "gateway has not completed a live model check") {
    lastFailure = lastLine ? `gateway did not become ready; last output: ${lastLine}` : "gateway did not become ready before the timeout";
  }
  log.warn(
    "openclaw",
    `gateway did not become ready${lastLine ? ` (last output: ${lastLine})` : ""}; OpenRouter/Ollama will continue working. Run \`npm run openclaw:status\` for details`,
  );
  return false;
}


export async function startOpenClaw(options = {}) {
  if (startupAttempt) {
    const needsStrongerAttempt = Boolean(options.force && !startupOptions?.force)
      || Boolean(options.autoInstall && !startupOptions?.autoInstall);
    const result = await startupAttempt;
    if (result || !needsStrongerAttempt) return result;
    return startOpenClaw(options);
  }
  startupOptions = options;
  startupAttempt = startOpenClawOnce(options).finally(() => {
    startupAttempt = null;
    startupOptions = null;
  });
  return startupAttempt;
}

export function getOpenClawFailure() {
  return lastFailure;
}

/**
 * Idempotent, de-duplicated "make OpenClaw work right now" entry point used by
 * the AI router when a request hits an unreachable gateway. Installs + tunes
 * for the machine if needed, then starts and waits for readiness.
 */
/** Forget the current base URL so the next ensure() hunts for the real one. */
export function invalidateOpenClawBase() {
  skipConfiguredBaseOnce = true;
}

async function ensureOpenClawOnce() {
  const skipConfigured = skipConfiguredBaseOnce;
  skipConfiguredBaseOnce = false;
  if (!skipConfigured && await pingBase() && await verifyGatewayModel()) {
      lastFailure = "";
      return true;
    }
    if (await discoverBase(resolveBin(), { skipConfigured })) {
      lastFailure = "";
      return true;
    }
    return startOpenClaw({ force: true, autoInstall: true }).catch((error) => {
      lastFailure = error?.message || "gateway startup failed";
      return false;
    });
}

export async function ensureOpenClaw() {
  if (!ensureAttempt) {
    ensureAttempt = ensureOpenClawOnce().finally(() => { ensureAttempt = null; });
  }
  return ensureAttempt;
}

function shutdownGateway() { try { killTree(child); } catch {} child = null; }
process.on("exit", shutdownGateway);
process.on("SIGINT", () => { shutdownGateway(); process.exit(0); });
process.on("SIGTERM", () => { shutdownGateway(); process.exit(0); });
