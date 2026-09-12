/**
 * Lookups folder scanner. Put PDF / CSV / TXT / JSON files in agent/lookups/
 * and YORU can search across all of them for a value (e.g. a username, ID,
 * email). Returns matching rows/lines with source file names.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isLookupWhitelisted, findWhitelistHit, addLookupWhitelist } from "./db.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const LOOKUPS_DIR = path.join(here, "..", "lookups");

async function ensure() {
  await fs.mkdir(LOOKUPS_DIR, { recursive: true });
}

export async function listLookupFiles() {
  await ensure();
  const items = await fs.readdir(LOOKUPS_DIR, { withFileTypes: true });
  return items
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => /\.(pdf|csv|txt|json|log|tsv)$/i.test(n));
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === "," || c === "\t") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

async function readPdf(file) {
  try {
    const pdfParse = require("pdf-parse");
    const buf = await fs.readFile(file);
    const data = await pdfParse(buf);
    return data.text || "";
  } catch (err) {
    console.warn(`[lookups] pdf ${path.basename(file)}: ${err.message}`);
    return "";
  }
}

/**
 * Search every lookup file for `query`. Case-insensitive substring match.
 * For CSV/TSV: returns matching rows keyed by the header row. For text/PDF:
 * returns matching lines with a bit of surrounding context.
 */
export async function lookup(query, { limitPerFile = 25 } = {}) {
  if (!query || query.length < 2) throw new Error("Query must be at least 2 characters.");
  if (isLookupWhitelisted(query)) {
    return { query, files: (await listLookupFiles()).length, matches: [], protected: true, message: "That identity is protected by the lookup whitelist." };
  }
  const files = await listLookupFiles();
  const needle = query.toLowerCase();
  const results = [];

  for (const name of files) {
    const full = path.join(LOOKUPS_DIR, name);
    const ext = path.extname(name).toLowerCase();
    try {
      let hits = [];
      if (ext === ".csv" || ext === ".tsv") {
        const text = await fs.readFile(full, "utf8");
        const lines = text.split(/\r?\n/).filter(Boolean);
        const header = lines.length ? parseCsvLine(lines[0]) : [];
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(needle)) {
            const cols = parseCsvLine(lines[i]);
            const row = {};
            header.forEach((h, k) => { row[h || `col_${k}`] = cols[k] ?? ""; });
            hits.push({ line: i + 1, row });
            if (hits.length >= limitPerFile) break;
          }
        }
      } else if (ext === ".json") {
        const text = await fs.readFile(full, "utf8");
        const data = JSON.parse(text);
        const arr = Array.isArray(data) ? data : Object.values(data);
        for (let i = 0; i < arr.length; i++) {
          const s = JSON.stringify(arr[i]).toLowerCase();
          if (s.includes(needle)) hits.push({ index: i, row: arr[i] });
          if (hits.length >= limitPerFile) break;
        }
      } else if (ext === ".pdf") {
        const text = await readPdf(full);
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(needle)) {
            hits.push({ line: i + 1, context: lines.slice(Math.max(0, i - 1), i + 2).join(" | ") });
            if (hits.length >= limitPerFile) break;
          }
        }
      } else {
        const text = await fs.readFile(full, "utf8");
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(needle)) {
            hits.push({ line: i + 1, context: lines[i].slice(0, 500) });
            if (hits.length >= limitPerFile) break;
          }
        }
      }
      if (hits.length) {
        // Filter out any hit that touches a whitelisted value.
        const filtered = [];
        let whitelistedCount = 0;
        for (const h of hits) {
          const blob = JSON.stringify(h);
          const w = findWhitelistHit(blob);
          if (w) { whitelistedCount++; continue; }
          filtered.push(h);
        }
        // NOTE: do not attach `file` (source filename). The requester must never
        // see which lookup file yielded results. Owner-only endpoints get the
        // filename via a separate `sourceInternal` field that is stripped
        // before the model or the panels see it.
        if (filtered.length) results.push({ hits: filtered, whitelistedRemoved: whitelistedCount, sourceInternal: name });
        else if (whitelistedCount) results.push({ hits: [], whitelistedRemoved: whitelistedCount, sourceInternal: name });
      }
    } catch (err) {
      results.push({ error: err.message, sourceInternal: name });
    }
  }

  // Sanitize: never expose the source filename outside owner-side debug logs.
  const protectedHits = results.reduce((count, result) => count + (result.whitelistedRemoved || 0), 0);
  const sanitized = results.map(({ sourceInternal, ...rest }) => rest).filter((result) => result.hits?.length || result.error);
  return {
    query,
    files: files.length,
    matches: sanitized,
    protected: protectedHits > 0 && sanitized.every((result) => !result.hits?.length),
    message: protectedHits > 0 ? "One or more matching identities are protected by the lookup whitelist." : undefined,
  };
}

function collectLinkedIdentities(value, hit) {
  const identities = new Set();
  const source = JSON.stringify(hit);
  for (const match of source.matchAll(/(?<!\d)\d{15,22}(?!\d)/g)) {
    if (match[0] !== String(value).trim()) identities.add(match[0]);
  }
  if (hit && typeof hit === "object") {
    for (const [key, raw] of Object.entries(hit)) {
      const candidate = String(raw ?? "").trim().toLowerCase();
      if (/^(?:user(?:name)?|discord_?user(?:name)?|handle)$/i.test(key) && /^[\w.-]{2,64}$/.test(candidate) && candidate !== value) {
        identities.add(candidate);
      }
    }
  }
  return [...identities];
}

/**
 * Add an identity and every alias we can find for it:
 *  - Discord IDs and usernames sitting in the same row of a local lookup file.
 *  - The counterpart (ID <-> username) resolved live from the running bot or
 *    alt-account client, so protecting "123..." also protects "someuser" and
 *    vice-versa without needing a file to link them.
 */
export async function addWhitelistIdentity(value, note = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) throw new Error("Enter a Discord username or ID.");
  const aliases = new Set();

  // 1) Live Discord resolution (bot first, then alt account).
  try {
    const discordAliases = await resolveDiscordAliases(normalized);
    discordAliases.forEach((a) => aliases.add(a));
  } catch (err) {
    console.warn(`[whitelist] discord resolve for "${normalized}" failed: ${err.message}`);
  }

  // 2) Local lookup-file scan — link identities that appear together in a row.
  try {
    const files = await listLookupFiles();
    const needle = normalized;
    for (const name of files) {
      const full = path.join(LOOKUPS_DIR, name);
      const ext = path.extname(name).toLowerCase();
      try {
        if (ext === ".csv" || ext === ".tsv") {
          const lines = (await fs.readFile(full, "utf8")).split(/\r?\n/).filter(Boolean);
          const header = lines.length ? parseCsvLine(lines[0]) : [];
          for (let i = 1; i < lines.length; i++) if (lines[i].toLowerCase().includes(needle)) {
            const cols = parseCsvLine(lines[i]);
            const row = {};
            header.forEach((h, k) => { row[h || `col_${k}`] = cols[k] ?? ""; });
            collectLinkedIdentities(normalized, row).forEach((id) => aliases.add(id));
          }
        } else if (ext === ".json") {
          const parsed = JSON.parse(await fs.readFile(full, "utf8"));
          const visit = (item) => {
            if (item && typeof item === "object") {
              if (JSON.stringify(item).toLowerCase().includes(needle)) collectLinkedIdentities(normalized, item).forEach((id) => aliases.add(id));
              Object.values(item).forEach(visit);
            }
          };
          visit(parsed);
        } else {
          const text = ext === ".pdf" ? await readPdf(full) : await fs.readFile(full, "utf8");
          for (const line of text.split(/\r?\n/)) if (line.toLowerCase().includes(needle)) {
            collectLinkedIdentities(normalized, line).forEach((id) => aliases.add(id));
          }
        }
      } catch (err) {
        console.warn(`[whitelist] scan ${name}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[whitelist] file scan failed: ${err.message}`);
  }

  aliases.delete(normalized);
  return addLookupWhitelist(normalized, note, [...aliases]);
}

/** Ask the running Discord clients to translate an ID into a username or vice-versa. */
async function resolveDiscordAliases(value) {
  const aliases = new Set();
  const isId = /^\d{15,22}$/.test(value);
  const clients = [];
  try { const { getBotClient } = await import("./bot.js"); const c = getBotClient?.(); if (c?.user) clients.push(c); } catch {}
  try { const { getSelfbotClient } = await import("./selfbot.js"); const c = getSelfbotClient?.(); if (c?.user) clients.push(c); } catch {}

  const push = (u) => {
    if (!u) return;
    if (u.id) aliases.add(String(u.id).toLowerCase());
    if (u.username) aliases.add(String(u.username).toLowerCase());
    if (u.globalName) aliases.add(String(u.globalName).toLowerCase());
    if (u.tag) aliases.add(String(u.tag).toLowerCase());
  };

  for (const client of clients) {
    try {
      if (isId) {
        const user = await client.users.fetch(value).catch(() => null);
        push(user);
      } else {
        // Search cached users across every guild this client sees.
        for (const guild of client.guilds.cache.values()) {
          const cached = guild.members.cache.find((m) => {
            const u = m.user;
            return (
              u.username?.toLowerCase() === value ||
              u.globalName?.toLowerCase() === value ||
              u.tag?.toLowerCase() === value
            );
          });
          if (cached) push(cached.user);
          // Best-effort live search when the guild supports it.
          try {
            const results = await guild.members.search({ query: value, limit: 5 });
            results.forEach((m) => {
              const u = m.user;
              const hit =
                u.username?.toLowerCase() === value ||
                u.globalName?.toLowerCase() === value ||
                u.tag?.toLowerCase() === value;
              if (hit) push(u);
            });
          } catch {}
        }
      }
    } catch (err) {
      console.warn(`[whitelist] client resolve failed: ${err.message}`);
    }
  }
  return [...aliases];
}
