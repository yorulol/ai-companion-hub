/**
 * Killswitch: pauses Yoru's AI responses on every surface (chat panel, bot,
 * selfbot). The Discord bot and alt-account stay CONNECTED while dead so the
 * owner (or a killswitch-admin) can still tell the agent to jumpstart from
 * those surfaces — the chat-loop replies with an "offline" line for everyone
 * else. Persists across restarts via a flag file in the data directory.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logActivity } from "./activity.js";
import { isOwnerId } from "./config.js";
import { getSettings } from "./db.js";

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

/** Owner OR a Discord ID the owner added in the panel as a killswitch admin. */
export function canControlKillswitch(id) {
  if (!id) return false;
  if (isOwnerId(id)) return true;
  const admins = getSettings().killswitchAdmins || [];
  return admins.includes(String(id));
}

export async function activateKillswitch({ reason = "owner-triggered", source = "unknown" } = {}) {
  const payload = { reason, source, at: new Date().toISOString() };
  writeFileSync(FLAG, JSON.stringify(payload, null, 2));
  logActivity("killswitch", `activated (${source}): ${reason}`);
  // Intentionally keep the bot and selfbot ONLINE so the owner can still send
  // a jumpstart from Discord. The isDead() gate in chat-loop makes them silent
  // for everyone else.
  return payload;
}

export async function jumpstart() {
  if (!isDead()) return { restarted: false, reason: "not-dead" };
  try { unlinkSync(FLAG); } catch {}
  logActivity("killswitch", "jumpstart — responses re-enabled");
  return { restarted: true };
}

const KILL_RE = /\b(?:activate|engage|trigger|hit|pull|flip|enable|initiate)\b.*\bkill[\s-]?switch\b|\bkill[\s-]?switch\b.*\b(?:on|now|activate|engage|go)\b|^kill[\s-]?switch$/i;
const JUMP_RE = /\b(?:jump[\s-]?start|revive|reboot|wake up|come back online|bring (?:yourself )?back online|disable\s+(?:your\s+)?kill[\s-]?switch|turn\s+off\s+(?:your\s+)?kill[\s-]?switch|release\s+(?:your\s+)?kill[\s-]?switch)\b/i;

export function detectKillswitchIntent(text) {
  if (JUMP_RE.test(String(text || ""))) return "jumpstart";
  if (KILL_RE.test(String(text || ""))) return "activate";
  return null;
}
