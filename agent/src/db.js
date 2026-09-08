import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(join(dataDir, "nova.sqlite"));
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
`);

const DEFAULT_SETTINGS = {
  persona:
    "You are NOVA, a sharp, friendly self-hosted AI assistant. Be concise and practical. For coding questions give working code with short explanations.",
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
      id,
      name,
      getSettings().discord.defaultPrefix,
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
    next.name,
    next.prefix,
    JSON.stringify(next.adminRoles),
    JSON.stringify(next.modRoles),
    next.aiReplies ? 1 : 0,
    JSON.stringify(next.disabledCommands),
    id,
  );
  return next;
}

export function allGuilds() {
  return db.prepare("SELECT id FROM guilds").all().map((r) => getGuild(r.id));
}

export function rememberMessage(scope, role, content) {
  db.prepare("INSERT INTO memory (scope, role, content, created_at) VALUES (?, ?, ?, ?)").run(
    scope,
    role,
    content,
    Date.now(),
  );
  db.prepare(
    "DELETE FROM memory WHERE scope = ? AND id NOT IN (SELECT id FROM memory WHERE scope = ? ORDER BY id DESC LIMIT 24)",
  ).run(scope, scope);
}

export function recallMessages(scope) {
  return db
    .prepare("SELECT role, content FROM memory WHERE scope = ? ORDER BY id ASC")
    .all(scope)
    .map(({ role, content }) => ({ role, content }));
}
