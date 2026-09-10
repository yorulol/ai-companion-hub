import { Client, GatewayIntentBits, Partials, Events } from "discord.js";
import { config, isOwnerId } from "./config.js";
import { COMMANDS, findCommand, commandSummary } from "./commands.js";
import { canRun } from "./permissions.js";
import {
  getGuild, getAfk, clearAfk, addXp,
  listCustomCommands, getAutoresponder, getWelcome,
  listReactionRoles,
} from "./db.js";
import { chat } from "./chat-loop.js";
import { errEmbed, warnEmbed, okEmbed, embed } from "./ui.js";

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
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildModeration,
    ],
    partials: [Partials.Channel, Partials.Message, Partials.Reaction],
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
          const isOwner = isOwnerId(message.author.id);
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
      const isOwner = isOwnerId(message.author.id);
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

  // Custom commands + autoresponder run alongside the prefix command system.
  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.author.bot || !message.guild) return;
      const guildCfg = getGuild(message.guild.id, message.guild.name);
      const content = message.content;

      // custom prefix commands (guild-specific shortcuts)
      if (content.startsWith(guildCfg.prefix)) {
        const name = content.slice(guildCfg.prefix.length).trim().split(/\s+/)[0].toLowerCase();
        const custom = listCustomCommands(message.guild.id).find((c) => c.name === name);
        if (custom) {
          return void message.reply({ embeds: [embed({ description: custom.content, footer: "Custom command" })] }).catch(() => {});
        }
      }

      // autoresponder triggers (substring match)
      const triggers = getAutoresponder(message.guild.id);
      for (const t of triggers) {
        if (content.toLowerCase().includes(t.trigger.toLowerCase())) {
          return void message.reply({ embeds: [embed({ description: t.response, footer: "Auto response" })] }).catch(() => {});
        }
      }
    } catch (err) {
      console.error("[bot] automation handler error", err);
    }
  });

  // Welcome / goodbye messages
  client.on(Events.GuildMemberAdd, async (member) => {
    try {
      const cfg = getWelcome(member.guild.id);
      if (!cfg.channel_id) return;
      const channel = member.guild.channels.cache.get(cfg.channel_id);
      if (!channel?.isTextBased()) return;
      const text = cfg.message
        .replace(/\{user\}/g, `<@${member.id}>`)
        .replace(/\{username\}/g, member.user.username)
        .replace(/\{server\}/g, member.guild.name)
        .replace(/\{count\}/g, String(member.guild.memberCount));
      await channel.send({ embeds: [embed({ title: "👋 Welcome", description: text, color: COLORS.ok })] });
    } catch (err) {
      console.error("[bot] welcome error", err.message);
    }
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    try {
      const cfg = getWelcome(member.guild.id);
      if (!cfg.goodbye_channel_id) return;
      const channel = member.guild.channels.cache.get(cfg.goodbye_channel_id);
      if (!channel?.isTextBased()) return;
      const text = cfg.goodbye_message
        .replace(/\{user\}/g, `<@${member.id}>`)
        .replace(/\{username\}/g, member.user.username)
        .replace(/\{server\}/g, member.guild.name)
        .replace(/\{count\}/g, String(member.guild.memberCount));
      await channel.send({ embeds: [embed({ title: "😢 Goodbye", description: text, color: COLORS.warn })] });
    } catch (err) {
      console.error("[bot] goodbye error", err.message);
    }
  });

  // Reaction roles
  async function handleReaction(reaction, user, add) {
    try {
      if (user.bot) return;
      const message = reaction.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
      if (!message?.guild) return;
      const cfg = listReactionRoles(message.guild.id).find((r) => r.message_id === message.id && r.emoji === reaction.emoji.name);
      if (!cfg) return;
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return;
      const role = message.guild.roles.cache.get(cfg.role_id);
      if (!role) return;
      if (add) await member.roles.add(role).catch(() => {});
      else await member.roles.remove(role).catch(() => {});
    } catch (err) {
      console.error("[bot] reaction role error", err.message);
    }
  }
  client.on(Events.MessageReactionAdd, (reaction, user) => handleReaction(reaction, user, true));
  client.on(Events.MessageReactionRemove, (reaction, user) => handleReaction(reaction, user, false));

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
