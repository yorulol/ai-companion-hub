/**
 * Bug-bounty report drafter. Produces HackerOne/Bugcrowd-style markdown
 * from a finding + its verification proof.
 */

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function cvssHint(sev) {
  // Very rough CVSS 3.1 vector suggestions per severity — reviewer adjusts.
  switch (sev) {
    case "critical": return "CVSS: ~9.0-10.0 (suggested vector AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H — adjust)";
    case "high":     return "CVSS: ~7.0-8.9 (suggested vector AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:L/A:N — adjust)";
    case "medium":   return "CVSS: ~4.0-6.9 (suggested vector AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:N — adjust)";
    case "low":      return "CVSS: ~0.1-3.9";
    default:         return "CVSS: informational";
  }
}

/** Markdown ready to paste into a bounty submission. */
export function renderFindingReport(finding, proof) {
  const f = finding, pr = proof || {};
  const lines = [];
  lines.push(`# ${f.title}`);
  lines.push("");
  lines.push(`**Severity:** ${f.severity.toUpperCase()}   **Confidence:** ${pr.confidence || f.confidence}   **Verified:** ${pr.verified ? "yes" : "no"}   **Exploitable:** ${pr.exploitable ? "yes" : "no"}`);
  lines.push(`**Type:** \`${f.type}\`   **Finding ID:** \`${f.id}\``);
  lines.push(`${cvssHint(f.severity)}`);
  lines.push("");
  lines.push(`## Summary`);
  lines.push(f.description || "No description.");
  lines.push("");
  if (f.url) { lines.push(`## Target`); lines.push(`- URL: ${f.url}`); if (f.param) lines.push(`- Parameter: \`${f.param}\``); if (f.path) lines.push(`- Path: \`${f.path}\``); lines.push(""); }

  lines.push(`## Steps to reproduce`);
  const steps = buildSteps(f, pr);
  steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  lines.push("");

  if (pr.request) { lines.push(`### Request`); lines.push("```http"); lines.push(pr.request); lines.push("```"); lines.push(""); }
  if (pr.response) { lines.push(`### Response (trimmed)`); lines.push("```http"); lines.push(pr.response.slice(0, 3000)); lines.push("```"); lines.push(""); }
  if (pr.evidence) { lines.push(`### Evidence`); lines.push("```"); lines.push(String(pr.evidence).slice(0, 1200)); lines.push("```"); lines.push(""); }
  if (pr.payloadsTried?.length) { lines.push(`### Payloads tried`); pr.payloadsTried.forEach((p) => lines.push(`- \`${p}\``)); lines.push(""); }

  lines.push(`## Impact`);
  lines.push(impactFor(f));
  lines.push("");

  lines.push(`## Remediation`);
  lines.push(f.remediation || "Follow vendor guidance for this vulnerability class.");
  lines.push("");

  if (f.references?.length) {
    lines.push(`## References`);
    for (const r of f.references) lines.push(`- ${r}`);
    lines.push("");
  }

  if (pr.notes) { lines.push(`## Notes`); lines.push(pr.notes); lines.push(""); }
  lines.push(`---`);
  lines.push(`_Prepared by YORU. Scan and verification performed with the operator's written permission._`);
  return lines.join("\n");
}

function buildSteps(f, pr) {
  const s = [];
  if (f.url) s.push(`Navigate to \`${f.url}\`.`);
  if (f.param && f.payload) s.push(`Set the \`${f.param}\` parameter to the payload below.`);
  else if (f.payload) s.push(`Send the following payload.`);
  if (pr.request) s.push(`Send the request shown in the "Request" block below.`);
  s.push(`Observe the response — see "Evidence" / "Response" blocks.`);
  if (pr.verified) s.push(`Confirm the vulnerability is present.`);
  return s;
}

function impactFor(f) {
  switch (f.type) {
    case "sqli-error": case "sqli-boolean": case "sqli-time":
      return "Attackers can read, modify, or delete database contents, potentially leading to full account takeover and data breach.";
    case "xss-reflected": case "xss-partial":
      return "Attackers can execute JavaScript in a victim's browser, steal session cookies or tokens, and perform actions on the victim's behalf.";
    case "lfi":
      return "Attackers can read arbitrary files on the server, including configuration, credentials, and source code.";
    case "cmdi-time":
      return "Attackers can execute arbitrary OS commands on the server, typically leading to full remote code execution.";
    case "ssti":
      return "Server-side template injection commonly leads to remote code execution on the application server.";
    case "open-redirect":
      return "Attackers can craft links that appear to come from your domain but redirect victims to phishing or malware sites.";
    case "cors-misconfig":
      return "Malicious sites can read authenticated responses from this origin, exposing user data.";
    case "exposed-path": case "source-map":
      return "Sensitive files or configuration are publicly accessible, aiding further attacks or leaking credentials.";
    case "exposed-secret":
      return "A credential has been leaked publicly and should be rotated immediately.";
    case "subdomain-takeover":
      return "An attacker can claim this subdomain and serve arbitrary content under your brand, enabling phishing and cookie theft.";
    case "csrf-missing":
      return "Attackers can trick authenticated users into performing state-changing actions without their consent.";
    case "clickjacking":
      return "Attackers can frame this page to trick users into clicking hidden UI elements.";
    case "crlf":
      return "Header injection can enable response splitting, cache poisoning, and XSS via forged headers.";
    default:
      return f.description || "See summary.";
  }
}

/** Combined per-site report. */
export function renderSiteReport(host, target, entries) {
  const sorted = [...entries].sort((a, b) => (SEV_ORDER[a.finding.severity] ?? 9) - (SEV_ORDER[b.finding.severity] ?? 9));
  const verified = sorted.filter((e) => e.proof?.verified);
  const lines = [];
  lines.push(`# Bug-bounty report — ${host}`);
  lines.push("");
  lines.push(`- Target: ${target}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Findings total: ${sorted.length}   Verified: ${verified.length}`);
  lines.push("");
  lines.push(`## Verified findings (submit these first)`);
  if (!verified.length) lines.push("_None verified this run._");
  for (const e of verified) {
    lines.push("");
    lines.push(`---`);
    lines.push("");
    lines.push(renderFindingReport(e.finding, e.proof));
  }
  const unverified = sorted.filter((e) => !e.proof?.verified);
  if (unverified.length) {
    lines.push("");
    lines.push(`## Unverified findings (manual follow-up)`);
    for (const e of unverified) {
      lines.push(`- [${e.finding.severity.toUpperCase()}] ${e.finding.title} — ${e.finding.url || e.finding.path || ""}  \n  _reason: ${e.proof?.evidence || "no signal"}_`);
    }
  }
  return lines.join("\n");
}
