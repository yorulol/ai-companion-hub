/**
 * Computer-control tools. Gated by config.computer.enabled and (for writes)
 * by config.computer.root when unrestricted is false. Cross-platform: works
 * on Linux (Parrot/Debian/Ubuntu/etc) and Windows 10/11.
 */
import { promises as fs, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec as execCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { config } from "./config.js";

const exec = promisify(execCb);

function assertEnabled() {
  if (!config.computer.enabled) throw new Error("Computer control is disabled in .env (COMPUTER_CONTROL_ENABLED=false).");
  if (typeof LOCK_STATE !== "undefined" && existsSync(LOCK_STATE)) {
    throw new Error("Emergency lockdown is active. Release it before using computer-control actions.");
  }
}

function resolveSafe(p) {
  assertEnabled();
  const target = path.resolve(p.startsWith("~") ? p.replace(/^~/, os.homedir()) : p);
  if (config.computer.unrestricted) return target;
  const root = path.resolve(config.computer.root);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error(`Path outside sandbox root (${root}): ${target}`);
  }
  return target;
}

// ---- File operations ----

export async function listDir(p) {
  const full = resolveSafe(p);
  const items = await fs.readdir(full, { withFileTypes: true });
  return items.map((d) => ({
    name: d.name,
    type: d.isDirectory() ? "dir" : d.isFile() ? "file" : "other",
  }));
}

export async function readFile(p, maxBytes = 512_000) {
  const full = resolveSafe(p);
  const stat = await fs.stat(full);
  if (stat.size > maxBytes) throw new Error(`File too large (${stat.size} bytes). Max ${maxBytes}.`);
  return await fs.readFile(full, "utf8");
}

export async function writeFile(p, content) {
  const full = resolveSafe(p);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf8");
  return { path: full, bytes: Buffer.byteLength(content) };
}

export async function moveFile(from, to) {
  const src = resolveSafe(from);
  const dst = resolveSafe(to);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await fs.rename(src, dst);
  return { from: src, to: dst };
}

export async function removeFile(p) {
  const full = resolveSafe(p);
  await fs.rm(full, { recursive: true, force: true });
  return { path: full };
}

// ---- System info ----

export async function systemInfo() {
  return {
    platform: process.platform,
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    memGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    freeMemGB: +(os.freemem() / 1024 ** 3).toFixed(1),
    uptimeMin: Math.round(os.uptime() / 60),
    user: os.userInfo().username,
    home: os.homedir(),
    sandboxRoot: config.computer.root,
    unrestricted: config.computer.unrestricted,
  };
}

// ---- Malware scan ----

export function scanForMalware({ onLine } = {}) {
  assertEnabled();
  return new Promise((resolve, reject) => {
    let cmd;
    let args;
    let target;

    if (config.os.isLinux) {
      cmd = config.computer.clamscanPath || "clamscan";
      target = config.computer.root;
      args = ["-r", "--infected", "--stdout", target];
    } else if (config.os.isWindows) {
      cmd = config.computer.winDefenderPath || "C:\\Program Files\\Windows Defender\\MpCmdRun.exe";
      target = config.computer.root;
      args = ["-Scan", "-ScanType", "3", "-File", target];
    } else {
      return reject(new Error(`Malware scan not supported on ${process.platform}`));
    }

    const proc = spawn(cmd, args);
    const lines = [];
    const push = (chunk) => {
      const text = chunk.toString();
      lines.push(text);
      text.split(/\r?\n/).forEach((l) => l && onLine?.(l));
    };
    proc.stdout.on("data", push);
    proc.stderr.on("data", push);
    proc.on("error", (err) => reject(new Error(`Scanner not found (${cmd}): ${err.message}`)));
    proc.on("close", (code) => resolve({ code, target, output: lines.join("").slice(-8000) }));
  });
}

// ---- Lockdown: reversible, non-destructive emergency gate ----

const KEY_DIR = path.join(os.homedir(), ".yoru");
const LOCK_STATE = path.join(KEY_DIR, "lockdown.json");

export async function engageLockdown() {
  if (!config.computer.enabled) throw new Error("Computer control is disabled in .env.");
  if (!config.computer.lockdownEnabled) throw new Error("LOCKDOWN_ENABLED=false in .env");
  if (existsSync(LOCK_STATE)) throw new Error("Emergency lockdown is already active.");
  await fs.mkdir(KEY_DIR, { recursive: true });
  const releaseKey = crypto.randomBytes(24).toString("hex");
  const releaseHash = crypto.createHash("sha256").update(releaseKey).digest("hex");
  await fs.writeFile(
    LOCK_STATE,
    JSON.stringify({ active: true, at: Date.now(), releaseHash }, null, 2),
  );
  return { active: true, pausedActions: true, releaseKey };
}

export async function releaseLockdown(releaseKey) {
  if (!config.computer.enabled) throw new Error("Computer control is disabled in .env.");
  const state = JSON.parse(await fs.readFile(LOCK_STATE, "utf8").catch(() => "{}"));
  if (!state.active || !state.releaseHash) throw new Error("No emergency lockdown is active.");
  const supplied = crypto.createHash("sha256").update(String(releaseKey || "")).digest();
  const expected = Buffer.from(state.releaseHash, "hex");
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error("Invalid release key.");
  await fs.rm(LOCK_STATE, { force: true });
  return { active: false, resumedActions: true };
}

export async function lockdownStatus() {
  try {
    const state = JSON.parse(await fs.readFile(LOCK_STATE, "utf8"));
    return { active: true, at: state.at, pausedActions: true };
  } catch {
    return { active: false };
  }
}

// ---- Generic shell ----

export async function runShell(command, { timeoutMs = 20_000 } = {}) {
  assertEnabled();
  if (!config.computer.unrestricted) {
    throw new Error("Shell execution requires COMPUTER_CONTROL_UNRESTRICTED=true");
  }
  const { stdout, stderr } = await exec(command, { timeout: timeoutMs, maxBuffer: 2_000_000 });
  return { stdout: stdout.slice(-8000), stderr: stderr.slice(-4000) };
}
