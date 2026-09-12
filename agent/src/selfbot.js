/**
 * Personal-account responder. Loads discord.js-selfbot-v13 lazily so the main
 * bot works even if the package fails to install. AGAINST DISCORD ToS.
 */
import { config, isOwnerId } from "./config.js";
import { chat } from "./chat-loop.js";
import { logActivity } from "./activity.js";
import { attachPlugins, runOutgoing } from "./selfbot-plugins.js";

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
      const isDm = !message.guild;
      // DMs: always respond. Servers: only when @mentioned or replied-to.
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
