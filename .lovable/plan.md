# Automate the bug-bounty loop

Right now YORU scans a site and drops findings into `agent/web/<host>/`. You want two things on top of that:

1. Every finding filed under its own vulnerability file per site (already partially there — tighten it).
2. YORU takes the next step automatically: verifies the finding, gathers proof, drafts the report, and stores everything ready to submit.

## What you'll see

After a scan finishes, each site's folder looks like this:

```text
agent/web/<host>/
  latest.json
  summary.md
  scans/<timestamp>.json
  vulns/
    sqli/
      <finding-id>/
        finding.md          human summary
        proof.md            verification steps + evidence
        request.http        raw HTTP request that triggered it
        response.txt        server response (trimmed)
        payloads.txt        payloads tried
        report.md           bug-bounty-ready writeup
        status.json         { verified, exploitable, severity, submitted:false }
    xss/<id>/...
    lfi/<id>/...
    ...one folder per vuln type, one subfolder per finding
  reports/
    <host>-<date>.md        combined report for the whole site
```

YORU then automatically runs a **verification pass** on every finding:

- Re-sends the exact request, confirms the signal is still there (error string, reflection, timing delta, redirect target, etc.).
- Escalates safely: SQLi → confirm with a second differential payload (no data exfil beyond `@@version` / `current_user`); XSS → confirm reflected context (attribute / html / js) and mark whether it fires without user interaction; LFI → try `/etc/passwd` + Windows equivalent; open redirect → confirm final Location; CORS → confirm `Access-Control-Allow-Credentials: true` with attacker origin; exposed path → capture first 2KB.
- Never runs destructive payloads (no DROP, no writes, no long time-based sleeps > 5s, no shell RCE beyond `id`/`whoami` echo probe).
- Writes `proof.md` with a numbered reproduction and `status.json` marking `verified: true/false`.

Then a **report drafter** turns each verified finding into `report.md` in HackerOne / Bugcrowd format: title, severity, CVSS-ish vector, summary, steps to reproduce, impact, remediation, references. A per-site combined report goes in `reports/`.

New terminal commands:

- `/verify <host>` — re-run verification on the latest scan for that host.
- `/report <host>` — regenerate all reports from current findings.
- `/vulns <host>` — list findings grouped by type with verified/unverified flags.

Natural language works too: "verify the last scan", "draft reports for example.com", "show me what's exploitable on example.com".

Safety rails stay: only scan/verify targets you have written permission to test; the warning banner stays in the terminal; nothing is ever auto-submitted to a bounty platform — you review and send.

## Technical details

- **New file `agent/src/vuln-verify.js`** — `verifyFinding(finding, ctx)` per type; returns `{ verified, evidence, request, response, payloadsTried, notes }`. Type handlers: sqli, xss, lfi, ssti, cmdi, ssrf, open_redirect, crlf, cors, clickjacking, exposed_path, missing_header, secret_leak, subdomain_takeover, cve. Uses same fetch helper as vuln-scan (15s timeout, 800KB cap, YORU-DeepScan UA). Concurrency 3.
- **New file `agent/src/vuln-report.js`** — `renderFindingReport(finding, proof)` → markdown; `renderSiteReport(host, findings, proofs)` → combined. Templates match H1/Bugcrowd conventions.
- **`agent/src/scan-store.js`** — add `saveFindingArtifacts(hostDir, finding, proof, report)` writing the `vulns/<type>/<id>/` layout above. Keep existing `by-type/` for compatibility but the new `vulns/` layout is the canonical one; drop `by-type/` writes.
- **`agent/src/vuln-scan.js`** — after `saveScan`, iterate findings with `pLimit(3)` calling verify + report + `saveFindingArtifacts`. Return enriched result with `verifiedCount`.
- **`agent/src/terminal-repl.js`** — add `/verify`, `/report`, `/vulns` commands + intent regex for "verify"/"report"/"exploitable"/"what's vulnerable"; printScan shows verified count and points at `reports/`.
- **`agent/src/tools.js`** — add owner tools `web_vuln_verify({host})`, `web_vuln_report({host})`, `web_vuln_list({host})`; wire into `chat-loop.js` intent map.
- Finding IDs stay stable (hash of type+url+param+payload) so re-verification updates the same folder instead of creating dupes.
- All new HTTP traffic keeps the same non-destructive guardrails as the scanner: no writes, no destructive SQL, time-based capped at 5s, single verification round per finding.
