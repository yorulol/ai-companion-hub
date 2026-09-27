// Dependency updater — checks npm for updates within the semver range declared
// in package.json, and runs `npm update` only if any are available. Used by
// `npm install` (postinstall) and `npm start` before YORU boots.
//
// Prints colored, JARVIS-style status. Never blocks: any failure is logged and
// the caller continues. Skips silently when there is no network.

import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  purple: "\x1b[38;5;141m", green: "\x1b[38;5;120m",
  yellow: "\x1b[38;5;222m", cyan: "\x1b[38;5;117m", grey: "\x1b[38;5;245m",
};
const say = (tag, msg, color = C.cyan) =>
  console.log(`${color}${C.bold} ${tag.padEnd(9)}${C.reset}${C.grey}│${C.reset} ${msg}`);
const ok = (m) => say("ok", m, C.green);
const info = (m) => say("deps", m, C.cyan);
const warn = (m) => say("warn", m, C.yellow);

/**
 * Check `npm outdated --json` and, when any package can move within its
 * declared semver range (current !== wanted), run `npm update`.
 * Returns { checked, updated, count } for callers that want to log.
 */
export async function updateDependencies({ quiet = false } = {}) {
  if ((process.env.DEPS_AUTO_UPDATE || "true").toLowerCase() === "false") {
    if (!quiet) info("auto-update disabled (DEPS_AUTO_UPDATE=false)");
    return { checked: false, updated: false, count: 0 };
  }

  if (!quiet) info("checking npm for dependency updates…");

  let outdated = {};
  try {
    // `npm outdated` exits 1 when anything is outdated — that's expected, not an error.
    const { stdout } = await run("npm", ["outdated", "--json", "--long=false"], {
      cwd: ROOT, timeout: 60_000, windowsHide: true,
    }).catch((e) => ({ stdout: e.stdout || "" }));
    outdated = stdout && stdout.trim() ? JSON.parse(stdout) : {};
  } catch (e) {
    if (!quiet) warn(`could not check for updates (${e.message.split("\n")[0]}) — skipping`);
    return { checked: false, updated: false, count: 0 };
  }

  // Only care about packages whose `wanted` version differs from `current`
  // (i.e. an update inside the semver range in package.json).
  const bumpable = Object.entries(outdated).filter(
    ([, v]) => v && v.current && v.wanted && v.current !== v.wanted,
  );

  if (!bumpable.length) {
    if (!quiet) ok("all dependencies up to date");
    return { checked: true, updated: false, count: 0 };
  }

  const names = bumpable.map(([n]) => n);
  info(`${bumpable.length} update${bumpable.length === 1 ? "" : "s"} available: ${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""}`);

  try {
    execFileSync("npm", ["update", "--no-audit", "--no-fund"], {
      cwd: ROOT, stdio: "inherit", timeout: 20 * 60 * 1000, windowsHide: true,
    });
    ok(`updated ${bumpable.length} package${bumpable.length === 1 ? "" : "s"}`);
    return { checked: true, updated: true, count: bumpable.length };
  } catch (e) {
    warn(`npm update failed: ${e.message.split("\n")[0]} — continuing`);
    return { checked: true, updated: false, count: 0 };
  }
}

// Allow `node scripts/update-deps.js` for manual use.
if (import.meta.url === `file://${process.argv[1]}`) {
  updateDependencies().catch(() => process.exit(0));
}
