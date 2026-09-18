/**
 * Persist scan results and per-finding artifacts under agent/web/<host>/.
 *
 * Layout:
 *   agent/web/<host>/
 *     latest.json                    full normalized result of the last scan
 *     scans/<timestamp>.json         full snapshot per scan
 *     summary.md                     human-readable current summary
 *     cves.md                        CVE hits from software fingerprint
 *     vulns/<type>/<finding-id>/
 *       finding.md                   the finding itself (human summary)
 *       proof.md                     verification steps + evidence
 *       request.http                 raw HTTP request that triggered it
 *       response.txt                 server response (trimmed)
 *       payloads.txt                 payloads tried
 *       report.md                    bug-bounty-ready writeup
 *       status.json                  { verified, exploitable, severity, submitted:false }
 *     reports/<host>-<date>.md       combined report for the whole site
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
export const WEB_DIR = path.join(ROOT, "web");

export function safeHost(target) {
  try { return new URL(target).host.replace(/[^a-z0-9._-]/gi, "_"); }
  catch { return String(target).replace(/[^a-z0-9._-]/gi, "_").slice(0, 80) || "target"; }
}

export function safeId(id) {
  return String(id || "unknown").replace(/[^a-z0-9._-]/gi, "_").slice(0, 80);
}

export function hostDirFor(target) {
  return path.join(WEB_DIR, safeHost(target));
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
      "  cves.md              CVE hits from software fingerprints",
      "  vulns/<type>/<id>/   per-finding folder with proof, request, response, report",
      "  reports/             combined bug-bounty reports per scan",
      "",
      "Only scan targets you have explicit written permission to test.",
      "",
    ].join("\n"), "utf8");
  }
}

function renderFindingMd(f) {
  const lines = [];
  lines.push(`# [${f.severity.toUpperCase()}] ${f.title}`);
  lines.push("");
  lines.push(`- id: \`${f.id}\`  type: \`${f.type}\`  confidence: ${f.confidence}`);
  if (f.url) lines.push(`- url: ${f.url}`);
  if (f.param) lines.push(`- param: \`${f.param}\``);
  if (f.path) lines.push(`- path: \`${f.path}\``);
  if (f.payload) lines.push(`- payload: \`${String(f.payload).slice(0, 300)}\``);
  lines.push("");
  if (f.description) { lines.push(f.description); lines.push(""); }
  if (f.evidence) { lines.push("## Evidence"); lines.push("```"); lines.push(String(f.evidence).slice(0, 1200)); lines.push("```"); lines.push(""); }
  if (f.remediation) { lines.push("## Remediation"); lines.push(f.remediation); lines.push(""); }
  if (f.references?.length) { lines.push("## References"); f.references.forEach((r) => lines.push(`- ${r}`)); }
  return lines.join("\n");
}

function renderProofMd(f, proof) {
  const lines = [];
  lines.push(`# Verification proof — ${f.title}`);
  lines.push("");
  lines.push(`- Verified: **${proof.verified ? "YES" : "NO"}**`);
  lines.push(`- Exploitable: **${proof.exploitable ? "YES" : "NO"}**`);
  lines.push(`- Confidence: ${proof.confidence}`);
  lines.push("");
  lines.push(`## Evidence`);
  lines.push("```"); lines.push(String(proof.evidence || "").slice(0, 2000)); lines.push("```");
  if (proof.notes) { lines.push(""); lines.push(`## Notes`); lines.push(proof.notes); }
  return lines.join("\n");
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
  if (typeof result.verifiedCount === "number") lines.push(`- verified: ${result.verifiedCount} / ${result.findings?.length || 0}`);
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
  for (const f of sorted) {
    const verified = result.proofs?.[f.id]?.verified;
    const mark = verified ? " ✅" : "";
    lines.push(`- [${f.severity.toUpperCase()}]${mark} ${f.title}  \n  \`vulns/${f.type}/${f.id}/\``);
  }
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

/**
 * Persist per-finding artifacts under vulns/<type>/<id>/.
 */
export async function saveFindingArtifacts(hostDir, finding, proof, reportMd) {
  const dir = path.join(hostDir, "vulns", safeId(finding.type), safeId(finding.id));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "finding.md"), renderFindingMd(finding), "utf8");
  await fs.writeFile(path.join(dir, "proof.md"), renderProofMd(finding, proof), "utf8");
  if (proof.request) await fs.writeFile(path.join(dir, "request.http"), proof.request, "utf8");
  if (proof.response) await fs.writeFile(path.join(dir, "response.txt"), proof.response, "utf8");
  if (proof.payloadsTried?.length) await fs.writeFile(path.join(dir, "payloads.txt"), proof.payloadsTried.join("\n"), "utf8");
  if (reportMd) await fs.writeFile(path.join(dir, "report.md"), reportMd, "utf8");
  await fs.writeFile(path.join(dir, "status.json"), JSON.stringify({
    id: finding.id, type: finding.type, severity: finding.severity,
    verified: !!proof.verified, exploitable: !!proof.exploitable,
    confidence: proof.confidence, submitted: false,
    updatedAt: new Date().toISOString(),
  }, null, 2), "utf8");
  return dir;
}

export async function saveSiteReport(hostDir, host, target, entries, renderer) {
  const dir = path.join(hostDir, "reports");
  await fs.mkdir(dir, { recursive: true });
  const stamp = ts();
  const file = path.join(dir, `${host}-${stamp}.md`);
  await fs.writeFile(file, renderer(host, target, entries), "utf8");
  return file;
}

/**
 * Save a scan result into agent/web/<host>/. Returns paths.
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
  return { hostDir, host, snapshot: snap };
}

/** Read the latest scan back from disk. */
export async function loadLatest(host) {
  const dir = path.join(WEB_DIR, safeHost(host));
  const file = path.join(dir, "latest.json");
  const raw = await fs.readFile(file, "utf8");
  return { hostDir: dir, result: JSON.parse(raw) };
}

/** List host folders currently on disk. */
export async function listHosts() {
  try {
    const entries = await fs.readdir(WEB_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}
