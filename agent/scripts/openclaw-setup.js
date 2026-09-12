#!/usr/bin/env node
// Install and onboard OpenClaw locally. Run with: npm run openclaw:setup
import { spawn } from "node:child_process";
import { platform } from "node:os";

const c = (n, s) => `\x1b[${n}m${s}\x1b[0m`;
const ok = (m) => console.log(c("38;5;120", "✔ ") + m);
const info = (m) => console.log(c("38;5;111", "› ") + m);
const err = (m) => console.log(c("38;5;203", "✖ ") + m);

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: platform() === "win32", ...opts });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
    p.on("error", reject);
  });
}

(async () => {
  console.log(c("38;5;141", "\n◆ YORU · OpenClaw setup\n"));
  info("installing openclaw globally via npm (this may take a minute)…");
  try {
    await run("npm", ["install", "-g", "openclaw@latest", "--allow-scripts=openclaw"]);
  } catch {
    info("retrying without --allow-scripts flag (older npm)…");
    await run("npm", ["install", "-g", "openclaw@latest"]);
  }
  ok("openclaw installed");

  info("running: openclaw onboard --install-daemon");
  info("follow the wizard to pick a model provider, then come back here.\n");
  try {
    await run("openclaw", ["onboard", "--install-daemon"]);
    ok("onboarding complete");
  } catch (e) {
    err(`onboarding failed: ${e.message}`);
    err("you can rerun it any time with: openclaw onboard --install-daemon");
    process.exit(1);
  }

  info("checking gateway status…");
  try {
    await run("openclaw", ["gateway", "status"]);
  } catch {}
  ok("done. Yoru will auto-start the gateway on boot when OPENCLAW_AUTOSTART=true.");
})().catch((e) => { err(e.message); process.exit(1); });
