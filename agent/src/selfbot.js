/**
 * Personal-account responder. Loads discord.js-selfbot-v13 lazily so the main
 * bot works even if the package fails to install. AGAINST DISCORD ToS.
 */
import { config } from "./config.js";
import { chat } from "./chat-loop.js";

let client = null;
let running = false;

export async function startSelfbot() {
  if (running) return { ok: true };
  if (!config.discord.userToken) throw new Error("DISCORD_USER_TOKEN missing.");
  const mod = await import("discord.js-selfbot-v13").catch((err) => {
    throw new Error(`selfbot package missing: ${err.message}. Run npm install in agent/.`);
  });
  client = new mod.Client({ checkUpdate: false });

  client.on("ready", () => console.log(`[selfbot] ready as ${client.user.tag}`));

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.id === client.user.id) return;
      if (!message.mentions.has(client.user)) return;
      const text = message.content.replace(/<@!?\d+>/g, "").trim();
      if (!text) return;
      const isOwner = message.author.id === config.ownerId;
      const { reply } = await chat({ scope: `s:${message.channelId}:${message.author.id}`, userText: text, isOwner });
      await message.reply(reply.slice(0, 1900));
    } catch (err) {
      console.error("[selfbot]", err.message);
    }
  });

  await client.login(config.discord.userToken);
  running = true;
  return { ok: true };
}

export async function stopSelfbot() {
  if (client) { try { await client.destroy(); } catch {} client = null; }
  running = false;
}

export function selfbotStatus() {
  return { running, tag: client?.user?.tag || null };
}
