/**
 * Persist scan results to agent/web/<host>/.
 *
 * Layout:
 *   agent/web/<host>/
 *     latest.json                    full normalized result of the last scan
 *     scans/<timestamp>.json         full snapshot per scan
 *     summary.md                     human-readable current summary
 *     by-type/<type>.md              one file per vulnerability type,
 *                                    appended to across scans (deduped by finding id)
 *     cves.md                        CVE hits from software fingerprint
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
export const WEB_DIR = path.join(ROOT, "web");

function safeHost(target) {
  try { return new URL(target).host.replace(/[^a-z0-9._-]/gi, "_"); }
  catch { return String(target).replace(/[^a-z0-9._-]/gi, "_").slice(0, 80) || "target"; }
}

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}_${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}`;
}

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const sortBySev = (a, b) => (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);

export async function ensureWebFolder() {
  await fs.mkdir(WEB_DIR, { recursive: true });
  const readme = path.join(WEB_DIR, "README.txt");
  try { await fs.access(readme); }
  catch {
    await fs.writeFile(readme, [
      "YORU web vulnerability scans",
      "",
      "One folder per host you scan. Each host folder contains:",
      "  latest.json          the most recent full scan result",
      "  scans/               timestamped snapshots of every scan",
      "  summary.md           readable summary of the latest scan",
      "  by-type/             one markdown file per vulnerability type",
      "  cves.md              CVE hits from software fingerprints",
      "",
      "Only scan targets you have explicit written permission to test.",
      "",
    ].join("\n"), "utf8");
  }
}

function renderFinding(f) {
  const lines = [];
  lines.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
  lines.push(`- id: \`${f.id}\`  confidence: ${f.confidence}`);
  if (f.url) lines.push(`- url: ${f.url}`);
  if (f.param) lines.push(`- param: \`${f.param}\``);
  if (f.path) lines.push(`- path: \`${f.path}\``);
  if (f.payload) lines.push(`- payload: \`${String(f.payload).slice(0, 300)}\``);
  if (f.description) lines.push(`\n${f.description}`);
  if (f.evidence) lines.push(`\n> ${String(f.evidence).replace(/\n/g, " ").slice(0, 400)}`);
  if (f.remediation) lines.push(`\n**Remediation:** ${f.remediation}`);
  if (f.references?.length) lines.push(`\nReferences: ${f.references.map((r) => `<${r}>`).join(" · ")}`);
  return lines.join("\n") + "\n";
}

function renderSummary(result) {
  const s = result.summary || {};
  const bySev = s.bySeverity || {};
  const lines = [];
  lines.push(`# Scan summary — ${result.target}`);
  lines.push("");
  lines.push(`- scanned: ${result.scannedAt}`);
  lines.push(`- final url: ${result.baseline?.finalUrl}`);
  lines.push(`- baseline: HTTP ${result.baseline?.status} (${result.baseline?.timeMs} ms, ${result.baseline?.size} B)`);
  lines.push(`- crawl: ${result.crawl?.pages} pages · ${result.crawl?.forms} forms · ${result.crawl?.paramUrls} param URLs`);
  lines.push("");
  lines.push(`## Findings by severity`);
  for (const sev of ["critical", "high", "medium", "low", "info"]) {
    lines.push(`- **${sev}**: ${bySev[sev] || 0}`);
  }
  lines.push("");
  if (result.fingerprints?.length) {
    lines.push(`## Software fingerprint`);
    for (const f of result.fingerprints) lines.push(`- ${f.type}: ${f.value}`);
    lines.push("");
  }
  const sorted = [...(result.findings || [])].sort(sortBySev);
  lines.push(`## All findings (${sorted.length})`);
  lines.push("");
  for (const f of sorted) lines.push(renderFinding(f));
  return lines.join("\n");
}

function renderCveDoc(result) {
  const lines = [`# CVE lookup — ${result.target}`, "", `scanned: ${result.scannedAt}`, ""];
  if (!result.cves?.length) { lines.push("_No CVE hits._"); return lines.join("\n"); }
  for (const grp of result.cves) {
    lines.push(`## ${grp.product} ${grp.version}`);
    for (const v of grp.cves) {
      lines.push(`- **${v.id}** — ${v.severity}${v.score ? ` (CVSS ${v.score})` : ""}`);
      if (v.vector) lines.push(`  - vector: \`${v.vector}\``);
      if (v.summary) lines.push(`  - ${v.summary}`);
      if (v.references?.length) lines.push(`  - refs: ${v.references.map((r) => `<${r}>`).join(" · ")}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function mergeByType(hostDir, findings) {
  const dir = path.join(hostDir, "by-type");
  await fs.mkdir(dir, { recursive: true });
  const groups = new Map();
  for (const f of findings) {
    if (!groups.has(f.type)) groups.set(f.type, []);
    groups.get(f.type).push(f);
  }
  for (const [type, list] of groups) {
    const file = path.join(dir, `${type}.md`);
    let existing = "";
    try { existing = await fs.readFile(file, "utf8"); } catch {}
    const knownIds = new Set([...existing.matchAll(/id:\s*`([^`]+)`/g)].map((m) => m[1]));
    const fresh = list.filter((f) => !knownIds.has(f.id)).sort(sortBySev);
    if (!fresh.length && existing) continue;
    const header = existing ? "" : `# ${type}\n\n_Findings for every scan that produced this type. Deduped by finding id._\n\n`;
    const block = `\n---\n_scan @ ${new Date().toISOString()}_\n\n` + fresh.map(renderFinding).join("\n");
    await fs.writeFile(file, (existing || header) + block, "utf8");
  }
}

/**
 * Save a scan result into agent/web/<host>/. Returns the folder path
 * and the files that were written.
 */
export async function saveScan(result) {
  await ensureWebFolder();
  const host = safeHost(result.target);
  const hostDir = path.join(WEB_DIR, host);
  await fs.mkdir(path.join(hostDir, "scans"), { recursive: true });
  const stamp = ts();
  const snap = path.join(hostDir, "scans", `${stamp}.json`);
  await fs.writeFile(snap, JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(hostDir, "latest.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(hostDir, "summary.md"), renderSummary(result), "utf8");
  await fs.writeFile(path.join(hostDir, "cves.md"), renderCveDoc(result), "utf8");
  await mergeByType(hostDir, result.findings || []);
  return { hostDir, host, snapshot: snap };
}
