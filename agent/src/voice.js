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

export function voiceStatus() {
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

export async function joinVoiceChannel(channelIdOrName) {
  const client = getClient();
  if (!client) throw new Error("Alt account is not running. Start it first.");
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

  const connection = await client.voice.joinChannel(channel, {
    selfMute: true,
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
  current.onVoiceState = (oldState, newState) => {
    if (!current) return;
    const id = current.channelId;
    const tag = newState?.member?.user?.username || oldState?.member?.user?.username || "someone";
    if (newState?.channelId === id && oldState?.channelId !== id) {
      current.events.push({ at: stamp(), text: `${tag} joined the call` });
    } else if (oldState?.channelId === id && newState?.channelId !== id) {
      current.events.push({ at: stamp(), text: `${tag} left the call` });
    }
  };
  client.on("voiceStateUpdate", current.onVoiceState);

  logActivity("selfbot", `joined voice channel #${channel.name} for meeting notes`);
  return { ok: true, channel: channel.name, guild: current.guildName };
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
  if (!current) throw new Error("Not in a voice channel.");
  const client = getClient();
  const session = { ...current, endedAt: ts() };
  try { client?.off("voiceStateUpdate", current.onVoiceState); } catch {}
  try { current.connection?.disconnect?.(); } catch {}
  current = null;

  await fs.mkdir(MEETINGS_DIR, { recursive: true });
  const file = path.join(MEETINGS_DIR, `meeting-${Date.now()}.md`);
  const md = renderMeetingMarkdown(session);
  await fs.writeFile(file, md, "utf8");
  logActivity("selfbot", `left voice channel, recap saved (${session.events.length} events, ${session.notes.length} notes)`);
  return { ok: true, recap: md, file: path.basename(file) };
}

export async function latestMeetingRecap() {
  const files = (await fs.readdir(MEETINGS_DIR).catch(() => []))
    .filter((f) => f.endsWith(".md"))
    .sort();
  if (!files.length) return { recap: null };
  const file = files[files.length - 1];
  return { file, recap: await fs.readFile(path.join(MEETINGS_DIR, file), "utf8") };
}
