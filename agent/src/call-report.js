/**
 * Call report writer — renders the PDF transcript for a finished call and
 * drops it (plus the audio recording and a plain-text transcript) into
 * agent/calls/.
 *
 * File naming: <Guild Name> (<Guild ID>) - YYYY-MM-DD HH-MM-SS
 */
import { promises as fs } from "node:fs";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CALLS_DIR = path.resolve(__dirname, "..", "calls");

const safe = (s) => String(s || "unknown").replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

export function callStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function callBaseName(session, when = new Date()) {
  return `${safe(session.guildName)} (${session.guildId || "no-guild"}) - ${callStamp(when)}`;
}

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

export function renderTranscriptText(session, lines) {
  const out = [
    `Call transcript — #${session.channelName}`,
    `Server: ${session.guildName || "?"} (${session.guildId || "?"})`,
    `Started: ${session.startedAt}`,
    `Ended:   ${session.endedAt}`,
    "",
    "── TRANSCRIPT ──",
  ];
  if (lines.length) {
    for (const l of lines) out.push(`[${clock(l.offsetMs)}] ${l.username} (${l.userId}): ${l.text}`);
  } else {
    out.push("(no speech was transcribed — speech-to-text is not configured or nobody spoke)");
  }
  out.push("", "── TIMELINE ──", ...session.events.map((e) => `[${e.at}] ${e.text}`));
  out.push("", "── NOTES ──", ...(session.notes.length ? session.notes.map((n) => `[${n.at}] ${n.text}`) : ["(none)"]));
  return out.join("\n");
}

async function loadPdfKit() {
  try { const m = await import("pdfkit"); return m.default ?? m; }
  catch { return null; }
}

/** Writes the PDF. Returns the file path, or null when pdfkit isn't installed. */
export async function writeCallPdf(session, lines, outPath) {
  const PDFDocument = await loadPdfKit();
  if (!PDFDocument) return null;

  const doc = new PDFDocument({ size: "LETTER", margin: 54, info: { Title: `Call transcript — ${session.guildName}` } });
  const stream = fsSync.createWriteStream(outPath);
  doc.pipe(stream);

  const INK = "#111111", MUTED = "#666666", ACCENT = "#6d3bf5";

  doc.fillColor(ACCENT).fontSize(20).text("Call Transcript", { continued: false });
  doc.moveDown(0.2);
  doc.fillColor(INK).fontSize(13).text(`#${session.channelName}`);
  doc.moveDown(0.6);
  doc.fillColor(MUTED).fontSize(10);
  doc.text(`Server:  ${session.guildName || "?"}`);
  doc.text(`Server ID: ${session.guildId || "?"}`);
  doc.text(`Channel ID: ${session.channelId}`);
  doc.text(`Started: ${new Date(session.startedAt).toLocaleString()}`);
  doc.text(`Ended:   ${new Date(session.endedAt).toLocaleString()}`);
  if (session.audioFile) doc.text(`Audio:   ${session.audioFile}`);
  doc.moveDown(0.8);
  doc.moveTo(54, doc.y).lineTo(558, doc.y).strokeColor("#dddddd").stroke();
  doc.moveDown(0.8);

  const heading = (t) => {
    doc.moveDown(0.5).fillColor(ACCENT).fontSize(13).text(t);
    doc.moveDown(0.3);
  };

  heading("Transcript");
  if (lines.length) {
    for (const l of lines) {
      doc.fontSize(9).fillColor(MUTED).text(`[${clock(l.offsetMs)}]  `, { continued: true });
      doc.fontSize(10).fillColor(ACCENT).text(`${l.username} (${l.userId}): `, { continued: true });
      doc.fontSize(10).fillColor(INK).text(l.text);
      doc.moveDown(0.25);
    }
  } else {
    doc.fontSize(10).fillColor(MUTED).text("No speech was transcribed for this call.");
  }

  heading("Timeline");
  for (const e of session.events) {
    doc.fontSize(9).fillColor(MUTED).text(`[${e.at}]  `, { continued: true });
    doc.fontSize(10).fillColor(INK).text(e.text);
  }

  heading("Notes");
  if (session.notes.length) {
    for (const n of session.notes) {
      doc.fontSize(9).fillColor(MUTED).text(`[${n.at}]  `, { continued: true });
      doc.fontSize(10).fillColor(INK).text(n.text);
    }
  } else {
    doc.fontSize(10).fillColor(MUTED).text("No notes were marked down.");
  }

  // Speaker index — every participant with their Discord ID.
  const speakers = new Map();
  for (const l of lines) speakers.set(l.userId, l.username);
  if (speakers.size) {
    heading("Participants heard");
    for (const [id, name] of speakers) doc.fontSize(10).fillColor(INK).text(`• ${name} — ${id}`);
  }

  doc.end();
  await new Promise((res, rej) => { stream.on("finish", res); stream.on("error", rej); });
  return outPath;
}

export async function ensureCallsDir() {
  await fs.mkdir(CALLS_DIR, { recursive: true });
  return CALLS_DIR;
}

export async function listCalls() {
  const files = await fs.readdir(CALLS_DIR).catch(() => []);
  return files.filter((f) => f.endsWith(".pdf")).sort().reverse();
}
