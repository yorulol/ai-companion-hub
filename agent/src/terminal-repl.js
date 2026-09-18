/**
 * YORU terminal REPL. After `npm start` you can talk to YORU directly.
 *
 * Just type — YORU listens. To run a vulnerability scan, tell it in plain
 * English ("scan a website for me", "do a vuln scan", "check example.com").
 * If you don't include the URL, it will ask, then run a deep scan and save
 * everything under agent/web/<host>/.
 *
 * Provider selection is automatic — whatever you have enabled (OpenRouter,
 * Ollama, OpenClaw) is used. Slash commands remain for power users.
 */
import readline from "node:readline";
import { chat } from "./chat-loop.js";
import { scanTarget } from "./vuln-scan.js";
import { saveScan, WEB_DIR } from "./scan-store.js";
import { ask } from "./ai.js";
import { getSettings } from "./db.js";
import { config } from "./config.js";
import path from "node:path";

const SCOPE = "terminal:local";

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  pink: "\x1b[38;5;219m", purple: "\x1b[38;5;141m", magenta: "\x1b[38;5;177m",
  cyan: "\x1b[38;5;123m", blue: "\x1b[38;5;111m",
  green: "\x1b[38;5;120m", yellow: "\x1b[38;5;222m",
  red: "\x1b[38;5;204m", orange: "\x1b[38;5;215m",
  grey: "\x1b[38;5;244m", white: "\x1b[38;5;255m",
};
const p = (c, s) => `${c}${s}${C.reset}`;
const line = (ch = "─", n = 62, col = C.purple) => p(col, ch.repeat(n));

function banner() {
  console.log("");
  console.log(line("─"));
  console.log(`${p(C.magenta + C.bold, "  Y O R U ")}${p(C.grey, "·")} ${p(C.pink, "terminal — type freely, or /help for commands")}`);
  console.log(`${p(C.grey, "  vuln scans → just say “scan a site” or drop a URL")}   ${p(C.grey, "· local user = owner")}`);
  console.log(line("─"));
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

// ─────────────────── scan output ───────────────────

function printScanHeader(target) {
  console.log("");
  console.log(line("═", 62, C.purple));
  console.log(`${p(C.pink + C.bold, "  DEEP SCAN")} ${p(C.grey, "→")} ${p(C.cyan, target)}`);
  console.log(p(C.grey, "  passive + non-destructive · only scan targets you have permission to test"));
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
      console.log(`    ${p(severityColor(sevKey), "▸")} ${p(C.white, f.title)} ${p(C.grey, `[${f.type}]`)}`);
      if (f.url) console.log(p(C.grey, `        ${f.url}`));
      if (f.param) console.log(p(C.grey, `        param=${f.param}`));
      if (f.evidence) console.log(p(C.grey, `        ${String(f.evidence).replace(/\s+/g, " ").slice(0, 160)}`));
      if (f.remediation) console.log(p(C.dim + C.cyan, `        fix › ${f.remediation.slice(0, 160)}`));
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
    console.log(p(C.grey, `    per-type   by-type/*.md · summary.md · cves.md · latest.json`));
    console.log("");
  }
  console.log(line("─"));
  console.log("");
}

async function analyzeScanWithAI(result, provider) {
  const providers = detectProviders();
  if (!providers.length) {
    console.log(p(C.yellow, "  (no AI provider enabled — skipping triage. Enable OpenRouter, Ollama or OpenClaw in .env.)"));
    return;
  }
  try {
    const persona = getSettings().persona;
    const compact = {
      target: result.target,
      summary: result.summary,
      fingerprints: result.fingerprints,
      findings: (result.findings || []).map((f) => ({
        type: f.type, severity: f.severity, confidence: f.confidence,
        title: f.title, url: f.url, param: f.param, path: f.path,
        evidence: f.evidence && String(f.evidence).slice(0, 200),
      })),
      cves: result.cves,
    };
    const messages = [
      { role: "system", content: `${persona}\n\nYou're a senior bug-bounty triage partner. Rank the top 5 issues worth reporting first, each with: severity, one-line impact, and one-line reproduction hint. Then list manual follow-ups worth trying, and finally flag noise. Never invent findings not in the data. Be concise, blunt, technical.` },
      { role: "user", content: `Deep-scan results for a target the operator has permission to test:\n\n${JSON.stringify(compact).slice(0, 14000)}` },
    ];
    const { reply, provider: pv, model } = await ask({ messages, mode: "general", only: provider || null });
    printReply({ reply, provider: pv, model });
  } catch (err) {
    console.log(p(C.red, `  AI triage failed: ${err.message}`));
  }
}

// ─────────────────── URL + intent detection ───────────────────

const URL_RE = /(https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?)/i;
const SCAN_INTENT_RE = /\b(vuln(?:erability)?|sqli|xss|cve|bug\s*bount|pentest|pen[- ]?test|scan|audit|security\s+(?:check|test))\b/i;

function extractUrl(text) {
  const m = URL_RE.exec(text || "");
  if (!m) return null;
  const raw = m[1];
  if (/^https?:\/\//i.test(raw)) return raw;
  return "https://" + raw;
}

async function runScan(rawUrl, pinnedProvider) {
  const url = rawUrl.trim();
  if (!url) { console.log(p(C.red, "  need a URL to scan.")); return; }
  printScanHeader(url);
  console.log(p(C.yellow, "  ⚠ only scan targets you have written permission to test."));
  console.log("");
  try {
    const result = await scanTarget(url, { onNote: (n) => console.log(p(C.grey, `    · ${n}`)) });
    const saved = await saveScan(result);
    printScan(result, saved);
    await analyzeScanWithAI(result, pinnedProvider);
  } catch (err) {
    console.log(p(C.red, `  scan failed: ${err.message}`));
  }
}

function help() {
  console.log("");
  console.log(p(C.pink + C.bold, "  commands"));
  console.log(`    ${p(C.cyan, "/scan <url>")}       deep vulnerability scan + AI triage`);
  console.log(`    ${p(C.cyan, "/provider <name>")}  pin provider for the next reply (openrouter|ollama|openclaw)`);
  console.log(`    ${p(C.cyan, "/providers")}        list currently enabled providers`);
  console.log(`    ${p(C.cyan, "/web")}              print the agent/web folder path`);
  console.log(`    ${p(C.cyan, "/clear")}            reset REPL memory scope`);
  console.log(`    ${p(C.cyan, "/help")}             show this`);
  console.log(`    ${p(C.cyan, "/exit")}             quit YORU`);
  console.log("");
  console.log(p(C.grey, "  tip: you can also just say “scan a site” — YORU will ask for the URL if you don't include one."));
  console.log("");
}

export function startTerminalRepl() {
  if (!process.stdin.isTTY) return;
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout,
    prompt: p(C.purple + C.bold, "you ") + p(C.grey, "› "),
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
      if (linein.startsWith("/provider")) {
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

      // Awaiting URL from a previous "scan" request
      if (awaitingScanUrl) {
        awaitingScanUrl = false;
        const url = extractUrl(linein) || linein;
        await runScan(url, pinnedProvider);
        rl.prompt(); return;
      }

      // Natural-language scan intent
      const url = extractUrl(linein);
      const intent = SCAN_INTENT_RE.test(linein);
      if (intent && url) { await runScan(url, pinnedProvider); rl.prompt(); return; }
      if (intent && !url) {
        awaitingScanUrl = true;
        console.log(p(C.pink, "  sure — what URL should I scan? (paste it on the next line)"));
        rl.prompt(); return;
      }
      // A bare URL alone is also treated as a scan request
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
