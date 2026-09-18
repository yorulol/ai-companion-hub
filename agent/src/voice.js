/**
 * Voice meetings via the alt account (discord.js-selfbot-v13 voice support).
 *
 * The OWNER can tell YORU to join a specific voice channel for staff
 * meetings. Everyone in the server is aware the agent is there to take
 * notes. While in the channel YORU logs a meeting timeline (who
 * joined/left/spoke when) plus any notes the owner marks down, and writes
 * a markdown recap to agent/data/meetings/ when the meeting ends.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logActivity } from "./activity.js";
import { startCallRecorder, mixCallAudio, cleanupRecorder } from "./call-recorder.js";
import { transcribeUtterances, sttAvailable } from "./transcribe.js";
import { CALLS_DIR, ensureCallsDir, callBaseName, renderTranscriptText, writeCallPdf, listCalls } from "./call-report.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MEETINGS_DIR = path.resolve(__dirname, "..", "data", "meetings");

let current = null; // { channelId, guildId, connection, startedAt, events: [], notes: [] }
let getClient = () => null;

/** Wire in the selfbot client getter (called from selfbot.js after login). */
export function bindVoiceClient(getter) {
  getClient = getter;
}

const ts = () => new Date().toISOString();
const stamp = () => new Date().toLocaleTimeString();

/**
 * Finds a voice connection/channel the account is actually sitting in, even
 * when our in-memory session was lost (reconnect, restart, hot reload).
 */
function findLiveVoice() {
  const client = getClient();
  if (!client) return null;
  let connection =
    client.voice?.connection ||
    (typeof client.voice?.connections?.first === "function" ? client.voice.connections.first() : null) ||
    null;

  let channel = connection?.channel || null;
  if (!channel) {
    // Fall back to our own voice state in any guild.
    for (const [, guild] of client.guilds?.cache || []) {
      const vs = guild.members?.me?.voice || guild.me?.voice || guild.voiceStates?.cache?.get(client.user?.id);
      const ch = vs?.channel || (vs?.channelId ? guild.channels?.cache?.get(vs.channelId) : null);
      if (ch) { channel = ch; break; }
    }
  }
  if (!channel && !connection) return null;
  return { connection, channel };
}

/** Rebuilds a minimal session from a live connection so leave/save still works. */
function adoptLiveSession() {
  const live = findLiveVoice();
  if (!live) return null;
  current = {
    channelId: live.channel?.id || null,
    channelName: live.channel?.name || "voice",
    guildId: live.channel?.guild?.id || null,
    guildName: live.channel?.guild?.name || null,
    connection: live.connection,
    startedAt: ts(),
    events: [{ at: stamp(), text: "session recovered — recording state was lost, saving what's available" }],
    notes: [],
    recorder: null,
    adopted: true,
  };
  return current;
}

export function voiceStatus() {
  if (!current && findLiveVoice()) adoptLiveSession();
  return current
    ? {
        inChannel: true,
        channelId: current.channelId,
        guildId: current.guildId,
        startedAt: current.startedAt,
        events: current.events.length,
        notes: current.notes.length,
      }
    : { inChannel: false };
}

/**
 * Re-establishes the voice connection for the session we're already tracking.
 * Used when Discord drops us (move/kick/reconnect) — the session, recorder and
 * timeline stay alive so a later "leave" still saves everything.
 */
async function rejoinCurrent(client) {
  if (!current || current.leaving) return;
  const channel = client.channels?.cache?.get(current.channelId);
  if (!channel || typeof client.voice?.joinChannel !== "function") return;
  for (let attempt = 0; attempt < 5 && current && !current.leaving; attempt++) {
    try {
      current.connection = await client.voice.joinChannel(channel, { selfMute: false, selfDeaf: false });
      current.events.push({ at: stamp(), text: "rejoined the call" });
      await startRecorderFor(current.connection, client); // capture restarts on the new connection
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  current?.events.push({ at: stamp(), text: "could not rejoin the call" });
}

export async function joinVoiceChannel(channelIdOrName) {
  const client = getClient();
  if (!client) throw new Error("Alt account is not running. Start it first.");
  if (!current && findLiveVoice()) adoptLiveSession();
  if (current) throw new Error("Already in a voice channel. Leave first.");

  // Resolve by ID first, then by case-insensitive channel name.
  let channel = client.channels.cache.get(channelIdOrName);
  if (!channel) {
    const needle = String(channelIdOrName).toLowerCase();
    channel = client.channels.cache.find(
      (c) => c.isVoice?.() && String(c.name).toLowerCase() === needle,
    );
  }
  if (!channel) throw new Error(`Voice channel not found: ${channelIdOrName}`);
  if (!(channel.isVoice?.() ?? /voice/i.test(channel.type))) {
    throw new Error(`#${channel.name || channelIdOrName} is not a voice channel.`);
  }
  if (typeof client.voice?.joinChannel !== "function") {
    throw new Error("This selfbot build has no voice support (client.voice.joinChannel missing).");
  }

  // Not self-muted / not deafened on purpose: Discord only streams other
  // people's audio to a client that is itself sending packets.
  const connection = await client.voice.joinChannel(channel, {
    selfMute: false,
    selfDeaf: false,
  });

  current = {
    channelId: channel.id,
    channelName: channel.name,
    guildId: channel.guild?.id || null,
    guildName: channel.guild?.name || null,
    connection,
    startedAt: ts(),
    events: [{ at: stamp(), text: `YORU joined #${channel.name} (notes mode — everyone in the server was told this meeting is being transcribed).` }],
    notes: [],
  };

  // Track members joining/leaving the voice channel while the meeting runs.
  // YORU never leaves on its own — not when the owner leaves, not when the
  // channel empties. Only an explicit leave command ends the session.
  current.onVoiceState = (oldState, newState) => {
    if (!current) return;
    const id = current.channelId;
    const selfId = client.user?.id;
    const memberId = newState?.id || newState?.member?.id || oldState?.id || oldState?.member?.id;
    const tag = newState?.member?.user?.username || oldState?.member?.user?.username || "someone";

    // We got yanked out (kicked, moved, gateway hiccup) — hop straight back in.
    if (memberId && selfId && memberId === selfId && oldState?.channelId === id && newState?.channelId !== id) {
      current.events.push({ at: stamp(), text: "dropped from the call — rejoining to keep recording" });
      rejoinCurrent(client).catch(() => {});
      return;
    }
    if (memberId === selfId) return;

    if (newState?.channelId === id && oldState?.channelId !== id) {
      current.events.push({ at: stamp(), text: `${tag} joined the call` });
    } else if (oldState?.channelId === id && newState?.channelId !== id) {
      current.events.push({ at: stamp(), text: `${tag} left the call — YORU stays and keeps recording` });
    }
  };
  client.on("voiceStateUpdate", current.onVoiceState);

  await startRecorderFor(connection, client);

  logActivity("selfbot", `joined voice channel #${channel.name} — recording + notes`);
  return {
    ok: true,
    channel: channel.name,
    guild: current.guildName,
    recording: !!current.recorder && !current.recorder.unsupported,
    transcription: sttAvailable(),
  };
}

/** Owner marks down a timestamped note during the meeting. */
export function addMeetingNote(text) {
  if (!current) throw new Error("Not in a voice channel right now.");
  const note = { at: stamp(), text: String(text || "").trim() };
  if (!note.text) throw new Error("Note text is empty.");
  current.notes.push(note);
  return { ok: true, count: current.notes.length };
}

function renderMeetingMarkdown(session) {
  const lines = [
    `# Staff meeting recap — #${session.channelName}`,
    ``,
    `- Server: ${session.guildName || "?"}`,
    `- Started: ${session.startedAt}`,
    `- Ended: ${session.endedAt}`,
    ``,
    `## Timeline`,
    ...session.events.map((e) => `- **${e.at}** — ${e.text}`),
    ``,
    `## Notes`,
    ...(session.notes.length ? session.notes.map((n) => `- **${n.at}** — ${n.text}`) : ["- (no notes marked down)"]),
    ``,
  ];
  return lines.join("\n");
}

export async function leaveVoiceChannel() {
  if (!current) adoptLiveSession();
  if (!current) throw new Error("Not in a voice channel.");
  current.leaving = true;
  const client = getClient();
  const recorder = current.recorder;
  const session = { ...current, endedAt: ts() };
  try { client?.off("voiceStateUpdate", current.onVoiceState); } catch {}
  // Disconnect every way this selfbot build exposes, so we really leave.
  try { current.connection?.disconnect?.(); } catch {}
  try { current.connection?.destroy?.(); } catch {}
  try {
    const guild = current.guildId ? client?.guilds?.cache?.get(current.guildId) : null;
    await (guild?.members?.me?.voice?.disconnect?.() ?? guild?.me?.voice?.disconnect?.());
  } catch {}
  try { client?.voice?.connections?.get?.(current.guildId)?.disconnect?.(); } catch {}
  current = null;

  // 1. Stop capture and collect every utterance (speaker + Discord ID attached).
  let utterances = [];
  try { ({ utterances = [] } = (await recorder?.stop?.()) || {}); } catch {}

  await ensureCallsDir();
  const base = callBaseName(session);
  const audioTarget = path.join(CALLS_DIR, `${base}.mp3`);

  // 2. Mix everyone onto one timeline -> single recording of the whole call.
  let audioFile = null;
  try { audioFile = await mixCallAudio(utterances, audioTarget); } catch {}
  session.audioFile = audioFile ? path.basename(audioFile) : null;

  // 3. Transcribe each utterance so every line keeps its speaker + ID.
  let lines = [];
  try { lines = await transcribeUtterances(utterances); } catch {}

  // 4. Write the PDF + a plain-text transcript into agent/calls/.
  const pdfPath = path.join(CALLS_DIR, `${base}.pdf`);
  let pdfFile = null;
  try { pdfFile = await writeCallPdf(session, lines, pdfPath); } catch {}
  const txt = renderTranscriptText(session, lines);
  await fs.writeFile(path.join(CALLS_DIR, `${base}.txt`), txt, "utf8").catch(() => {});

  // 5. Keep the old markdown recap too, and clean up the temp audio chunks.
  await fs.mkdir(MEETINGS_DIR, { recursive: true });
  const md = renderMeetingMarkdown(session);
  await fs.writeFile(path.join(MEETINGS_DIR, `meeting-${Date.now()}.md`), md, "utf8").catch(() => {});
  await cleanupRecorder(recorder?.dir);

  logActivity("selfbot", `left call — saved ${pdfFile ? "PDF" : "transcript"}${audioFile ? " + audio" : ""} to agent/calls (${lines.length} spoken lines)`);
  return {
    ok: true,
    recap: md,
    transcript: txt,
    folder: CALLS_DIR,
    pdf: pdfFile ? path.basename(pdfFile) : null,
    audio: session.audioFile,
    text: `${base}.txt`,
    spokenLines: lines.length,
    speakers: [...new Set(lines.map((l) => `${l.username} (${l.userId})`))],
  };
}

/** Newest call files saved in agent/calls. */
export async function listCallFiles() {
  return { dir: CALLS_DIR, files: await listCalls() };
}

export async function latestMeetingRecap() {
  const files = (await fs.readdir(MEETINGS_DIR).catch(() => []))
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (!files.length) return { recap: null };
  const file = files[files.length - 1];
  return { file, recap: await fs.readFile(path.join(MEETINGS_DIR, file), "utf8") };
}
