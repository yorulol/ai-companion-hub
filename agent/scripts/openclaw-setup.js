#!/usr/bin/env node
// Install and onboard OpenClaw locally (no root / no global install). Run with: npm run openclaw:setup
import { spawn, execSync } from "node:child_process";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const AGENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR_DIR = path.join(AGENT_DIR, "vendor", "openclaw");

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const ok = (m) => console.log(c("38;5;120", "✔ ") + m);
const info = (m) => console.log(c("38;5;111", "› ") + m);
const err = (m) => console.log(c("38;5;203", "✖ ") + m);
const warn = (m) => console.log(c("38;5;214", "! ") + m);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: platform() === "win32", ...opts });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}

function openclawCmd() {
  // Local vendored install first, global fallback.
  const localBin = path.join(VENDOR_DIR, "node_modules", ".bin", platform() === "win32" ? "openclaw.cmd" : "openclaw");
  try { execSync(`"${localBin}" --version`, { stdio: "ignore" }); return localBin; } catch { return "openclaw"; }
}

function nodeOk() {
  const [maj, min] = process.versions.node.split(".").map(Number);
  // Package.json engines: ">=24.16.0 <25 || >=26.1.0"
  if (maj === 24 && (min > 16 || (min === 16))) return true;
  if (maj >= 26) return true;
  if (maj === 24 && min >= 16) return true;
  return false;
}

(async () => {
  console.log(c("38;5;141", "\n◆ YORU · OpenClaw setup\n"));

  // 1) Node version gate — OpenClaw 2026.x needs Node >=24.16 (<25) or >=26.1.
  if (!nodeOk()) {
    err(`OpenClaw requires Node.js 24.16+ (<25) or 26.1+ — you're on v${process.versions.node}.`);
    console.log("");
    console.log(c("38;5;111", "  Linux (recommended, no root):"));
    console.log("    curl -fsSL https://fnm.vercel.app/install | bash");
    console.log("    source ~/.bashrc   # or restart your terminal");
    console.log("    fnm install 24 && fnm use 24");
    console.log("");
    console.log(c("38;5;111", "  Or via NodeSource (Debian/Parrot/Ubuntu):"));
    console.log("    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -");
    console.log("    sudo apt-get install -y nodejs");
    console.log("");
    console.log(c("38;5;111", "  Windows: download Node 24 or 26 from https://nodejs.org"));
    console.log("");
    err("Re-run `npm run openclaw:setup` after upgrading. Aborting.");
    process.exit(1);
  }
  ok(`node v${process.versions.node} — good`);

  // 2) Local install into agent/vendor/openclaw. Must have a package.json first so
  //    `npm install <pkg>` doesn't walk up and mutate the agent's own tree.
  info(`installing openclaw locally into ${path.relative(process.cwd(), VENDOR_DIR)} (no root needed)…`);
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  mkdirSync(VENDOR_DIR, { recursive: true });
  const vendorPkg = path.join(VENDOR_DIR, "package.json");
  if (!existsSync(vendorPkg)) {
    writeFileSync(vendorPkg, JSON.stringify({ name: "yoru-openclaw-host", private: true, version: "0.0.0" }, null, 2));
  }
  const npmArgs = ["install", "--prefix", VENDOR_DIR, "openclaw@latest", "--no-audit", "--no-fund", "--loglevel=error"];
  try {
    await run("npm", npmArgs);
  } catch (e) {
    warn(`install failed (${e.message}). Retrying with --ignore-scripts, will run postinstall manually…`);
    try {
      await run("npm", [...npmArgs, "--ignore-scripts"]);
      // Trigger OpenClaw's bundled-plugin postinstall by hand.
      const oc = path.join(VENDOR_DIR, "node_modules", "openclaw");
      const postinstall = path.join(oc, "scripts", "postinstall-bundled-plugins.mjs");
      if (existsSync(postinstall)) {
        info("running openclaw postinstall…");
        await run(process.execPath, [postinstall], { cwd: oc });
      }
    } catch (e2) {
      err(`openclaw install failed: ${e2.message}`);
      process.exit(1);
    }
  }
  ok("openclaw installed locally (global install not required)");

  // 3) Let Yoru write the local, non-interactive model/gateway configuration.
  // Do not install a native daemon: Yoru owns one foreground gateway process,
  // which avoids stale launchd/systemd/Task Scheduler registrations.
  const bin = openclawCmd();
  info("writing the hardware-tuned local gateway configuration…");
  try {
    const { autotuneOpenClaw } = await import("../src/openclaw-autotune.js");
    await autotuneOpenClaw({ force: true });
    await run(bin, ["gateway", "stop", "--force", "--json"]).catch(() => {});
    ok("local gateway configuration complete");
  } catch (e) {
    err(`configuration failed: ${e.message}`);
    err("you can rerun it any time with: npm run openclaw:setup");
    process.exit(1);
  }

  ok("done. `npm start` will launch and own one OpenClaw gateway.");
})().catch((e) => { err(e.message); process.exit(1); });
