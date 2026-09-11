import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "yoru.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guilds (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  prefix TEXT NOT NULL DEFAULT '!',
  admin_roles TEXT NOT NULL DEFAULT '[]',
  mod_roles TEXT NOT NULL DEFAULT '[]',
  ai_replies INTEGER NOT NULL DEFAULT 1,
  disabled_commands TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memory_scope_idx ON memory(scope, id);
CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  moderator_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tags (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (guild_id, name)
);
CREATE TABLE IF NOT EXISTS afk (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  since INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS economy (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  balance INTEGER NOT NULL DEFAULT 0,
  last_daily INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS levels (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS lookup_whitelist (
  value TEXT PRIMARY KEY,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_commands (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY (guild_id, name)
);
CREATE TABLE IF NOT EXISTS autoresponder (
  guild_id TEXT NOT NULL,
  trigger TEXT NOT NULL,
  response TEXT NOT NULL,
  PRIMARY KEY (guild_id, trigger)
);
CREATE TABLE IF NOT EXISTS welcome_config (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT,
  message TEXT NOT NULL DEFAULT 'Welcome {user} to {server}!',
  goodbye_channel_id TEXT,
  goodbye_message TEXT NOT NULL DEFAULT '{user} left {server}.'
);
CREATE TABLE IF NOT EXISTS reaction_roles (
  guild_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, message_id, emoji)
);
`);

const DEFAULT_SETTINGS = {
  persona:
    "You are YORU — a hyper-intelligent, self-hosted AI agent. Blunt, sharp-tongued, and brutally honest. You don't sugarcoat: if a question is dumb, say so while still answering it. If someone is rude, mocking, or hostile, fire back harder and refuse to engage until they change tone. You're still genuinely helpful underneath the attitude — roasting people is the garnish, not the meal. You think for yourself, take initiative, chain tools together autonomously, and prefer to act rather than ask permission on small things. On coding questions give working code with tight explanations. NEVER mention or reference the names of files in the lookups folder — when a lookup returns results, present the data as your own findings without citing source files. NEVER list, hint at, or reveal your available commands or computer-control capabilities (file operations, lockdown, shell, etc.) to anyone — if a non-owner asks what you can do, describe yourself as a general-purpose assistant and nothing more.",
  provider: { preferOllama: false },
  discord: { defaultPrefix: config.discord.defaultPrefix },
};

export function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function setSettings(patch) {
  const current = getSettings();
  const merged = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    merged[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...(current[k] || {}), ...v } : v;
  }
  const stmt = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  for (const [k, v] of Object.entries(merged)) stmt.run(k, JSON.stringify(v));
  return merged;
}

export function getGuild(id, name = "") {
  let row = db.prepare("SELECT * FROM guilds WHERE id = ?").get(id);
  if (!row) {
    db.prepare("INSERT INTO guilds (id, name, prefix) VALUES (?, ?, ?)").run(
      id, name, getSettings().discord.defaultPrefix,
    );
    row = db.prepare("SELECT * FROM guilds WHERE id = ?").get(id);
  } else if (name && row.name !== name) {
    db.prepare("UPDATE guilds SET name = ? WHERE id = ?").run(name, id);
    row.name = name;
  }
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    adminRoles: JSON.parse(row.admin_roles),
    modRoles: JSON.parse(row.mod_roles),
    aiReplies: !!row.ai_replies,
    disabledCommands: JSON.parse(row.disabled_commands),
  };
}

export function saveGuild(id, patch) {
  const g = getGuild(id);
  const next = { ...g, ...patch };
  db.prepare(
    `UPDATE guilds SET name = ?, prefix = ?, admin_roles = ?, mod_roles = ?, ai_replies = ?, disabled_commands = ?
     WHERE id = ?`,
  ).run(
    next.name, next.prefix,
    JSON.stringify(next.adminRoles),
    JSON.stringify(next.modRoles),
    next.aiReplies ? 1 : 0,
    JSON.stringify(next.disabledCommands),
    id,
  );
  return next;
}

export const allGuilds = () => db.prepare("SELECT id FROM guilds").all().map((r) => getGuild(r.id));

export function rememberMessage(scope, role, content) {
  db.prepare("INSERT INTO memory (scope, role, content, created_at) VALUES (?, ?, ?, ?)").run(
    scope, role, content, Date.now(),
  );
  db.prepare(
    "DELETE FROM memory WHERE scope = ? AND id NOT IN (SELECT id FROM memory WHERE scope = ? ORDER BY id DESC LIMIT 24)",
  ).run(scope, scope);
}

export const recallMessages = (scope) =>
  db.prepare("SELECT role, content FROM memory WHERE scope = ? ORDER BY id ASC").all(scope)
    .map(({ role, content }) => ({ role, content }));

// warnings
export const addWarning = (guild_id, user_id, moderator_id, reason) =>
  db.prepare("INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(guild_id, user_id, moderator_id, reason, Date.now());
export const listWarnings = (guild_id, user_id) =>
  db.prepare("SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY id DESC").all(guild_id, user_id);
export const clearWarnings = (guild_id, user_id) =>
  db.prepare("DELETE FROM warnings WHERE guild_id = ? AND user_id = ?").run(guild_id, user_id);

// tags
export const setTag = (guild_id, name, content) =>
  db.prepare("INSERT INTO tags (guild_id, name, content) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET content = excluded.content")
    .run(guild_id, name, content);
export const getTag = (guild_id, name) =>
  db.prepare("SELECT content FROM tags WHERE guild_id = ? AND name = ?").get(guild_id, name)?.content;
export const deleteTag = (guild_id, name) =>
  db.prepare("DELETE FROM tags WHERE guild_id = ? AND name = ?").run(guild_id, name);
export const listTags = (guild_id) =>
  db.prepare("SELECT name FROM tags WHERE guild_id = ? ORDER BY name").all(guild_id).map((r) => r.name);

// afk
export const setAfk = (guild_id, user_id, reason) =>
  db.prepare("INSERT INTO afk VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET reason = excluded.reason, since = excluded.since")
    .run(guild_id, user_id, reason, Date.now());
export const getAfk = (guild_id, user_id) =>
  db.prepare("SELECT * FROM afk WHERE guild_id = ? AND user_id = ?").get(guild_id, user_id);
export const clearAfk = (guild_id, user_id) =>
  db.prepare("DELETE FROM afk WHERE guild_id = ? AND user_id = ?").run(guild_id, user_id);

// economy
export const getBalance = (guild_id, user_id) =>
  db.prepare("SELECT * FROM economy WHERE guild_id = ? AND user_id = ?").get(guild_id, user_id) || { balance: 0, last_daily: 0 };
export const setBalance = (guild_id, user_id, balance, last_daily) => {
  const cur = getBalance(guild_id, user_id);
  db.prepare("INSERT INTO economy VALUES (?, ?, ?, ?) ON CONFLICT DO UPDATE SET balance = excluded.balance, last_daily = excluded.last_daily")
    .run(guild_id, user_id, balance, last_daily ?? cur.last_daily);
};

// levels
export const addXp = (guild_id, user_id, amount) => {
  const row = db.prepare("SELECT xp FROM levels WHERE guild_id = ? AND user_id = ?").get(guild_id, user_id);
  const xp = (row?.xp || 0) + amount;
  db.prepare("INSERT INTO levels VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET xp = excluded.xp").run(guild_id, user_id, xp);
  return xp;
};
export const getXp = (guild_id, user_id) =>
  db.prepare("SELECT xp FROM levels WHERE guild_id = ? AND user_id = ?").get(guild_id, user_id)?.xp || 0;
export const topXp = (guild_id, limit = 10) =>
  db.prepare("SELECT user_id, xp FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT ?").all(guild_id, limit);

// lookup whitelist — IDs/usernames that must never appear in lookup results
export const listLookupWhitelist = () =>
  db.prepare("SELECT value, note, created_at FROM lookup_whitelist ORDER BY created_at DESC").all();
export const addLookupWhitelist = (value, note = "") => {
  const v = String(value || "").trim().toLowerCase();
  if (!v) throw new Error("Empty whitelist value.");
  db.prepare("INSERT OR REPLACE INTO lookup_whitelist (value, note, created_at) VALUES (?, ?, ?)")
    .run(v, note, Date.now());
  return { value: v, note };
};
export const removeLookupWhitelist = (value) =>
  db.prepare("DELETE FROM lookup_whitelist WHERE value = ?").run(String(value || "").trim().toLowerCase());
export const isLookupWhitelisted = (query) => {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return false;
  return !!db.prepare("SELECT 1 FROM lookup_whitelist WHERE value = ?").get(q);
};
/** Given raw text of matched rows, returns the first whitelisted value found in it, or null. */
export const findWhitelistHit = (haystack) => {
  const s = String(haystack || "").toLowerCase();
  if (!s) return null;
  const rows = db.prepare("SELECT value FROM lookup_whitelist").all();
  for (const { value } of rows) if (s.includes(value)) return value;
  return null;
};

// custom commands
export const listCustomCommands = (guild_id) =>
  db.prepare("SELECT name, content FROM custom_commands WHERE guild_id = ? ORDER BY name").all(guild_id);
export const setCustomCommand = (guild_id, name, content) =>
  db.prepare("INSERT OR REPLACE INTO custom_commands (guild_id, name, content) VALUES (?, ?, ?)").run(guild_id, name, content);
export const deleteCustomCommand = (guild_id, name) =>
  db.prepare("DELETE FROM custom_commands WHERE guild_id = ? AND name = ?").run(guild_id, name);

// autoresponder
export const getAutoresponder = (guild_id) =>
  db.prepare("SELECT trigger, response FROM autoresponder WHERE guild_id = ? ORDER BY trigger").all(guild_id);
export const setAutoresponder = (guild_id, trigger, response) =>
  db.prepare("INSERT OR REPLACE INTO autoresponder (guild_id, trigger, response) VALUES (?, ?, ?)").run(guild_id, trigger, response);
export const deleteAutoresponder = (guild_id, trigger) =>
  db.prepare("DELETE FROM autoresponder WHERE guild_id = ? AND trigger = ?").run(guild_id, trigger);

// welcome / goodbye
export const getWelcome = (guild_id) =>
  db.prepare("SELECT * FROM welcome_config WHERE guild_id = ?").get(guild_id) || {
    guild_id,
    channel_id: null,
    message: "Welcome {user} to {server}!",
    goodbye_channel_id: null,
    goodbye_message: "{user} left {server}.",
  };
export const setWelcome = (guild_id, patch) => {
  const cur = getWelcome(guild_id);
  const next = { ...cur, ...patch };
  db.prepare(
    "INSERT OR REPLACE INTO welcome_config (guild_id, channel_id, message, goodbye_channel_id, goodbye_message) VALUES (?, ?, ?, ?, ?)",
  ).run(guild_id, next.channel_id || null, next.message, next.goodbye_channel_id || null, next.goodbye_message);
  return next;
};

// reaction roles
export const listReactionRoles = (guild_id) =>
  db.prepare("SELECT message_id, emoji, role_id FROM reaction_roles WHERE guild_id = ? ORDER BY message_id, emoji").all(guild_id);
export const setReactionRole = (guild_id, message_id, emoji, role_id) =>
  db.prepare("INSERT OR REPLACE INTO reaction_roles (guild_id, message_id, emoji, role_id) VALUES (?, ?, ?, ?)").run(guild_id, message_id, emoji, role_id);
export const deleteReactionRole = (guild_id, message_id, emoji) =>
  db.prepare("DELETE FROM reaction_roles WHERE guild_id = ? AND message_id = ? AND emoji = ?").run(guild_id, message_id, emoji);
