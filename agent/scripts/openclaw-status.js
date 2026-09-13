#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { platform } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { OPENCLAW_NODE_REQUIREMENT, supportsOpenClawNode } from "../src/openclaw-runtime.js";

const agentDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localBin = path.join(
  agentDir,
  "vendor",
  "openclaw",
  "node_modules",
  ".bin",
  platform() === "win32" ? "openclaw.cmd" : "openclaw",
);

if (!supportsOpenClawNode()) {
  console.error(`OpenClaw cannot run on Node.js ${process.versions.node}; install ${OPENCLAW_NODE_REQUIREMENT}.`);
  console.error("After upgrading Node, run: npm run openclaw:setup");
  process.exitCode = 1;
} else {
  const command = existsSync(localBin) ? localBin : "openclaw";
  const child = spawn(command, ["gateway", "status", "--deep"], {
    cwd: agentDir,
    stdio: "inherit",
    shell: platform() === "win32",
    windowsHide: true,
  });
  child.on("error", () => {
    console.error("OpenClaw is not installed. Run: npm run openclaw:setup");
    process.exitCode = 1;
  });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}