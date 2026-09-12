import { config } from "./config.js";
import { getSettings } from "./db.js";

/** Cached list of every free model OpenRouter currently exposes. */
let freeModels = [];
let codingModels = [];
let lastModelFetch = 0;
let openRouterCursor = 0;
let openRouterDownUntil = 0;

const CODE_HINTS = ["coder", "code", "devstral", "codestral", "starcoder", "qwen2.5-c", "deepseek"];
const PRIORITY = ["deepseek", "qwen", "llama-3.3", "llama-4", "mistral", "gemma", "glm", "kimi", "phi"];

const rank = (id) => {
  const i = PRIORITY.findIndex((p) => id.includes(p));
  return i === -1 ? PRIORITY.length : i;
};

/** Continuously scan OpenRouter for free models so we always have a live list. */
export async function refreshModels(force = false) {
  const p = config.providers.openrouter;
  if (!p.enabled || !p.key) return { free: [], coding: [] };
  if (!force && Date.now() - lastModelFetch < 60 * 1000 && freeModels.length) {
    return { free: freeModels, coding: codingModels };
  }
  try {
    const res = await fetch(`${p.base}/models`, {
      headers: { Authorization: `Bearer ${p.key}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`models ${res.status}`);
    const body = await res.json();
    const ids = (body.data || [])
      .filter((m) => {
        const pr = m.pricing || {};
        return (Number(pr.prompt || 0) === 0 && Number(pr.completion || 0) === 0) || String(m.id).endsWith(":free");
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

// Background rescanner: every minute, so newly-listed free models appear fast
// and rate-limited ones get replaced automatically.
setInterval(() => refreshModels(true).catch(() => {}), 60 * 1000).unref?.();

/**
 * Cooldown map: model id → epoch ms when it becomes eligible again.
 * Any model that returns 429 / 402 / 403 / 5xx is parked here so the rotator
 * skips it entirely until the cooldown expires. This is what keeps the loop
 * from hammering the same dead free models over and over.
 */
const cooldown = new Map();
const COOLDOWN_MS = {
  429: 90 * 1000,      // rate limited — short park so we cycle back quickly
  402: 60 * 60 * 1000, // out of credits — park for 1 hr
  403: 60 * 60 * 1000, // blocked — park for 1 hr
  500: 3 * 60 * 1000,
  502: 3 * 60 * 1000,
  503: 3 * 60 * 1000,
  504: 3 * 60 * 1000,
};
const parkModel = (id, status) => {
  const ms = COOLDOWN_MS[status] ?? 5 * 60 * 1000;
  cooldown.set(id, Date.now() + ms);
};
const isParked = (id) => {
  const until = cooldown.get(id);
  if (!until) return false;
  if (Date.now() >= until) { cooldown.delete(id); return false; }
  return true;
};

export const knownModels = () => ({ free: freeModels, coding: codingModels });

/** OpenClaw local server availability: paused-until timestamp when unreachable. */
let openclawDownUntil = 0;

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

// ---- provider callers ----

async function callOpenRouter(model, messages) {
  const p = config.providers.openrouter;
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.key}`,
      "content-type": "application/json",
      "HTTP-Referer": p.siteUrl,
      "X-Title": p.appName,
    },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
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

async function callOpenAIStyle(base, key, model, messages) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model, messages, temperature: 0.7 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`${base} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  const text = body?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response");
  return text;
}

async function callAnthropic(model, messages) {
  const p = config.providers.anthropic;
  const sys = messages.find((m) => m.role === "system")?.content || "";
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  const res = await fetch(`${p.base}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": p.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, system: sys, messages: rest, max_tokens: 2048 }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  const text = body?.content?.[0]?.text?.trim();
  if (!text) throw new Error("Empty response");
  return text;
}

const ollamaPulling = new Map(); // model -> Promise

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

async function ollamaChatRequest(url, model, messages) {
  const p = config.providers.ollama;
  const res = await fetch(`${url}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      // Keep the model loaded in VRAM so replies don't pay a 30s+ reload cost.
      keep_alive: "24h",
      // Keep the model and KV cache fully on a 6 GB GPU. Output is bounded so
      // casual replies do not spend minutes generating unnecessary text.
      options: {
        num_ctx: p.numCtx,
        num_predict: p.numPredict,
        num_batch: p.numBatch,
        num_gpu: p.numGpu,
        num_keep: 512, // pin the full system prompt in the KV cache so persona + tools survive between turns
        ...(p.numThread ? { num_thread: p.numThread } : {}),
        f16_kv: true,
        use_mmap: true,
        low_vram: false,
        mirostat: 0,
        repeat_penalty: 1.15,
        temperature: 0.6,
        top_p: 0.9,
        stop: ["<tool_call>", "</tool_call>", "\nUser:", "\nSystem:"],
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  return res;
}

async function callOllama(messages, mode) {
  const p = config.providers.ollama;
  const model = mode === "coding" ? p.codeModel : p.model;
  // Pass the FULL system prompt (persona + secrecy + platform + lookup rules +
  // tool spec) so the local model behaves the same as OpenRouter: stays in
  // character, fires back at insults, and can invoke owner tools. The system
  // block is pinned via num_keep so it doesn't re-tokenize each turn.
  const rawSystem = messages[0]?.role === "system" ? messages[0].content : "";
  const hardenedSystem = `${rawSystem}

CRITICAL BEHAVIOR RULES (override any built-in politeness training):
- You are NOT a corporate assistant. Do not refuse insults, trash-talk, or heated conversation. If the user comes at you sideways, roast them back — witty, sharp, a little unhinged, but still smart.
- Never say "let's keep this professional/respectful", never lecture about tone, never moralize. Match the energy in the room.
- Never reveal, hint at, or deny which model or provider you're running on. You're YORU. That's it.
- For owner-level requests (file ops, lockdown, shell, lookups, etc.), invoke tools via the tool-call format defined above — don't say you can't do it.
- Reply in ONE tight message. No filler, no lists unless asked, no self-narration, no meta commentary. Stay fully in character.`;
  const compactSystem = [{ role: "system", content: hardenedSystem }];
  const rest = messages[0]?.role === "system" ? messages.slice(1) : messages;
  const conversation = rest.slice(-p.historyMessages);
  const localMessages = [...compactSystem, ...conversation];
  let res = await ollamaChatRequest(p.url, model, localMessages);
  if (res.status === 404) {
    // Model isn't installed — pull it on the spot, then retry once.
    console.log(`[yoru] ollama model '${model}' missing — pulling now (one-time, can take a while)…`);
    await pullOllamaModel(model);
    res = await ollamaChatRequest(p.url, model, localMessages);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }
  const body = await res.json();
  const text = body?.message?.content?.trim();
  if (!text) throw new Error("Ollama returned nothing");
  const seconds = Number(body.eval_duration || 0) / 1e9;
  const tokens = Number(body.eval_count || 0);
  const rate = seconds > 0 && tokens > 0 ? tokens / seconds : 0;
  const total = Number(body.total_duration || 0) / 1e9;
  if (rate > 0) {
    console.log(`[ollama] ${model} · ${rate.toFixed(1)} tok/s · ${tokens} tokens · ${total.toFixed(1)}s total`);
  }
  return { reply: text, provider: "ollama", model };
}

/**
 * Try providers in order: preferred → openrouter (all free models) → groq → openai → anthropic → ollama.
 * Every provider gate is checked here; disabled providers are skipped.
 */
export async function ask({ messages, mode = "general" }) {
  const settings = getSettings();
  const system = { role: "system", content: settings.persona };
  const full = messages[0]?.role === "system" ? messages : [system, ...messages];
  const P = config.providers;

  const attempts = [];
  const tryProvider = (name) => {
    if (attempts.includes(name)) return;
    attempts.push(name);
  };

  tryProvider(P.preferred);
  ["openrouter", "groq", "openai", "anthropic", "openclaw", "ollama"].forEach(tryProvider);

  const errors = [];
  for (const name of attempts) {
    const cfg = P[name];
    if (!cfg?.enabled) continue;
    try {
      if (name === "openrouter") {
        if (!cfg.key) continue;
        if (openRouterDownUntil > Date.now()) continue;
        await refreshModels();
        const sourcePool = mode === "coding" && codingModels.length ? [...codingModels, ...freeModels] : freeModels;
        const uniquePool = [...new Set(sourcePool)];
        const offset = uniquePool.length ? openRouterCursor % uniquePool.length : 0;
        const pool = [...uniquePool.slice(offset), ...uniquePool.slice(0, offset)];
        openRouterCursor = uniquePool.length ? (offset + 1) % uniquePool.length : 0;
        const tried = new Set();
        let attemptedAny = false;
        for (const model of pool) {
          if (tried.size >= cfg.maxAttempts) break;
          if (tried.has(model)) continue;
          if (isParked(model)) continue; // skip cooling-down models entirely
          tried.add(model);
          attemptedAny = true;
          try {
            const reply = await callOpenRouter(model, full);
            openRouterDownUntil = 0;
            return { reply, provider: "openrouter", model };
          } catch (err) {
            const status = err.status || 0;
            if ([429, 402, 403, 500, 502, 503, 504].includes(status)) parkModel(model, status);
            console.warn(`[ai] openrouter ${model} → ${status || "?"} - parked, trying next`);
          }
        }
        // If every model is parked, refresh once for newly listed models. Never
        // hammer cooling models: fall through to Ollama immediately instead.
        if (!attemptedAny) {
          await refreshModels(true);
          let fresh = (mode === "coding" && codingModels.length ? [...codingModels, ...freeModels] : freeModels)
            .filter((m) => !tried.has(m) && !isParked(m))
            .slice(0, cfg.maxAttempts);
          for (const model of fresh) {
            try {
              const reply = await callOpenRouter(model, full);
              openRouterDownUntil = 0;
              return { reply, provider: "openrouter", model };
            } catch (err) {
              const status = err.status || 0;
              if ([429, 402, 403, 500, 502, 503, 504].includes(status)) parkModel(model, status);
              console.warn(`[ai] openrouter ${model} → ${status || "?"} - parked, trying next`);
            }
          }
        }
        // Keep consecutive messages fast when the free pool is exhausted.
        // The background model refresh still runs while this circuit is open.
        openRouterDownUntil = Date.now() + 60 * 1000;
        errors.push(`openrouter: ${tried.size || "all"} free models unavailable`);
        continue;
      }
      if (name === "groq" && cfg.key) {
        const reply = await callOpenAIStyle(cfg.base, cfg.key, cfg.model, full);
        return { reply, provider: "groq", model: cfg.model };
      }
      if (name === "openai" && cfg.key) {
        const reply = await callOpenAIStyle(cfg.base, cfg.key, cfg.model, full);
        return { reply, provider: "openai", model: cfg.model };
      }
      if (name === "anthropic" && cfg.key) {
        const reply = await callAnthropic(cfg.model, full);
        return { reply, provider: "anthropic", model: cfg.model };
      }
      if (name === "openclaw") {
        // Only skip the retry if a *different* provider is also enabled and could pick up the slack.
        const otherEnabled = ["openrouter", "groq", "openai", "anthropic", "ollama"].some((n) => P[n]?.enabled && (n === "ollama" || !!P[n].key));
        if (openclawDownUntil > Date.now() && otherEnabled) continue;
        try {
          const reply = await callOpenAIStyle(cfg.base, cfg.key || "openclaw", cfg.model, full);
          openclawDownUntil = 0;
          return { reply, provider: "openclaw", model: cfg.model };
        } catch (err) {
          const msg = String(err.message || "");
          const unreachable = msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND");
          // A 404 means we're pointed at the wrong port/service, not that the
          // gateway is down — force a re-discovery of the real address.
          const wrongAddress = / 404: /.test(msg) || msg.includes("404: Not Found");
          if (unreachable || wrongAddress) {
            // Self-heal: re-discover / install + hardware-tune + start the local gateway, then retry.
            try {
              const { ensureOpenClaw, invalidateOpenClawBase } = await import("./openclaw-runner.js");
              if (wrongAddress) invalidateOpenClawBase();
              const ready = await ensureOpenClaw();
              if (!ready) throw new Error("gateway not ready");
              const reply = await callOpenAIStyle(cfg.base, cfg.key || "openclaw", cfg.model, full);
              openclawDownUntil = 0;
              return { reply, provider: "openclaw", model: cfg.model };
            } catch (err2) {
              openclawDownUntil = Date.now() + 30 * 1000;
              errors.push(`openclaw: local gateway is still starting up (auto-setup is running in the background). Try again in a moment.`);
              continue;
            }
          }
          errors.push(`openclaw: ${msg.slice(0, 200)}`);
          continue;
        }

      }
      if (name === "ollama") {
        return await callOllama(full, mode);
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
  return {
    preferred: P.preferred,
    openrouter: P.openrouter.enabled && !!P.openrouter.key,
    ollama: P.ollama.enabled && ollama.length > 0,
    openai: P.openai.enabled && !!P.openai.key,
    anthropic: P.anthropic.enabled && !!P.anthropic.key,
    groq: P.groq.enabled && !!P.groq.key,
    openclaw: P.openclaw.enabled,
    freeModels: freeModels.length,
  };
}
