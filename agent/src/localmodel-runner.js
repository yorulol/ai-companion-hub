/**
 * Local-model runtime helpers: pick the active custom model, pre-warm it into
 * memory on boot so first replies are fast, and expose the tuning YORU should
 * use when routing chat through it.
 */
import { config } from "./config.js";
import { log } from "./boot-ui.js";
import { listBuiltModels, getBuiltModel } from "./model-builder.js";

/**
 * Resolve the currently active local model.
 *   - If LOCALMODEL_ACTIVE is set and exists, use it.
 *   - Else pick the smallest built model (fastest to respond).
 */
export async function activeLocalModel() {
  if (!config.localmodel.enabled) return null;
  const list = await listBuiltModels();
  if (!list.length) return null;
  const want = config.localmodel.active;
  if (want) {
    const hit = list.find((m) => m.name === want);
    if (hit) return hit;
  }
  return [...list].sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0))[0];
}

async function ollamaUp() {
  try {
    const r = await fetch(`${config.providers.ollama.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

/** Pre-warm the active local model so the first reply doesn't pay a cold-load cost. */
export async function preloadLocalModel() {
  const active = await activeLocalModel();
  if (!active) return;
  if (!(await ollamaUp())) {
    log.warn("localmodel", `active model "${active.name}" needs Ollama running to preload — skipping`);
    return;
  }
  const t = active.tuning || {};
  try {
    await fetch(`${config.providers.ollama.url}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: active.name,
        messages: [{ role: "user", content: "hi" }],
        keep_alive: "24h",
        options: {
          num_ctx: t.numCtx || 1536,
          num_predict: 1,
          num_batch: t.numBatch || 512,
          num_gpu: t.numGpu ?? 999,
        },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    log.ok("localmodel", `${active.name} pre-loaded (~${active.paramsB || "?"}B params · ctx ${t.numCtx || 1536})`);
  } catch (err) {
    log.warn("localmodel", `preload failed: ${err.message}`);
  }
}

export { getBuiltModel };
