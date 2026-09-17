/**
 * Per-speaker audio capture for voice calls.
 *
 * Subscribes to every speaking user in the call, decodes their Opus stream to
 * 48 kHz stereo PCM and writes one WAV file per utterance (tagged with the
 * speaker's Discord username + ID and the offset from the start of the call).
 *
 * Those utterance files are later:
 *   - transcribed one by one (so every line keeps its speaker), and
 *   - mixed down with ffmpeg into a single recording of the whole call.
 */
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const RATE = 48000;
const CHANNELS = 2;

let prism = null;
async function loadPrism() {
  if (prism !== null) return prism;
  try { prism = (await import("prism-media")).default ?? (await import("prism-media")); }
  catch { prism = false; }
  return prism;
}

function wavHeader(dataBytes) {
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataBytes, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(CHANNELS, 22);
  b.writeUInt32LE(RATE, 24);
  b.writeUInt32LE(RATE * CHANNELS * 2, 28);
  b.writeUInt16LE(CHANNELS * 2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataBytes, 40);
  return b;
}

/**
 * Resolves an ffmpeg binary: FFMPEG_PATH from .env first, then the bundled
 * ffmpeg-static binary (installed automatically on Linux + Windows), then
 * whatever is on PATH.
 */
let ffmpegPath = null;
export async function resolveFfmpeg() {
  if (ffmpegPath !== null) return ffmpegPath;
  const candidates = [];
  const fromEnv = (process.env.FFMPEG_PATH || "").trim();
  if (fromEnv) candidates.push(fromEnv);
  try {
    const mod = await import("ffmpeg-static");
    const p = mod.default ?? mod;
    if (typeof p === "string" && p) candidates.push(p);
  } catch {}
  candidates.push("ffmpeg");
  for (const c of candidates) {
    const okBin = await new Promise((resolve) => {
      const p = spawn(c, ["-version"], { stdio: "ignore" });
      p.on("error", () => resolve(false));
      p.on("close", (code) => resolve(code === 0));
    });
    if (okBin) { ffmpegPath = c; return ffmpegPath; }
  }
  ffmpegPath = false;
  return ffmpegPath;
}

export async function hasFfmpeg() {
  return Boolean(await resolveFfmpeg());
}


function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr?.on("data", (d) => { err += d.toString(); });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `${cmd} exited ${code}`))));
  });
}

/**
 * Starts capturing audio from a voice connection.
 * Returns a recorder handle: { utterances, stop(), dir }.
 */
export async function startCallRecorder(connection, client, { onError } = {}) {
  const receiver = connection?.receiver;
  if (!receiver?.subscribe) {
    return { unsupported: true, utterances: [], stop: async () => ({ utterances: [] }) };
  }
  const prismMod = await loadPrism();
  if (!prismMod?.opus?.Decoder) {
    return { unsupported: true, reason: "opus decoder unavailable", utterances: [], stop: async () => ({ utterances: [] }) };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "yoru-call-"));
  const startedAt = Date.now();
  const utterances = [];
  const active = new Set();
  let stopped = false;

  const onStart = (userId) => {
    if (stopped || active.has(userId)) return;
    active.add(userId);
    const offsetMs = Date.now() - startedAt;
    const user = client?.users?.cache?.get(userId);
    const file = path.join(dir, `u-${userId}-${offsetMs}.wav`);

    let opus;
    try {
      opus = receiver.subscribe(userId, { end: { behavior: 1 /* AfterSilence */, duration: 900 } });
    } catch (e) { active.delete(userId); onError?.(e); return; }

    const decoder = new prismMod.opus.Decoder({ rate: RATE, channels: CHANNELS, frameSize: 960 });
    const out = fsSync.createWriteStream(file);
    out.write(wavHeader(0)); // placeholder, patched on close
    let bytes = 0;

    decoder.on("data", (chunk) => { bytes += chunk.length; out.write(chunk); });
    const finish = async () => {
      if (!active.delete(userId)) return;
      try {
        await new Promise((res) => out.end(res));
        if (bytes < RATE * CHANNELS * 2 * 0.25) { await fs.rm(file, { force: true }); return; } // <0.25s = noise
        const fd = await fs.open(file, "r+");
        await fd.write(wavHeader(bytes), 0, 44, 0);
        await fd.close();
        utterances.push({
          userId,
          username: user?.username || user?.tag || `user-${userId}`,
          displayName: user?.globalName || user?.username || null,
          offsetMs,
          durationMs: Math.round((bytes / (RATE * CHANNELS * 2)) * 1000),
          file,
        });
      } catch (e) { onError?.(e); }
    };
    decoder.on("end", finish);
    decoder.on("error", (e) => { onError?.(e); finish(); });
    opus.on("error", (e) => { onError?.(e); finish(); });
    opus.pipe(decoder);
  };

  receiver.speaking?.on?.("start", onStart);

  return {
    dir,
    startedAt,
    utterances,
    async stop() {
      stopped = true;
      try { receiver.speaking?.off?.("start", onStart); } catch {}
      // give trailing utterances a moment to flush
      await new Promise((r) => setTimeout(r, 1200));
      utterances.sort((a, b) => a.offsetMs - b.offsetMs);
      return { utterances, dir };
    },
  };
}

/**
 * Mixes every utterance onto one timeline and encodes a single call recording.
 * Falls back to WAV when the mp3 encoder is unavailable.
 */
export async function mixCallAudio(utterances, outPath) {
  if (!utterances.length) return null;
  if (!(await hasFfmpeg())) return null;

  const inputs = [];
  const filters = [];
  utterances.forEach((u, i) => {
    inputs.push("-i", u.file);
    filters.push(`[${i}:a]adelay=${u.offsetMs}|${u.offsetMs}[a${i}]`);
  });
  const mix = `${utterances.map((_, i) => `[a${i}]`).join("")}amix=inputs=${utterances.length}:dropout_transition=0:normalize=0[out]`;
  const args = [
    "-y", "-hide_banner", "-loglevel", "error",
    ...inputs,
    "-filter_complex", `${filters.join(";")};${mix}`,
    "-map", "[out]",
    ...(outPath.endsWith(".mp3") ? ["-codec:a", "libmp3lame", "-b:a", "128k"] : []),
    outPath,
  ];
  try { await run("ffmpeg", args); return outPath; }
  catch {
    if (!outPath.endsWith(".mp3")) throw new Error("audio mixdown failed");
    const wav = outPath.replace(/\.mp3$/, ".wav");
    await run("ffmpeg", args.slice(0, -3).concat(wav));
    return wav;
  }
}

export async function cleanupRecorder(dir) {
  if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
}
