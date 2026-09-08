/**
 * Computer-control tools. Gated by config.computer.enabled and (for writes)
 * by config.computer.root when unrestricted is false. Cross-platform: works
 * on Linux (Parrot/Debian/Ubuntu/etc) and Windows 10/11.
 */
import { promises as fs } from "node:fs";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { exec as execCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";

const exec = promisify(execCb);

function assertEnabled() {
  if (!config.computer.enabled) throw new Error("Computer control is disabled in .env (COMPUTER_CONTROL_ENABLED=false).");
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

// ---- Lockdown: encrypt a folder with AES-256-GCM ----

const KEY_DIR = path.join(os.homedir(), ".yoru-agent");
const LOCK_STATE = path.join(KEY_DIR, "lockdown.json");

async function walk(dir, out = []) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full, out);
    else if (item.isFile()) out.push(full);
  }
  return out;
}

async function encryptFile(file, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const tmp = `${file}.yoruenc`;
  await pipeline(createReadStream(file), cipher, createWriteStream(tmp));
  const tag = cipher.getAuthTag();
  const original = await fs.readFile(tmp);
  await fs.writeFile(tmp, Buffer.concat([iv, tag, original]));
  await fs.rm(file);
  await fs.rename(tmp, `${file}.yoru`);
}

async function decryptFile(file, key) {
  const raw = await fs.readFile(file);
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  const restored = file.replace(/\.yoru$/, "");
  await fs.writeFile(restored, plain);
  await fs.rm(file);
}

export async function engageLockdown() {
  assertEnabled();
  if (!config.computer.lockdownEnabled) throw new Error("LOCKDOWN_ENABLED=false in .env");
  const target = config.computer.lockdownTarget;
  if (!target) throw new Error("Set LOCKDOWN_TARGET in .env to the folder you want encrypted.");
  const full = path.resolve(target);
  await fs.mkdir(KEY_DIR, { recursive: true });

  const key = crypto.randomBytes(32);
  const files = await walk(full);
  let done = 0;
  for (const f of files) {
    if (f.endsWith(".yoru")) continue;
    try {
      await encryptFile(f, key);
      done++;
    } catch (err) {
      console.warn(`[lockdown] skip ${f}: ${err.message}`);
    }
  }
  const keyHex = key.toString("hex");
  await fs.writeFile(
    LOCK_STATE,
    JSON.stringify({ target: full, at: Date.now(), files: done }, null, 2),
  );
  return { target: full, encryptedFiles: done, decryptionKey: keyHex };
}

export async function releaseLockdown(keyHex) {
  assertEnabled();
  const state = JSON.parse(await fs.readFile(LOCK_STATE, "utf8").catch(() => "{}"));
  if (!state.target) throw new Error("No lockdown state found.");
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("Invalid decryption key length.");
  const files = (await walk(state.target)).filter((f) => f.endsWith(".yoru"));
  let done = 0;
  for (const f of files) {
    try {
      await decryptFile(f, key);
      done++;
    } catch (err) {
      throw new Error(`Wrong key or corrupt file: ${err.message}`);
    }
  }
  await fs.rm(LOCK_STATE, { force: true });
  return { restoredFiles: done, target: state.target };
}

export async function lockdownStatus() {
  try {
    const state = JSON.parse(await fs.readFile(LOCK_STATE, "utf8"));
    return { active: true, ...state };
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
