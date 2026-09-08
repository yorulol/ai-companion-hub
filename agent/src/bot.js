import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { config } from "./config.js";
import { COMMANDS, findCommand, commandSummary } from "./commands.js";
import { canRun } from "./permissions.js";
import { getGuild, getAfk, clearAfk, addXp } from "./db.js";
import { chat } from "./chat-loop.js";
import { errEmbed, warnEmbed } from "./ui.js";

let client = null;
let running = false;
const cooldowns = new Map();

export async function startBot() {
  if (running) return { ok: true };
  if (!config.discord.botToken) throw new Error("DISCORD_BOT_TOKEN missing.");

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
  });

  client.on(Events.ClientReady, () => console.log(`[bot] ready as ${client.user.tag}`));

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot || !message.guild) return;
      const guildCfg = getGuild(message.guild.id, message.guild.name);

      // AFK auto-clear on activity
      if (getAfk(message.guild.id, message.author.id)) {
        clearAfk(message.guild.id, message.author.id);
        message.reply("👋 Welcome back — AFK cleared.").catch(() => {});
      }
      // Mention AFK'd user
      for (const [, u] of message.mentions.users) {
        const afk = getAfk(message.guild.id, u.id);
        if (afk) message.reply(`${u.tag} is AFK: ${afk.reason || "no reason"}`).catch(() => {});
      }
      // XP
      addXp(message.guild.id, message.author.id, 3);

      // AI reply when mentioned
      if (message.mentions.has(client.user) && guildCfg.aiReplies) {
        const text = message.content.replace(/<@!?\d+>/g, "").trim();
        if (text) {
          await message.channel.sendTyping();
          const isOwner = message.author.id === config.ownerId;
          const { reply } = await chat({ scope: `g:${message.channel.id}:${message.author.id}`, userText: text, isOwner });
          return void message.reply(reply.slice(0, 1990));
        }
      }

      if (!message.content.startsWith(guildCfg.prefix)) return;
      const [name, ...args] = message.content.slice(guildCfg.prefix.length).trim().split(/\s+/);
      const cmd = findCommand(name);
      if (!cmd) return;
      if (guildCfg.disabledCommands.includes(cmd.name)) {
        return void message.reply({ embeds: [warnEmbed("Command disabled", `\`${cmd.name}\` is turned off in this server.`)] }).catch(() => {});
      }

      const member = await message.guild.members.fetch(message.author.id).catch(() => null);
      const isOwner = message.author.id === config.ownerId;
      if (!isOwner && !canRun(member, guildCfg, cmd.permission)) {
        return void message.reply({
          embeds: [errEmbed("Not allowed", `\`${cmd.name}\` needs **${cmd.permission}** permission.`)],
        }).catch(() => {});
      }

      // Light per-user cooldown so nothing can be spammed.
      const key = `${message.author.id}:${cmd.name}`;
      const until = cooldowns.get(key) || 0;
      if (Date.now() < until) {
        return void message.reply({
          embeds: [warnEmbed("Slow down", `Try \`${cmd.name}\` again in ${Math.ceil((until - Date.now()) / 1000)}s.`)],
        }).catch(() => {});
      }
      cooldowns.set(key, Date.now() + 2000);

      await cmd.run({ message, args, client, guildCfg, isOwner });
    } catch (err) {
      console.error("[bot] handler error", err);
      message.reply({
        embeds: [errEmbed("Something went wrong", String(err.message || err).slice(0, 1000))],
      }).catch(() => {});
    }
  });

  await client.login(config.discord.botToken);
  running = true;
  return { ok: true };
}

export async function stopBot() {
  if (client) { await client.destroy(); client = null; }
  running = false;
  return { ok: true };
}

export function botStatus() {
  return {
    running,
    tag: client?.user?.tag || null,
    guilds: client?.guilds.cache.size || 0,
  };
}

/** For the owner panel: list every guild with its roles. */
export function botGuilds() {
  if (!client) return [];
  return client.guilds.cache.map((g) => ({
    id: g.id,
    name: g.name,
    roles: g.roles.cache.map((r) => ({ id: r.id, name: r.name })).filter((r) => r.name !== "@everyone"),
  }));
}

export const listCommands = commandSummary;
export const allCommands = COMMANDS;
