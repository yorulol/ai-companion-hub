/**
 * YORU terminal REPL. After `npm start` you can talk to YORU directly.
 *
 * Just type — YORU listens. To run a vulnerability scan, tell it in plain
 * English ("scan a website for me", "do a vuln scan", "check example.com").
 * If you don't include the URL, it will ask, then run a deep scan + verify +
 * draft bug-bounty reports, all saved under agent/web/<host>/.
 *
 * Slash commands:
 *   /scan <url>       full scan + verify + report
 *   /verify <host>    re-verify the latest scan for a host
 *   /report <host>    regenerate reports from current findings
 *   /vulns <host>     list findings grouped by type
 *   /provider <name>  pin provider for the next reply
 *   /providers        list enabled providers
 *   /web              print the agent/web folder path
 *   /clear /help /exit
 */
import readline from "node:readline";
import path from "node:path";
import { chat } from "./chat-loop.js";
import { runFullScan, reverifyHost, regenerateReports, listVulns } from "./scan-run.js";
import { WEB_DIR } from "./scan-store.js";
import { ask } from "./ai.js";
import { getSettings } from "./db.js";
import { config } from "./config.js";
import { spinner } from "./boot-ui.js";

const SCOPE = "terminal:local";

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  pink: "\x1b[38;5;219m", pinkSoft: "\x1b[38;5;225m",
  purple: "\x1b[38;5;141m", magenta: "\x1b[38;5;177m",
  cyan: "\x1b[38;5;123m", cyanDim: "\x1b[38;5;74m", blue: "\x1b[38;5;111m",
  green: "\x1b[38;5;120m", greenSoft: "\x1b[38;5;157m",
  yellow: "\x1b[38;5;222m", red: "\x1b[38;5;204m", orange: "\x1b[38;5;215m",
  grey: "\x1b[38;5;244m", greyDim: "\x1b[38;5;238m", white: "\x1b[38;5;255m",
};
const GRAD = ["\x1b[38;5;54m","\x1b[38;5;91m","\x1b[38;5;98m","\x1b[38;5;141m","\x1b[38;5;177m","\x1b[38;5;213m","\x1b[38;5;219m"];
const p = (c, s) => `${c}${s}${C.reset}`;
const line = (ch = "─", n = 64, col = C.purple) => p(col, ch.repeat(n));
function gradient(text) {
  const chars = [...text]; const step = chars.length / GRAD.length;
  return chars.map((ch, i) => p(GRAD[Math.min(GRAD.length - 1, Math.floor(i / step))], ch)).join("");
}

function banner() {
  const W = 64;
  const title = gradient("Y · O · R · U   T E R M I N A L");
  const sub = "type freely — or /help · say “scan a site” or drop a URL";
  console.log("");
  console.log(p(GRAD[2], "╭" + "─".repeat(W) + "╮"));
  const titleLen = title.replace(/\x1b\[[0-9;]*m/g, "").length;
  const pad = " ".repeat(Math.max(0, Math.floor((W - titleLen) / 2)));
  console.log(p(GRAD[2], "│") + pad + title + " ".repeat(W - titleLen - pad.length) + p(GRAD[2], "│"));
  const subPad = " ".repeat(Math.max(0, Math.floor((W - sub.length) / 2)));
  console.log(p(GRAD[2], "│") + p(C.grey + C.dim, subPad + sub + " ".repeat(W - sub.length - subPad.length)) + p(GRAD[2], "│"));
  console.log(p(GRAD[2], "╰" + "─".repeat(W) + "╯"));
  console.log("");
}

function severityColor(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critical") return C.red + C.bold;
  if (s === "high") return C.red;
  if (s === "medium") return C.orange;
  if (s === "low") return C.yellow;
  return C.grey;
}

function printReply({ reply, provider, model }) {
  console.log("");
  console.log(p(C.pink + C.bold, "  YORU ") + p(C.grey, `(${provider || "?"}/${model || "?"})`));
  const wrapped = reply.split("\n").map((l) => "  " + l).join("\n");
  console.log(p(C.white, wrapped));
  console.log("");
}

function detectProviders() {
  const enabled = [];
  const pr = config.providers || {};
  if (pr.openrouter?.enabled && pr.openrouter?.key) enabled.push("openrouter");
  if (pr.ollama?.enabled) enabled.push("ollama");
  if (pr.openclaw?.enabled) enabled.push("openclaw");
  return enabled;
}

function printScanHeader(target) {
  console.log("");
  console.log(line("═", 62, C.purple));
  console.log(`${p(C.pink + C.bold, "  DEEP SCAN")} ${p(C.grey, "→")} ${p(C.cyan, target)}`);
  console.log(p(C.grey, "  passive + non-destructive · scan + verify + draft reports"));
  console.log(p(C.yellow, "  ⚠ only scan targets you have written permission to test."));
  console.log(line("═", 62, C.purple));
  console.log("");
}

function printScan(result, saved) {
  const s = result.summary || { bySeverity: {} };
  const sev = s.bySeverity || {};
  console.log("");
  console.log(line("─"));
  console.log(`${p(C.pink + C.bold, "  scan complete")} ${p(C.grey, "→")} ${p(C.cyan, result.target)}`);
  console.log(p(C.grey, `  final url: ${result.baseline?.finalUrl}   HTTP ${result.baseline?.status}   ${result.baseline?.timeMs}ms`));
  console.log(p(C.grey, `  crawl: ${result.crawl?.pages} pages · ${result.crawl?.forms} forms · ${result.crawl?.paramUrls} param URLs`));
  console.log(p(C.green, `  verified: ${result.verifiedCount || 0} / ${result.findings?.length || 0}`));
  console.log("");
  console.log("  " + [
    p(severityColor("critical"), `critical ${sev.critical || 0}`),
    p(severityColor("high"), `high ${sev.high || 0}`),
    p(severityColor("medium"), `medium ${sev.medium || 0}`),
    p(severityColor("low"), `low ${sev.low || 0}`),
    p(severityColor("info"), `info ${sev.info || 0}`),
  ].join(p(C.grey, " · ")));
  console.log("");

  if (result.fingerprints?.length) {
    console.log(p(C.blue + C.bold, "  fingerprint"));
    for (const f of result.fingerprints) console.log(`    ${p(C.grey, "·")} ${p(C.cyan, f.type)} ${p(C.white, f.value)}`);
    console.log("");
  }

  const SEV_ORDER = ["critical", "high", "medium", "low", "info"];
  const bySev = new Map(SEV_ORDER.map((k) => [k, []]));
  for (const f of result.findings || []) bySev.get(f.severity)?.push(f);
  for (const sevKey of SEV_ORDER) {
    const list = bySev.get(sevKey) || [];
    if (!list.length) continue;
    console.log(p(severityColor(sevKey) + C.bold, `  ${sevKey.toUpperCase()} (${list.length})`));
    for (const f of list) {
      const verified = result.proofs?.[f.id]?.verified;
      const mark = verified ? p(C.green, " ✓") : p(C.grey, " ·");
      console.log(`    ${p(severityColor(sevKey), "▸")}${mark} ${p(C.white, f.title)} ${p(C.grey, `[${f.type}]`)}`);
      if (f.url) console.log(p(C.grey, `        ${f.url}`));
      if (f.param) console.log(p(C.grey, `        param=${f.param}`));
      if (f.evidence) console.log(p(C.grey, `        ${String(f.evidence).replace(/\s+/g, " ").slice(0, 160)}`));
    }
    console.log("");
  }

  if (result.cves?.length) {
    console.log(p(C.pink + C.bold, "  CVE hits (NVD)"));
    for (const grp of result.cves) {
      console.log(`    ${p(C.white, `${grp.product} ${grp.version}`)}`);
      for (const v of grp.cves) {
        console.log(`      ${p(severityColor(v.severity), `[${v.severity}]`)} ${p(C.white, v.id)}${v.score ? p(C.grey, ` (cvss ${v.score})`) : ""}`);
        if (v.summary) console.log(p(C.grey, `        ${v.summary}`));
      }
    }
    console.log("");
  }

  if (saved) {
    console.log(p(C.green + C.bold, "  saved"));
    console.log(p(C.grey, `    folder     ${saved.hostDir}`));
    console.log(p(C.grey, `    snapshot   ${path.relative(WEB_DIR, saved.snapshot)}`));
    console.log(p(C.grey, `    per vuln   vulns/<type>/<id>/ (finding.md · proof.md · request.http · response.txt · report.md · status.json)`));
    if (saved.reportFile) console.log(p(C.grey, `    report     ${path.relative(WEB_DIR, saved.reportFile)}`));
    console.log("");
  }
  console.log(line("─"));
  console.log("");
}

async function analyzeScanWithAI(result, provider) {
  const providers = detectProviders();
  if (!providers.length) {
    console.log(p(C.yellow, "  (no AI provider enabled — skipping triage.)"));
    return;
  }
  try {
    const persona = getSettings().persona;
    const compact = {
      target: result.target,
      summary: result.summary,
      verifiedCount: result.verifiedCount,
      fingerprints: result.fingerprints,
      findings: (result.findings || []).map((f) => ({
        id: f.id, type: f.type, severity: f.severity, confidence: f.confidence,
        title: f.title, url: f.url, param: f.param, path: f.path,
        verified: !!result.proofs?.[f.id]?.verified,
        evidence: f.evidence && String(f.evidence).slice(0, 200),
      })),
      cves: result.cves,
    };
    const messages = [
      { role: "system", content: `${persona}\n\nYou're a senior bug-bounty triage partner. Rank the top 5 VERIFIED issues worth submitting first (severity, one-line impact, one-line repro hint). Then list unverified findings worth manual follow-up. Flag noise. Never invent findings not in the data. Be concise, blunt, technical.` },
      { role: "user", content: `Deep-scan + verification results for a target the operator has permission to test:\n\n${JSON.stringify(compact).slice(0, 14000)}` },
    ];
    const { reply, provider: pv, model } = await ask({ messages, mode: "general", only: provider || null });
    printReply({ reply, provider: pv, model });
  } catch (err) {
    console.log(p(C.red, `  AI triage failed: ${err.message}`));
  }
}

const URL_RE = /(https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;
const SCAN_INTENT_RE = /\b(vuln(?:erability)?|sqli|xss|cve|bug\s*bount|pentest|pen[- ]?test|scan|audit|security\s+(?:check|test))\b/i;
const VERIFY_INTENT_RE = /\b(verify|re[- ]?verify|confirm)\b.*\b(scan|vuln|finding|last)\b/i;
const REPORT_INTENT_RE = /\b(draft|generate|write|regen(?:erate)?)\b.*\breport/i;
const LIST_INTENT_RE = /\b(what(?:'s| is)\s+(?:vulnerable|exploitable)|show|list)\b.*\b(vuln|finding|exploit)/i;

function extractUrl(text) {
  const m = URL_RE.exec(text || "");
  if (!m) return null;
  const raw = m[1];
  return /^https?:\/\//i.test(raw) ? raw : "https://" + raw;
}

function extractHost(text) {
  const m = /\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i.exec(text || "");
  return m?.[1] || null;
}

async function runScan(rawUrl, pinnedProvider) {
  const url = rawUrl.trim();
  if (!url) { console.log(p(C.red, "  need a URL to scan.")); return; }
  printScanHeader(url);
  const spin = spinner("initializing deep scan");
  const notes = [];
  try {
    const { result, saved } = await runFullScan(url, {
      onNote: (n) => { notes.push(n); spin.update(n); },
    });
    spin.stop(p(C.greenSoft, `  ✓ scan finished · ${notes.length} probe phases`));
    printScan(result, saved);
    await analyzeScanWithAI(result, pinnedProvider);
  } catch (err) {
    spin.stop();
    console.log(p(C.red, `  scan failed: ${err.message}`));
  }
}

async function runReverify(host) {
  if (!host) { console.log(p(C.red, "  need a host — e.g. /verify example.com")); return; }
  console.log(p(C.pink, `  re-verifying latest scan for ${host}`));
  try {
    const { hostDir, result, reportFile } = await reverifyHost(host, {
      onNote: (n) => console.log(p(C.grey, `    · ${n}`)),
    });
    console.log(p(C.green, `  ✓ verified ${result.verifiedCount} / ${result.findings.length}`));
    console.log(p(C.grey, `    folder ${hostDir}`));
    console.log(p(C.grey, `    report ${reportFile}`));
  } catch (err) {
    console.log(p(C.red, `  re-verify failed: ${err.message}`));
  }
}

async function runReport(host) {
  if (!host) { console.log(p(C.red, "  need a host — e.g. /report example.com")); return; }
  try {
    const { hostDir, reportFile } = await regenerateReports(host);
    console.log(p(C.green, `  ✓ reports regenerated`));
    console.log(p(C.grey, `    folder ${hostDir}`));
    console.log(p(C.grey, `    report ${reportFile}`));
  } catch (err) {
    console.log(p(C.red, `  report failed: ${err.message}`));
  }
}

async function runList(host) {
  if (!host) { console.log(p(C.red, "  need a host — e.g. /vulns example.com")); return; }
  try {
    const { target, verifiedCount, byType } = await listVulns(host);
    console.log("");
    console.log(p(C.pink + C.bold, `  vulns for ${target}`) + p(C.grey, `   verified ${verifiedCount}`));
    for (const [type, items] of Object.entries(byType)) {
      console.log(p(C.cyan + C.bold, `  ${type}`) + p(C.grey, `  (${items.length})`));
      for (const it of items) {
        const mark = it.verified ? p(C.green, "✓") : p(C.grey, "·");
        console.log(`    ${mark} ${p(severityColor(it.severity), `[${it.severity}]`)} ${p(C.white, it.title)}`);
        if (it.url) console.log(p(C.grey, `        ${it.url}${it.param ? ` (?${it.param})` : ""}`));
      }
    }
    console.log("");
  } catch (err) {
    console.log(p(C.red, `  list failed: ${err.message}`));
  }
}

function help() {
  console.log("");
  console.log(p(C.pink + C.bold, "  commands"));
  console.log(`    ${p(C.cyan, "/scan <url>")}       deep scan + verify + draft reports`);
  console.log(`    ${p(C.cyan, "/verify <host>")}    re-verify the latest scan for that host`);
  console.log(`    ${p(C.cyan, "/report <host>")}    regenerate reports from current findings`);
  console.log(`    ${p(C.cyan, "/vulns <host>")}     list findings grouped by type (verified flag)`);
  console.log(`    ${p(C.cyan, "/provider <name>")}  pin provider for the next reply`);
  console.log(`    ${p(C.cyan, "/providers")}        list enabled providers`);
  console.log(`    ${p(C.cyan, "/web")}              print the agent/web folder path`);
  console.log(`    ${p(C.cyan, "/clear /help /exit")}`);
  console.log("");
  console.log(p(C.grey, "  natural: “scan a site”, “verify last scan on x.com”, “draft reports for x.com”, “what's exploitable on x.com”"));
  console.log("");
}

export function startTerminalRepl() {
  // The banner and provider line always print — only the interactive prompt
  // needs a TTY. (Some launchers pipe stdin, which used to hide everything.)
  banner();
  const providers = detectProviders();
  if (providers.length) {
    console.log(p(C.green, "  providers enabled: ") + providers.map((n) => p(C.cyan, n)).join(p(C.grey, " · ")));
  } else {
    console.log(p(C.yellow, "  no AI providers enabled — add keys / enable in .env"));
  }
  console.log("");
  if (!process.stdin.isTTY) {
    console.log(p(C.grey, "  (non-interactive terminal — chat prompt unavailable)"));
    return;
  }
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout,
    prompt: gradient("you") + p(C.grey, " ❯ "),
    terminal: true,
  });

  let pinnedProvider = null;
  let awaitingScanUrl = false;

  banner();
  const providers = detectProviders();
  if (providers.length) {
    console.log(p(C.green, "  providers enabled: ") + providers.map((n) => p(C.cyan, n)).join(p(C.grey, " · ")));
  } else {
    console.log(p(C.yellow, "  no AI providers enabled — add keys / enable in .env"));
  }
  console.log("");
  rl.prompt();

  rl.on("line", async (raw) => {
    const linein = raw.trim();
    if (!linein) { rl.prompt(); return; }

    try {
      if (linein === "/exit" || linein === "/quit") { rl.close(); return; }
      if (linein === "/help") { help(); rl.prompt(); return; }
      if (linein === "/web") { console.log(p(C.grey, `  ${WEB_DIR}`)); rl.prompt(); return; }
      if (linein === "/providers") {
        const ps = detectProviders();
        console.log(ps.length ? p(C.green, "  " + ps.join(", ")) : p(C.yellow, "  none enabled"));
        rl.prompt(); return;
      }
      if (linein === "/clear") {
        const { db } = await import("./db.js");
        try { db.prepare("DELETE FROM messages WHERE scope = ?").run(SCOPE); } catch {}
        console.log(p(C.grey, "  memory cleared."));
        rl.prompt(); return;
      }
      if (linein.startsWith("/provider ") || linein === "/provider") {
        const name = linein.split(/\s+/)[1];
        pinnedProvider = name || null;
        console.log(p(C.grey, `  next reply will use: ${pinnedProvider || "auto"}`));
        rl.prompt(); return;
      }
      if (linein.startsWith("/scan")) {
        const rest = linein.slice(5).trim();
        if (!rest) { awaitingScanUrl = true; console.log(p(C.pink, "  what URL should I scan?")); rl.prompt(); return; }
        await runScan(rest, pinnedProvider);
        rl.prompt(); return;
      }
      if (linein.startsWith("/verify")) {
        await runReverify(linein.slice(7).trim() || extractHost(linein));
        rl.prompt(); return;
      }
      if (linein.startsWith("/report")) {
        await runReport(linein.slice(7).trim() || extractHost(linein));
        rl.prompt(); return;
      }
      if (linein.startsWith("/vulns")) {
        await runList(linein.slice(6).trim() || extractHost(linein));
        rl.prompt(); return;
      }

      if (awaitingScanUrl) {
        awaitingScanUrl = false;
        const url = extractUrl(linein) || linein;
        await runScan(url, pinnedProvider);
        rl.prompt(); return;
      }

      const url = extractUrl(linein);
      const host = extractHost(linein);

      if (VERIFY_INTENT_RE.test(linein) && host) { await runReverify(host); rl.prompt(); return; }
      if (REPORT_INTENT_RE.test(linein) && host) { await runReport(host); rl.prompt(); return; }
      if (LIST_INTENT_RE.test(linein) && host) { await runList(host); rl.prompt(); return; }

      const intent = SCAN_INTENT_RE.test(linein);
      if (intent && url) { await runScan(url, pinnedProvider); rl.prompt(); return; }
      if (intent && !url) {
        awaitingScanUrl = true;
        console.log(p(C.pink, "  sure — what URL should I scan? (paste it on the next line)"));
        rl.prompt(); return;
      }
      if (url && /^\S+$/.test(linein)) { await runScan(url, pinnedProvider); rl.prompt(); return; }

      const res = await chat({
        scope: SCOPE, userText: linein,
        mode: /\b(code|refactor|debug|implement|function|class)\b/i.test(linein) ? "coding" : "general",
        isOwner: true,
        context: { platform: "terminal" },
      });
      printReply(res);
      pinnedProvider = null;
    } catch (err) {
      console.log(p(C.red, `  error: ${err.message}`));
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("");
    console.log(p(C.pink, "  bye."));
    process.exit(0);
  });
}
