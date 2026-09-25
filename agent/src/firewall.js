/**
 * Best-effort firewall port opener for the team-share surface.
 *
 * Tries the platform's native firewall CLI without elevation. If it can't
 * (no sudo, no admin, no CLI installed) it fails quietly — teammates on the
 * same LAN often work without touching the firewall anyway, and the Tor
 * fallback covers the rest.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const RULE_NAME = "YORU Team Share";

async function tryRun(cmd, args, timeout = 6000) {
  try {
    await run(cmd, args, { timeout, windowsHide: true });
    return true;
  } catch { return false; }
}

/** Returns { opened: bool, via: string|null } — never throws. */
export async function openSharePort(port) {
  try {
    if (process.platform === "linux") {
      // ufw (Debian/Ubuntu/Parrot/Kali default)
      if (await tryRun("sudo", ["-n", "ufw", "allow", `${port}/tcp`])) {
        return { opened: true, via: "ufw" };
      }
      // firewalld (Fedora/RHEL/CentOS)
      if (await tryRun("sudo", ["-n", "firewall-cmd", `--add-port=${port}/tcp`])) {
        return { opened: true, via: "firewalld" };
      }
      // iptables raw fallback
      if (await tryRun("sudo", ["-n", "iptables", "-I", "INPUT", "-p", "tcp", "--dport", String(port), "-j", "ACCEPT"])) {
        return { opened: true, via: "iptables" };
      }
      return { opened: false, via: null };
    }
    if (process.platform === "win32") {
      // netsh needs an elevated shell; try anyway — it's harmless if it fails.
      const args = [
        "advfirewall", "firewall", "add", "rule",
        `name=${RULE_NAME}`,
        "dir=in", "action=allow", "protocol=TCP",
        `localport=${port}`,
      ];
      if (await tryRun("netsh", args)) return { opened: true, via: "netsh" };
      return { opened: false, via: null };
    }
    if (process.platform === "darwin") {
      // macOS pf rules can't be added atomically from CLI without root; skip.
      return { opened: false, via: null };
    }
  } catch { /* swallow */ }
  return { opened: false, via: null };
}
