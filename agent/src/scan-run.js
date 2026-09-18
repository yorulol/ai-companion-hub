/**
 * Full bug-bounty pipeline: scan → verify → draft reports → persist per-finding.
 *
 * This is the single entry point the REPL and tool calls use so a user just
 * says "scan example.com" and gets everything on disk ready to submit.
 */
import { scanTarget } from "./vuln-scan.js";
import { verifyAll, verifyFinding } from "./vuln-verify.js";
import { renderFindingReport, renderSiteReport } from "./vuln-report.js";
import {
  saveScan, saveFindingArtifacts, saveSiteReport,
  loadLatest, hostDirFor, safeHost,
} from "./scan-store.js";

/**
 * @param {string} target
 * @param {object} [opts]
 * @param {(note:string)=>void} [opts.onNote]
 * @param {boolean} [opts.verify=true]
 * @param {boolean} [opts.report=true]
 */
export async function runFullScan(target, opts = {}) {
  const onNote = opts.onNote || (() => {});
  const doVerify = opts.verify !== false;
  const doReport = opts.report !== false;

  const result = await scanTarget(target, { onNote });

  const entries = [];
  const proofs = {};
  if (doVerify && result.findings?.length) {
    onNote(`verifying ${result.findings.length} findings`);
    const verified = await verifyAll(result.findings, {
      concurrency: 3,
      onProgress: (i, n, f, pr) => onNote(`  verify ${i}/${n} — ${f.type} → ${pr.verified ? "VERIFIED" : "no signal"}`),
    });
    for (const e of verified) { entries.push(e); proofs[e.finding.id] = e.proof; }
  } else {
    for (const f of result.findings || []) entries.push({ finding: f, proof: { verified: false, exploitable: false, confidence: "low", evidence: "verification skipped", request: "", response: "", payloadsTried: [], notes: "" } });
  }
  result.verifiedCount = entries.filter((e) => e.proof.verified).length;
  result.proofs = proofs;

  const saved = await saveScan(result);

  if (doReport) {
    onNote("writing per-finding artifacts");
    for (const e of entries) {
      const md = renderFindingReport(e.finding, e.proof);
      await saveFindingArtifacts(saved.hostDir, e.finding, e.proof, md);
    }
    onNote("drafting combined site report");
    const reportFile = await saveSiteReport(saved.hostDir, saved.host, result.target, entries, renderSiteReport);
    saved.reportFile = reportFile;
  }

  return { result, saved, entries };
}

/**
 * Re-run verification on the latest scan for a host, refresh proofs, reports, artifacts.
 */
export async function reverifyHost(host, opts = {}) {
  const onNote = opts.onNote || (() => {});
  const { hostDir, result } = await loadLatest(host);
  const findings = result.findings || [];
  onNote(`re-verifying ${findings.length} findings for ${host}`);
  const verified = await verifyAll(findings, {
    concurrency: 3,
    onProgress: (i, n, f, pr) => onNote(`  verify ${i}/${n} — ${f.type} → ${pr.verified ? "VERIFIED" : "no signal"}`),
  });
  const proofs = {};
  for (const e of verified) proofs[e.finding.id] = e.proof;
  result.proofs = proofs;
  result.verifiedCount = verified.filter((e) => e.proof.verified).length;
  await saveScan(result);
  for (const e of verified) {
    const md = renderFindingReport(e.finding, e.proof);
    await saveFindingArtifacts(hostDir, e.finding, e.proof, md);
  }
  const reportFile = await saveSiteReport(hostDir, safeHost(host), result.target, verified, renderSiteReport);
  return { hostDir, result, entries: verified, reportFile };
}

/**
 * Regenerate reports for a host from what's on disk (no re-verification).
 */
export async function regenerateReports(host) {
  const { hostDir, result } = await loadLatest(host);
  const entries = (result.findings || []).map((f) => ({
    finding: f, proof: result.proofs?.[f.id] || { verified: false, exploitable: false, confidence: "low", evidence: "", request: "", response: "", payloadsTried: [], notes: "" },
  }));
  for (const e of entries) {
    const md = renderFindingReport(e.finding, e.proof);
    await saveFindingArtifacts(hostDir, e.finding, e.proof, md);
  }
  const reportFile = await saveSiteReport(hostDir, safeHost(host), result.target, entries, renderSiteReport);
  return { hostDir, reportFile, entries };
}

/**
 * Group findings for a host by type with verified flag.
 */
export async function listVulns(host) {
  const { result } = await loadLatest(host);
  const byType = new Map();
  for (const f of result.findings || []) {
    if (!byType.has(f.type)) byType.set(f.type, []);
    byType.get(f.type).push({
      id: f.id, severity: f.severity, title: f.title, url: f.url, param: f.param,
      verified: !!result.proofs?.[f.id]?.verified,
      exploitable: !!result.proofs?.[f.id]?.exploitable,
    });
  }
  return { target: result.target, verifiedCount: result.verifiedCount || 0, byType: Object.fromEntries(byType) };
}

export { verifyFinding, hostDirFor };
