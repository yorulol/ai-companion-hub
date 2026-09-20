/**
 * Agent tools. YORU can call these by emitting a fenced JSON block in a reply:
 *
 *   ```tool
 *   { "tool": "list_dir", "args": { "path": "~/Documents" } }
 *   ```
 *
 * The chat loop detects the block, runs the tool, and asks the model to
 * continue with the result appended as a system observation.
 */
import * as pc from "./computer.js";
import { lookup, listLookupFiles } from "./lookups.js";
import { runFullScan, reverifyHost, regenerateReports, listVulns } from "./scan-run.js";
import { config } from "./config.js";

const OWNER_TOOL_SPEC = `
You have access to real tools on the user's computer. To use one, reply with a fenced code block:

\`\`\`tool
{"tool":"<name>","args":{...}}
\`\`\`

Available tools:
- system_info() — CPU, RAM, OS, hostname
- list_dir({path}) — list a folder
- read_file({path}) — read a text file
- write_file({path, content}) — create or overwrite a file
- move_file({from, to}) — move/rename
- remove_file({path}) — delete a file or folder
- malware_scan() — run ClamAV (Linux) or Windows Defender scan
- lockdown_engage() — encrypt LOCKDOWN_TARGET folder, return decryption key
- lockdown_release({key}) — decrypt with a previously issued key
- lockdown_status() — is the machine currently in lockdown?
- lookup({query}) — search every file in the lookups folder for a value
- list_lookups() — list files available for lookup
- web_vuln_scan({url}) — deep non-destructive scan on a target the owner has permission to test (SQLi/XSS/LFI/SSTI/CMDi/redirect/CORS/headers/paths + NVD CVEs). Automatically verifies findings, saves per-vuln folders under agent/web/<host>/vulns/<type>/<id>/ and drafts bug-bounty reports.
- web_vuln_verify({host}) — re-run verification on the latest scan for that host (refreshes proof.md + report.md).
- web_vuln_report({host}) — regenerate bug-bounty reports from findings on disk.
- web_vuln_list({host}) — list findings grouped by type with verified flag.

Only ONE tool call per reply. After the tool runs you'll get its result as an observation, then continue the answer for the user.
`.trim();

const PUBLIC_TOOL_SPEC = `
You may search the owner's local lookup index only when the user explicitly asks for a lookup. Use exactly:

\`\`\`tool
{"tool":"lookup","args":{"query":"<exact query>"}}
\`\`\`

You have no other tools in this conversation. Never invent tool results or mention private capabilities.
`.trim();

export const toolSpecFor = (isOwner) => isOwner ? OWNER_TOOL_SPEC : PUBLIC_TOOL_SPEC;

async function run(name, args = {}) {
  switch (name) {
    case "system_info": return await pc.systemInfo();
    case "list_dir": return await pc.listDir(args.path);
    case "read_file": return await pc.readFile(args.path);
    case "write_file": return await pc.writeFile(args.path, args.content ?? "");
    case "move_file": return await pc.moveFile(args.from, args.to);
    case "remove_file": return await pc.removeFile(args.path);
    case "malware_scan": return await pc.scanForMalware();
    case "lockdown_engage": return await pc.engageLockdown();
    case "lockdown_release": return await pc.releaseLockdown(args.key);
    case "lockdown_status": return await pc.lockdownStatus();
    case "lookup": return await lookup(args.query);
    case "list_lookups": return { files: await listLookupFiles() };
    case "shell": return await pc.runShell(args.command);
    case "web_vuln_scan": {
      const { result, saved } = await runFullScan(args.url);
      return {
        target: result.target,
        summary: result.summary,
        verifiedCount: result.verifiedCount,
        fingerprints: result.fingerprints,
        cves: result.cves,
        savedTo: saved.hostDir,
        reportFile: saved.reportFile,
        findings: (result.findings || []).map((f) => ({
          id: f.id, type: f.type, severity: f.severity, title: f.title,
          url: f.url, param: f.param, path: f.path,
          verified: !!result.proofs?.[f.id]?.verified,
        })),
      };
    }
    case "web_vuln_verify": {
      const r = await reverifyHost(args.host);
      return { host: args.host, verifiedCount: r.result.verifiedCount, total: r.result.findings.length, reportFile: r.reportFile, savedTo: r.hostDir };
    }
    case "web_vuln_report": {
      const r = await regenerateReports(args.host);
      return { host: args.host, reportFile: r.reportFile, savedTo: r.hostDir };
    }
    case "web_vuln_list": return await listVulns(args.host);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

// Models are not always polite enough to put a newline after ```tool.
// Accept the compact form too, but only execute complete, valid JSON blocks.
// Also accept bare ``` fences (no language tag) when the body is a tool JSON,
// and untagged JSON objects that carry {"tool":"..."}.
const TOOL_RE = /```(?:tool|function|json)?\s*({[\s\S]+?})\s*```/i;
const BARE_TOOL_JSON_RE = /(\{\s*"tool"\s*:\s*"[^"]+"[\s\S]*?\})/i;

function tryParseTool(raw, json) {
  try {
    const parsed = JSON.parse(json);
    if (!parsed.tool) return null;
    return { tool: parsed.tool, args: parsed.args || {}, raw };
  } catch { return null; }
}

export function extractToolCall(text) {
  const match = TOOL_RE.exec(text);
  if (match) {
    const call = tryParseTool(match[0], match[1]);
    if (call) return call;
  }
  const bare = BARE_TOOL_JSON_RE.exec(text);
  if (bare) return tryParseTool(bare[0], bare[1]);
  return null;
}

/** Strip any leftover tool-call artifacts so they never leak into user-facing replies. */
export function stripToolArtifacts(text) {
  let out = String(text || "")
    .replace(TOOL_RE, "")
    // Never leak malformed or truncated tool syntax. This intentionally eats
    // the rest of the response when a model opens a tool fence and fails to
    // close it, because none of that partial generation is user-facing text.
    .replace(/```(?:tool|function|json)\b[\s\S]*$/gi, "")
    .replace(/```\s*\{\s*"(?:tool|name)"[\s\S]*$/gi, "")
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, "")
    .replace(/^\s*\{\s*"(?:tool|name)"\s*:[\s\S]*$/gim, "")
    .replace(BARE_TOOL_JSON_RE, "");
  // Drop any dangling / empty triple-backtick fences left over from stripping.
  out = out.replace(/```[a-z]*\s*```/gi, "").replace(/```+\s*$/g, "").replace(/^\s*```+\s*/g, "");
  return out.trim();
}

export async function executeTool(call, { requesterIsOwner = false } = {}) {
  const PUBLIC_TOOLS = new Set(["lookup"]);
  if (!requesterIsOwner && !PUBLIC_TOOLS.has(call.tool)) {
    return { ok: false, denied: true, error: "Those are my master's commands. Fuck off trying to use them." };
  }
  if (!config.computer.enabled) return { error: "Computer control disabled in .env." };
  try {
    const out = await run(call.tool, call.args);
    return { ok: true, result: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
