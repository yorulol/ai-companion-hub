/**
 * Lightweight anti-raid + spam auto-moderation. Runs inside the bot's
 * MessageCreate / GuildMemberAdd handlers. Zero external state — everything
 * is per-process; restarts reset counters, which is fine for raid detection.
 */
import { db, getGuild } from "./db.js";
import { logActivity } from "./activity.js";

// Ensure a per-guild automod settings table.
db.exec(`
CREATE TABLE IF NOT EXISTS automod (
  guild_id TEXT PRIMARY KEY,
  antispam INTEGER NOT NULL DEFAULT 1,
  antiraid INTEGER NOT NULL DEFAULT 1,
  antiinvite INTEGER NOT NULL DEFAULT 0,
  antimention INTEGER NOT NULL DEFAULT 1,
  log_channel_id TEXT,
  verify_role_id TEXT
);
`);

export const getAutomod = (guild_id) =>
  db.prepare("SELECT * FROM automod WHERE guild_id = ?").get(guild_id) || {
    guild_id, antispam: 1, antiraid: 1, antiinvite: 0, antimention: 1,
    log_channel_id: null, verify_role_id: null,
  };

export const setAutomod = (guild_id, patch) => {
  const cur = getAutomod(guild_id);
  const next = { ...cur, ...patch };
  db.prepare(
    `INSERT OR REPLACE INTO automod
     (guild_id, antispam, antiraid, antiinvite, antimention, log_channel_id, verify_role_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(guild_id, next.antispam ? 1 : 0, next.antiraid ? 1 : 0,
        next.antiinvite ? 1 : 0, next.antimention ? 1 : 0,
        next.log_channel_id || null, next.verify_role_id || null);
  return next;
};

// ---- runtime counters ----
const msgWindow = new Map(); // key: guild:user -> [timestamps]
const joinWindow = new Map(); // guildId -> [timestamps]

function pushWindow(map, key, ms) {
  const now = Date.now();
  const arr = (map.get(key) || []).filter((t) => now - t < ms);
  arr.push(now);
  map.set(key, arr);
  return arr.length;
}

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite)\/\S+/i;

async function log(guild, cfg, message) {
  if (!cfg.log_channel_id) return;
  const ch = guild.channels.cache.get(cfg.log_channel_id);
  if (ch?.isTextBased?.()) await ch.send(message).catch(() => {});
}

/** Handle a message; returns true if the message was actioned (deleted). */
export async function checkMessage(message) {
  try {
    if (message.author.bot || !message.guild) return false;
    const cfg = getAutomod(message.guild.id);
    const key = `${message.guild.id}:${message.author.id}`;
    let actioned = false;

    if (cfg.antispam) {
      const count = pushWindow(msgWindow, key, 5000);
      if (count >= 6) {
        await message.delete().catch(() => {});
        await message.channel.send(`⚠ <@${message.author.id}> slow down — spam detected.`).catch(() => {});
        await log(message.guild, cfg, `🛡 anti-spam: ${message.author.tag} sent ${count} msgs in 5s`);
        logActivity("automod", `antispam ${message.author.tag}`, { guild: message.guild.id });
        actioned = true;
      }
    }
    if (cfg.antimention && (message.mentions.users.size + message.mentions.roles.size) >= 5) {
      await message.delete().catch(() => {});
      await log(message.guild, cfg, `🛡 mass-mention: ${message.author.tag}`);
      actioned = true;
    }
    if (cfg.antiinvite && INVITE_RE.test(message.content)) {
      await message.delete().catch(() => {});
      await log(message.guild, cfg, `🛡 invite blocked from ${message.author.tag}`);
      actioned = true;
    }
    return actioned;
  } catch (err) {
    console.error("[automod]", err.message);
    return false;
  }
}

/** Handle a member join; returns true when raid mode locked the join out. */
export async function checkJoin(member) {
  try {
    const cfg = getAutomod(member.guild.id);
    if (!cfg.antiraid) return false;
    const count = pushWindow(joinWindow, member.guild.id, 10_000);
    if (count >= 8) {
      await log(member.guild, cfg, `🚨 raid detected — ${count} joins in 10s. Kicking latest joiners.`);
      await member.kick("Anti-raid: mass-join detected").catch(() => {});
      logActivity("automod", `antiraid kick ${member.user.tag}`, { guild: member.guild.id });
      return true;
    }
  } catch (err) {
    console.error("[automod]", err.message);
  }
  return false;
}

// Re-export getGuild so callers can bundle imports.
export { getGuild };
