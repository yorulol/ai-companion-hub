/**
 * Ephemeral Tor hidden service for the team-share surface.
 *
 * Boots a local `tor` process pointed at agent/data/tor/ with a HiddenService
 * that forwards :80 -> 127.0.0.1:<sharePort>. Prints the .onion URL once
 * Tor writes the hostname file. Killed on agent exit — the onion address
 * is discarded on shutdown so the link is temporary by design.
 *
 * Falls back cleanly when `tor` isn't installed.
 */
import { spawn, execFileSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "tor");
const HS_DIR = path.join(DATA_DIR, "hs");
const TORRC = path.join(DATA_DIR, "torrc");

let CHILD = null;

function torBinary() {
  const candidates = process.platform === "win32"
    ? ["tor.exe", "tor"]
    : ["tor"];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 3000, windowsHide: true });
      return bin;
    } catch {}
  }
  return null;
}

async function pickFreePort(preferred = 9150) {
  const net = await import("node:net");
  return await new Promise((resolve) => {
    const s = net.createServer();
    s.on("error", () => resolve(preferred + Math.floor(Math.random() * 500) + 1));
    s.listen(0, "127.0.0.1", () => {
      const port = s.address().port;
      s.close(() => resolve(port));
    });
  });
}

async function writeTorrc(sharePort, socksPort, ctrlPort) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(HS_DIR, { recursive: true });
  if (process.platform !== "win32") {
    try { await fs.chmod(HS_DIR, 0o700); } catch {}
  }
  const torrc = [
    `DataDirectory ${DATA_DIR}`,
    `SocksPort 127.0.0.1:${socksPort}`,
    `ControlPort 127.0.0.1:${ctrlPort}`,
    `HiddenServiceDir ${HS_DIR}`,
    `HiddenServicePort 80 127.0.0.1:${sharePort}`,
    `Log notice stdout`,
    `AvoidDiskWrites 1`,
    `ClientOnly 1`,
    ``,
  ].join("\n");
  await fs.writeFile(TORRC, torrc, "utf8");
}

async function readHostname(timeoutMs = 45000) {
  const file = path.join(HS_DIR, "hostname");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(file)) {
      const v = (await fs.readFile(file, "utf8")).trim();
      if (v) return v;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/**
 * @param {number} sharePort  The port the team-share HTTP server listens on.
 * @param {(msg:string)=>void} logDim
 * @param {(tag:string,msg:string)=>void} logOk
 * @param {(tag:string,msg:string)=>void} logWarn
 * @returns {Promise<string|null>} onion URL or null.
 */
export async function startShareOnion(sharePort, { logOk, logWarn, logDim }) {
  const bin = torBinary();
  if (!bin) {
    logWarn("share", "tor not installed — no onion fallback. install: `sudo apt install tor` (Linux) or `winget install TorProject.TorBrowser` (Windows)");
    return null;
  }
  try {
    const socks = await pickFreePort(9150);
    const ctrl = await pickFreePort(9151);
    await writeTorrc(sharePort, socks, ctrl);

    CHILD = spawn(bin, ["-f", TORRC], { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    CHILD.on("error", (e) => logWarn("share", `tor process error: ${e.message}`));
    CHILD.stderr?.on("data", () => {});
    CHILD.stdout?.on("data", () => {});

    const kill = () => { try { CHILD?.kill(); } catch {} };
    process.once("exit", kill);
    process.once("SIGINT", () => { kill(); process.exit(0); });
    process.once("SIGTERM", () => { kill(); process.exit(0); });

    const host = await readHostname(60000);
    if (!host) {
      logWarn("share", "tor started but no onion hostname within 60s — check agent/data/tor/");
      return null;
    }
    const url = `http://${host}/`;
    logOk("share", `onion link (temporary): ${url}`);
    logDim("share", "share it with your team; it dies when you stop the agent");
    return url;
  } catch (e) {
    logWarn("share", `tor onion setup failed: ${e.message}`);
    return null;
  }
}

export function stopShareOnion() {
  try { CHILD?.kill(); } catch {}
  CHILD = null;
}
