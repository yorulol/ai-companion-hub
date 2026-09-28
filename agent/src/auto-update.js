// Auto-updater: watches the git remote for new commits and watches local files
// under the agent folder. On either signal, it pulls (remote case) and asks the
// supervisor to rerun the full startup sequence by exiting with code 42.
//
// Env knobs (all optional):
//   AUTO_UPDATE_ENABLED   default "true"
//   AUTO_UPDATE_GIT       default "true"   — poll git remote
//   AUTO_UPDATE_WATCH     default "true"   — watch local files
//   AUTO_UPDATE_INTERVAL  default 60       — seconds between git checks
//   AUTO_UPDATE_DEBOUNCE  default 3        — seconds to coalesce local edits

import { spawn, spawnSync } from "node:child_process";
import { watch, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./boot-ui.js";
import { sendUpdateNotice } from "./update-notices.js";

const RESTART_CODE = 42;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = path.resolve(HERE, "..");            // .../agent
const REPO_ROOT = path.resolve(AGENT_ROOT, "..");       // repo root (fallback: agent)

function repoDir() {
  // Prefer repo root if it has .git, else agent folder itself.
  if (existsSync(path.join(REPO_ROOT, ".git"))) return REPO_ROOT;
  if (existsSync(path.join(AGENT_ROOT, ".git"))) return AGENT_ROOT;
  return null;
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { code: r.status ?? 1, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

let restarting = false;
async function scheduleRestart(reason) {
  if (restarting) return;
  restarting = true;
  await Promise.race([
    sendUpdateNotice("Yoru is processing an update. I'll let you know when I'm back online."),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
  log.ok("auto-update", `${reason} — restarting…`);
  process.exit(RESTART_CODE);
}

function startGitPoller() {
  const cwd = repoDir();
  if (!cwd) {
    log.dim?.("auto-update", "no .git folder found — skipping remote checks");
    return;
  }
  const intervalSec = Math.max(15, Number(process.env.AUTO_UPDATE_INTERVAL) || 60);
  let busy = false;

  const check = async () => {
    if (busy) return;
    busy = true;
    try {
      const fetch = git(["fetch", "--quiet"], cwd);
      if (fetch.code !== 0) return; // offline etc.
      const local = git(["rev-parse", "HEAD"], cwd);
      const remote = git(["rev-parse", "@{u}"], cwd);
      if (!local.out || !remote.out || local.out === remote.out) return;

      log.info("auto-update", "new commits on remote — pulling…");
      const pull = git(["pull", "--ff-only"], cwd);
      if (pull.code !== 0) {
        log.warn("auto-update", `git pull failed: ${pull.err || pull.out}`);
        return;
      }
      await scheduleRestart("repo updated");
    } finally {
      busy = false;
    }
  };

  // First check shortly after boot, then on interval.
  setTimeout(check, 8000).unref?.();
  setInterval(check, intervalSec * 1000).unref?.();
  log.ok("auto-update", `watching git remote every ${intervalSec}s`);
}

function startFileWatcher() {
  const debounceMs = Math.max(500, (Number(process.env.AUTO_UPDATE_DEBOUNCE) || 3) * 1000);
  const IGNORE = /(^|[\\/])(node_modules|\.git|data|web|calls|UF|models|logs|dist|build|\.cache)([\\/]|$)/;
  const WATCH_EXT = /\.(js|mjs|cjs|ts|json|env)$/i;

  let timer = null;
  let lastFile = "";
  const bump = (file) => {
    if (timer) clearTimeout(timer);
    lastFile = file || lastFile;
    timer = setTimeout(() => { void scheduleRestart(`local change detected (${path.basename(lastFile) || "file"})`); }, debounceMs);
  };

  try {
    watch(AGENT_ROOT, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      if (IGNORE.test(rel)) return;
      if (!WATCH_EXT.test(rel) && !rel.endsWith(".env")) return;
      bump(rel);
    });
    log.ok("auto-update", "watching agent folder for local edits");
  } catch (e) {
    log.warn("auto-update", `file watcher unavailable: ${e.message}`);
  }
}

export function startAutoUpdate() {
  if ((process.env.AUTO_UPDATE_ENABLED || "true").toLowerCase() === "false") return;
  // Only run when supervised — otherwise exiting with code 42 just kills the agent.
  if (process.env.YORU_SUPERVISED !== "1") {
    log.dim?.("auto-update", "run via `npm start` to enable auto-restart on updates");
    return;
  }
  if ((process.env.AUTO_UPDATE_GIT || "true").toLowerCase() !== "false") startGitPoller();
  if ((process.env.AUTO_UPDATE_WATCH || "true").toLowerCase() !== "false") startFileWatcher();
}

// Standalone helper: spawn the agent and restart it whenever it exits with
// RESTART_CODE (42). Used by scripts/supervisor.js.
export function runSupervised(entry, beforeStart = async () => {}) {
  const env = { ...process.env, YORU_SUPERVISED: "1" };
  let child = null;
  let stopping = false;
  const forward = (signal) => {
    stopping = true;
    if (child) child.kill(signal);
    else process.exit(0);
  };
  process.on("SIGINT", forward);
  process.on("SIGTERM", forward);
  const supervise = async () => {
    while (!stopping) {
      // The same dependency pass runs before the first boot AND after each
      // update-triggered exit, just like Ctrl+C followed by npm start.
      await beforeStart();
      if (stopping) break;
      // Only the replacement child announces completion, never a normal boot.
      const result = await new Promise((resolve) => {
        child = spawn(process.execPath, [entry], { stdio: "inherit", env });
        child.once("error", (error) => resolve({ error }));
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      child = null;
      if (stopping || result.signal === "SIGINT" || result.signal === "SIGTERM") break;
      if (result.error) { console.error(result.error); process.exitCode = 1; break; }
      if (result.code !== RESTART_CODE) { process.exitCode = result.code ?? 1; break; }
      env.YORU_UPDATE_RESTART = "1";
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  };
  return supervise();
}
