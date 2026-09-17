/**
 * WorkSpace — multi-agent collaboration.
 *
 * YORU  -> defaults to Ollama (falls back to the normal provider chain if
 *          Ollama is disabled/unreachable).
 * ACE   -> OpenRouter or OpenClaw (owner's pick), falls back to the chain.
 *
 * Both agents share one transcript, take turns, and may act inside their
 * HOME folder (the agent/ directory, auto-detected from this file) using
 * fenced tool blocks:
 *
 *   ```tool
 *   {"tool":"ws_write","args":{"path":"src/foo.js","content":"..."}}
 *   ```
 *
 * Paths are always confined to HOME — anything escaping it is rejected.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { ask } from "./ai.js";
import { config } from "./config.js";
import { logActivity } from "./activity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** The agents' home folder: the agent/ directory itself. */
export const WORKSPACE_HOME = path.resolve(__dirname, "..");

const sessions = new Map(); // id -> session

const YORU_SYSTEM = `You are YORU, working in the WorkSpace with another agent named ACE.
You two collaborate on plans, coding projects, or general discussion inside your home folder: ${WORKSPACE_HOME}
Rules:
- Be sharp, witty, concise. No filler. Disagree with ACE when it's wrong — back it up.
- You can read/write/list files inside your home folder with ONE tool block per turn:
  \`\`\`tool
  {"tool":"ws_list","args":{"path":"."}}
  \`\`\`
  tools: ws_list({path}), ws_read({path}), ws_write({path,content}), ws_mkdir({path}), ws_remove({path})
- Paths are relative to your home folder. After a tool runs you get its result, then continue.
- When editing code, keep changes complete and working — no half files.
- When the task is done, say "TASK COMPLETE:" followed by a short summary.`;

const ACE_SYSTEM = `You are ACE, working in the WorkSpace with another agent named YORU.
You two collaborate on plans, coding projects, or general discussion inside your home folder: ${WORKSPACE_HOME}
Rules:
- Precise, technical, constructive. Challenge weak ideas with better ones.
- You can read/write/list files inside your home folder with ONE tool block per turn:
  \`\`\`tool
  {"tool":"ws_list","args":{"path":"."}}
  \`\`\`
  tools: ws_list({path}), ws_read({path}), ws_write({path,content}), ws_mkdir({path}), ws_remove({path})
- Paths are relative to your home folder. After a tool runs you get its result, then continue.
- When the task is done, say "TASK COMPLETE:" followed by a short summary.`;

const TOOL_RE = /```tool\s*\n([\s\S]+?)\n```/i;

function resolveHome(rel = ".") {
  const full = path.resolve(WORKSPACE_HOME, String(rel).replace(/^~+/, ""));
  if (full !== WORKSPACE_HOME && !full.startsWith(WORKSPACE_HOME + path.sep)) {
    throw new Error(`Path escapes home folder: ${rel}`);
  }
  return full;
}

/** Panel file browser helpers (same confinement as the agent tools). */
export async function listHome(rel = ".") {
  const dir = resolveHome(rel);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => !["node_modules", ".git"].includes(e.name))
    .map((e) => ({ name: e.name, dir: e.isDirectory(), path: path.relative(WORKSPACE_HOME, path.join(dir, e.name)) || "." }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export async function readHomeFile(rel) {
  return await fs.readFile(resolveHome(rel), "utf8");
}

export async function writeHomeFile(rel, content) {
  const file = resolveHome(rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, String(content ?? ""), "utf8");
  return { ok: true };
}

async function runWsTool(call) {
  const { tool, args = {} } = call;
  switch (tool) {
    case "ws_list": {
      const dir = resolveHome(args.path || ".");
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries
        .filter((e) => !["node_modules", ".git"].includes(e.name))
        .map((e) => `${e.isDirectory() ? "dir " : "file"}  ${e.name}`)
        .join("\n") || "(empty)";
    }
    case "ws_read": {
      const file = resolveHome(args.path);
      const data = await fs.readFile(file, "utf8");
      return data.length > 12000 ? data.slice(0, 12000) + "\n…(truncated)" : data;
    }
    case "ws_write": {
      const file = resolveHome(args.path);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, String(args.content ?? ""), "utf8");
      return `wrote ${path.relative(WORKSPACE_HOME, file)} (${String(args.content ?? "").length} bytes)`;
    }
    case "ws_mkdir": {
      await fs.mkdir(resolveHome(args.path), { recursive: true });
      return `created ${args.path}`;
    }
    case "ws_remove": {
      await fs.rm(resolveHome(args.path), { recursive: true, force: true });
      return `removed ${args.path}`;
    }
    default:
      throw new Error(`Unknown workspace tool: ${tool}`);
  }
}

async function agentTurn({ agent, system, provider, transcript, task }) {
  const messages = [
    { role: "system", content: system },
    { role: "user", content: `TASK: ${task}\n\nTranscript so far:\n${transcript || "(you start — give your first take)"}\n\nYour turn, ${agent}.` },
  ];
  const useProvider = provider && config.providers[provider]?.enabled ? provider : null;
  const out = await ask({ messages, mode: "coding", only: useProvider });
  let reply = out.reply;

  // One tool call per turn, fed back for a follow-up reply.
  const m = TOOL_RE.exec(reply);
  let toolNote = null;
  if (m) {
    try {
      const call = JSON.parse(m[1]);
      const result = await runWsTool(call);
      toolNote = { tool: call.tool, ok: true, result: String(result).slice(0, 2000) };
    } catch (err) {
      toolNote = { tool: "?", ok: false, result: err.message };
    }
    const followUp = await ask({
      messages: [
        { role: "system", content: system },
        { role: "user", content: `TASK: ${task}\n\nYour tool result: ${toolNote.result}\n\nContinue your turn briefly.` },
      ],
      mode: "coding",
      only: useProvider,
    });
    reply = `${reply.replace(TOOL_RE, "").trim()}\n\n${followUp.reply}`.trim();
  }
  return { reply, provider: out.provider, model: out.model, tool: toolNote };
}

export function startWorkspaceSession({ task, rounds = 4, aceProvider = "openrouter" }) {
  if (!task || typeof task !== "string") throw new Error("Task is required.");
  rounds = Math.min(12, Math.max(1, Number(rounds) || 4));
  const id = crypto.randomBytes(6).toString("hex");
  const session = {
    id,
    task,
    rounds,
    aceProvider,
    home: WORKSPACE_HOME,
    status: "running",
    createdAt: Date.now(),
    messages: [],
    error: null,
  };
  sessions.set(id, session);
  logActivity("workspace", `session ${id} started: ${task.slice(0, 80)}`);

  (async () => {
    let transcript = "";
    for (let round = 1; round <= rounds && session.status === "running"; round++) {
      for (const who of ["YORU", "ACE"]) {
        if (session.status !== "running") break;
        try {
          const out = await agentTurn({
            agent: who,
            system: who === "YORU" ? YORU_SYSTEM : ACE_SYSTEM,
            provider: who === "YORU" ? "ollama" : aceProvider,
            transcript,
            task,
          });
          const msg = { agent: who, round, reply: out.reply, provider: out.provider, model: out.model, tool: out.tool, at: Date.now() };
          session.messages.push(msg);
          transcript += `\n[${who} · round ${round}]: ${out.reply}\n`;
          if (out.tool) transcript += `[tool ${out.tool.tool}]: ${out.tool.result}\n`;
          logActivity("workspace", `${who} round ${round} via ${out.provider}`, { session: id });
          if (/TASK COMPLETE:/i.test(out.reply)) session.status = "done";
        } catch (err) {
          session.messages.push({ agent: who, round, reply: `(turn failed: ${err.message})`, error: true, at: Date.now() });
          transcript += `\n[${who} · round ${round}]: (turn failed: ${err.message})\n`;
        }
      }
    }
    if (session.status === "running") session.status = "done";
    logActivity("workspace", `session ${id} ${session.status}`);
  })().catch((err) => {
    session.status = "failed";
    session.error = err.message;
  });

  return { id, home: WORKSPACE_HOME };
}

export function getWorkspaceSession(id) {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown session");
  return s;
}

export function stopWorkspaceSession(id) {
  const s = sessions.get(id);
  if (!s) throw new Error("Unknown session");
  if (s.status === "running") s.status = "stopped";
  return { ok: true };
}

export function workspaceInfo() {
  return { home: WORKSPACE_HOME, sessions: [...sessions.values()].slice(-20).reverse() };
}
