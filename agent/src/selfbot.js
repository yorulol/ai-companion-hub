/**
 * Personal-account responder. Loads discord.js-selfbot-v13 lazily so the main
 * bot works even if the package fails to install. AGAINST DISCORD ToS.
 */
import { config, isOwnerId } from "./config.js";
import { chat } from "./chat-loop.js";
import { logActivity } from "./activity.js";

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
      if (!message.mentions.has(client.user)) return;
      const text = message.content.replace(/<@!?\d+>/g, "").trim();
      if (!text) return;
      const isOwner = isOwnerId(message.author.id);
      const { reply } = await chat({ scope: `s:${message.channelId}:${message.author.id}`, userText: text, isOwner });
      await message.reply(reply.slice(0, 1900));
      logActivity("selfbot", `replied to @${message.author.tag}`, { channel: message.channelId });
    } catch (err) {
      console.error("[selfbot]", err.message);
    }
  });

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
