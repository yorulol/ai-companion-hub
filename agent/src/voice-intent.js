/**
 * Natural-language voice control: the owner can just ping YORU and say
 * "join the voice chat" / "leave the call" instead of typing a command.
 * Commands still work — this is an additional, friendlier path.
 */
import { joinVoiceChannel, leaveVoiceChannel, addMeetingNote, voiceStatus } from "./voice.js";

const VOICE_WORD = /(voice|vc\b|call|meeting|huddle|channel)/i;
const JOIN_WORD = /\b(join|hop in|get in|come in|pop in|connect to|sit in|enter)\b/i;
const LEAVE_WORD = /\b(leave|exit|disconnect|hang up|hangup|get out|drop|end)\b/i;
const NOTE_WORD = /\b(note that|mark down|make a note|write down|note:)\b/i;

/**
 * Returns { action, target } or null when the message isn't a voice request.
 */
export function detectVoiceIntent(text) {
  const t = String(text || "").trim();
  if (!t) return null;

  const noteMatch = t.match(/\b(?:note that|mark down|make a note(?: that)?|write down|note:)\s*(.+)/i);
  if (noteMatch && voiceStatus().inChannel) return { action: "note", target: noteMatch[1].trim() };
  if (NOTE_WORD.test(t) && !VOICE_WORD.test(t)) return null;

  if (!VOICE_WORD.test(t)) return null;

  if (LEAVE_WORD.test(t)) return { action: "leave" };
  if (JOIN_WORD.test(t)) {
    // "join the #staff-meeting vc" / "join voice channel general"
    const m =
      t.match(/(?:join|hop in|get in|come in|pop in|connect to|sit in|enter)\s+(?:the\s+)?(?:voice\s*(?:channel|chat)?|vc|call|meeting)?\s*#?["']?([\w\- ]{2,40})["']?/i);
    let target = (m?.[1] || "").trim();
    if (/^(voice|vc|call|chat|channel|meeting|huddle|here|us|in)$/i.test(target)) target = "";
    return { action: "join", target };
  }
  return null;
}

/**
 * Executes the intent. `message` is a discord.js message (selfbot or bot).
 * Returns a reply string.
 */
export async function runVoiceIntent(intent, message) {
  if (intent.action === "note") {
    addMeetingNote(intent.target);
    return "Noted.";
  }

  if (intent.action === "leave") {
    const out = await leaveVoiceChannel();
    return [
      `Out. Everything's in \`agent/calls\`:`,
      out.pdf ? `• **${out.pdf}** — transcript (${out.spokenLines} spoken lines)` : `• transcript: ${out.text}`,
      out.text ? `• **${out.text}** — plain text copy` : null,
      out.audio ? `• **${out.audio}** — full call recording` : `• no audio recording (recording disabled or nothing captured)`,
      out.speakers?.length ? `• speakers: ${out.speakers.join(", ")}` : null,
    ].filter(Boolean).join("\n").slice(0, 1900);
  }

  // join — prefer an explicitly named channel, else whatever channel the
  // person talking to me is sitting in.
  let target = intent.target;
  if (!target) {
    const vc = message.member?.voice?.channel || message.member?.voice?.channelId;
    target = typeof vc === "string" ? vc : vc?.id;
  }
  if (!target) return "You're not in a voice channel and you didn't name one. Which one?";

  const out = await joinVoiceChannel(target);
  return `In **#${out.channel}**${out.guild ? ` (${out.guild})` : ""}. Recording and taking notes — tell me to leave and I'll drop the transcript, text copy and audio in the calls folder.`;
}
