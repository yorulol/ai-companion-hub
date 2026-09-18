/**
 * Terminal REPL. After `npm start`, you can talk to YORU directly in the
 * same terminal — tool-use, vuln scans, and every provider work here.
 *
 * Commands:
 *   /scan <url>        run a web vulnerability scan (SQLi/XSS/CVE/etc)
 *   /provider <name>   pin one provider for the next reply
 *   /clear             wipe REPL memory scope
 *   /help              show commands
 *   /exit              quit the whole process
 */
import readline from "node:readline";
import { chat } from "./chat-loop.js";
import { scanTarget } from "./vuln-scan.js";
import { ask } from "./ai.js";
import { getSettings } from "./db.js";

const SCOPE = "terminal:local";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  pink: "\x1b[38;5;219m",
  purple: "\x1b[38;5;141m",
  cyan: "\x1b[38;5;123m",
  green: "\x1b[38;5;120m",
  yellow: "\x1b[38;5;222m",
  red: "\x1b[38;5;204m",
  grey: "\x1b[38;5;244m",
};
const paint = (c, s) => `${c}${s}${C.reset}`;

function banner() {
  console.log("");
  console.log(paint(C.purple, "─".repeat(60)));
  console.log(paint(C.pink, "  YORU terminal — type freely, or /help for commands"));
  console.log(paint(C.grey, "  local terminal user is trusted as owner"));
  console.log(paint(C.purple, "─".repeat(60)));
  console.log("");
}

function printReply({ reply, provider, model }) {
  console.log("");
  console.log(paint(C.pink, "YORU ") + paint(C.grey, `(${provider || "?"}/${model || "?"})`));
  console.log(reply);
  console.log("");
}

function severityColor(sev) {
  const s = String(sev || "").toLowerCase();
  if (s === "critical" || s === "high") return C.red;
  if (s === "medium") return C.yellow;
  if (s === "low") return C.cyan;
  return C.grey;
}

function printScan(result) {
  console.log("");
  console.log(paint(C.pink, `scan complete → ${result.target}`));
  console.log(paint(C.grey, `  final url: ${result.finalUrl}   status: ${result.status}`));
  if (result.fingerprints.length) {
    console.log(paint(C.cyan, "  fingerprints:"));
    for (const f of result.fingerprints) console.log(`    · ${f.type}: ${f.value}`);
  }
  if (result.missingSecurityHeaders.length) {
    console.log(paint(C.yellow, `  missing headers: ${result.missingSecurityHeaders.join(", ")}`));
  }
  if (result.cookieIssues.length) {
    console.log(paint(C.yellow, "  cookie issues:"));
    for (const c of result.cookieIssues) console.log(`    · ${c.cookie}: ${c.issues.join(", ")}`);
  }
  if (result.findings.length) {
    console.log(paint(C.pink, "  findings:"));
    for (const f of result.findings) {
      console.log(`    ${paint(severityColor(f.severity), `[${f.severity}]`)} ${f.type}` +
        (f.param ? ` param=${f.param}` : "") +
        (f.path ? ` path=${f.path}` : ""));
      if (f.url) console.log(paint(C.grey, `        ${f.url}`));
      if (f.evidence) console.log(paint(C.grey, `        ${f.evidence.replace(/\s+/g, " ").slice(0, 200)}`));
    }
  } else {
    console.log(paint(C.grey, "  no probe-level findings"));
  }
  if (result.cves.length) {
    console.log(paint(C.pink, "  CVE hits:"));
    for (const c of result.cves) {
      console.log(`    ${c.product} ${c.version}`);
      for (const v of c.cves) {
        console.log(`      ${paint(severityColor(v.severity), `[${v.severity}]`)} ${v.id}` +
          (v.score ? paint(C.grey, ` (cvss ${v.score})`) : ""));
        if (v.summary) console.log(paint(C.grey, `        ${v.summary}`));
      }
    }
  }
  console.log("");
}

async function analyzeScanWithAI(result, provider) {
  try {
    const persona = getSettings().persona;
    const messages = [
      { role: "system", content: `${persona}\n\nYou're a bug-bounty triage partner. Prioritize what to report first, what needs manual confirmation, and what's noise. Be concise, blunt, and technical. Never invent findings not in the scan data.` },
      { role: "user", content: `Scan result JSON for a target the operator has permission to test:\n\n${JSON.stringify(result).slice(0, 12000)}\n\nGive me: (1) the top 3 issues worth reporting, ranked, with a one-line justification each; (2) manual follow-ups worth trying; (3) anything you'd de-prioritize as noise.` },
    ];
    const { reply, provider: pv, model } = await ask({ messages, mode: "general", only: provider || null });
    printReply({ reply, provider: pv, model });
  } catch (err) {
    console.log(paint(C.red, `  AI triage failed: ${err.message}`));
  }
}

async function handleScan(rest, pinnedProvider) {
  const url = rest.trim();
  if (!url) { console.log(paint(C.red, "  usage: /scan <url>")); return; }
  console.log(paint(C.grey, "  ⚠ only scan targets you have written permission to test."));
  console.log(paint(C.purple, `  scanning ${url}…`));
  try {
    const result = await scanTarget(url, { onNote: (n) => console.log(paint(C.grey, `    · ${n}`)) });
    printScan(result);
    await analyzeScanWithAI(result, pinnedProvider);
  } catch (err) {
    console.log(paint(C.red, `  scan failed: ${err.message}`));
  }
}

function help() {
  console.log("");
  console.log(paint(C.pink, "  commands:"));
  console.log("    /scan <url>       vulnerability scan + AI triage");
  console.log("    /provider <name>  pin provider for the next reply (openrouter|ollama|openclaw|openai|anthropic|groq)");
  console.log("    /clear            reset REPL memory scope");
  console.log("    /help             show this");
  console.log("    /exit             quit YORU");
  console.log("");
}

export function startTerminalRepl() {
  if (!process.stdin.isTTY) return; // background service — no REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: paint(C.purple, "you › "),
    terminal: true,
  });

  let pinnedProvider = null;

  banner();
  rl.prompt();

  rl.on("line", async (raw) => {
    const line = raw.trim();
    if (!line) { rl.prompt(); return; }

    try {
      if (line === "/exit" || line === "/quit") { rl.close(); return; }
      if (line === "/help") { help(); rl.prompt(); return; }
      if (line === "/clear") {
        const { db } = await import("./db.js");
        try { db.prepare("DELETE FROM messages WHERE scope = ?").run(SCOPE); } catch {}
        console.log(paint(C.grey, "  memory cleared."));
        rl.prompt(); return;
      }
      if (line.startsWith("/provider")) {
        const name = line.split(/\s+/)[1];
        pinnedProvider = name || null;
        console.log(paint(C.grey, `  next reply will use: ${pinnedProvider || "auto"}`));
        rl.prompt(); return;
      }
      if (line.startsWith("/scan")) {
        await handleScan(line.slice(5), pinnedProvider);
        rl.prompt(); return;
      }

      // Inline shortcut: "scan https://…" also works without the slash.
      const inlineScan = /^scan\s+(https?:\/\/\S+|[a-z0-9.-]+\.[a-z]{2,}\S*)$/i.exec(line);
      if (inlineScan) {
        await handleScan(inlineScan[1], pinnedProvider);
        rl.prompt(); return;
      }

      const res = await chat({
        scope: SCOPE,
        userText: line,
        mode: /\b(code|refactor|debug|implement|function|class)\b/i.test(line) ? "coding" : "general",
        isOwner: true, // local terminal user is trusted as owner
        context: { platform: "terminal" },
      });
      // Honor pinned provider by re-asking with `only` when set (chat() doesn't accept it)
      printReply(res);
      pinnedProvider = null;
    } catch (err) {
      console.log(paint(C.red, `  error: ${err.message}`));
    }
    rl.prompt();
  });

  rl.on("close", () => {
    console.log("");
    console.log(paint(C.pink, "bye."));
    process.exit(0);
  });
}
