// Auto-provision Ollama models tuned for mid-range hardware.
// Target rig: Intel i7 + RTX 1660 Ti (6 GB VRAM) + 16 GB RAM.
// We use a fast 3B chat model that stays fully on a 6 GB GPU, while retaining
// the stronger 7B coder for coding tasks where quality matters more than speed.
import { config } from "./config.js";
import { log } from "./boot-ui.js";

// Chosen for a 6 GB VRAM / 16 GB RAM box:
//   - llama3.2:3b-instruct-q4_K_M → ~2 GB, fast all-round chat
//   - qwen2.5-coder:7b-instruct-q4_K_M → ~4.4 GB, strongest small coder
const RECOMMENDED = {
  general: "qwen2.5:3b-instruct-q4_K_M",
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

export async function startOllama() {
  const p = config.providers.ollama;
  if (!p.enabled) return;

  if (!(await ollamaUp())) {
    log.warn("ollama", `not reachable at ${p.url}. Install from https://ollama.com and run: ollama serve`);
    return;
  }

  // If the user hasn't customised their model choice, snap to hardware-tuned defaults.
  // Migrate both the old shorthand and the previous 8B hardware default.
  if (["llama3.1", "llama3.1:8b-instruct-q4_K_M", "llama3.2:3b-instruct-q4_K_M", "llama3.2:1b-instruct-q4_K_M"].includes(p.model)) p.model = RECOMMENDED.general;
  if (p.codeModel === "qwen2.5-coder") p.codeModel = RECOMMENDED.coding;

  const installed = await listInstalled();
  const need = [p.model, p.codeModel].filter((m) => !installed.some((i) => i === m || i.startsWith(m.split(":")[0] + ":")));

  // Pre-warm the chat model into VRAM so the first chat reply isn't slow.
  if (!need.includes(p.model)) {
    try {
      await fetch(`${p.url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: p.model,
          messages: [],
          keep_alive: "24h",
          options: { num_ctx: p.numCtx, num_predict: 1, num_gpu: p.numGpu, num_batch: p.numBatch },
        }),
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
