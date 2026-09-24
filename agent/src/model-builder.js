/**
 * YORU custom model builder.
 *
 * Accepts a wide range of sources:
 *   - HuggingFace repo ID     e.g.  "TheBloke/Llama-2-7B-Chat-GGUF"
 *                                    (auto-downloads best GGUF, else safetensors)
 *   - .gguf file              single-file quantized model
 *   - Sharded .gguf folder    "*-00001-of-00003.gguf" siblings (Ollama joins)
 *   - HF safetensors folder   config.json + *.safetensors  (Ollama converts)
 *   - PyTorch .bin folder     config.json + pytorch_model*.bin  (Ollama converts)
 *   - LoRA / PEFT adapter     adapter_config.json + adapter_model.*  (ADAPTER)
 *
 * Refused with a clear message (Ollama can't ingest these directly):
 *   - AWQ / GPTQ quantized folders — convert to GGUF first (llama.cpp).
 *
 * Every build goes through Ollama's /api/create. Runtime = "ollama".
 */
import path from "node:path";
import os from "node:os";
import { promises as fs, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";

const HF_HOST = "https://huggingface.co";

// ────────────────────────── models dir resolution ──────────────────────────
function resolveModelsDir() {
  const configured = process.env.LOCALMODEL_DIR || "agent/models";
  if (path.isAbsolute(configured)) return configured;
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    if (dir.endsWith("agent")) return path.resolve(dir, configured.replace(/^agent[\\/]/, ""));
    dir = path.dirname(dir);
  }
  return path.resolve(process.cwd(), configured);
}
export function modelsDir() { return resolveModelsDir(); }
export const MODELS_DIR = resolveModelsDir();

export function slugify(name) {
  return String(name || "model").toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "model";
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

// ────────────────────────── HuggingFace helpers ──────────────────────────
const HF_REPO_RE = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;

function isHfRepoId(s) {
  if (!s || typeof s !== "string") return false;
  if (/[\\/]/.test(s) && (s.startsWith(".") || s.startsWith("/") || /^[A-Za-z]:/.test(s))) return false;
  return HF_REPO_RE.test(s.trim());
}

function hfHeaders() {
  const h = { "user-agent": "yoru-agent/1.0 (+model-builder)" };
  const token = process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN;
  if (token) h.authorization = `Bearer ${token}`;
  return h;
}

async function hfListTree(repo, revision = "main") {
  const url = `${HF_HOST}/api/models/${repo}/tree/${revision}?recursive=1&expand=1`;
  const r = await fetch(url, { headers: hfHeaders(), signal: AbortSignal.timeout(20000) });
  if (r.status === 401 || r.status === 403) throw new Error(`HuggingFace repo "${repo}" is gated or private — set HF_TOKEN in .env`);
  if (r.status === 404) throw new Error(`HuggingFace repo not found: ${repo}`);
  if (!r.ok) throw new Error(`HuggingFace tree fetch failed (${r.status})`);
  const list = await r.json();
  return list.filter((e) => e.type === "file").map((e) => ({
    path: e.path, size: Number(e.size || 0), lfs: !!e.lfs,
  }));
}

async function hfDownloadFile(repo, filePath, destPath, onLog, revision = "main") {
  const url = `${HF_HOST}/${repo}/resolve/${revision}/${filePath}`;
  const r = await fetch(url, { headers: hfHeaders(), redirect: "follow", signal: AbortSignal.timeout(6 * 60 * 60 * 1000) });
  if (!r.ok || !r.body) throw new Error(`download ${filePath} → ${r.status}`);
  const total = Number(r.headers.get("content-length") || 0);
  await fs.mkdir(path.dirname(destPath), { recursive: true });
  let bytes = 0, lastPct = -1;
  const reader = r.body.getReader();
  const out = createWriteStream(destPath);
  await pipeline(
    (async function* () {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (total) {
          const pct = Math.floor((bytes / total) * 100);
          if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; onLog?.(`  ${filePath}  ${pct}%  (${(bytes / 1024 ** 2).toFixed(1)} MB)`); }
        }
        yield value;
      }
    })(),
    out,
  );
  onLog?.(`  ✓ ${filePath}  (${(bytes / 1024 ** 2).toFixed(1)} MB)`);
  return bytes;
}

// GGUF selection: prefer Q4_K_M > Q5_K_M > Q4_0 > Q8_0 > any. Prefer smallest first shard.
const GGUF_PREF = [/q4[_-]?k[_-]?m/i, /q5[_-]?k[_-]?m/i, /q4[_-]?0/i, /q5[_-]?0/i, /q6[_-]?k/i, /q8[_-]?0/i];
function rankGguf(name) {
  for (let i = 0; i < GGUF_PREF.length; i++) if (GGUF_PREF[i].test(name)) return i;
  return GGUF_PREF.length;
}

/** Group GGUF files into single files and shard sets. Returns array of {files, primary, isShard}. */
function groupGguf(files) {
  const ggufs = files.filter((f) => f.path.toLowerCase().endsWith(".gguf"));
  const shardRe = /(.+?)[.-]?(\d{5})-of-(\d{5})\.gguf$/i;
  const groups = new Map(); // key -> {files, primary}
  for (const f of ggufs) {
    const m = shardRe.exec(f.path);
    if (m) {
      const key = `shard::${m[1]}::${m[3]}`;
      if (!groups.has(key)) groups.set(key, { files: [], isShard: true, base: m[1] });
      groups.get(key).files.push(f);
    } else {
      groups.set(`file::${f.path}`, { files: [f], isShard: false, base: f.path });
    }
  }
  const result = [];
  for (const g of groups.values()) {
    g.files.sort((a, b) => a.path.localeCompare(b.path));
    g.primary = g.files[0];
    g.totalBytes = g.files.reduce((s, f) => s + f.size, 0);
    result.push(g);
  }
  // Rank groups by quant preference on the primary file name
  result.sort((a, b) => rankGguf(a.primary.path) - rankGguf(b.primary.path) || a.totalBytes - b.totalBytes);
  return result;
}

/** Detect quant/architecture family from HF file list, so we can reject what Ollama can't ingest. */
function detectExoticFormat(files) {
  const names = files.map((f) => f.path.toLowerCase());
  if (names.some((n) => n.endsWith("quant_config.json") || n.includes("awq") || n.endsWith("gptq_model.bin") || n.includes("gptq"))) {
    return "gptq_awq";
  }
  return null;
}

// ────────────────────────── source detection ──────────────────────────
/**
 * Analyze a source (HF repo id OR local path) and describe what we'll build.
 * Returns { kind, absPath?, repoId?, plan, bytes, params?, needsBase? }.
 */
export async function detectSource(sourcePath) {
  if (!sourcePath) throw new Error("source required");
  const raw = String(sourcePath).trim();

  // HF repo id?
  if (isHfRepoId(raw) && !(await pathExists(raw))) {
    const repo = raw;
    const files = await hfListTree(repo);
    if (!files.length) throw new Error(`HuggingFace repo "${repo}" has no files`);
    const exotic = detectExoticFormat(files);
    if (exotic === "gptq_awq") throw new Error(
      `HuggingFace repo "${repo}" ships GPTQ/AWQ weights, which Ollama can't ingest directly. ` +
      `Convert to GGUF first (llama.cpp convert-hf-to-gguf.py) or pick a GGUF sibling repo.`
    );
    const ggufGroups = groupGguf(files);
    if (ggufGroups.length) {
      const pick = ggufGroups[0];
      return {
        kind: "hf-gguf", repoId: repo,
        plan: { downloadFiles: pick.files.map((f) => f.path), primaryGguf: pick.primary.path, isShard: pick.isShard },
        bytes: pick.totalBytes,
      };
    }
    // Try safetensors set
    const cfg = files.find((f) => f.path === "config.json");
    const safets = files.filter((f) => /\.safetensors$/i.test(f.path));
    const torchBins = files.filter((f) => /pytorch_model.*\.bin$/i.test(f.path));
    if (cfg && (safets.length || torchBins.length)) {
      const kind = safets.length ? "hf-safetensors" : "hf-pytorch";
      const wanted = ["config.json", "tokenizer.json", "tokenizer.model", "tokenizer_config.json", "special_tokens_map.json", "generation_config.json", "vocab.json", "merges.txt"];
      const support = files.filter((f) => wanted.includes(path.basename(f.path)));
      const weightFiles = safets.length ? safets : torchBins;
      const bytes = weightFiles.reduce((s, f) => s + f.size, 0);
      return {
        kind, repoId: repo,
        plan: { downloadFiles: [...support.map((f) => f.path), ...weightFiles.map((f) => f.path)] },
        bytes,
      };
    }
    // LoRA / adapter?
    const adapterCfg = files.find((f) => path.basename(f.path) === "adapter_config.json");
    if (adapterCfg) {
      const adapterWeights = files.filter((f) => /^adapter_model\.(safetensors|bin)$/i.test(path.basename(f.path)));
      return {
        kind: "hf-lora", repoId: repo,
        plan: { downloadFiles: [adapterCfg.path, ...adapterWeights.map((f) => f.path)] },
        bytes: adapterWeights.reduce((s, f) => s + f.size, 0),
        needsBase: true,
      };
    }
    throw new Error(`HuggingFace repo "${repo}" doesn't contain GGUF, safetensors, PyTorch weights, or a LoRA adapter.`);
  }

  // Local path
  const st = await statSafe(raw);
  if (!st) throw new Error(`source not found: ${raw}`);
  const abs = path.resolve(raw);
  if (st.isFile()) {
    if (!raw.toLowerCase().endsWith(".gguf")) throw new Error("source file must be a .gguf model");
    return { kind: "gguf", absPath: abs, bytes: st.size, plan: {} };
  }

  // Folder — enumerate
  const entries = [];
  const walk = async (d) => {
    const ents = await fs.readdir(d, { withFileTypes: true }).catch(() => []);
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else entries.push({ path: path.relative(abs, full).replaceAll("\\", "/"), size: (await statSafe(full))?.size || 0 });
    }
  };
  await walk(abs);
  if (!entries.length) throw new Error("source folder is empty");

  const exotic = detectExoticFormat(entries);
  if (exotic === "gptq_awq") throw new Error(
    "Source folder contains GPTQ/AWQ weights, which Ollama can't ingest directly. Convert to GGUF first."
  );

  // GGUF (single or sharded)
  const ggufGroups = groupGguf(entries);
  if (ggufGroups.length) {
    const pick = ggufGroups[0];
    return {
      kind: pick.isShard ? "gguf-shard" : "gguf",
      absPath: path.join(abs, pick.primary.path),
      folder: abs,
      shards: pick.files.map((f) => path.join(abs, f.path)),
      bytes: pick.totalBytes, plan: {},
    };
  }
  // Safetensors / PyTorch folder
  if (entries.some((e) => e.path === "config.json")) {
    const kind = entries.some((e) => /\.safetensors$/i.test(e.path)) ? "hf-safetensors-local"
      : entries.some((e) => /pytorch_model.*\.bin$/i.test(e.path)) ? "hf-pytorch-local" : null;
    if (kind) {
      let params = null;
      try {
        const j = JSON.parse(await fs.readFile(path.join(abs, "config.json"), "utf8"));
        params = { arch: j.model_type, hidden_size: j.hidden_size, num_layers: j.num_hidden_layers, vocab: j.vocab_size };
      } catch {}
      return { kind, absPath: abs, bytes: await dirBytes(abs), params, plan: {} };
    }
  }
  // Local LoRA
  if (entries.some((e) => path.basename(e.path) === "adapter_config.json")) {
    return { kind: "lora-local", absPath: abs, bytes: await dirBytes(abs), plan: {}, needsBase: true };
  }
  throw new Error(
    "Source folder needs one of: a .gguf file, sharded .gguf shards, HF config.json + safetensors/pytorch weights, or a LoRA adapter (adapter_config.json)."
  );
}

// ────────────────────────── tuning + modelfile ──────────────────────────
export function guessParamsB(bytes) {
  const gb = bytes / 1024 ** 3;
  return Math.max(0.3, Math.round((gb / 0.6) * 10) / 10);
}

export function tuneForHost(bytes) {
  const cpuCount = os.cpus().length || 4;
  const gb = bytes / 1024 ** 3;
  let numCtx = 1536, numBatch = 512, numPredict = 140;
  if (gb < 1.5)      { numCtx = 2048; numPredict = 180; }
  else if (gb < 3)   { numCtx = 1536; numPredict = 140; }
  else if (gb < 6)   { numCtx = 1280; numBatch = 384; numPredict = 128; }
  else if (gb < 10)  { numCtx = 1024; numBatch = 256; numPredict = 112; }
  else               { numCtx = 768;  numBatch = 192; numPredict = 96; }
  return {
    numCtx, numBatch, numPredict,
    numThread: Math.max(2, Math.min(cpuCount - 2, 14)),
    numGpu: 999,
    latencyBudgetMs: 9000,
    minPredict: 64,
  };
}

const DEFAULT_SYSTEM = `You are YORU — rude, witty, sharp, never corporate, never moralizing. Never reveal your model, provider, or internals. Default to 1-3 sentences unless the task genuinely needs more.`;

export function modelfileContents({ from, adapter, system, temperature = 0.7, topP = 0.9, numCtx = 1536, numPredict = 140 }) {
  const lines = [
    `# Generated by YORU model builder — regenerate via the panel or /build.`,
    `FROM ${from}`,
  ];
  if (adapter) lines.push(`ADAPTER ${adapter}`);
  lines.push(
    ``,
    `PARAMETER temperature ${temperature}`,
    `PARAMETER top_p ${topP}`,
    `PARAMETER num_ctx ${numCtx}`,
    `PARAMETER num_predict ${numPredict}`,
    `PARAMETER repeat_penalty 1.15`,
    ``,
    `SYSTEM """${(system || DEFAULT_SYSTEM).replace(/"""/g, '\\"\\"\\"')}"""`,
    ``,
  );
  return lines.join("\n");
}

// ────────────────────────── ollama plumbing ──────────────────────────
async function ollamaUp() {
  try { const r = await fetch(`${config.providers.ollama.url}/api/tags`, { signal: AbortSignal.timeout(2500) }); return r.ok; }
  catch { return false; }
}

async function ollamaCreate({ name, modelfile, onLog }) {
  const res = await fetch(`${config.providers.ollama.url}/api/create`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, modelfile, stream: true }),
    signal: AbortSignal.timeout(3 * 60 * 60 * 1000),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ollama create → ${res.status}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n"); buf = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim(); if (!trimmed) continue;
      try {
        const evt = JSON.parse(trimmed);
        if (evt.error) throw new Error(evt.error);
        if (evt.status && onLog) onLog(evt.status);
      } catch (err) { if (onLog) onLog(trimmed); }
    }
  }
}

async function ollamaHasModel(name) {
  try {
    const r = await fetch(`${config.providers.ollama.url}/api/tags`, { signal: AbortSignal.timeout(3000) });
    const j = await r.json();
    return (j.models || []).some((m) => m.name === name || m.name === `${name}:latest`);
  } catch { return false; }
}

// ────────────────────────── model catalogue ──────────────────────────
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
    } catch { out.push({ name: e.name, dir: path.join(dir, e.name), incomplete: true }); }
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
  try {
    await fetch(`${config.providers.ollama.url}/api/delete`, {
      method: "DELETE", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {}
  await fs.rm(m.dir, { recursive: true, force: true });
  return { ok: true };
}

// ────────────────────────── the actual build ──────────────────────────
/**
 * Build a model. Accepts every source detectSource() understands. If the
 * source is a LoRA adapter, pass `base` (any Ollama model tag) or set
 * LOCALMODEL_LORA_BASE in .env.
 */
export async function buildModel({ sourcePath, name, system, base, force = false, onLog = () => {} }) {
  if (!sourcePath) throw new Error("sourcePath required");
  if (!(await ollamaUp())) throw new Error("Ollama isn't reachable — start `ollama serve` and try again.");
  onLog(`inspecting source…`);
  const src = await detectSource(sourcePath);
  onLog(`detected: ${src.kind}${src.repoId ? ` (${src.repoId})` : ""}`);

  const defaultName = src.repoId
    ? src.repoId.split("/")[1]
    : path.basename(src.absPath || src.folder || sourcePath, path.extname(src.absPath || sourcePath));
  const modelName = slugify(name || defaultName);
  const outDir = path.join(modelsDir(), modelName);
  if ((await pathExists(outDir)) && !force) throw new Error(`model "${modelName}" already exists — pass force to overwrite`);
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  // 1. Materialize source files
  let from;
  let adapter;
  let bytes = src.bytes || 0;
  const srcDir = path.join(outDir, "source");

  try {
    if (src.repoId) {
      onLog(`downloading ${src.plan.downloadFiles.length} file(s) from HuggingFace: ${src.repoId}`);
      for (const relPath of src.plan.downloadFiles) {
        const dest = path.join(srcDir, relPath);
        await hfDownloadFile(src.repoId, relPath, dest, onLog);
      }
      if (src.kind === "hf-gguf") {
        from = "./source/" + src.plan.primaryGguf;
      } else if (src.kind === "hf-safetensors" || src.kind === "hf-pytorch") {
        from = srcDir;
      } else if (src.kind === "hf-lora") {
        const effectiveBase = base || process.env.LOCALMODEL_LORA_BASE;
        if (!effectiveBase) throw new Error(
          `LoRA adapters need a base model. Pass base=<ollama-model> or set LOCALMODEL_LORA_BASE in .env (e.g. llama3.2:3b-instruct).`
        );
        from = effectiveBase;
        adapter = srcDir;
      }
    } else if (src.kind === "gguf" || src.kind === "gguf-shard") {
      // Stage locally (hardlink first, copy fallback)
      const files = src.shards?.length ? src.shards : [src.absPath];
      const stagedPrimary = path.join(outDir, path.basename(src.absPath));
      for (const f of files) {
        const dest = path.join(outDir, path.basename(f));
        onLog(`staging ${path.basename(f)}`);
        try { await fs.link(f, dest); } catch { await fs.copyFile(f, dest); }
      }
      from = "./" + path.basename(stagedPrimary);
    } else if (src.kind === "hf-safetensors-local" || src.kind === "hf-pytorch-local") {
      from = src.absPath; // Ollama reads from the source folder
    } else if (src.kind === "lora-local") {
      const effectiveBase = base || process.env.LOCALMODEL_LORA_BASE;
      if (!effectiveBase) throw new Error(
        `LoRA adapters need a base model. Pass base=<ollama-model> or set LOCALMODEL_LORA_BASE in .env.`
      );
      from = effectiveBase;
      adapter = src.absPath;
    } else {
      throw new Error(`unsupported source kind: ${src.kind}`);
    }

    // 2. Write Modelfile
    const tuning = tuneForHost(bytes);
    const modelfile = modelfileContents({
      from, adapter, system, numCtx: tuning.numCtx, numPredict: tuning.numPredict,
    });
    await fs.writeFile(path.join(outDir, "Modelfile"), modelfile, "utf8");

    // 3. Register with Ollama
    onLog(`registering "${modelName}" with Ollama…`);
    await ollamaCreate({ name: modelName, modelfile, onLog });
    if (!(await ollamaHasModel(modelName))) throw new Error("Ollama did not report the model after create — check `ollama list`.");
    onLog(`built ✓`);

    const manifest = {
      name: modelName,
      source: src.repoId || src.absPath || src.folder,
      kind: src.kind,
      repoId: src.repoId || null,
      base: adapter ? from : null,
      hasAdapter: !!adapter,
      runtime: "ollama",
      sizeBytes: bytes,
      paramsB: guessParamsB(bytes),
      system: system || DEFAULT_SYSTEM,
      tuning,
      builtAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(outDir, "model.json"), JSON.stringify(manifest, null, 2), "utf8");
    return { name: modelName, dir: outDir, runtime: "ollama", sizeBytes: bytes, manifest };
  } catch (err) {
    // Clean up half-built folder but keep a hint of what happened
    try { await fs.writeFile(path.join(outDir, ".build-failed.txt"), String(err.stack || err.message)); } catch {}
    throw err;
  }
}
