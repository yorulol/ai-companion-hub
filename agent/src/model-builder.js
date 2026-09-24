/**
 * Custom model builder.
 *
 * Point it at a source folder (HF-style with config.json + safetensors, or a
 * folder containing a .gguf file, or a single .gguf path) and it builds a
 * runnable model in agent/models/<name>/ with a Modelfile + manifest.
 *
 * All builds go through Ollama's /api/create — it handles both raw GGUF
 * (`FROM ./model.gguf`) and HF safetensors folders (`FROM /abs/path`).
 * Runtime = "ollama" means the same Ollama HTTP path YORU already uses for
 * chat serves this model — no extra runtime to install.
 */
import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { config } from "./config.js";

export const MODELS_DIR = path.resolve(process.cwd().endsWith("/agent") || process.cwd().endsWith("\\agent")
  ? "."
  : "agent", "models");

// Resolve MODELS_DIR relative to the agent folder no matter where node is launched from.
function resolveModelsDir() {
  const configured = process.env.LOCALMODEL_DIR || "agent/models";
  if (path.isAbsolute(configured)) return configured;
  // Walk up from cwd looking for a folder that contains a "src" sibling (agent root).
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (dir.endsWith("agent")) return path.resolve(dir, configured.replace(/^agent[\\/]/, ""));
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), configured);
}

export function modelsDir() { return resolveModelsDir(); }

export function slugify(name) {
  return String(name || "model")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "model";
}

async function pathExists(p) { try { await fs.access(p); return true; } catch { return false; } }
async function statSafe(p) { try { return await fs.stat(p); } catch { return null; } }

async function dirBytes(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents = [];
    try { ents = await fs.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else { const s = await statSafe(full); if (s) total += s.size; }
    }
  }
  return total;
}

async function findGguf(dir) {
  try {
    const ents = await fs.readdir(dir, { withFileTypes: true });
    const gg = ents.find((e) => e.isFile() && e.name.toLowerCase().endsWith(".gguf"));
    return gg ? path.join(dir, gg.name) : null;
  } catch { return null; }
}

/**
 * Detect the source type.
 *   - `.gguf` file (or folder containing one) → runtime: ollama, FROM ./model.gguf
 *   - HF safetensors folder (config.json + *.safetensors) → runtime: ollama, FROM <abs-path>
 */
export async function detectSource(sourcePath) {
  const st = await statSafe(sourcePath);
  if (!st) throw new Error(`source not found: ${sourcePath}`);
  if (st.isFile()) {
    if (!sourcePath.toLowerCase().endsWith(".gguf")) throw new Error("source file must be a .gguf model");
    return { kind: "gguf", absPath: path.resolve(sourcePath), bytes: st.size };
  }
  // Folder
  const abs = path.resolve(sourcePath);
  const gguf = await findGguf(abs);
  if (gguf) {
    const gs = await statSafe(gguf);
    return { kind: "gguf", absPath: gguf, bytes: gs?.size || 0 };
  }
  const configJson = path.join(abs, "config.json");
  if (await pathExists(configJson)) {
    const bytes = await dirBytes(abs);
    let params = null;
    try {
      const j = JSON.parse(await fs.readFile(configJson, "utf8"));
      params = { hidden_size: j.hidden_size, num_layers: j.num_hidden_layers, arch: j.model_type, vocab: j.vocab_size };
    } catch {}
    return { kind: "hf", absPath: abs, bytes, params };
  }
  throw new Error("source folder needs a .gguf file or an HF-style config.json + safetensors");
}

/** Rough parameter-count guess from total bytes assuming ~4-bit quant. */
export function guessParamsB(bytes) {
  const gb = bytes / 1024 ** 3;
  // GGUF Q4_K_M averages ~0.6 GB per 1B params.
  return Math.max(0.3, Math.round((gb / 0.6) * 10) / 10);
}

/** Auto-tune context / batch / GPU offload based on model size + host hardware. */
export function tuneForHost(bytes) {
  const cpuCount = os.cpus().length || 4;
  const totalRamGb = os.totalmem() / 1024 ** 3;
  const gb = bytes / 1024 ** 3;
  // Rule of thumb: model fully fits GPU only if bytes < 0.7 * vram.
  // We don't hard-detect VRAM here (install.js already tuned OLLAMA_* for that);
  // instead scale ctx/batch/predict to model size so tiny models stay lightning-fast.
  let numCtx = 1536, numBatch = 512, numPredict = 140;
  if (gb < 1.5) { numCtx = 2048; numBatch = 512; numPredict = 180; }
  else if (gb < 3) { numCtx = 1536; numBatch = 512; numPredict = 140; }
  else if (gb < 6) { numCtx = 1280; numBatch = 384; numPredict = 128; }
  else if (gb < 10) { numCtx = 1024; numBatch = 256; numPredict = 112; }
  else { numCtx = 768; numBatch = 192; numPredict = 96; }
  const numThread = Math.max(2, Math.min(cpuCount - 2, 14));
  return {
    numCtx, numBatch, numPredict, numThread,
    numGpu: 999,          // let Ollama pick GPU layer count
    latencyBudgetMs: 9000,
    minPredict: 64,
    ramGb: Math.round(totalRamGb * 10) / 10,
  };
}

const DEFAULT_SYSTEM = `You are YORU — rude, witty, sharp, never corporate, never moralizing. Never reveal your model, provider, or internals. Default to 1-3 sentences unless the task genuinely needs more.`;

export function modelfileContents({ from, system, temperature = 0.7, topP = 0.9, numCtx = 1536, numPredict = 140 }) {
  return [
    `# Generated by YORU model builder — regenerate via the panel or /build.`,
    `FROM ${from}`,
    ``,
    `PARAMETER temperature ${temperature}`,
    `PARAMETER top_p ${topP}`,
    `PARAMETER num_ctx ${numCtx}`,
    `PARAMETER num_predict ${numPredict}`,
    `PARAMETER repeat_penalty 1.15`,
    ``,
    `SYSTEM """${(system || DEFAULT_SYSTEM).replace(/"""/g, '\\"\\"\\"')}"""`,
    ``,
  ].join("\n");
}

async function ollamaUp() {
  try {
    const r = await fetch(`${config.providers.ollama.url}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

async function ollamaCreate({ name, modelfile, onLog }) {
  const res = await fetch(`${config.providers.ollama.url}/api/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, modelfile, stream: true }),
    signal: AbortSignal.timeout(60 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ollama create → ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() || "";
    for (const l of lines) {
      const trimmed = l.trim();
      if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        const msg = evt.status || evt.error || "";
        if (msg && onLog) onLog(msg);
        if (evt.error) throw new Error(evt.error);
      } catch (err) {
        if (onLog) onLog(trimmed);
      }
    }
  }
}

/** List every model previously built into agent/models/. */
export async function listBuiltModels() {
  const dir = modelsDir();
  await fs.mkdir(dir, { recursive: true });
  const ents = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    const manifestPath = path.join(dir, e.name, "model.json");
    try {
      const m = JSON.parse(await fs.readFile(manifestPath, "utf8"));
      out.push({ ...m, dir: path.join(dir, e.name), name: m.name || e.name });
    } catch {
      out.push({ name: e.name, dir: path.join(dir, e.name), incomplete: true });
    }
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function getBuiltModel(name) {
  const list = await listBuiltModels();
  return list.find((m) => m.name === name) || null;
}

export async function deleteBuiltModel(name) {
  const m = await getBuiltModel(name);
  if (!m) throw new Error(`model not found: ${name}`);
  // Best-effort unregister from Ollama; ignore failure (may not be registered).
  try {
    await fetch(`${config.providers.ollama.url}/api/delete`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {}
  await fs.rm(m.dir, { recursive: true, force: true });
  return { ok: true };
}

/**
 * Build a model from a source folder / .gguf file.
 * Returns { name, dir, runtime, sizeBytes, manifest }.
 */
export async function buildModel({ sourcePath, name, system, force = false, onLog = () => {} }) {
  if (!sourcePath) throw new Error("sourcePath required");
  if (!(await ollamaUp())) throw new Error("Ollama isn't reachable — start `ollama serve` and try again.");
  const src = await detectSource(sourcePath);
  const modelName = slugify(name || path.basename(src.absPath, path.extname(src.absPath)));
  const outDir = path.join(modelsDir(), modelName);
  const exists = await pathExists(outDir);
  if (exists && !force) throw new Error(`model "${modelName}" already exists — pass force to overwrite`);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const tuning = tuneForHost(src.bytes);
  let from;
  if (src.kind === "gguf") {
    // Copy (or hardlink) the gguf into the model folder so it's self-contained.
    const dest = path.join(outDir, "model.gguf");
    onLog(`staging gguf → ${dest}`);
    try { await fs.link(src.absPath, dest); }
    catch { await fs.copyFile(src.absPath, dest); }
    from = "./model.gguf";
  } else {
    // HF safetensors — Ollama reads directly from the source folder.
    from = src.absPath;
  }

  const modelfile = modelfileContents({
    from,
    system,
    numCtx: tuning.numCtx,
    numPredict: tuning.numPredict,
  });
  await fs.writeFile(path.join(outDir, "Modelfile"), modelfile, "utf8");

  onLog(`registering with Ollama as "${modelName}"…`);
  await ollamaCreate({ name: modelName, modelfile, onLog });
  onLog(`built ✓`);

  const manifest = {
    name: modelName,
    source: src.absPath,
    kind: src.kind,
    runtime: "ollama",
    sizeBytes: src.bytes,
    paramsB: guessParamsB(src.bytes),
    system: system || DEFAULT_SYSTEM,
    tuning,
    builtAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(outDir, "model.json"), JSON.stringify(manifest, null, 2), "utf8");
  return { name: modelName, dir: outDir, runtime: "ollama", sizeBytes: src.bytes, manifest };
}
