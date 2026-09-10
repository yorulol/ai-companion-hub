/**
 * Lookups folder scanner. Put PDF / CSV / TXT / JSON files in agent/lookups/
 * and YORU can search across all of them for a value (e.g. a username, ID,
 * email). Returns matching rows/lines with source file names.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { isLookupWhitelisted, findWhitelistHit } from "./db.js";

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
      if (hits.length) results.push({ file: name, hits });
    } catch (err) {
      results.push({ file: name, error: err.message });
    }
  }

  return { query, files: files.length, matches: results };
}
