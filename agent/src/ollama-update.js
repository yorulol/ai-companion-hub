/**
 * Ollama version check + auto-update. Used by both `npm install` and
 * `npm start` so hf.co/ pulls and new model features keep working.
 * Fully best-effort: never throws, never blocks boot.
 */
import { execFile } from "node:child_process";

const LATEST_URL = "https://api.github.com/repos/ollama/ollama/releases/latest";

function run(cmd, args, timeout = 8000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout, stderr) => {
      resolve(err ? null : (stdout || stderr || "").trim());
    });
  });
}

function parseVersion(text) {
  const m = String(text || "").match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function cmp(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

async function localVersion(ollamaUrl) {
  // Prefer the running server; fall back to the CLI.
  try {
    const r = await fetch(`${ollamaUrl}/api/version`, { signal: AbortSignal.timeout(2500) });
    if (r.ok) {
      const b = await r.json();
      const v = parseVersion(b.version);
      if (v) return v;
    }
  } catch { /* server not up */ }
  const out = await run("ollama", ["--version"]);
  return parseVersion(out);
}

async function latestVersion() {
  try {
    const r = await fetch(LATEST_URL, {
      headers: { "user-agent": "yoru-agent", accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const b = await r.json();
    return parseVersion(b.tag_name || b.name);
  } catch { return null; }
}

async function applyUpdate(log) {
  if (process.platform === "win32") {
    log?.("updating via winget…");
    const out = await run("winget", ["upgrade", "--id", "Ollama.Ollama", "-e", "--silent", "--accept-source-agreements", "--accept-package-agreements"], 10 * 60 * 1000);
    return out !== null;
  }
  // Linux + macOS: official install script handles upgrades in place.
  log?.("updating via the official install script…");
  const out = await run("sh", ["-c", "curl -fsSL https://ollama.com/install.sh | sh"], 10 * 60 * 1000);
  return out !== null;
}

/**
 * Check Ollama's version against the latest release and update if behind.
 * @param {{ url?: string, log?: (msg: string) => void, warn?: (msg: string) => void }} opts
 * @returns {{ checked: boolean, updated?: boolean, current?: string, latest?: string }}
 */
export async function ensureOllamaLatest({ url = "http://127.0.0.1:11434", log, warn } = {}) {
  try {
    const [cur, latest] = await Promise.all([localVersion(url), latestVersion()]);
    if (!cur || !latest) return { checked: false };
    const curStr = cur.join("."), latestStr = latest.join(".");
    if (cmp(cur, latest) >= 0) {
      log?.(`ollama ${curStr} is up to date`);
      return { checked: true, updated: false, current: curStr, latest: latestStr };
    }
    log?.(`ollama ${curStr} → ${latestStr} available — updating…`);
    const okUpdate = await applyUpdate(log);
    if (okUpdate) {
      log?.(`ollama updated to ${latestStr} (restart \`ollama serve\` if it was already running)`);
      return { checked: true, updated: true, current: curStr, latest: latestStr };
    }
    warn?.(`could not auto-update ollama ${curStr} → ${latestStr}; update manually: https://ollama.com/download`);
    return { checked: true, updated: false, current: curStr, latest: latestStr };
  } catch (e) {
    warn?.(`ollama version check skipped: ${e.message}`);
    return { checked: false };
  }
}
