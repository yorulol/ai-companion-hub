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
  reasoning: "qwen2.5:7b-instruct-q4_K_M",
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
  if (res.ok) { log.ok("ollama", `${name} ready`); return; }

  const detail = (await res.text().catch(() => "")).slice(0, 200);
  // hf.co/ refs need a recent Ollama; older servers 500 on the HTTP API but
  // the CLI on the same box often still works — try it before giving up.
  if (name.startsWith("hf.co/") || name.startsWith("hf.co")) {
    try {
      const { execFile } = await import("node:child_process");
      await new Promise((resolve, reject) => {
        execFile("ollama", ["pull", name], { timeout: 30 * 60 * 1000 }, (err, _stdout, stderr) => {
          if (err) reject(new Error((stderr || err.message || "").slice(0, 200)));
          else resolve();
        });
      });
      log.ok("ollama", `${name} ready (pulled via ollama CLI)`);
      return;
    } catch (cliErr) {
      throw new Error(
        `pull ${name} → ${res.status} (${detail}); CLI fallback also failed (${cliErr.message}). ` +
        `Fix: upgrade Ollama (https://ollama.com/download) then run: ollama pull ${name}`
      );
    }
  }
  throw new Error(`pull ${name} → ${res.status}${detail ? ` (${detail})` : ""}`);
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
  const wanted = [p.model, p.reasoningModel, p.codeModel];
  if (p.heretic?.enabled && p.heretic.model) wanted.push(p.heretic.model);
  const need = [...new Set(wanted)].filter((m) => !installed.includes(m));

  // UF variant enabled: (re)build from agent/UF/Modelfile whenever it's missing
  // or its tuning changed — ensureUfModel compares a content hash itself.
  if (p.uf?.enabled) {
    try {
      const { ensureUfModel } = await import("./uf-model.js");
      const r = await ensureUfModel({ url: p.url, log: (m) => log.info("uf", m) });
      if (r.created) {
        log.ok("uf", `${p.uf.model} ${r.rebuilt ? "rebuilt with new speed tuning" : "built"} from UF/Modelfile`);
        if (!installed.includes(p.uf.model)) installed.push(p.uf.model);
      } else if (r.reason !== "exists") log.warn("uf", `variant not built (${r.reason})`);
    } catch (e) { log.warn("uf", `could not build ${p.uf.model}: ${e.message}`); }
  }

  // Pre-warm the active chat model into VRAM so the first reply isn't slow.
  // A cold load costs 10-30s — far past the latency budget.
  const warmModel = p.uf?.enabled ? p.uf.model : p.model;
  if (!need.includes(warmModel)) {
    try {
      await fetch(`${p.url}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: warmModel,
          messages: [{ role: "user", content: "hi" }],
          keep_alive: "24h",
          options: { num_ctx: p.numCtx, num_predict: 1, num_gpu: p.numGpu, num_batch: p.numBatch },
        }),
        signal: AbortSignal.timeout(180_000),
      });
      log.ok("ollama", `${warmModel} pre-loaded into memory (target reply time ≤ ${Math.round(p.latencyBudgetMs / 1000)}s)`);
    } catch { /* non-fatal */ }
  }

  if (!need.length) {
    log.ok("ollama", `ready (chat=${p.model}, reasoning=${p.reasoningModel}, code=${p.codeModel})`);
    return;
  }

  for (const m of need) {
    try { await pullModel(m); }
    catch (e) { log.warn("ollama", `could not pull ${m}: ${e.message}`); }
  }
}
