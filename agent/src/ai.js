import { config } from "./config.js";
import { getSettings } from "./db.js";

/** Cached list of every free model OpenRouter currently exposes. */
let freeModels = [];
let codingModels = [];
let lastModelFetch = 0;

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
/** Evict the N models whose cooldown ends soonest so we can retry. */
const evictSoonestCooldowns = (n = 5) => {
  const entries = [...cooldown.entries()].sort((a, b) => a[1] - b[1]);
  for (const [id] of entries.slice(0, n)) cooldown.delete(id);
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

async function callOllama(messages, mode) {
  const p = config.providers.ollama;
  const model = mode === "coding" ? p.codeModel : p.model;
  const res = await fetch(`${p.url}/api/chat`, {
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
        await refreshModels();
        const pool = mode === "coding" && codingModels.length ? [...codingModels, ...freeModels] : freeModels;
        const tried = new Set();
        let attemptedAny = false;
        for (const model of pool) {
          if (tried.has(model)) continue;
          tried.add(model);
          if (isParked(model)) continue; // skip cooling-down models entirely
          attemptedAny = true;
          try {
            const reply = await callOpenRouter(model, full);
            return { reply, provider: "openrouter", model };
          } catch (err) {
            const status = err.status || 0;
            if ([429, 402, 403, 500, 502, 503, 504].includes(status)) parkModel(model, status);
            console.warn(`[ai] openrouter ${model} → ${status || "?"} - parked, trying next`);
          }
        }
        // Every free model is parked (all rate-limited). Force a fresh scan so
        // newly-listed free models get picked up, and if still nothing is
        // available evict the soonest-expiring cooldowns and retry ANYWAY —
        // better to hit a maybe-cool model than tell the user "no providers".
        if (!attemptedAny) {
          await refreshModels(true);
          let fresh = (mode === "coding" && codingModels.length ? [...codingModels, ...freeModels] : freeModels)
            .filter((m) => !tried.has(m) && !isParked(m));
          if (!fresh.length) {
            evictSoonestCooldowns(8);
            fresh = (mode === "coding" && codingModels.length ? [...codingModels, ...freeModels] : freeModels)
              .filter((m) => !tried.has(m));
            console.warn(`[ai] openrouter all models parked — evicted cooldowns and retrying ${fresh.length} models`);
          }
          for (const model of fresh) {
            try {
              const reply = await callOpenRouter(model, full);
              return { reply, provider: "openrouter", model };
            } catch (err) {
              const status = err.status || 0;
              if ([429, 402, 403, 500, 502, 503, 504].includes(status)) parkModel(model, status);
              console.warn(`[ai] openrouter ${model} → ${status || "?"} - parked, trying next`);
            }
          }
        }
        errors.push("openrouter: all free models parked or failed");
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
        if (openclawDownUntil > Date.now()) continue; // silently skip while unreachable
        try {
          const reply = await callOpenAIStyle(cfg.base, cfg.key || "openclaw", cfg.model, full);
          openclawDownUntil = 0;
          return { reply, provider: "openclaw", model: cfg.model };
        } catch (err) {
          const msg = String(err.message || "");
          if (msg.includes("fetch failed") || msg.includes("ECONNREFUSED") || msg.includes("ENOTFOUND")) {
            openclawDownUntil = Date.now() + 5 * 60 * 1000;
            console.warn(`[ai] openclaw unreachable at ${cfg.base} — start your local OpenClaw server (https://github.com/openclaw/openclaw). Skipping for 5 min.`);
            continue;
          }
          throw err;
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
