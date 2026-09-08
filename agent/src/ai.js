import { config } from "./config.js";
import { getSettings } from "./db.js";

/** Cache of every free model OpenRouter currently exposes. */
let freeModels = [];
let codingModels = [];
let lastModelFetch = 0;

const CODE_HINTS = ["coder", "code", "devstral", "codestral", "starcoder", "qwen2.5-c", "deepseek"];

// Models that are generally strongest first; anything else keeps API order.
const PRIORITY = ["deepseek", "qwen", "llama-3.3", "llama-4", "mistral", "gemma", "glm", "kimi", "phi"];

function rank(id) {
  const i = PRIORITY.findIndex((p) => id.includes(p));
  return i === -1 ? PRIORITY.length : i;
}

export async function refreshModels(force = false) {
  if (!config.openrouter.key) return { free: [], coding: [] };
  if (!force && Date.now() - lastModelFetch < 30 * 60 * 1000 && freeModels.length) {
    return { free: freeModels, coding: codingModels };
  }
  try {
    const res = await fetch(`${config.openrouter.base}/models`, {
      headers: { Authorization: `Bearer ${config.openrouter.key}` },
    });
    if (!res.ok) throw new Error(`models ${res.status}`);
    const body = await res.json();
    const ids = (body.data || [])
      .filter((m) => {
        const p = m.pricing || {};
        const free = Number(p.prompt || 0) === 0 && Number(p.completion || 0) === 0;
        return free || String(m.id).endsWith(":free");
      })
      .map((m) => m.id);

    freeModels = [...new Set(ids)].sort((a, b) => rank(a) - rank(b));
    codingModels = freeModels.filter((id) => CODE_HINTS.some((h) => id.toLowerCase().includes(h)));
    lastModelFetch = Date.now();
  } catch (err) {
    console.warn("[ai] could not refresh OpenRouter models:", err.message);
  }
  return { free: freeModels, coding: codingModels };
}

export function knownModels() {
  return { free: freeModels, coding: codingModels };
}

export async function ollamaModels() {
  try {
    const res = await fetch(`${config.ollama.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    if (!res.ok) return [];
    const body = await res.json();
    return (body.models || []).map((m) => m.name);
  } catch {
    return [];
  }
}

async function callOpenRouter(model, messages) {
  const res = await fetch(`${config.openrouter.base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openrouter.key}`,
      "content-type": "application/json",
      "HTTP-Referer": config.openrouter.siteUrl,
      "X-Title": config.openrouter.appName,
    },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`OpenRouter ${res.status}: ${detail.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response");
  return text;
}

async function callOllama(messages, mode) {
  const model = mode === "coding" ? config.ollama.codeModel : config.ollama.model;
  const res = await fetch(`${config.ollama.url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const body = await res.json();
  const text = body?.message?.content?.trim();
  if (!text) throw new Error("Ollama returned nothing");
  return { reply: text, provider: "ollama", model };
}

/**
 * Ask the agent. Tries every free OpenRouter model in order (best first),
 * skipping ones that are rate limited or erroring, then falls back to Ollama.
 */
export async function ask({ messages, mode = "general" }) {
  const settings = getSettings();
  const system = { role: "system", content: settings.persona };
  const full = messages[0]?.role === "system" ? messages : [system, ...messages];

  if (settings.provider?.preferOllama) {
    try {
      return await callOllama(full, mode);
    } catch (err) {
      console.warn("[ai] Ollama first-choice failed:", err.message);
    }
  }

  if (config.openrouter.key) {
    await refreshModels();
    const pool = mode === "coding" && codingModels.length ? [...codingModels, ...freeModels] : freeModels;
    const tried = new Set();
    for (const model of pool) {
      if (tried.has(model)) continue;
      tried.add(model);
      try {
        const reply = await callOpenRouter(model, full);
        return { reply, provider: "openrouter", model };
      } catch (err) {
        // 400/404 = model rejected the request, 429 = busy, 5xx = upstream hiccup.
        console.warn(`[ai] ${model} failed (${err.status || "?"}) - trying next`);
      }
    }
  }

  return await callOllama(full, mode);
}

export async function providerStatus() {
  const [ollama] = await Promise.all([ollamaModels()]);
  return {
    openrouter: !!config.openrouter.key,
    ollama: ollama.length > 0,
    freeModels: freeModels.length,
  };
}
