import os from "node:os";
import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed,
  button, row, select, bar, listPages, paginate, choose,
  fmt, ago, COLORS, targetMember,
} from "../ui.js";

export const commands = [];
const add = (c) => commands.push(c);

// ================= HELP =================
add({ name: "help", category: "info", description: "Interactive command browser.", usage: "help", permission: "everyone",
  run: async ({ message, guildCfg, isOwner }) => {
    const { COMMANDS } = await import("../commands.js").catch(() => ({ COMMANDS: [] }));
    const { isOwnerId } = await import("../config.js");
    const owner = isOwner || isOwnerId(message.author.id);
    const all = (COMMANDS.length ? COMMANDS : []).filter(
      (c) => owner || (c.category !== "owner" && c.permission !== "owner"),
    );
    const cats = [...new Set(all.map((c) => c.category))];
    if (!cats.length) return message.reply({ embeds: [warnEmbed("No commands loaded", "Command registry is empty.")] });

    const menu = select({ id: "help:cat", placeholder: "Choose a category…", options: cats.map((c) => ({ label: c, value: c })) });
    const intro = embed({ title: "🧭 YORU help", description: `Prefix: \`${guildCfg?.prefix ?? "!"}\`\n${all.length} commands across ${cats.length} categories.\nPick a category below to browse.` });
    const sent = await message.reply({ embeds: [intro], components: [row(menu)] });

    let pages = [];
    let i = 0;
    const nav = () => row(
      button({ id: "help:first", emoji: "⏮️", disabled: i === 0 }),
      button({ id: "help:prev", emoji: "◀️", disabled: i === 0 }),
      button({ id: "help:page", label: `${i + 1}/${pages.length}`, style: "primary", disabled: true }),
      button({ id: "help:next", emoji: "▶️", disabled: i >= pages.length - 1 }),
      button({ id: "help:home", emoji: "🏠", style: "secondary" }),
    );
    const view = () => (pages.length > 1 ? [row(menu), nav()] : [row(menu)]);

    const collector = sent.createMessageComponentCollector({ time: 300_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your menu.", ephemeral: true }).catch(() => {});
      if (int.isStringSelectMenu()) {
        const cat = int.values[0];
        const list = all.filter((c) => c.category === cat);
        pages = listPages(list.map((c) => `\`${c.usage || c.name}\` — ${c.description}`), { title: `📂 ${cat} (${list.length})` });
        i = 0;
        return void int.update({ embeds: [pages[0]], components: view() }).catch(() => {});
      }
      if (int.customId === "help:home") {
        pages = []; i = 0;
        return void int.update({ embeds: [intro], components: [row(menu)] }).catch(() => {});
      }
      if (!pages.length) return void int.deferUpdate().catch(() => {});
      if (int.customId === "help:first") i = 0;
      if (int.customId === "help:prev") i = Math.max(0, i - 1);
      if (int.customId === "help:next") i = Math.min(pages.length - 1, i + 1);
      await int.update({ embeds: [pages[i]], components: view() }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });


add({ name: "commands", category: "info", description: "Show a command count breakdown by category.", usage: "commands", permission: "everyone",
  run: async ({ message }) => {
    const { COMMANDS } = await import("../commands.js").catch(() => ({ COMMANDS: [] }));
    const grouped = COMMANDS.reduce((a, c) => { (a[c.category] ||= 0); a[c.category]++; return a; }, {});
    const fields = Object.entries(grouped).map(([cat, n]) => ({ name: cat, value: `${n} commands`, inline: true }));
    message.reply({ embeds: [embed({ title: `📊 Command breakdown (${COMMANDS.length} total)`, fields })] });
  } });

// ================= PING =================
add({ name: "ping", category: "info", description: "Show bot latency with a gauge and refresh button.", usage: "ping", permission: "everyone",
  run: async ({ message, client }) => {
    const build = () => {
      const ws = Math.round(client.ws.ping);
      const rating = ws < 100 ? "Excellent" : ws < 200 ? "Good" : ws < 400 ? "Okay" : "Poor";
      return embed({ title: "🏓 Pong!", fields: [{ name: "WebSocket", value: `${ws}ms — ${bar(Math.max(0, 500 - ws), 500)}` }, { name: "Rating", value: rating }] });
    };
    const btn = row(button({ id: "ping:refresh", label: "Refresh", style: "primary", emoji: "🔄" }));
    const sent = await message.reply({ embeds: [build()], components: [btn] });
    const collector = sent.createMessageComponentCollector({ time: 60_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not yours.", ephemeral: true }).catch(() => {});
      await int.update({ embeds: [build()] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

add({ name: "botinfo", category: "info", description: "Show bot statistics.", usage: "botinfo", permission: "everyone",
  run: async ({ message, client }) => {
    const uptimeS = Math.floor(process.uptime());
    const mem = process.memoryUsage();
    message.reply({ embeds: [embed({
      title: "🤖 YORU bot info",
      thumbnail: client.user.displayAvatarURL(),
      fields: [
        { name: "Uptime", value: `${Math.floor(uptimeS / 3600)}h ${Math.floor((uptimeS % 3600) / 60)}m ${uptimeS % 60}s`, inline: true },
        { name: "Memory", value: `${(mem.rss / 1024 / 1024).toFixed(1)} MB`, inline: true },
        { name: "Node.js", value: process.version, inline: true },
        { name: "Guilds", value: fmt(client.guilds.cache.size), inline: true },
        { name: "Users", value: fmt(client.guilds.cache.reduce((a, g) => a + g.memberCount, 0)), inline: true },
        { name: "Platform", value: `${os.type()} ${os.arch()}`, inline: true },
      ],
    })] });
  } });

add({ name: "uptime", category: "info", description: "Show how long the bot has been running.", usage: "uptime", permission: "everyone",
  run: async ({ message }) => {
    const s = Math.floor(process.uptime());
    message.reply({ embeds: [okEmbed("⏱️ Uptime", `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h ${Math.floor((s % 3600) / 60)}m ${s % 60}s`)] });
  } });

// ================= SERVER =================
add({ name: "serverinfo", category: "info", description: "Show detailed server information.", usage: "serverinfo", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g) return message.reply({ embeds: [warnEmbed("Server only", "This command only works in a server.")] });
    await g.fetch().catch(() => {});
    message.reply({ embeds: [embed({
      title: g.name,
      thumbnail: g.iconURL({ size: 256 }),
      image: g.bannerURL({ size: 1024 }) || undefined,
      fields: [
        { name: "Owner", value: `<@${g.ownerId}>`, inline: true },
        { name: "Members", value: fmt(g.memberCount), inline: true },
        { name: "Boost tier", value: `Level ${g.premiumTier} (${g.premiumSubscriptionCount || 0} boosts)`, inline: true },
        { name: "Channels", value: fmt(g.channels.cache.size), inline: true },
        { name: "Roles", value: fmt(g.roles.cache.size), inline: true },
        { name: "Emojis", value: fmt(g.emojis.cache.size), inline: true },
        { name: "Verification", value: `${g.verificationLevel}`, inline: true },
        { name: "Created", value: ago(g.createdTimestamp), inline: true },
      ],
    })] });
  } });

add({ name: "serverstats", category: "info", description: "Summary card of server statistics.", usage: "serverstats", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g) return message.reply({ embeds: [warnEmbed("Server only", "This command only works in a server.")] });
    const humans = g.members.cache.filter((m) => !m.user.bot).size;
    const bots = g.members.cache.filter((m) => m.user.bot).size;
    message.reply({ embeds: [embed({
      title: `📈 ${g.name} — stats`,
      fields: [
        { name: "Total members", value: fmt(g.memberCount), inline: true },
        { name: "Humans (cached)", value: fmt(humans), inline: true },
        { name: "Bots (cached)", value: fmt(bots), inline: true },
        { name: "Text channels", value: fmt(g.channels.cache.filter((c) => c.type === 0).size), inline: true },
        { name: "Voice channels", value: fmt(g.channels.cache.filter((c) => c.type === 2).size), inline: true },
        { name: "Roles", value: fmt(g.roles.cache.size), inline: true },
      ],
    })] });
  } });

add({ name: "servericon", category: "info", description: "Show the server icon.", usage: "servericon", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g?.iconURL()) return message.reply({ embeds: [warnEmbed("No icon", "This server has no icon set.")] });
    message.reply({ embeds: [embed({ title: `${g.name}'s icon`, image: g.iconURL({ size: 1024 }) })] });
  } });

add({ name: "serverbanner", category: "info", description: "Show the server banner.", usage: "serverbanner", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g?.bannerURL()) return message.reply({ embeds: [warnEmbed("No banner", "This server has no banner set.")] });
    message.reply({ embeds: [embed({ title: `${g.name}'s banner`, image: g.bannerURL({ size: 1024 }) })] });
  } });

// ================= USER =================
add({ name: "userinfo", category: "info", description: "Show information about a user.", usage: "userinfo [@user]", permission: "everyone", aliases: ["whois"],
  run: async ({ message }) => {
    const member = message.mentions.members?.first() || message.member;
    const user = member?.user || message.author;
    const badges = user.flags?.toArray?.() || [];
    message.reply({ embeds: [embed({
      title: user.tag,
      thumbnail: user.displayAvatarURL({ size: 256 }),
      fields: [
        { name: "ID", value: user.id, inline: true },
        { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
        { name: "Badges", value: badges.length ? badges.join(", ") : "None", inline: true },
        { name: "Account created", value: ago(user.createdTimestamp), inline: true },
        ...(member ? [
          { name: "Joined server", value: ago(member.joinedTimestamp), inline: true },
          { name: "Roles", value: member.roles.cache.filter((r) => r.id !== message.guild.id).map((r) => r.toString()).slice(0, 15).join(" ") || "None" },
        ] : []),
      ],
    })] });
  } });

add({ name: "avatar", category: "info", description: "Show a user's avatar with server/global toggle.", usage: "avatar [@user]", permission: "everyone",
  run: async ({ message }) => {
    const member = message.mentions.members?.first();
    const user = member?.user || message.author;
    const global = user.displayAvatarURL({ size: 1024 });
    const serverAvatar = member?.avatarURL({ size: 1024 });
    const build = (url, label) => embed({ title: `${user.tag}'s avatar (${label})`, image: url });
    const buttons = row(
      button({ id: "av:global", label: "Global", style: "primary" }),
      button({ id: "av:server", label: "Server", style: "secondary", disabled: !serverAvatar }),
    );
    const sent = await message.reply({ embeds: [build(global, "global")], components: serverAvatar ? [buttons] : [] });
    if (!serverAvatar) return;
    const collector = sent.createMessageComponentCollector({ time: 60_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not yours.", ephemeral: true }).catch(() => {});
      const url = int.customId === "av:server" ? serverAvatar : global;
      await int.update({ embeds: [build(url, int.customId === "av:server" ? "server" : "global")] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

add({ name: "banner", category: "info", description: "Show a user's profile banner.", usage: "banner [@user]", permission: "everyone",
  run: async ({ message }) => {
    const target = message.mentions.users.first() || message.author;
    try {
      const fetched = await message.client.users.fetch(target.id, { force: true });
      const url = fetched.bannerURL({ size: 1024 });
      if (!url) return message.reply({ embeds: [warnEmbed("No banner", `${fetched.tag} has no profile banner set.`)] });
      message.reply({ embeds: [embed({ title: `${fetched.tag}'s banner`, image: url })] });
    } catch { message.reply({ embeds: [errEmbed("Failed", "Could not fetch that user.")] }); }
  } });

add({ name: "memberscount", category: "info", description: "Show a breakdown of member counts.", usage: "memberscount", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g) return message.reply({ embeds: [warnEmbed("Server only", "This command only works in a server.")] });
    const online = g.members.cache.filter((m) => m.presence?.status && m.presence.status !== "offline").size;
    const bots = g.members.cache.filter((m) => m.user.bot).size;
    message.reply({ embeds: [embed({
      title: "👥 Member count",
      fields: [
        { name: "Total", value: fmt(g.memberCount), inline: true },
        { name: "Online (cached)", value: fmt(online), inline: true },
        { name: "Bots (cached)", value: fmt(bots), inline: true },
      ],
    })] });
  } });

add({ name: "boosters", category: "info", description: "List the server's boosters.", usage: "boosters", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    const boosters = g?.members.cache.filter((m) => m.premiumSince).sort((a, b) => a.premiumSince - b.premiumSince);
    if (!boosters?.size) return message.reply({ embeds: [infoEmbed("No boosters", "This server has no boosters yet.")] });
    const pages = listPages(boosters.map((m) => `${m.user.tag} — boosting ${ago(m.premiumSinceTimestamp)}`), { title: `💎 Boosters (${boosters.size})` });
    paginate(message, pages);
  } });

add({ name: "oldestmembers", category: "info", description: "List the longest-standing members.", usage: "oldestmembers", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g) return message.reply({ embeds: [warnEmbed("Server only", "This command only works in a server.")] });
    const sorted = [...g.members.cache.values()].sort((a, b) => a.joinedTimestamp - b.joinedTimestamp).slice(0, 50);
    const pages = listPages(sorted.map((m, i) => `**${i + 1}.** ${m.user.tag} — joined ${ago(m.joinedTimestamp)}`), { title: "🕰️ Oldest members" });
    paginate(message, pages);
  } });

add({ name: "invites", category: "info", description: "List active server invites.", usage: "invites", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g) return message.reply({ embeds: [warnEmbed("Server only", "This command only works in a server.")] });
    try {
      const invites = await g.invites.fetch();
      if (!invites.size) return message.reply({ embeds: [infoEmbed("No invites", "This server has no active invites.")] });
      const pages = listPages([...invites.values()].map((i) => `\`${i.code}\` — ${i.uses ?? 0} uses — by ${i.inviter?.tag ?? "unknown"}`), { title: "📨 Active invites" });
      paginate(message, pages);
    } catch { message.reply({ embeds: [errEmbed("Missing permissions", "I need `Manage Guild` to view invites.")] }); }
  } });

// ================= ROLES / CHANNELS / EMOJIS =================
add({ name: "roleinfo", category: "info", description: "Show information about a role.", usage: "roleinfo <@role|name>", permission: "everyone",
  run: async ({ message, args }) => {
    const role = message.mentions.roles.first() || message.guild?.roles.cache.find((r) => r.name.toLowerCase() === args.join(" ").toLowerCase());
    if (!role) return message.reply({ embeds: [warnEmbed("Usage", "`roleinfo @role` or `roleinfo <role name>`")] });
    const perms = role.permissions.toArray();
    message.reply({ embeds: [embed({
      title: `Role: ${role.name}`,
      color: role.color || COLORS.brand,
      fields: [
        { name: "ID", value: role.id, inline: true },
        { name: "Colour", value: `#${role.color.toString(16).padStart(6, "0")}`, inline: true },
        { name: "Members", value: fmt(role.members.size), inline: true },
        { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
        { name: "Hoisted", value: role.hoist ? "Yes" : "No", inline: true },
        { name: "Created", value: ago(role.createdTimestamp), inline: true },
        { name: "Key permissions", value: perms.length ? perms.slice(0, 15).join(", ") : "None" },
      ],
    })] });
  } });

add({ name: "rolelist", category: "info", description: "List all server roles, paginated.", usage: "rolelist", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g) return message.reply({ embeds: [warnEmbed("Server only", "This command only works in a server.")] });
    const roles = [...g.roles.cache.values()].sort((a, b) => b.position - a.position);
    const pages = listPages(roles.map((r) => `${r.toString()} — ${fmt(r.members.size)} members`), { title: `🎭 Roles (${roles.length})` });
    paginate(message, pages);
  } });

add({ name: "channelinfo", category: "info", description: "Show information about a channel.", usage: "channelinfo [#channel]", permission: "everyone",
  run: async ({ message }) => {
    const ch = message.mentions.channels.first() || message.channel;
    message.reply({ embeds: [embed({
      title: `#${ch.name ?? ch.id}`,
      fields: [
        { name: "ID", value: ch.id, inline: true },
        { name: "Type", value: `${ch.type}`, inline: true },
        { name: "Created", value: ago(ch.createdTimestamp), inline: true },
        { name: "Topic", value: ch.topic || "None" },
      ],
    })] });
  } });

add({ name: "channellist", category: "info", description: "List all server channels, paginated.", usage: "channellist", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g) return message.reply({ embeds: [warnEmbed("Server only", "This command only works in a server.")] });
    const chans = [...g.channels.cache.values()].sort((a, b) => a.position - b.position);
    const pages = listPages(chans.map((c) => `${c.toString?.() ?? c.name} (${c.type})`), { title: `📺 Channels (${chans.length})` });
    paginate(message, pages);
  } });

add({ name: "firstmessage", category: "info", description: "Get a link to the first message in this channel.", usage: "firstmessage", permission: "everyone",
  run: async ({ message }) => {
    try {
      const fetched = await message.channel.messages.fetch({ after: "0", limit: 1 });
      const first = fetched.first();
      if (!first) return message.reply({ embeds: [infoEmbed("Not found", "Couldn't locate the first message.")] });
      message.reply({ embeds: [embed({ title: "📜 First message", description: `[Jump to message](${first.url})`, fields: [{ name: "Author", value: first.author.tag }, { name: "Sent", value: ago(first.createdTimestamp) }] })] });
    } catch { message.reply({ embeds: [errEmbed("Failed", "Could not fetch the first message.")] }); }
  } });

add({ name: "emojilist", category: "info", description: "List all custom server emojis, paginated.", usage: "emojilist", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g?.emojis.cache.size) return message.reply({ embeds: [infoEmbed("No emojis", "This server has no custom emojis.")] });
    const pages = listPages([...g.emojis.cache.values()].map((e) => `${e.toString()} \`:${e.name}:\``), { title: `😀 Emojis (${g.emojis.cache.size})` });
    paginate(message, pages);
  } });

add({ name: "stickerlist", category: "info", description: "List all server stickers.", usage: "stickerlist", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    if (!g?.stickers.cache.size) return message.reply({ embeds: [infoEmbed("No stickers", "This server has no stickers.")] });
    const pages = listPages([...g.stickers.cache.values()].map((s) => `**${s.name}** — ${s.description || "no description"}`), { title: `🏷️ Stickers (${g.stickers.cache.size})` });
    paginate(message, pages);
  } });

// ================= PERMISSIONS =================
const PERM_CATEGORIES = {
  General: ["Administrator", "ManageGuild", "ManageChannels", "ManageRoles", "ViewAuditLog", "ManageWebhooks", "ManageEmojisAndStickers"],
  Membership: ["KickMembers", "BanMembers", "ModerateMembers", "CreateInstantInvite", "ChangeNickname", "ManageNicknames"],
  Text: ["SendMessages", "ManageMessages", "EmbedLinks", "AttachFiles", "MentionEveryone", "AddReactions", "UseExternalEmojis"],
  Voice: ["Connect", "Speak", "MuteMembers", "DeafenMembers", "MoveMembers", "UseVAD", "Stream"],
};
add({ name: "permissions", category: "info", description: "View a member's permissions by category.", usage: "permissions [@user]", permission: "everyone",
  run: async ({ message }) => {
    const member = message.mentions.members?.first() || message.member;
    if (!member) return message.reply({ embeds: [warnEmbed("Not found", "Could not resolve that member.")] });
    const options = Object.keys(PERM_CATEGORIES).map((c) => ({ label: c, value: c }));
    const value = await choose(message, { title: `Permissions for ${member.user.tag}`, description: "Pick a category to inspect.", options });
    if (!value) return;
    const has = PERM_CATEGORIES[value].map((p) => `${member.permissions.has(p) ? "✅" : "❌"} ${p}`);
    message.channel.send({ embeds: [embed({ title: `🔑 ${value} permissions — ${member.user.tag}`, description: has.join("\n") })] });
  } });

// ================= SUPPORT / ABOUT =================
add({ name: "support", category: "info", description: "Get support links.", usage: "support", permission: "everyone", aliases: ["links"],
  run: async ({ message, client }) => {
    const links = row(
      button({ id: "invite-link", label: "Invite YORU", style: "link", url: `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=8`, emoji: "➕" }),
      button({ id: "github-link", label: "GitHub", style: "link", url: "https://github.com" }),
    );
    message.reply({ embeds: [embed({ title: "🛟 Support & links", description: "Need help or want to invite YORU elsewhere? Use the buttons below." })], components: [links] });
  } });

add({ name: "about", category: "info", description: "Learn about YORU.", usage: "about", permission: "everyone",
  run: async ({ message, client }) => {
    const links = row(
      button({ id: "about-invite", label: "Invite", style: "link", url: `https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=8`, emoji: "➕" }),
      button({ id: "about-github", label: "GitHub", style: "link", url: "https://github.com" }),
    );
    message.reply({ embeds: [embed({
      title: "✨ YORU",
      description: "YORU is a self-hosted, AI-powered Discord agent — moderation, economy, levels, utilities and a conversational AI brain, all in one bot.",
      thumbnail: client.user.displayAvatarURL(),
      fields: [{ name: "Servers", value: fmt(client.guilds.cache.size), inline: true }, { name: "Node.js", value: process.version, inline: true }],
    })], components: [links] });
  } });

// ================= AI PROVIDER STATUS =================
add({ name: "providers", category: "info", description: "Show which AI providers are online and how many OpenRouter free models are loaded.", usage: "providers", permission: "everyone", aliases: ["aistatus", "models"],
  run: async ({ message }) => {
    const { providerStatus } = await import("../ai.js");
    const s = await providerStatus();
    const status = (ok) => ok ? "🟢 online" : "🔴 offline";
    message.reply({ embeds: [embed({
      title: "🧠 AI provider status",
      fields: [
        { name: "Preferred", value: s.preferred || "—", inline: true },
        { name: "OpenRouter", value: `${status(s.openrouter)} · ${s.freeModels} free models`, inline: true },
        { name: "Ollama", value: status(s.ollama), inline: true },
        { name: "OpenAI", value: status(s.openai), inline: true },
        { name: "Anthropic", value: status(s.anthropic), inline: true },
        { name: "Groq", value: status(s.groq), inline: true },
        { name: "OpenClaw", value: status(s.openclaw), inline: true },
      ],
    })] });
  } });

// ================= POLL =================
add({ name: "poll", category: "info", description: "Create a reaction poll with up to 10 options.", usage: "poll \"Question\" \"Option 1\" \"Option 2\" ...", permission: "everyone",
  run: async ({ message, args }) => {
    const parsed = args.join(" ").match(/"([^"]+)"/g);
    const items = parsed ? parsed.map((x) => x.replace(/"/g, "")) : [];
    if (items.length < 2) return message.reply({ embeds: [warnEmbed("Usage", "`!poll \"Question\" \"Option 1\" \"Option 2\" ...`")] });
    const [question, ...opts] = items;
    if (opts.length > 10) return message.reply({ embeds: [warnEmbed("Too many options", "Maximum 10 options.")] });
    const emojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
    const description = opts.map((o, i) => `${emojis[i]} ${o}`).join("\n");
    const sent = await message.reply({ embeds: [embed({ title: `📊 ${question}`, description })] });
    for (let i = 0; i < opts.length; i++) await sent.react(emojis[i]);
  } });


