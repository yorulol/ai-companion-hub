// Auto-provision Ollama models tuned for mid-range hardware.
// Target rig: Intel i7 + RTX 1660 Ti (6 GB VRAM) + 16 GB RAM.
// We pick quantised 7-8B models that fit in ~6 GB VRAM comfortably and
// leave headroom on the CPU/RAM side.
import { config } from "./config.js";
import { log } from "./boot-ui.js";

// Chosen for a 6 GB VRAM / 16 GB RAM box:
//   - llama3.1:8b-instruct-q4_K_M → ~4.7 GB, best all-round chat
//   - qwen2.5-coder:7b-instruct-q4_K_M → ~4.4 GB, strongest small coder
// Both run fully on the 1660 Ti with room for context.
const RECOMMENDED = {
  general: "llama3.1:8b-instruct-q4_K_M",
  coding: "qwen2.5-coder:7b-instruct-q4_K_M",
};

async function ollamaUp() {
  try {
    const r = await fetch(`${config.providers.ollama.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

async function listInstalled() {
  try {
    const r = await fetch(`${config.providers.ollama.url}/api/tags`);
    const b = await r.json();
    return (b.models || []).map((m) => m.name);
  } catch { return []; }
}

async function pullModel(name) {
  log.info("ollama", `pulling ${name} (one-time, this can take a while)…`);
  const res = await fetch(`${config.providers.ollama.url}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, stream: false }),
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  if (!res.ok) throw new Error(`pull ${name} → ${res.status}`);
  log.ok("ollama", `${name} ready`);
}

async function gpuInfo() {
  try {
    const r = await fetch(`${config.providers.ollama.url}/api/ps`, { signal: AbortSignal.timeout(2500) });
    if (!r.ok) return null;
    const b = await r.json();
    return (b.models || []).map((m) => `${m.name} (${m.size_vram ? "GPU" : "CPU"})`);
  } catch { return null; }
}

export async function startOllama() {
  const p = config.providers.ollama;
  if (!p.enabled) return;

  if (!(await ollamaUp())) {
    log.warn("ollama", `not reachable at ${p.url}. Install from https://ollama.com and run: ollama serve`);
    return;
  }

  // If the user hasn't customised their model choice, snap to hardware-tuned defaults.
  if (p.model === "llama3.1") p.model = RECOMMENDED.general;
  if (p.codeModel === "qwen2.5-coder") p.codeModel = RECOMMENDED.coding;

  const installed = await listInstalled();
  const need = [p.model, p.codeModel].filter((m) => !installed.some((i) => i === m || i.startsWith(m.split(":")[0] + ":")));

  // Pre-warm the chat model into VRAM so the first chat reply isn't slow.
  if (!need.includes(p.model)) {
    try {
      await fetch(`${p.url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: p.model, messages: [], keep_alive: "24h" }),
        signal: AbortSignal.timeout(120_000),
      });
      log.ok("ollama", `${p.model} pre-loaded into memory`);
    } catch { /* non-fatal */ }
  }

  if (!need.length) {
    log.ok("ollama", `ready (chat=${p.model}, code=${p.codeModel})`);
    return;
  }

  for (const m of need) {
    try { await pullModel(m); }
    catch (e) { log.warn("ollama", `could not pull ${m}: ${e.message}`); }
  }
}
