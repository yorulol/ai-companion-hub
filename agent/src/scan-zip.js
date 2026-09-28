/**
 * Bundle a host's scan folder (agent/web/<host>/) into a single .zip so it can
 * be attached to a Discord embed. Uses the system `zip` binary on Linux/mac
 * and PowerShell's Compress-Archive on Windows; both are already present on
 * the platforms this agent supports.
 */
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.trim()}`)));
  });
}

/**
 * Zip srcDir into agent/<tmp>/<name>.zip. Returns the absolute zip path.
 */
export async function zipDir(srcDir, name) {
  await fs.access(srcDir);
  const outDir = path.join(os.tmpdir(), "yoru-scan-zips");
  await fs.mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `${name}_${stamp}.zip`);
  const parent = path.dirname(srcDir);
  const base = path.basename(srcDir);

  if (process.platform === "win32") {
    // Compress-Archive is present on every modern Windows via PowerShell.
    await run("powershell", ["-NoProfile", "-Command",
      `Compress-Archive -Path '${srcDir.replace(/'/g, "''")}\\*' -DestinationPath '${outFile.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    // -r recursive, -q quiet. zip is standard on Parrot / most Linux distros.
    await run("zip", ["-rq", outFile, base], { cwd: parent });
  }
  const stat = await fs.stat(outFile);
  return { path: outFile, size: stat.size };
}
