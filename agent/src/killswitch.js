/**
 * Killswitch: full shutdown of Yoru's response surfaces. Only the verified
 * owner can trigger or release it. Persists across restarts via a flag file
 * in the data directory, so a "dead" agent stays dead until jumpstarted.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stopBot, startBot } from "./bot.js";
import { stopSelfbot, startSelfbot } from "./selfbot.js";
import { logActivity } from "./activity.js";
import { config } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
mkdirSync(dataDir, { recursive: true });
const FLAG = join(dataDir, "killswitch.flag");

export function isDead() {
  return existsSync(FLAG);
}

export function killswitchStatus() {
  if (!isDead()) return { active: false };
  try {
    const raw = JSON.parse(readFileSync(FLAG, "utf8"));
    return { active: true, ...raw };
  } catch {
    return { active: true };
  }
}

export async function activateKillswitch({ reason = "owner-triggered", source = "unknown" } = {}) {
  const payload = { reason, source, at: new Date().toISOString() };
  writeFileSync(FLAG, JSON.stringify(payload, null, 2));
  logActivity("killswitch", `activated (${source}): ${reason}`);
  // Tear down responders. Swallow errors — the flag alone is enough to keep them silent.
  await Promise.allSettled([stopBot(), stopSelfbot()]);
  return payload;
}

export async function jumpstart() {
  if (!isDead()) return { restarted: false, reason: "not-dead" };
  try { unlinkSync(FLAG); } catch {}
  logActivity("killswitch", "jumpstart — bringing systems back online");
  const results = { bot: null, selfbot: null };
  if (config.discord.botAutostart && config.discord.botToken) {
    try { await startBot(); results.bot = "online"; }
    catch (e) { results.bot = `failed: ${e.message}`; }
  }
  if (config.discord.selfbotAutostart && config.discord.userToken) {
    try { await startSelfbot(); results.selfbot = "online"; }
    catch (e) { results.selfbot = `failed: ${e.message}`; }
  }
  return { restarted: true, ...results };
}

const KILL_RE = /\b(?:activate|engage|trigger|hit|pull|flip|enable|initiate)\b.*\bkill[\s-]?switch\b|\bkill[\s-]?switch\b.*\b(?:on|now|activate|engage|go)\b|^kill[\s-]?switch$/i;
const JUMP_RE = /\b(?:jump[\s-]?start|revive|reboot|wake up|come back online|bring (?:yourself )?back online)\b/i;

export function detectKillswitchIntent(text) {
  if (KILL_RE.test(String(text || ""))) return "activate";
  if (JUMP_RE.test(String(text || ""))) return "jumpstart";
  return null;
}
