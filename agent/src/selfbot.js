/**
 * Personal-account responder. Loads discord.js-selfbot-v13 lazily so the main
 * bot works even if the package fails to install. AGAINST DISCORD ToS.
 */
import { config, isOwnerId } from "./config.js";
import { chat } from "./chat-loop.js";
import { logActivity } from "./activity.js";
import { attachPlugins, runOutgoing } from "./selfbot-plugins.js";
import { findCommand } from "./commands.js";
import { bindVoiceClient, joinVoiceChannel, leaveVoiceChannel, addMeetingNote, latestMeetingRecap } from "./voice.js";

let client = null;
let running = false;

export async function startSelfbot() {
  if (running) return { ok: true };
  if (!config.discord.userToken) throw new Error("DISCORD_USER_TOKEN missing.");
  const mod = await import("discord.js-selfbot-v13").catch((err) => {
    throw new Error(`selfbot package missing: ${err.message}. Run npm install in agent/.`);
  });
  client = new mod.Client({ checkUpdate: false });

  client.on("ready", () => {
    console.log(`[selfbot] ready as ${client.user.tag}`);
    logActivity("selfbot", `ready as ${client.user.tag} in ${client.guilds.cache.size} servers`);
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.id === client.user.id) return;

      // NEVER react to @everyone / @here mass pings — even if they mention me.
      const massPing = message.mentions.everyone || /@(everyone|here)\b/.test(message.content);

      const isDm = !message.guild;
      const ownerPrefix = config.discord.ownerPrefix;
      if (message.content.startsWith(ownerPrefix)) {
        const [name, ...args] = message.content.slice(ownerPrefix.length).trim().split(/\s+/);
        const cmdName = (name || "").toLowerCase();

        // Owner voice-meeting commands (work even outside the command registry).
        const VOICE_CMDS = new Set(["joinvoice", "leavevoice", "meetingnote", "meetingnotes"]);
        if (VOICE_CMDS.has(cmdName)) {
          if (!isOwnerId(message.author.id)) {
            await message.reply("Those are my master's commands. Fuck off trying to use them.").catch(() => {});
            return;
          }
          try {
            if (cmdName === "joinvoice") {
              const target = args.join(" ").trim();
              if (!target) { await message.reply("Give me a voice channel ID or exact name.").catch(() => {}); return; }
              const out = await joinVoiceChannel(target);
              await message.reply(`Joined voice channel **#${out.channel}**${out.guild ? ` in ${out.guild}` : ""}. Notes mode on — I'll keep a timeline and your marked-down notes for the recap.`).catch(() => {});
            } else if (cmdName === "leavevoice") {
              const out = await leaveVoiceChannel();
              const bits = [
                `Left the call. Saved to \`agent/calls\`:`,
                out.pdf ? `• **${out.pdf}** — transcript (${out.spokenLines} spoken lines)` : `• transcript: ${out.text}`,
                out.audio ? `• **${out.audio}** — full call recording` : `• no audio recording (ffmpeg missing or nothing captured)`,
                out.speakers?.length ? `• speakers: ${out.speakers.join(", ")}` : null,
              ].filter(Boolean);
              await message.reply(bits.join("\n").slice(0, 1900)).catch(() => {});
            } else if (cmdName === "meetingnote") {
              const note = args.join(" ").trim();
              addMeetingNote(note);
              await message.reply("Noted.").catch(() => {});
            } else {
              const { recap } = await latestMeetingRecap();
              await message.reply(recap ? recap.slice(0, 1800) : "No meeting recaps yet.").catch(() => {});
            }
            logActivity("selfbot", `owner ran ${ownerPrefix}${cmdName}`, { channel: message.channelId });
          } catch (err) {
            await message.reply(`Voice command failed: ${err.message}`).catch(() => {});
          }
          return;
        }

        const command = findCommand(name);
        if (command?.permission === "owner") {
          const isOwner = isOwnerId(message.author.id);
          if (!isOwner) {
            await message.reply("Those are my master's commands. Fuck off trying to use them.").catch(() => {});
            return;
          }
          await command.run({ message, args, client, guildCfg: null, isOwner: true });
          logActivity("selfbot", `owner ran ${ownerPrefix}${command.name}`, { channel: message.channelId });
          return;
        }
      }
      // DMs: always respond. Servers: only when @mentioned or replied-to.
      if (massPing) return;
      const mentionedMe = message.mentions.has(client.user);
      const repliedToMe =
        message.reference && (await message.fetchReference().catch(() => null))?.author?.id === client.user.id;
      if (!isDm && !mentionedMe && !repliedToMe) return;

      // Keep the raw text so the model can see who was mentioned by name,
      // but strip only the self-mention so it doesn't leak into the prompt.
      const selfMentionRe = new RegExp(`<@!?${client.user.id}>`, "g");
      const text = message.content.replace(selfMentionRe, "").trim();
      if (!text) return;

      // Collect other users mentioned in the message (not self) so the model
      // can ping them back when asked ("say hi to @bob").
      const mentioned = [];
      for (const [, u] of message.mentions.users) {
        if (u.id === client.user.id) continue;
        mentioned.push({ id: u.id, tag: u.username });
      }

      const isOwner = isOwnerId(message.author.id);
      await message.channel.sendTyping().catch(() => {});
      const { reply } = await chat({
        scope: `s:${isDm ? "dm" : message.channelId}:${message.author.id}`,
        userText: text,
        isOwner,
        context: {
          platform: "selfbot",
          isDm,
          guildName: message.guild?.name || null,
          channelName: message.channel?.name || null,
          authorTag: message.author.username,
          authorId: message.author.id,
          selfId: client.user.id,
          mentioned,
        },
      });

      // In DMs send as a normal message; in servers use reply so the thread stays clear.
      const out = reply.slice(0, 1900);
      const payload = await runOutgoing(client, { content: out });
      if (payload === null) return;
      if (isDm) await message.channel.send(payload);
      else await message.reply(payload);
      logActivity("selfbot", `replied to @${message.author.username}${isDm ? " (DM)" : ""}`, { channel: message.channelId });
    } catch (err) {
      console.error("[selfbot]", err.message);
    }
  });

  attachPlugins(client);
  await client.login(config.discord.userToken);
  bindVoiceClient(() => client);
  running = true;
  logActivity("selfbot", "started");
  return { ok: true };
}

export async function stopSelfbot() {
  if (client) { try { await client.destroy(); } catch {} client = null; }
  running = false;
  logActivity("selfbot", "stopped");
}

export function selfbotStatus() {
  return { running, tag: client?.user?.tag || null };
}

/** For the owner panel: list every guild the alt account is in. */
export function selfbotGuilds() {
  if (!client) return [];
  return client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    memberCount: g.memberCount || 0,
    icon: g.iconURL?.() || null,
  }));
}

export const getSelfbotClient = () => client;
