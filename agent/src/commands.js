/**
 * Discord command registry. Categories: general, fun, utility, info, moderation,
 * admin, economy, levels, tags, owner, ai. Extend by pushing to COMMANDS.
 * Permission gating happens in permissions.js.
 */
import { EmbedBuilder, PermissionsBitField } from "discord.js";
import {
  addWarning, listWarnings, clearWarnings,
  setTag, getTag, deleteTag, listTags,
  setAfk, clearAfk,
  getBalance, setBalance,
  addXp, getXp, topXp,
  getGuild, saveGuild,
} from "./db.js";
import { chat } from "./chat-loop.js";
import { config } from "./config.js";

const RNG = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[RNG(arr.length)];

/** @type {Array<{name:string, category:string, description:string, usage:string, permission:'everyone'|'mod'|'admin'|'owner', run:Function, aliases?:string[]}>} */
export const COMMANDS = [];
const add = (c) => COMMANDS.push(c);

// ---------- General ----------
add({ name: "ping", category: "general", description: "Show latency.", usage: "ping", permission: "everyone",
  run: async ({ message, client }) => message.reply(`🏓 ${Math.round(client.ws.ping)}ms`) });

add({ name: "help", category: "general", description: "List commands.", usage: "help [category]", permission: "everyone",
  run: async ({ message, args, guildCfg }) => {
    const cat = args[0]?.toLowerCase();
    const list = cat ? COMMANDS.filter((c) => c.category === cat) : COMMANDS;
    const grouped = list.reduce((a, c) => { (a[c.category] ||= []).push(c.name); return a; }, {});
    const embed = new EmbedBuilder()
      .setTitle("NOVA commands")
      .setDescription(`Prefix: \`${guildCfg.prefix}\` · ${COMMANDS.length} commands`)
      .setColor(0xa855f7);
    for (const [k, v] of Object.entries(grouped)) embed.addFields({ name: k, value: v.map((n) => `\`${n}\``).join(" ") });
    message.reply({ embeds: [embed] });
  }});

add({ name: "invite", category: "general", description: "Bot invite link.", usage: "invite", permission: "everyone",
  run: async ({ message, client }) =>
    message.reply(`https://discord.com/oauth2/authorize?client_id=${client.user.id}&scope=bot&permissions=8`) });

// ---------- Info ----------
add({ name: "serverinfo", category: "info", description: "Server info.", usage: "serverinfo", permission: "everyone",
  run: async ({ message }) => {
    const g = message.guild;
    const embed = new EmbedBuilder().setTitle(g.name).setColor(0xa855f7)
      .addFields(
        { name: "Members", value: `${g.memberCount}`, inline: true },
        { name: "Channels", value: `${g.channels.cache.size}`, inline: true },
        { name: "Roles", value: `${g.roles.cache.size}`, inline: true },
        { name: "Owner", value: `<@${g.ownerId}>`, inline: true },
        { name: "Created", value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
      );
    if (g.iconURL()) embed.setThumbnail(g.iconURL());
    message.reply({ embeds: [embed] });
  }});

add({ name: "userinfo", category: "info", description: "User info.", usage: "userinfo [@user]", permission: "everyone",
  aliases: ["whois"],
  run: async ({ message }) => {
    const u = message.mentions.users.first() || message.author;
    const m = message.guild?.members.cache.get(u.id);
    const embed = new EmbedBuilder().setTitle(u.tag).setColor(0xa855f7)
      .setThumbnail(u.displayAvatarURL())
      .addFields(
        { name: "ID", value: u.id, inline: true },
        { name: "Created", value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: true },
        ...(m ? [{ name: "Joined", value: `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>`, inline: true }] : []),
      );
    message.reply({ embeds: [embed] });
  }});

add({ name: "avatar", category: "info", description: "Show avatar.", usage: "avatar [@user]", permission: "everyone",
  aliases: ["av", "pfp"],
  run: async ({ message }) => {
    const u = message.mentions.users.first() || message.author;
    message.reply(u.displayAvatarURL({ size: 1024 }));
  }});

add({ name: "channelinfo", category: "info", description: "Show channel info.", usage: "channelinfo", permission: "everyone",
  run: async ({ message }) => message.reply(`#${message.channel.name} · ID ${message.channel.id}`) });

add({ name: "botinfo", category: "info", description: "Show bot info.", usage: "botinfo", permission: "everyone",
  run: async ({ message, client }) =>
    message.reply(`NOVA · in ${client.guilds.cache.size} servers · uptime ${Math.round(process.uptime() / 60)}m`) });

// ---------- Fun (25) ----------
add({ name: "8ball", category: "fun", description: "Magic 8-ball.", usage: "8ball <question>", permission: "everyone",
  run: async ({ message }) => message.reply(`🎱 ${pick(["Yes.","No.","Maybe.","Definitely.","Ask again later.","Absolutely not.","Signs point to yes.","Doubt it."])}` )});
add({ name: "roll", category: "fun", description: "Roll a dice, default d6.", usage: "roll [sides]", permission: "everyone",
  run: async ({ message, args }) => message.reply(`🎲 ${1 + RNG(Number(args[0]) || 6)}`) });
add({ name: "flip", category: "fun", description: "Coin flip.", usage: "flip", permission: "everyone",
  run: async ({ message }) => message.reply(RNG(2) ? "🪙 Heads" : "🪙 Tails") });
add({ name: "choose", category: "fun", description: "Pick one option.", usage: "choose a|b|c", permission: "everyone",
  run: async ({ message, args }) => message.reply(`👉 ${pick(args.join(" ").split("|").map((s) => s.trim()).filter(Boolean)) || "Give me options separated by |"}`) });
add({ name: "reverse", category: "fun", description: "Reverse text.", usage: "reverse <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(args.join(" ").split("").reverse().join("") || "?") });
add({ name: "mock", category: "fun", description: "sPoNgEbOb text.", usage: "mock <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(args.join(" ").split("").map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join("") || "?") });
add({ name: "clap", category: "fun", description: "Add 👏 between words.", usage: "clap <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(args.join(" 👏 ") || "?") });
add({ name: "ascii", category: "fun", description: "Big block text.", usage: "ascii <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply("```\n" + (args.join(" ") || "?").toUpperCase().split("").map((c) => `[${c}]`).join(" ") + "\n```") });
add({ name: "coinflip", category: "fun", description: "Alias of flip.", usage: "coinflip", permission: "everyone",
  run: async ({ message }) => message.reply(RNG(2) ? "🪙 Heads" : "🪙 Tails") });
add({ name: "joke", category: "fun", description: "Random joke.", usage: "joke", permission: "everyone",
  run: async ({ message }) => message.reply(pick([
    "I told my computer I needed a break — it said 'no problem, I'll go to sleep'.",
    "Why did the developer go broke? Because he used up all his cache.",
    "There are 10 kinds of people in the world: those who understand binary and those who don't.",
  ])) });
add({ name: "quote", category: "fun", description: "Inspirational quote.", usage: "quote", permission: "everyone",
  run: async ({ message }) => message.reply(pick([
    "“Talk is cheap. Show me the code.” — Linus Torvalds",
    "“Simplicity is the soul of efficiency.” — Austin Freeman",
    "“First, solve the problem. Then, write the code.” — John Johnson",
  ])) });
add({ name: "rate", category: "fun", description: "Rate something 1-10.", usage: "rate <thing>", permission: "everyone",
  run: async ({ message, args }) => message.reply(`I rate **${args.join(" ") || "that"}** a ${1 + RNG(10)}/10.`) });
add({ name: "ship", category: "fun", description: "Compatibility %.", usage: "ship @a @b", permission: "everyone",
  run: async ({ message }) => message.reply(`💘 ${RNG(101)}% compatible.`) });
add({ name: "hug", category: "fun", description: "Send a hug.", usage: "hug @user", permission: "everyone",
  run: async ({ message }) => message.reply(`🤗 ${message.mentions.users.first() || "everyone"}`) });
add({ name: "slap", category: "fun", description: "Slap someone.", usage: "slap @user", permission: "everyone",
  run: async ({ message }) => message.reply(`👋 ${message.author} slaps ${message.mentions.users.first() || "the void"}`) });
add({ name: "cat", category: "fun", description: "Random cat.", usage: "cat", permission: "everyone",
  run: async ({ message }) => {
    try { const r = await (await fetch("https://api.thecatapi.com/v1/images/search")).json(); message.reply(r[0]?.url || "🐱"); }
    catch { message.reply("🐱 (offline)"); }
  }});
add({ name: "dog", category: "fun", description: "Random dog.", usage: "dog", permission: "everyone",
  run: async ({ message }) => {
    try { const r = await (await fetch("https://dog.ceo/api/breeds/image/random")).json(); message.reply(r.message || "🐶"); }
    catch { message.reply("🐶 (offline)"); }
  }});
add({ name: "fact", category: "fun", description: "Random fact.", usage: "fact", permission: "everyone",
  run: async ({ message }) => message.reply(pick([
    "Honey never spoils.", "Octopuses have three hearts.", "Bananas are berries; strawberries aren't.",
  ])) });
add({ name: "riddle", category: "fun", description: "Riddle.", usage: "riddle", permission: "everyone",
  run: async ({ message }) => message.reply("I speak without a mouth and hear without ears. What am I? (Answer: an echo)") });
add({ name: "roast", category: "fun", description: "Playful roast.", usage: "roast @user", permission: "everyone",
  run: async ({ message }) => message.reply(`${message.mentions.users.first() || "you"} — ${pick([
    "your ideas load slower than dial-up.", "if brilliance were water, you'd be a dry lake.", "you make silence sound like a masterpiece.",
  ])}`) });
add({ name: "compliment", category: "fun", description: "Send a compliment.", usage: "compliment @user", permission: "everyone",
  run: async ({ message }) => message.reply(`${message.mentions.users.first() || "you"} — ${pick([
    "you make hard problems look easy.", "your energy could light a whole datacenter.", "the room gets sharper when you show up.",
  ])}`) });
add({ name: "random", category: "fun", description: "Random number.", usage: "random <max>", permission: "everyone",
  run: async ({ message, args }) => message.reply(`${RNG(Number(args[0]) || 100)}`) });
add({ name: "guess", category: "fun", description: "Guess 1-10.", usage: "guess <n>", permission: "everyone",
  run: async ({ message, args }) => {
    const n = Number(args[0]); const t = 1 + RNG(10);
    message.reply(n === t ? `🎉 Correct! It was ${t}` : `Nope, it was ${t}`);
  }});
add({ name: "say", category: "fun", description: "Bot repeats you.", usage: "say <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(args.join(" ") || "…") });
add({ name: "emojify", category: "fun", description: "Add emoji spice.", usage: "emojify <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(args.join(" ").split("").join("✨")) });

// ---------- Utility (25) ----------
add({ name: "poll", category: "utility", description: "Quick yes/no poll.", usage: "poll <question>", permission: "everyone",
  run: async ({ message, args }) => {
    const m = await message.channel.send(`📊 **${args.join(" ") || "poll"}**`);
    await m.react("👍"); await m.react("👎");
  }});
add({ name: "remindme", category: "utility", description: "Remind you later.", usage: "remindme <minutes> <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const mins = Number(args[0]); if (!mins) return message.reply("Give minutes then message.");
    message.reply(`⏰ In ${mins}m: ${args.slice(1).join(" ")}`);
    setTimeout(() => message.author.send(`⏰ Reminder: ${args.slice(1).join(" ")}`).catch(() => {}), mins * 60_000);
  }});
add({ name: "timer", category: "utility", description: "Countdown.", usage: "timer <seconds>", permission: "everyone",
  run: async ({ message, args }) => {
    const s = Math.min(3600, Number(args[0]) || 10);
    const m = await message.reply(`⏳ ${s}s`);
    setTimeout(() => m.edit("✅ Done!"), s * 1000);
  }});
add({ name: "math", category: "utility", description: "Safe calculator.", usage: "math <expression>", permission: "everyone",
  run: async ({ message, args }) => {
    const expr = args.join(" ").replace(/[^0-9+\-*/().% ]/g, "");
    try { message.reply(`= ${Function(`"use strict"; return (${expr})`)()}`); }
    catch { message.reply("Bad expression."); }
  }});
add({ name: "base64", category: "utility", description: "Encode text.", usage: "base64 <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(Buffer.from(args.join(" ")).toString("base64")) });
add({ name: "unbase64", category: "utility", description: "Decode base64.", usage: "unbase64 <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(Buffer.from(args[0] || "", "base64").toString()) });
add({ name: "hash", category: "utility", description: "SHA-256 a string.", usage: "hash <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const { createHash } = await import("node:crypto");
    message.reply("`" + createHash("sha256").update(args.join(" ")).digest("hex") + "`");
  }});
add({ name: "uuid", category: "utility", description: "Random UUID.", usage: "uuid", permission: "everyone",
  run: async ({ message }) => { const { randomUUID } = await import("node:crypto"); message.reply(`\`${randomUUID()}\``); }});
add({ name: "password", category: "utility", description: "Strong password.", usage: "password [length]", permission: "everyone",
  run: async ({ message, args }) => {
    const len = Math.min(64, Math.max(8, Number(args[0]) || 20));
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%^&*";
    let out = ""; for (let i = 0; i < len; i++) out += chars[RNG(chars.length)];
    message.author.send(`🔐 \`${out}\``).catch(() => message.reply("Enable DMs and try again."));
    message.reply("Sent to your DMs.");
  }});
add({ name: "time", category: "utility", description: "Current time.", usage: "time", permission: "everyone",
  run: async ({ message }) => message.reply(`🕒 ${new Date().toISOString()}`) });
add({ name: "afk", category: "utility", description: "Set AFK.", usage: "afk [reason]", permission: "everyone",
  run: async ({ message, args }) => { setAfk(message.guild.id, message.author.id, args.join(" ")); message.reply(`😴 AFK set.`); }});
add({ name: "unafk", category: "utility", description: "Clear AFK.", usage: "unafk", permission: "everyone",
  run: async ({ message }) => { clearAfk(message.guild.id, message.author.id); message.reply("Welcome back."); }});
add({ name: "tag", category: "utility", description: "Show a saved tag.", usage: "tag <name>", permission: "everyone",
  run: async ({ message, args }) => message.reply(getTag(message.guild.id, args[0] || "") || "No such tag.") });
add({ name: "tagset", category: "utility", description: "Save a tag.", usage: "tagset <name> <content>", permission: "mod",
  run: async ({ message, args }) => { setTag(message.guild.id, args[0], args.slice(1).join(" ")); message.reply("✅ Saved."); }});
add({ name: "tagdel", category: "utility", description: "Delete a tag.", usage: "tagdel <name>", permission: "mod",
  run: async ({ message, args }) => { deleteTag(message.guild.id, args[0]); message.reply("🗑️ Deleted."); }});
add({ name: "tags", category: "utility", description: "List tags.", usage: "tags", permission: "everyone",
  run: async ({ message }) => message.reply(listTags(message.guild.id).join(", ") || "No tags yet.") });
add({ name: "vote", category: "utility", description: "Multi-choice poll.", usage: "vote q?|a|b|c", permission: "everyone",
  run: async ({ message, args }) => {
    const [q, ...opts] = args.join(" ").split("|");
    const emo = ["1️⃣","2️⃣","3️⃣","4️⃣","5️⃣"];
    const body = opts.slice(0, 5).map((o, i) => `${emo[i]} ${o.trim()}`).join("\n");
    const m = await message.channel.send(`📊 **${q}**\n${body}`);
    for (let i = 0; i < opts.slice(0, 5).length; i++) await m.react(emo[i]);
  }});
add({ name: "define", category: "utility", description: "Ask NOVA for a definition.", usage: "define <word>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const { reply } = await chat({ scope: `d:${message.author.id}`, userText: `Define: ${args.join(" ")}`, isOwner });
    message.reply(reply.slice(0, 1900));
  }});
add({ name: "shortlink", category: "utility", description: "Shorten URL (tinyurl).", usage: "shortlink <url>", permission: "everyone",
  run: async ({ message, args }) => {
    try { const r = await (await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(args[0])}`)).text(); message.reply(r); }
    catch { message.reply("Failed."); }
  }});
add({ name: "qr", category: "utility", description: "QR code image.", usage: "qr <text>", permission: "everyone",
  run: async ({ message, args }) => message.reply(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(args.join(" "))}`) });
add({ name: "weather", category: "utility", description: "Weather via wttr.in.", usage: "weather <city>", permission: "everyone",
  run: async ({ message, args }) => {
    try { const r = await (await fetch(`https://wttr.in/${encodeURIComponent(args.join(" "))}?format=3`)).text(); message.reply(r); }
    catch { message.reply("Weather offline."); }
  }});
add({ name: "urban", category: "utility", description: "Urban dictionary.", usage: "urban <term>", permission: "everyone",
  run: async ({ message, args }) => {
    try {
      const r = await (await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(args.join(" "))}`)).json();
      message.reply((r.list?.[0]?.definition || "No results.").slice(0, 1900));
    } catch { message.reply("Offline."); }
  }});
add({ name: "translate", category: "utility", description: "Translate via NOVA.", usage: "translate <lang> <text>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const { reply } = await chat({
      scope: `t:${message.author.id}`,
      userText: `Translate to ${args[0]}: ${args.slice(1).join(" ")}. Return only the translation.`,
      isOwner,
    });
    message.reply(reply.slice(0, 1900));
  }});
add({ name: "wiki", category: "utility", description: "Wikipedia summary.", usage: "wiki <title>", permission: "everyone",
  run: async ({ message, args }) => {
    try {
      const r = await (await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(args.join("_"))}`)).json();
      message.reply(r.extract?.slice(0, 1900) || "Nothing found.");
    } catch { message.reply("Offline."); }
  }});
add({ name: "color", category: "utility", description: "Show a hex color.", usage: "color #a855f7", permission: "everyone",
  run: async ({ message, args }) => {
    const hex = (args[0] || "").replace("#", ""); if (!/^[0-9a-f]{6}$/i.test(hex)) return message.reply("Give a hex like #a855f7");
    message.reply(`https://singlecolorimage.com/get/${hex}/200x60`);
  }});

// ---------- Moderation ----------
add({ name: "kick", category: "moderation", description: "Kick a member.", usage: "kick @user [reason]", permission: "mod",
  run: async ({ message, args }) => {
    const m = message.mentions.members.first(); if (!m) return message.reply("Mention a user.");
    await m.kick(args.slice(1).join(" ") || "no reason"); message.reply(`👢 Kicked ${m.user.tag}`);
  }});
add({ name: "ban", category: "moderation", description: "Ban a member.", usage: "ban @user [reason]", permission: "admin",
  run: async ({ message, args }) => {
    const m = message.mentions.members.first(); if (!m) return message.reply("Mention a user.");
    await m.ban({ reason: args.slice(1).join(" ") || "no reason" }); message.reply(`🔨 Banned ${m.user.tag}`);
  }});
add({ name: "unban", category: "moderation", description: "Unban by ID.", usage: "unban <userId>", permission: "admin",
  run: async ({ message, args }) => { await message.guild.members.unban(args[0]); message.reply("✅ Unbanned."); }});
add({ name: "timeout", category: "moderation", description: "Timeout N minutes.", usage: "timeout @user <mins>", permission: "mod",
  run: async ({ message, args }) => {
    const m = message.mentions.members.first(); if (!m) return message.reply("Mention a user.");
    await m.timeout(Number(args[1] || 5) * 60_000, "NOVA"); message.reply(`⏳ Timed out ${m.user.tag}`);
  }});
add({ name: "untimeout", category: "moderation", description: "Remove timeout.", usage: "untimeout @user", permission: "mod",
  run: async ({ message }) => { const m = message.mentions.members.first(); if (!m) return; await m.timeout(null); message.reply("✅ Cleared."); }});
add({ name: "warn", category: "moderation", description: "Warn a user.", usage: "warn @user <reason>", permission: "mod",
  run: async ({ message, args }) => {
    const u = message.mentions.users.first(); if (!u) return message.reply("Mention a user.");
    addWarning(message.guild.id, u.id, message.author.id, args.slice(1).join(" "));
    message.reply(`⚠️ Warned ${u.tag}`);
  }});
add({ name: "warnings", category: "moderation", description: "Show warnings.", usage: "warnings @user", permission: "mod",
  run: async ({ message }) => {
    const u = message.mentions.users.first() || message.author;
    const w = listWarnings(message.guild.id, u.id);
    message.reply(w.length ? w.map((r) => `• ${r.reason}`).join("\n") : "No warnings.");
  }});
add({ name: "clearwarns", category: "moderation", description: "Clear warnings.", usage: "clearwarns @user", permission: "admin",
  run: async ({ message }) => {
    const u = message.mentions.users.first(); if (!u) return; clearWarnings(message.guild.id, u.id);
    message.reply("🧹 Cleared.");
  }});
add({ name: "purge", category: "moderation", description: "Bulk delete messages.", usage: "purge <count>", permission: "mod",
  run: async ({ message, args }) => {
    const n = Math.min(100, Math.max(1, Number(args[0]) || 10));
    await message.channel.bulkDelete(n, true); message.channel.send(`🧹 Deleted ${n}`).then((m) => setTimeout(() => m.delete().catch(() => {}), 3000));
  }});
add({ name: "slowmode", category: "moderation", description: "Set slowmode seconds.", usage: "slowmode <s>", permission: "mod",
  run: async ({ message, args }) => { await message.channel.setRateLimitPerUser(Math.min(21600, Number(args[0]) || 0)); message.reply("🐢 Updated."); }});
add({ name: "lock", category: "moderation", description: "Lock channel.", usage: "lock", permission: "mod",
  run: async ({ message }) => {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    message.reply("🔒 Locked.");
  }});
add({ name: "unlock", category: "moderation", description: "Unlock channel.", usage: "unlock", permission: "mod",
  run: async ({ message }) => {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    message.reply("🔓 Unlocked.");
  }});
add({ name: "nick", category: "moderation", description: "Change a nickname.", usage: "nick @user <name>", permission: "mod",
  run: async ({ message, args }) => { const m = message.mentions.members.first(); if (!m) return; await m.setNickname(args.slice(1).join(" ")); message.reply("✅"); }});
add({ name: "role", category: "moderation", description: "Toggle a role.", usage: "role @user <role>", permission: "admin",
  run: async ({ message, args }) => {
    const m = message.mentions.members.first(); if (!m) return;
    const r = message.guild.roles.cache.find((r) => r.name === args.slice(1).join(" ")); if (!r) return message.reply("Role not found.");
    m.roles.cache.has(r.id) ? await m.roles.remove(r) : await m.roles.add(r);
    message.reply("✅");
  }});

// ---------- Admin ----------
add({ name: "prefix", category: "admin", description: "Change command prefix.", usage: "prefix <char>", permission: "admin",
  run: async ({ message, args, guildCfg }) => {
    const p = args[0]; if (!p) return message.reply(`Prefix: \`${guildCfg.prefix}\``);
    saveGuild(message.guild.id, { prefix: p }); message.reply(`✅ Prefix → \`${p}\``);
  }});
add({ name: "aitoggle", category: "admin", description: "Toggle AI mention replies.", usage: "aitoggle", permission: "admin",
  run: async ({ message, guildCfg }) => {
    const next = saveGuild(message.guild.id, { aiReplies: !guildCfg.aiReplies });
    message.reply(`AI replies: ${next.aiReplies ? "on" : "off"}`);
  }});
add({ name: "setmod", category: "admin", description: "Add a mod role.", usage: "setmod <@role>", permission: "admin",
  run: async ({ message, guildCfg }) => {
    const r = message.mentions.roles.first(); if (!r) return message.reply("Mention a role.");
    saveGuild(message.guild.id, { modRoles: [...new Set([...guildCfg.modRoles, r.id])] });
    message.reply(`✅ Mod role added: ${r.name}`);
  }});
add({ name: "setadmin", category: "admin", description: "Add an admin role.", usage: "setadmin <@role>", permission: "admin",
  run: async ({ message, guildCfg }) => {
    const r = message.mentions.roles.first(); if (!r) return message.reply("Mention a role.");
    saveGuild(message.guild.id, { adminRoles: [...new Set([...guildCfg.adminRoles, r.id])] });
    message.reply(`✅ Admin role added: ${r.name}`);
  }});
add({ name: "announce", category: "admin", description: "Announce in a channel.", usage: "announce #ch <text>", permission: "admin",
  run: async ({ message, args }) => {
    const ch = message.mentions.channels.first(); if (!ch) return message.reply("Mention a channel.");
    ch.send(args.slice(1).join(" ")); message.reply("📢 Sent.");
  }});

// ---------- Economy ----------
add({ name: "balance", category: "economy", description: "Check balance.", usage: "balance", permission: "everyone",
  aliases: ["bal"],
  run: async ({ message }) => message.reply(`💰 ${getBalance(message.guild.id, message.author.id).balance}`) });
add({ name: "daily", category: "economy", description: "Daily reward.", usage: "daily", permission: "everyone",
  run: async ({ message }) => {
    const b = getBalance(message.guild.id, message.author.id);
    const now = Date.now();
    if (now - b.last_daily < 86400000) return message.reply(`⏳ Come back in ${Math.ceil((86400000 - (now - b.last_daily)) / 3600000)}h`);
    setBalance(message.guild.id, message.author.id, b.balance + 250, now);
    message.reply("✨ +250");
  }});
add({ name: "give", category: "economy", description: "Give coins.", usage: "give @user <n>", permission: "everyone",
  run: async ({ message, args }) => {
    const u = message.mentions.users.first(); const n = Number(args[1]);
    if (!u || !n) return message.reply("give @user <n>");
    const from = getBalance(message.guild.id, message.author.id);
    if (from.balance < n) return message.reply("Not enough.");
    setBalance(message.guild.id, message.author.id, from.balance - n);
    const to = getBalance(message.guild.id, u.id);
    setBalance(message.guild.id, u.id, to.balance + n);
    message.reply(`💸 ${n} → ${u.tag}`);
  }});
add({ name: "leaderboard", category: "economy", description: "Top by XP.", usage: "leaderboard", permission: "everyone",
  aliases: ["lb"],
  run: async ({ message }) => {
    const rows = topXp(message.guild.id, 10);
    message.reply(rows.length ? rows.map((r, i) => `${i + 1}. <@${r.user_id}> — ${r.xp} xp`).join("\n") : "No data.");
  }});
add({ name: "rank", category: "levels", description: "Show your rank.", usage: "rank", permission: "everyone",
  run: async ({ message }) => message.reply(`⭐ XP: ${getXp(message.guild.id, message.author.id)}`) });

// ---------- AI ----------
add({ name: "ai", category: "ai", description: "Chat with NOVA.", usage: "ai <message>", permission: "everyone",
  aliases: ["ask", "nova"],
  run: async ({ message, args, isOwner }) => {
    if (!args.length) return message.reply("Ask me something.");
    await message.channel.sendTyping();
    const { reply, provider, model } = await chat({
      scope: `c:${message.channel.id}:${message.author.id}`, userText: args.join(" "), isOwner,
    });
    message.reply(`${reply}\n\n\`${provider} · ${model}\``.slice(0, 1990));
  }});
add({ name: "code", category: "ai", description: "Coding help.", usage: "code <question>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    await message.channel.sendTyping();
    const { reply, provider, model } = await chat({
      scope: `code:${message.author.id}`, userText: args.join(" "), mode: "coding", isOwner,
    });
    message.reply(`${reply}\n\n\`${provider} · ${model}\``.slice(0, 1990));
  }});
add({ name: "lookup", category: "ai", description: "Search lookups folder.", usage: "lookup <query>", permission: "mod",
  run: async ({ message, args }) => {
    const { lookup: doLookup } = await import("./lookups.js");
    const out = await doLookup(args.join(" "));
    const summary = out.matches.length
      ? out.matches.map((m) => `**${m.file}** — ${m.hits?.length || 0} hits`).join("\n")
      : "No matches.";
    message.reply(`🔎 Query: \`${out.query}\`\nScanned ${out.files} files.\n${summary}`.slice(0, 1900));
  }});
add({ name: "reset", category: "ai", description: "Clear this convo's memory.", usage: "reset", permission: "everyone",
  run: async ({ message }) => {
    const { db } = await import("./db.js");
    db.prepare("DELETE FROM memory WHERE scope = ?").run(`c:${message.channel.id}:${message.author.id}`);
    message.reply("🧠 Cleared.");
  }});

// ---------- Owner ----------
add({ name: "sysinfo", category: "owner", description: "Host system info.", usage: "sysinfo", permission: "owner",
  run: async ({ message }) => {
    const { systemInfo } = await import("./computer.js");
    const s = await systemInfo();
    message.reply("```json\n" + JSON.stringify(s, null, 2) + "\n```");
  }});
add({ name: "shutdown", category: "owner", description: "Stop the bot.", usage: "shutdown", permission: "owner",
  run: async ({ message, client }) => { await message.reply("💤 Shutting down."); await client.destroy(); }});

/** Look up a command by name or alias. */
export const findCommand = (name) => {
  const n = name.toLowerCase();
  return COMMANDS.find((c) => c.name === n || c.aliases?.includes(n));
};

export const commandSummary = () =>
  COMMANDS.map((c) => ({ name: c.name, category: c.category, description: c.description, usage: c.usage, permission: c.permission }));

export const _ownerId = () => config.ownerId;
export const _adminFlag = PermissionsBitField.Flags.Administrator;
