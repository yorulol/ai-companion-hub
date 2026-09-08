/**
 * Admin command module for NOVA. 28 commands for guild configuration, channel/role
 * management, announcements, autorole/welcome, backups and a settings panel.
 * Destructive actions confirm() first; a couple are locked to the bot owner.
 */
import { ChannelType, PermissionsBitField } from "discord.js";
import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed,
  button, row, select, confirm, choose, prompt, paginate, listPages, codeBlock,
  EMOJI, COLORS,
} from "../ui.js";
import { saveGuild } from "../db.js";

export const commands = [];
const add = (c) => commands.push(c);

// module-level state (kept out of db.js schema)
const autoroleMap = new Map(); // guildId -> roleId
const welcomeCfg = new Map(); // guildId -> { channelId, message, goodbye }

function cfgOf(guildId) {
  const c = welcomeCfg.get(guildId) || { channelId: null, message: "Welcome {user} to {guild}!", goodbye: "{user} has left {guild}." };
  welcomeCfg.set(guildId, c);
  return c;
}
const render = (tpl, member, guild) => tpl.replaceAll("{user}", `${member}`).replaceAll("{guild}", guild.name);

// ============================= 1. prefix =============================
add({ name: "prefix", category: "admin", description: "Change the command prefix.", usage: "prefix <newPrefix>", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const p = args[0];
    if (!p || p.length > 5) return message.reply({ embeds: [errEmbed("Bad prefix", "Give a prefix up to 5 characters.")] });
    saveGuild(message.guild.id, { prefix: p });
    message.reply({ embeds: [okEmbed("Prefix updated", `New prefix: \`${p}\``)] });
  }});

// ============================= 2. aitoggle =============================
add({ name: "aitoggle", category: "admin", description: "Enable/disable AI replies.", usage: "aitoggle on|off", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const v = (args[0] || "").toLowerCase();
    if (!["on", "off"].includes(v)) return message.reply({ embeds: [errEmbed("Usage", "`aitoggle on|off`")] });
    saveGuild(message.guild.id, { aiReplies: v === "on" });
    message.reply({ embeds: [okEmbed("AI replies updated", `AI replies are now **${v}**.`)] });
  }});

// ============================= 3. modrole (add/remove) =============================
add({ name: "modrole", category: "admin", description: "Add/remove a moderator role.", usage: "modrole add|remove @role", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const mode = (args[0] || "").toLowerCase();
    const roleId = message.mentions.roles.first()?.id;
    if (!["add", "remove"].includes(mode) || !roleId) return message.reply({ embeds: [errEmbed("Usage", "`modrole add|remove @role`")] });
    const set = new Set(guildCfg.modRoles);
    mode === "add" ? set.add(roleId) : set.delete(roleId);
    const next = saveGuild(message.guild.id, { modRoles: [...set] });
    message.reply({ embeds: [okEmbed("Mod roles updated", next.modRoles.map((r) => `<@&${r}>`).join(" ") || "None set.")] });
  }});

// ============================= 4. adminrole (add/remove) =============================
add({ name: "adminrole", category: "admin", description: "Add/remove an admin role.", usage: "adminrole add|remove @role", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const mode = (args[0] || "").toLowerCase();
    const roleId = message.mentions.roles.first()?.id;
    if (!["add", "remove"].includes(mode) || !roleId) return message.reply({ embeds: [errEmbed("Usage", "`adminrole add|remove @role`")] });
    const set = new Set(guildCfg.adminRoles);
    mode === "add" ? set.add(roleId) : set.delete(roleId);
    const next = saveGuild(message.guild.id, { adminRoles: [...set] });
    message.reply({ embeds: [okEmbed("Admin roles updated", next.adminRoles.map((r) => `<@&${r}>`).join(" ") || "None set.")] });
  }});

// ============================= 5. viewconfig =============================
add({ name: "viewconfig", category: "admin", description: "View full guild config with toggle buttons.", usage: "viewconfig", permission: "admin",
  run: async ({ message, guildCfg }) => {
    const view = () => embed({
      title: `Config · ${message.guild.name}`, color: COLORS.brand,
      fields: [
        { name: "Prefix", value: `\`${guildCfg.prefix}\``, inline: true },
        { name: "AI replies", value: guildCfg.aiReplies ? "On" : "Off", inline: true },
        { name: "Mod roles", value: guildCfg.modRoles.map((r) => `<@&${r}>`).join(" ") || "None" },
        { name: "Admin roles", value: guildCfg.adminRoles.map((r) => `<@&${r}>`).join(" ") || "None" },
        { name: "Disabled commands", value: guildCfg.disabledCommands.join(", ") || "None" },
      ],
    });
    const sent = await message.reply({ embeds: [view()], components: [row(button({ id: "cfg:ai", label: guildCfg.aiReplies ? "Disable AI" : "Enable AI", style: "primary" }))] });
    const c = sent.createMessageComponentCollector({ time: 30_000, max: 5 });
    c.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not yours.", ephemeral: true }).catch(() => {});
      const g = saveGuild(message.guild.id, { aiReplies: !guildCfg.aiReplies });
      guildCfg.aiReplies = g.aiReplies;
      await int.update({ embeds: [view()], components: [row(button({ id: "cfg:ai", label: guildCfg.aiReplies ? "Disable AI" : "Enable AI", style: "primary" }))] });
    });
  }});

// ============================= 6. enablecmd =============================
add({ name: "enablecmd", category: "admin", description: "Re-enable a disabled command.", usage: "enablecmd <name>", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const name = (args[0] || "").toLowerCase();
    const next = saveGuild(message.guild.id, { disabledCommands: guildCfg.disabledCommands.filter((c) => c !== name) });
    message.reply({ embeds: [okEmbed("Command enabled", `\`${name}\` is now enabled.`)] });
  }});

// ============================= 7. disablecmd =============================
add({ name: "disablecmd", category: "admin", description: "Disable a command in this server.", usage: "disablecmd <name>", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const name = (args[0] || "").toLowerCase();
    if (!name) return message.reply({ embeds: [errEmbed("Missing name", "Give a command name.")] });
    const set = new Set(guildCfg.disabledCommands); set.add(name);
    saveGuild(message.guild.id, { disabledCommands: [...set] });
    message.reply({ embeds: [okEmbed("Command disabled", `\`${name}\` is now disabled here.`)] });
  }});

// ============================= 8. disabledlist =============================
add({ name: "disabledlist", category: "admin", description: "List disabled commands.", usage: "disabledlist", permission: "admin",
  run: async ({ message, guildCfg }) => message.reply({ embeds: [infoEmbed("Disabled commands", guildCfg.disabledCommands.map((c) => `\`${c}\``).join(", ") || "None disabled.")] }) });

// ============================= 9. announce =============================
add({ name: "announce", category: "admin", description: "Interactive announcement embed composer.", usage: "announce #channel", permission: "admin",
  run: async ({ message }) => {
    const channel = message.mentions.channels.first() || message.channel;
    const title = await prompt(message, { title: "Announcement title", description: "What's the title?" });
    if (title == null) return;
    const body = await prompt(message, { title: "Announcement body", description: "What's the message?" });
    if (body == null) return;
    const preview = embed({ title, description: body, color: COLORS.brand, footer: `Announced by ${message.author.tag}` });
    const ok = await confirm(message, { title: "Send announcement?", description: `Post this in ${channel}?`, danger: false });
    if (!ok) return;
    await channel.send({ embeds: [preview] });
    message.reply({ embeds: [okEmbed("Sent", `Announcement posted in ${channel}.`)] });
  }});

// ============================= 10. embedsend =============================
add({ name: "embedsend", category: "admin", description: "Send a custom embed.", usage: "embedsend #channel <title> | <description>", permission: "admin",
  run: async ({ message, args }) => {
    const channel = message.mentions.channels.first() || message.channel;
    const rest = args.filter((a) => !/^<#\d+>$/.test(a)).join(" ");
    const [title, description] = rest.split("|").map((s) => s?.trim());
    if (!title) return message.reply({ embeds: [errEmbed("Usage", "`embedsend #channel <title> | <description>`")] });
    await channel.send({ embeds: [embed({ title, description: description || "" })] });
    message.reply({ embeds: [okEmbed("Sent", `Embed posted in ${channel}.`)] });
  }});

// ============================= 11. dm =============================
add({ name: "dm", category: "admin", description: "DM a user as the bot.", usage: "dm @user <message>", permission: "admin", aliases: ["dm-a-user"],
  run: async ({ message, args }) => {
    const user = message.mentions.users.first();
    const text = args.slice(1).join(" ").trim();
    if (!user || !text) return message.reply({ embeds: [errEmbed("Usage", "`dm @user <message>`")] });
    const ok = await dmSafe(user, infoEmbed(`Message from ${message.guild.name} staff`, text));
    message.reply({ embeds: ok ? [okEmbed("Sent", `DM sent to ${user.tag}.`)] : [errEmbed("Failed", "Couldn't DM that user.")] });
  }});
async function dmSafe(user, e) { try { await user.send({ embeds: [e] }); return true; } catch { return false; } }

// ============================= 12. say =============================
add({ name: "say", category: "admin", description: "Make the bot say something in a channel.", usage: "say #channel <text>", permission: "admin",
  run: async ({ message, args }) => {
    const channel = message.mentions.channels.first() || message.channel;
    const text = args.filter((a) => !/^<#\d+>$/.test(a)).join(" ").trim();
    if (!text) return message.reply({ embeds: [errEmbed("Missing text", "Give a message to say.")] });
    await channel.send(text);
    if (channel.id !== message.channel.id) message.reply({ embeds: [okEmbed("Sent", `Message posted in ${channel}.`)] });
  }});

// ============================= 13. editmsg =============================
add({ name: "editmsg", category: "admin", description: "Edit a message the bot previously sent.", usage: "editmsg <messageId> <new text>", permission: "admin",
  run: async ({ message, args }) => {
    const id = args[0];
    const text = args.slice(1).join(" ").trim();
    if (!id || !text) return message.reply({ embeds: [errEmbed("Usage", "`editmsg <messageId> <new text>`")] });
    const target = await message.channel.messages.fetch(id).catch(() => null);
    if (!target || target.author.id !== message.client.user.id) return message.reply({ embeds: [errEmbed("Not found", "That's not a message I sent in this channel.")] });
    await target.edit(text);
    message.reply({ embeds: [okEmbed("Edited", "Message updated.")] });
  }});

// ============================= 14. createchannel =============================
add({ name: "createchannel", category: "admin", description: "Create a text channel.", usage: "createchannel <name> [category]", permission: "admin",
  run: async ({ message, args }) => {
    const name = args[0];
    if (!name) return message.reply({ embeds: [errEmbed("Missing name", "Give a channel name.")] });
    const parent = message.guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === args.slice(1).join(" ").toLowerCase());
    const ch = await message.guild.channels.create({ name, type: ChannelType.GuildText, parent: parent?.id });
    message.reply({ embeds: [okEmbed("Channel created", `${ch} created.`)] });
  }});

// ============================= 15. deletechannel =============================
add({ name: "deletechannel", category: "admin", description: "Delete a channel.", usage: "deletechannel [#channel]", permission: "admin",
  run: async ({ message }) => {
    const ch = message.mentions.channels.first() || message.channel;
    const ok = await confirm(message, { title: "Delete channel?", description: `Delete ${ch}? This cannot be undone.` });
    if (!ok) return;
    await ch.delete(`Deleted by ${message.author.tag}`).catch(() => {});
  }});

// ============================= 16. clonechannel =============================
add({ name: "clonechannel", category: "admin", description: "Clone a channel's settings.", usage: "clonechannel [#channel]", permission: "admin",
  run: async ({ message }) => {
    const ch = message.mentions.channels.first() || message.channel;
    const clone = await ch.clone({ name: `${ch.name}-copy` });
    message.reply({ embeds: [okEmbed("Cloned", `Created ${clone}.`)] });
  }});

// ============================= 17. createrole =============================
add({ name: "createrole", category: "admin", description: "Create a role.", usage: "createrole <name> [#hexcolor]", permission: "admin",
  run: async ({ message, args }) => {
    const name = args[0];
    if (!name) return message.reply({ embeds: [errEmbed("Missing name", "Give a role name.")] });
    const color = args[1] && /^#?[0-9a-f]{6}$/i.test(args[1]) ? args[1] : undefined;
    const r = await message.guild.roles.create({ name, color });
    message.reply({ embeds: [okEmbed("Role created", `${r} created.`)] });
  }});

// ============================= 18. deleterole =============================
add({ name: "deleterole", category: "admin", description: "Delete a role.", usage: "deleterole @role", permission: "admin",
  run: async ({ message }) => {
    const r = message.mentions.roles.first();
    if (!r) return message.reply({ embeds: [errEmbed("Missing role", "Mention a role to delete.")] });
    const ok = await confirm(message, { title: "Delete role?", description: `Delete ${r}? This cannot be undone.` });
    if (!ok) return;
    await r.delete(`Deleted by ${message.author.tag}`).catch(() => {});
  }});

// ============================= 19. editrole =============================
add({ name: "editrole", category: "admin", description: "Edit a role's colour or name.", usage: "editrole @role color #hex | editrole @role name <new>", permission: "admin",
  run: async ({ message, args }) => {
    const r = message.mentions.roles.first();
    const mode = (args[0] || "").toLowerCase();
    if (!r || !["color", "colour", "name"].includes(mode)) return message.reply({ embeds: [errEmbed("Usage", "`editrole @role color #hex` or `editrole @role name <new>`")] });
    if (mode === "name") {
      const name = args.slice(1).join(" ").trim();
      if (!name) return message.reply({ embeds: [errEmbed("Missing name", "Give a new name.")] });
      await r.setName(name);
    } else {
      const hex = args[1];
      if (!hex || !/^#?[0-9a-f]{6}$/i.test(hex)) return message.reply({ embeds: [errEmbed("Bad colour", "Give a hex colour like `#a855f7`.")] });
      await r.setColor(hex);
    }
    message.reply({ embeds: [okEmbed("Role updated", `${r} updated.`)] });
  }});

// ============================= 20. createcategory =============================
add({ name: "createcategory", category: "admin", description: "Create a category.", usage: "createcategory <name>", permission: "admin",
  run: async ({ message, args }) => {
    const name = args.join(" ");
    if (!name) return message.reply({ embeds: [errEmbed("Missing name", "Give a category name.")] });
    const cat = await message.guild.channels.create({ name, type: ChannelType.GuildCategory });
    message.reply({ embeds: [okEmbed("Category created", `**${cat.name}** created.`)] });
  }});

// ============================= 21. slowmodeall =============================
add({ name: "slowmodeall", category: "admin", description: "Set slowmode on every text channel.", usage: "slowmodeall <seconds>", permission: "admin",
  run: async ({ message, args }) => {
    const secs = Math.max(0, Math.min(21600, Number(args[0]) || 0));
    const ok = await confirm(message, { title: "Apply slowmode server-wide?", description: `Set ${secs}s slowmode on every text channel?`, danger: false });
    if (!ok) return;
    const channels = message.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
    for (const ch of channels.values()) await ch.setRateLimitPerUser(secs).catch(() => {});
    message.channel.send({ embeds: [okEmbed("Slowmode applied", `${secs}s set on ${channels.size} channels.`)] });
  }});

// ============================= 22. autorole =============================
add({ name: "autorole", category: "admin", description: "Set or clear the auto-assigned join role.", usage: "autorole set @role | autorole clear", permission: "admin",
  run: async ({ message, args }) => {
    const mode = (args[0] || "").toLowerCase();
    if (mode === "clear") { autoroleMap.delete(message.guild.id); return message.reply({ embeds: [okEmbed("Autorole cleared", "New members won't be auto-assigned a role.")] }); }
    const r = message.mentions.roles.first();
    if (mode !== "set" || !r) return message.reply({ embeds: [errEmbed("Usage", "`autorole set @role` or `autorole clear`")] });
    autoroleMap.set(message.guild.id, r.id);
    message.reply({ embeds: [okEmbed("Autorole set", `New members will receive ${r}.`)] });
  }});
export const getAutorole = (guildId) => autoroleMap.get(guildId) || null;

// ============================= 23. welcome =============================
add({ name: "welcome", category: "admin", description: "Configure welcome/goodbye messages.", usage: "welcome channel #chan | welcome message <text> | welcome goodbye <text> | welcome preview", permission: "admin",
  run: async ({ message, args }) => {
    const mode = (args[0] || "").toLowerCase();
    const c = cfgOf(message.guild.id);
    if (mode === "channel") {
      const ch = message.mentions.channels.first();
      if (!ch) return message.reply({ embeds: [errEmbed("Missing channel", "Mention a channel.")] });
      c.channelId = ch.id;
      return message.reply({ embeds: [okEmbed("Welcome channel set", `Set to ${ch}.`)] });
    }
    if (mode === "message") {
      const text = args.slice(1).join(" ").trim();
      if (!text) return message.reply({ embeds: [errEmbed("Missing text", "Use `{user}` and `{guild}` placeholders.")] });
      c.message = text;
      return message.reply({ embeds: [okEmbed("Welcome message set", "Updated.")] });
    }
    if (mode === "goodbye") {
      const text = args.slice(1).join(" ").trim();
      if (!text) return message.reply({ embeds: [errEmbed("Missing text", "Use `{user}` and `{guild}` placeholders.")] });
      c.goodbye = text;
      return message.reply({ embeds: [okEmbed("Goodbye message set", "Updated.")] });
    }
    if (mode === "preview") {
      return message.reply({ embeds: [
        infoEmbed("Welcome preview", render(c.message, message.member, message.guild)),
        infoEmbed("Goodbye preview", render(c.goodbye, message.member, message.guild)),
      ] });
    }
    message.reply({ embeds: [errEmbed("Usage", "`welcome channel|message|goodbye|preview`")] });
  }});
export const getWelcomeCfg = cfgOf;

// ============================= 24. logchannel =============================
const logChannelMap = new Map();
add({ name: "logchannel", category: "admin", description: "Set the moderation log channel.", usage: "logchannel #channel", permission: "admin",
  run: async ({ message }) => {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply({ embeds: [errEmbed("Missing channel", "Mention a channel.")] });
    logChannelMap.set(message.guild.id, ch.id);
    message.reply({ embeds: [okEmbed("Log channel set", `Set to ${ch}.`)] });
  }});
export const getLogChannel = (guildId) => logChannelMap.get(guildId) || null;

// ============================= 25. serversetup =============================
add({ name: "serversetup", category: "admin", description: "Wizard to create a starter channel/role set.", usage: "serversetup", permission: "admin",
  run: async ({ message }) => {
    const template = await choose(message, { title: "Server setup", description: "Pick a starter template.", options: [
      { label: "Community basics", value: "community" },
      { label: "Gaming clan", value: "gaming" },
    ] });
    if (!template) return;
    const name = await prompt(message, { title: "Category name", description: "What should the main category be called?" });
    if (!name) return;
    const ok = await confirm(message, { title: "Run setup?", description: `Create category **${name}** with starter channels & roles?` });
    if (!ok) return;
    const cat = await message.guild.channels.create({ name, type: ChannelType.GuildCategory });
    const chanNames = template === "gaming" ? ["general", "lfg", "voice-chat"] : ["general", "announcements", "introductions"];
    for (const n of chanNames) {
      await message.guild.channels.create({ name: n, type: n.includes("voice") ? ChannelType.GuildVoice : ChannelType.GuildText, parent: cat.id }).catch(() => {});
    }
    await message.guild.roles.create({ name: template === "gaming" ? "Clan Member" : "Member", color: "#a855f7" }).catch(() => {});
    message.channel.send({ embeds: [okEmbed("Setup complete", `Created **${name}** with starter channels and a role.`)] });
  }});

// ============================= 26. nuke (owner) =============================
add({ name: "nuke", category: "admin", description: "Delete and recreate the current channel.", usage: "nuke", permission: "owner",
  run: async ({ message }) => {
    const ch = message.channel;
    const ok = await confirm(message, { title: "Nuke this channel?", description: "This deletes and recreates the channel, wiping all history." });
    if (!ok) return;
    const clone = await ch.clone();
    await clone.setPosition(ch.position).catch(() => {});
    await ch.delete().catch(() => {});
    clone.send({ embeds: [okEmbed("Channel nuked", "This channel has been reset.")] });
  }});

// ============================= 27. config (backup/restore) =============================
add({ name: "config", category: "admin", description: "Backup or restore guild config as JSON.", usage: "config backup | config restore", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const mode = (args[0] || "").toLowerCase();
    if (mode === "backup") {
      const data = { prefix: guildCfg.prefix, aiReplies: guildCfg.aiReplies, modRoles: guildCfg.modRoles, adminRoles: guildCfg.adminRoles, disabledCommands: guildCfg.disabledCommands };
      return message.reply({ embeds: [infoEmbed("Config backup", codeBlock(JSON.stringify(data, null, 2), "json"))] });
    }
    if (mode === "restore") {
      const text = await prompt(message, { title: "Paste config JSON", description: "Paste the JSON backup to restore." });
      if (!text) return;
      let parsed;
      try { parsed = JSON.parse(text); } catch { return message.reply({ embeds: [errEmbed("Invalid JSON", "Couldn't parse that.")] }); }
      const ok = await confirm(message, { title: "Restore config?", description: "This overwrites the current guild config." });
      if (!ok) return;
      saveGuild(message.guild.id, parsed);
      return message.reply({ embeds: [okEmbed("Restored", "Config restored from backup.")] });
    }
    message.reply({ embeds: [errEmbed("Usage", "`config backup` or `config restore`")] });
  }});

// ============================= 28. settings (paginated panel) =============================
add({ name: "settings", category: "admin", description: "Paginated settings overview with menu navigation.", usage: "settings", permission: "admin",
  run: async ({ message, guildCfg }) => {
    const pages = {
      general: embed({ title: "General", fields: [
        { name: "Prefix", value: `\`${guildCfg.prefix}\``, inline: true },
        { name: "AI replies", value: guildCfg.aiReplies ? "On" : "Off", inline: true },
      ] }),
      roles: embed({ title: "Roles", fields: [
        { name: "Mod roles", value: guildCfg.modRoles.map((r) => `<@&${r}>`).join(" ") || "None" },
        { name: "Admin roles", value: guildCfg.adminRoles.map((r) => `<@&${r}>`).join(" ") || "None" },
      ] }),
      commands: embed({ title: "Commands", fields: [
        { name: "Disabled", value: guildCfg.disabledCommands.join(", ") || "None" },
      ] }),
      welcome: embed({ title: "Welcome", fields: [
        { name: "Channel", value: cfgOf(message.guild.id).channelId ? `<#${cfgOf(message.guild.id).channelId}>` : "Not set" },
        { name: "Message", value: cfgOf(message.guild.id).message },
      ] }),
    };
    const menu = select({ id: "settings:nav", placeholder: "Jump to section", options: [
      { label: "General", value: "general" }, { label: "Roles", value: "roles" },
      { label: "Commands", value: "commands" }, { label: "Welcome", value: "welcome" },
    ] });
    const sent = await message.reply({ embeds: [pages.general], components: [row(menu)] });
    const c = sent.createMessageComponentCollector({ time: 60_000 });
    c.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not yours.", ephemeral: true }).catch(() => {});
      await int.update({ embeds: [pages[int.values[0]]] });
    });
    c.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  }});
