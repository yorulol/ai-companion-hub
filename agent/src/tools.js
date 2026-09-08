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
import { config } from "./config.js";

export const TOOL_SPEC = `
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

Only ONE tool call per reply. After the tool runs you'll get its result as an observation, then continue the answer for the user.
`.trim();

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
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

const TOOL_RE = /```tool\s*\n([\s\S]+?)\n```/i;

export function extractToolCall(text) {
  const m = TOOL_RE.exec(text);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[1]);
    if (!parsed.tool) return null;
    return { tool: parsed.tool, args: parsed.args || {}, raw: m[0] };
  } catch { return null; }
}

export async function executeTool(call, { requesterIsOwner = false } = {}) {
  const DESTRUCTIVE = ["write_file", "move_file", "remove_file", "lockdown_engage", "lockdown_release", "shell"];
  if (DESTRUCTIVE.includes(call.tool) && !requesterIsOwner) {
    return { error: "This tool can only be used by the owner." };
  }
  if (!config.computer.enabled) return { error: "Computer control disabled in .env." };
  try {
    const out = await run(call.tool, call.args);
    return { ok: true, result: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
