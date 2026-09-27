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

async function runOut(cmd, args, timeout = 6000) {
  try {
    const { stdout } = await run(cmd, args, { timeout, windowsHide: true });
    return stdout || "";
  } catch { return null; }
}

/** Detect whether the OS firewall is actually active. */
async function firewallActive() {
  if (process.platform === "linux") {
    const ufw = await runOut("ufw", ["status"]);
    if (ufw && /Status:\s*active/i.test(ufw)) return "ufw";
    const fwd = await runOut("firewall-cmd", ["--state"]);
    if (fwd && /running/i.test(fwd)) return "firewalld";
    const nft = await runOut("nft", ["list", "ruleset"]);
    if (nft && /chain\s+input/i.test(nft)) return "nftables";
    return null;
  }
  if (process.platform === "win32") {
    const out = await runOut("netsh", ["advfirewall", "show", "allprofiles", "state"]);
    if (out && /State\s+ON/i.test(out)) return "netsh";
    return null;
  }
  return null;
}

/** Returns { opened, via, skipped } — never throws. skipped=true means no firewall to open. */
export async function openSharePort(port) {
  try {
    const active = await firewallActive();
    if (!active) return { opened: false, via: null, skipped: true };

    if (process.platform === "linux") {
      if (active === "ufw" && await tryRun("sudo", ["-n", "ufw", "allow", `${port}/tcp`])) {
        return { opened: true, via: "ufw" };
      }
      if (active === "firewalld" && await tryRun("sudo", ["-n", "firewall-cmd", `--add-port=${port}/tcp`])) {
        return { opened: true, via: "firewalld" };
      }
      if (await tryRun("sudo", ["-n", "iptables", "-I", "INPUT", "-p", "tcp", "--dport", String(port), "-j", "ACCEPT"])) {
        return { opened: true, via: "iptables" };
      }
      return { opened: false, via: null };
    }
    if (process.platform === "win32") {
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
      return { opened: false, via: null, skipped: true };
    }
  } catch { /* swallow */ }
  return { opened: false, via: null };
}
