import { config } from "./config.js";
import { getSettings } from "./db.js";
import { detectHardware, pickHermesModel, hermesTuning } from "./hermes.js";
import os from "node:os";

/**
 * Yoru's AI router. Two providers only, both local:
 *   • hermes  — Nous Research Hermes-3, hardware-tier auto-selected
 *   • ollama  — plain Ollama chat (fallback / non-Hermes models)
 *
 * Both run through the same Ollama daemon, so the routing simply swaps the
 * chat model and per-tier tuning based on the preferred provider.
 */

export async function ollamaModels() {
  const p = config.providers.ollama;
  if (!p.enabled) return [];
  try {
    const res = await fetch(`${p.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const body = await res.json();
    return (body.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

// Kept for panel/back-compat: no remote catalogue in the local-only build.
export const knownModels = () => ({ free: [], reserve: [], coding: [], total: 0 });
export async function refreshModels() { return { free: [], coding: [] }; }

const ollamaPulling = new Map();

const SYSTEM_DATA_RE = /(?:\b(?:cpu|gpu|vram|ram|hostname|platform|architecture|processor|operating system)\s*[:=]|\b(?:total|free)\s+memory\s*[:=]|\b(?:nvidia|amd|intel)\s+(?:geforce|radeon|core)\b)/i;
const SYSTEM_DATA_REQUEST_RE = /\b(?:system|computer|machine|hardware|device|pc)\s+(?:info|information|specs?|details?)\b|\b(?:what|which)\s+(?:cpu|gpu|processor)\b/i;
const COMPUTER_TASK_RE = /\b(?:computer|pc|machine|laptop|desktop|env(?:ironment)?\s*(?:file|vars?|variables)?|\.env|files?|folders?|director(?:y|ies)|shell|terminal|commands?|access|control|operate|task|process(?:es)?|program|app(?:lication)?s?|install|uninstall|download|screenshot|browse|window)\b/i;
const MODEL_DRIFT_RE = /(?:```\s*(?:tool|function)|<tool_call>|\{\s*"(?:tool|name)"\s*:|\b(?:as an ai(?: language)? model|system_info\s*(?:\(|\b)|lockdown_(?:engage|release)\s*\(|tool result for|available tools:|critical behavior rules)\b)/i;
const COMPLEX_REQUEST_RE = /\b(?:analy[sz]e|debug|architecture|refactor|implement|compare|explain in detail|step[- ]by[- ]step|security|algorithm|write (?:a |the )?(?:code|function|class|program))\b/i;

const FAKE_TOOL_BLOCK_RE = /```(?:tool|json|function)\b[\s\S]*?(?:```|$)/gi;
const FAKE_TOOL_LINE_RE = /^\s*(?:\{[\s\S]*"(?:tool|name|args|arguments)"[\s\S]*|(?:checking|running|executing|calling|invoking|using|looking at)\s+(?:the\s+)?[a-z_]{3,}(?:\s+output)?(?:\s*\(|\s+tool|\s*$))\s*$/i;

function stripDriftLines(text) {
  return String(text || "")
    .split(/\n+/)
    .filter((line) => !MODEL_DRIFT_RE.test(line) && !/system prompt/i.test(line))
    .join(" ")
    .trim();
}

function stripFakeToolNoise(text) {
  return String(text || "")
    .replace(FAKE_TOOL_BLOCK_RE, " ")
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|$)/gi, " ")
    .replace(/^\s*\{\s*"(?:tool|name)"\s*:[\s\S]*$/gim, " ")
    .split("\n")
    .filter((l) => !FAKE_TOOL_LINE_RE.test(l.trim()))
    .join("\n")
    .replace(/\b(?:system_info|lockdown_engage|lockdown_release|tool_call|function_call)\b\s*\([^)]*\)/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cleanOllamaHistory(messages) {
  const latestUser = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  return messages.filter((message) => {
    if (message.role !== "assistant") return true;
    const content = String(message.content || "");
    if (FAKE_TOOL_BLOCK_RE.test(content)) return false;
    if (MODEL_DRIFT_RE.test(content)) return false;
    return !SYSTEM_DATA_RE.test(content) || SYSTEM_DATA_REQUEST_RE.test(latestUser) || COMPUTER_TASK_RE.test(latestUser);
  });
}

async function pullOllamaModel(model) {
  if (ollamaPulling.has(model)) return ollamaPulling.get(model);
  const p = config.providers.ollama;
  const job = (async () => {
    const res = await fetch(`${p.url}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: model, stream: false }),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!res.ok) throw new Error(`Ollama pull failed (${res.status})`);
  })().finally(() => ollamaPulling.delete(model));
  ollamaPulling.set(model, job);
  return job;
}

const OLLAMA_RATES = new Map();
function recordOllamaRate(model, rate) {
  if (!(rate > 0)) return;
  const prev = OLLAMA_RATES.get(model);
  OLLAMA_RATES.set(model, prev ? prev * 0.7 + rate * 0.3 : rate);
}

function budgetPredict(model, ceiling, latencyBudgetMs) {
  const p = config.providers.ollama;
  const budgetMs = latencyBudgetMs || p.latencyBudgetMs;
  const budgetSec = Math.max(1, budgetMs / 1000);
  const rate = OLLAMA_RATES.get(model) || OLLAMA_RATES.get(p.model) || 22;
  // Cap at the smaller of the workload ceiling and what the model can
  // actually produce inside the latency budget. The floor is minPredict so
  // short conversational prompts aren't padded to hundreds of tokens.
  const fit = Math.floor(rate * budgetSec);
  return Math.max(p.minPredict, Math.min(ceiling, fit));
}

let ACTIVE_LOCAL = null;
export async function refreshLocalModel() {
  try {
    const { activeLocalModel } = await import("./localmodel-runner.js");
    ACTIVE_LOCAL = await activeLocalModel();
  } catch { ACTIVE_LOCAL = null; }
  return ACTIVE_LOCAL;
}

/** Cached Hermes model choice, refreshed when the toggle or override changes. */
let HERMES_CHOICE = null;
function resolveHermesChoice() {
  const h = config.providers.hermes;
  if (!h?.enabled) { HERMES_CHOICE = null; return null; }
  if (!HERMES_CHOICE || HERMES_CHOICE.override !== h.model) {
    const picked = pickHermesModel(h.model);
    HERMES_CHOICE = { ...picked, override: h.model, tuning: hermesTuning(picked.tier) };
    const hw = detectHardware();
    console.log(`[hermes] hardware: ${hw.cpuCount}x ${hw.cpuModel} · ${hw.ramGb} GB RAM · ${hw.hasGpu ? `${hw.vramGb} GB VRAM` : "no GPU"} → ${picked.label}`);
  }
  return HERMES_CHOICE;
}

function ollamaWorkload(messages, mode) {
  const p = config.providers.ollama;
  const latest = [...messages].reverse().find((message) => message.role === "user")?.content || "";
  const chars = messages.reduce((sum, message) => sum + String(message.content || "").length, 0);
  const complex = mode === "coding" || (COMPLEX_REQUEST_RE.test(latest) && latest.length > 240) || latest.length > 1200;
  const large = chars > Math.max(9000, p.numCtx * 4) || latest.length > 2600;

  // Hermes wins over UF/heretic when enabled — hardware-tuned local Nous model.
  const hermes = resolveHermesChoice();
  const localActive = config.localmodel.enabled && ACTIVE_LOCAL ? ACTIVE_LOCAL : null;
  const fastModel = hermes?.model || localActive?.name || (p.uf?.enabled ? p.uf.model : p.model);
  const latencyBudget = hermes?.tuning?.latencyBudgetMs || p.latencyBudgetMs;
  const numCtxBase = hermes?.tuning?.numCtx || p.numCtx;
  const numPredictBase = hermes?.tuning?.numPredict || p.numPredict;

  if (large) {
    const model = mode === "coding" ? p.codeModel : (hermes?.model || p.reasoningModel);
    return {
      name: hermes ? "hermes-deep" : "balanced",
      model,
      temp: mode === "coding" ? 0.2 : 0.45,
      numGpu: p.balancedGpuLayers,
      numThread: p.numThread || Math.max(2, Math.min(12, os.cpus().length - 2)),
      numCtx: Math.max(numCtxBase, 3072),
      numPredict: budgetPredict(model, Math.max(numPredictBase, 320), latencyBudget),
      latencyBudgetMs: latencyBudget,
    };
  }
  if (complex) {
    const model = mode === "coding" ? p.codeModel : (hermes?.model || p.reasoningModel);
    return {
      name: hermes ? "hermes-reasoning" : "gpu-reasoning",
      model,
      temp: mode === "coding" ? 0.2 : 0.45,
      numGpu: p.numGpu,
      numThread: p.numThread,
      numCtx: Math.max(numCtxBase, 2560),
      numPredict: budgetPredict(model, Math.max(numPredictBase, 300), latencyBudget),
      latencyBudgetMs: latencyBudget,
    };
  }
  if (mode === "share") {
    const tightPredict = Math.min(numPredictBase, 96);
    return {
      name: hermes ? "hermes-share" : "gpu-share",
      model: fastModel,
      temp: 0.55,
      numGpu: p.numGpu,
      numThread: p.numThread,
      numCtx: Math.min(numCtxBase, 1024),
      numPredict: budgetPredict(fastModel, tightPredict, latencyBudget),
      latencyBudgetMs: latencyBudget,
    };
  }
  // Short casual prompts ("hi", "how are you") get a snappier cap so the
  // model wraps up in ~2s instead of rambling to the full budget.
  const shortPrompt = latest.length <= 80;
  const casualCtx = shortPrompt ? Math.min(numCtxBase, 768) : numCtxBase;
  const casualCap = shortPrompt ? Math.min(numPredictBase, 128) : numPredictBase;
  const casualBudget = shortPrompt ? Math.min(latencyBudget, 3500) : latencyBudget;
  return {
    name: hermes ? "hermes-fast" : "gpu-fast",
    model: fastModel,
    temp: 0.55,
    numGpu: p.numGpu,
    numThread: p.numThread,
    numCtx: casualCtx,
    numPredict: budgetPredict(fastModel, casualCap, casualBudget),
    latencyBudgetMs: casualBudget,
  };
}

async function ollamaChatRequest(url, model, messages, numKeep, workload, overrides = {}) {
  const p = config.providers.ollama;
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      keep_alive: "24h",
      options: {
        num_ctx: workload.numCtx,
        num_predict: workload.numPredict,
        num_batch: p.numBatch,
        num_gpu: workload.numGpu,
        ...(numKeep ? { num_keep: numKeep } : {}),
        ...(workload.numThread ? { num_thread: workload.numThread } : {}),
        f16_kv: true,
        use_mmap: true,
        low_vram: false,
        mirostat: 0,
        repeat_last_n: 128,
        repeat_penalty: 1.1,
        temperature: workload.temp ?? 0.7,
        top_p: 0.9,
        top_k: 40,
        stop: ["\nUser:", "\nSystem:"],
        ...overrides,
      },
    }),
  });
  return res;
}

function ollamaText(body) {
  const m = body?.message || {};
  const raw = m.content ?? body?.response ?? "";
  let text = String(raw).trim();
  if (text.includes("<think>")) text = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/<\/?think>/g, "").trim();
  if (!text && typeof m.thinking === "string") text = m.thinking.trim();
  return text;
}

async function ollamaChatText(url, model, messages, numKeep, workload) {
  const retryPredict = budgetPredict(model, Math.max(workload.numPredict, 256), workload.latencyBudgetMs);
  const attempts = [
    {},
    { stop: [], temperature: 0.6, num_predict: retryPredict },
    { stop: [], temperature: 0.8, top_p: 0.95, repeat_penalty: 1.05, num_predict: retryPredict },
  ];
  let lastErr = "";
  for (let i = 0; i < attempts.length; i++) {
    const payload = i === attempts.length - 1
      ? [messages[0], ...[...messages].reverse().filter((m) => m.role === "user").slice(0, 1)]
      : messages;
    let res = await ollamaChatRequest(url, model, payload, numKeep, workload, attempts[i]);
    if (res.status === 404) {
      console.log(`[yoru] ollama model '${model}' missing — pulling now (one-time, can take a while)…`);
      await pullOllamaModel(model);
      res = await ollamaChatRequest(url, model, payload, numKeep, workload, attempts[i]);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Ollama ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
    }
    const body = await res.json().catch(() => null);
    const text = ollamaText(body);
    if (text) return { text, body };
    lastErr = body?.done_reason ? `done_reason=${body.done_reason}` : "empty content";
    console.log(`[ollama] empty reply (${lastErr}) — retry ${i + 1}/${attempts.length - 1}`);
  }
  throw new Error(`Ollama returned nothing (${lastErr})`);
}

async function callOllama(messages, mode, providerLabel = "ollama") {
  const p = config.providers.ollama;
  const workload = ollamaWorkload(messages, mode);
  const model = workload.model;
  const rawSystem = messages[0]?.role === "system" ? messages[0].content : "";
  const hardenedSystem = `${rawSystem}

RULES: Be helpful, direct, and accurate. Keep private configuration private. Use available tools when the user's request calls for an action; report what actually happened.`;
  const compactSystem = [{ role: "system", content: hardenedSystem }];
  const rest = messages[0]?.role === "system" ? messages.slice(1) : messages;
  const maxHistoryChars = Math.max(500, Math.floor((workload.numCtx - workload.numPredict - 256) * 3.5) - hardenedSystem.length);
  const recent = cleanOllamaHistory(rest).slice(-p.historyMessages);
  const conversation = [];
  let historyChars = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const size = String(recent[i]?.content || "").length;
    if (conversation.length && historyChars + size > maxHistoryChars) break;
    conversation.unshift(recent[i]);
    historyChars += size;
  }
  const localMessages = [...compactSystem, ...conversation];
  const numKeep = Math.min(workload.numCtx - 128, Math.ceil(hardenedSystem.length / 3.5) + 64);
  const { text: firstText, body } = await ollamaChatText(p.url, model, localMessages, numKeep, workload);
  let text = firstText;
  const latestUser = [...conversation].reverse().find((message) => message.role === "user")?.content || "";
  const computerTask = COMPUTER_TASK_RE.test(latestUser) || SYSTEM_DATA_REQUEST_RE.test(latestUser);
  const drifted = (SYSTEM_DATA_RE.test(text) && !computerTask) || MODEL_DRIFT_RE.test(text);
  if (drifted) {
    const retryMessages = [compactSystem[0], { role: "user", content: latestUser }];
    const { text: retryText } = await ollamaChatText(p.url, model, retryMessages, numKeep, workload);
    text = retryText;
    if (!text || (SYSTEM_DATA_RE.test(text) && !computerTask) || MODEL_DRIFT_RE.test(text)) {
      const cleaned = stripDriftLines(firstText) || stripDriftLines(retryText);
      if (cleaned) text = cleaned;
      else if (computerTask) text = "Yeah, I've got access to your machine. Tell me exactly what you want done and I'll handle it.";
      else text = "Ask me that again — straight to the point this time.";
    }
  }
  if (!text) text = computerTask
    ? "Yeah, I've got access to your machine. Tell me exactly what you want done and I'll handle it."
    : "Ask me that again — straight to the point this time.";
  text = stripFakeToolNoise(text) || "…lost my train of thought. Say that again?";

  const seconds = Number(body.eval_duration || 0) / 1e9;
  const tokens = Number(body.eval_count || 0);
  const rate = seconds > 0 && tokens > 0 ? tokens / seconds : 0;
  const total = Number(body.total_duration || 0) / 1e9;
  recordOllamaRate(model, rate);
  if (rate > 0) {
    const budget = workload.latencyBudgetMs / 1000;
    const over = total > budget ? ` ⚠ over ${budget}s budget` : "";
    console.log(`[${providerLabel}] ${workload.name} · ${model} · ${rate.toFixed(1)} tok/s · ${tokens} tokens · ${total.toFixed(1)}s total${over}`);
  }
  return { reply: text, provider: providerLabel, model };
}

/**
 * Route a chat turn. Only local providers exist now:
 *   hermes → callOllama with the auto-picked Hermes tier
 *   ollama → callOllama with the plain configured model
 */
export async function ask({ messages, mode = "general", only = null }) {
  const settings = getSettings();
  const system = { role: "system", content: settings.persona };
  const full = messages[0]?.role === "system" ? messages : [system, ...messages];
  const P = config.providers;

  const order = [];
  const push = (n) => { if (!order.includes(n)) order.push(n); };
  if (only) push(only);
  else {
    push(P.preferred);
    ["hermes", "ollama"].forEach(push);
  }

  const errors = [];
  for (const name of order) {
    const cfg = P[name];
    if (!cfg?.enabled) continue;
    try {
      if (name === "hermes") {
        // Hermes rides on the Ollama runtime; workload picks the Hermes model.
        resolveHermesChoice();
        return await callOllama(full, mode, "hermes");
      }
      if (name === "ollama") {
        // Temporarily disable the Hermes choice so plain Ollama uses its own model.
        const savedHermes = HERMES_CHOICE;
        HERMES_CHOICE = null;
        try { return await callOllama(full, mode, "ollama"); }
        finally { HERMES_CHOICE = savedHermes; }
      }
    } catch (err) {
      errors.push(`${name}: ${err.message}`);
      console.warn(`[ai] ${name} failed:`, err.message);
    }
  }

  throw new Error(`All AI providers failed. ${errors.join(" | ") || "No provider enabled."}`);
}

export async function providerStatus() {
  const ollama = await ollamaModels();
  const P = config.providers;
  const hermes = resolveHermesChoice();
  const hw = detectHardware();
  return {
    preferred: P.preferred,
    hermes: P.hermes.enabled,
    hermesModel: hermes?.model || null,
    hermesTier: hermes?.tier || null,
    hermesLabel: hermes?.label || null,
    ollama: P.ollama.enabled && ollama.length > 0,
    hardware: hw,
    freeModels: 0,
  };
}

// Force re-evaluation of the Hermes tier (called after HERMES_MODEL toggles).
export function refreshHermesChoice() {
  HERMES_CHOICE = null;
  return resolveHermesChoice();
}
