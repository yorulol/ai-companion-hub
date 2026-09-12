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

(async () => {
  console.log(c("38;5;141", "\n◆ YORU · OpenClaw setup\n"));

  // 1) Node version gate — OpenClaw needs Node 22+.
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 22) {
    err(`OpenClaw requires Node.js 22 or newer — you're on v${process.versions.node}.`);
    err("It will install but crash at runtime on Node 20. Upgrade first:");
    console.log("");
    console.log(c("38;5;111", "  Linux (recommended, no root):"));
    console.log("    curl -fsSL https://fnm.vercel.app/install | bash");
    console.log("    source ~/.bashrc   # or restart your terminal");
    console.log("    fnm install 22 && fnm use 22");
    console.log("");
    console.log(c("38;5;111", "  Or via NodeSource (Debian/Parrot/Ubuntu):"));
    console.log("    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -");
    console.log("    sudo apt-get install -y nodejs");
    console.log("");
    console.log(c("38;5;111", "  Windows: download the LTS installer from https://nodejs.org"));
    console.log("");
    err("Re-run `npm run openclaw:setup` after upgrading. Aborting.");
    process.exit(1);
  }
  ok(`node v${process.versions.node} — good`);

  // 2) Local install into agent/vendor/openclaw (no root, no global permissions needed).
  info(`installing openclaw locally into ${path.relative(process.cwd(), VENDOR_DIR)} (no root needed)…`);
  try {
    await run("npm", ["install", "--prefix", VENDOR_DIR, "openclaw@latest", "--allow-scripts=openclaw"]);
  } catch {
    info("retrying without --allow-scripts flag (older npm)…");
    await run("npm", ["install", "--prefix", VENDOR_DIR, "openclaw@latest"]);
  }
  ok("openclaw installed locally (global install not required)");

  // 3) Onboard with the local binary.
  const bin = openclawCmd();
  info(`running: ${path.basename(bin)} onboard --install-daemon`);
  info("follow the wizard to pick a model provider, then come back here.\n");
  try {
    await run(bin, ["onboard", "--install-daemon"]);
    ok("onboarding complete");
  } catch (e) {
    err(`onboarding failed: ${e.message}`);
    err(`you can rerun it any time with: ${bin} onboard --install-daemon`);
    process.exit(1);
  }

  info("checking gateway status…");
  try { await run(bin, ["gateway", "status"]); } catch {}
  ok("done. Yoru will auto-start the gateway on boot when OPENCLAW_AUTOSTART=true.");
})().catch((e) => { err(e.message); process.exit(1); });
