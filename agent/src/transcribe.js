/**
 * Speech-to-text for call recordings.
 *
 * Two backends, picked automatically:
 *   1. whisper.cpp binary  — fully local, no keys. Set STT_WHISPER_BIN + STT_WHISPER_MODEL.
 *   2. OpenAI-compatible /audio/transcriptions endpoint (faster-whisper-server,
 *      LocalAI, OpenAI, Groq…). Set STT_BASE_URL (+ STT_API_KEY, STT_MODEL).
 *
 * If neither is configured the call still gets a PDF + audio recording, just
 * with the timeline/notes instead of spoken text.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

const env = (k, d = "") => (process.env[k] ?? d).trim();

export function sttConfig() {
  const bin = env("STT_WHISPER_BIN");
  const model = env("STT_WHISPER_MODEL");
  const base = env("STT_BASE_URL").replace(/\/$/, "");
  if (env("STT_ENABLED", "true").toLowerCase() === "false") return { mode: "off" };
  if (bin && model) return { mode: "whisper-cpp", bin, model, lang: env("STT_LANGUAGE", "en") };
  if (base) {
    return {
      mode: "api",
      base,
      key: env("STT_API_KEY"),
      model: env("STT_MODEL", "whisper-1"),
      lang: env("STT_LANGUAGE", "en"),
    };
  }
  return { mode: "off" };
}

export function sttAvailable() {
  return sttConfig().mode !== "off";
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (c) => (c === 0 ? resolve(out) : reject(new Error(err.slice(-300) || `exit ${c}`))));
  });
}

async function whisperCpp(file, cfg) {
  const outBase = path.join(os.tmpdir(), `yoru-stt-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await run(cfg.bin, ["-m", cfg.model, "-f", file, "-l", cfg.lang, "-otxt", "-of", outBase, "-nt"]);
  const txt = await fs.readFile(`${outBase}.txt`, "utf8").catch(() => "");
  await fs.rm(`${outBase}.txt`, { force: true }).catch(() => {});
  return txt.trim();
}

async function apiTranscribe(file, cfg) {
  const buf = await fs.readFile(file);
  const form = new FormData();
  form.append("file", new Blob([buf], { type: "audio/wav" }), path.basename(file));
  form.append("model", cfg.model);
  if (cfg.lang) form.append("language", cfg.lang);
  const res = await fetch(`${cfg.base}/audio/transcriptions`, {
    method: "POST",
    headers: cfg.key ? { Authorization: `Bearer ${cfg.key}` } : {},
    body: form,
    signal: AbortSignal.timeout(120000),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const body = await res.json().catch(() => ({}));
  return String(body.text || "").trim();
}

/** Transcribes one utterance WAV. Returns "" when STT is off or fails. */
export async function transcribeFile(file) {
  const cfg = sttConfig();
  if (cfg.mode === "off") return "";
  try {
    return cfg.mode === "whisper-cpp" ? await whisperCpp(file, cfg) : await apiTranscribe(file, cfg);
  } catch { return ""; }
}

/**
 * Transcribes every utterance, keeping speaker identity attached.
 * Runs a few at a time so a long call doesn't take forever.
 */
export async function transcribeUtterances(utterances, { concurrency = 3, onProgress } = {}) {
  if (!sttAvailable() || !utterances.length) return [];
  const lines = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, utterances.length) }, async () => {
    while (i < utterances.length) {
      const idx = i++;
      const u = utterances[idx];
      const text = await transcribeFile(u.file);
      if (text) lines.push({ ...u, text });
      onProgress?.(lines.length, utterances.length);
    }
  });
  await Promise.all(workers);
  lines.sort((a, b) => a.offsetMs - b.offsetMs);
  return lines;
}
