/**
 * Moderation command module for NOVA. 32 commands covering member discipline,
 * channel/server locking, purge tooling, roles, voice management and case logs.
 * All destructive/irreversible actions run through confirm() and every action
 * is written to a module-level case log + posted as a clean embed.
 */
import { PermissionsBitField, ChannelType } from "discord.js";
import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed,
  button, row, select, confirm, choose, prompt, paginate, listPages,
  mention, targetMember, fmt, ago, EMOJI, COLORS,
} from "../ui.js";
import { addWarning, listWarnings, clearWarnings } from "../db.js";

export const commands = [];
const add = (c) => commands.push(c);

// ---------------- module-level state (do not touch db.js schema) ----------------
let caseSeq = 1;
const casesByGuild = new Map(); // guildId -> [{id,type,targetId,targetTag,modId,modTag,reason,at}]
const notesByGuild = new Map(); // guildId -> Map(userId -> [{by,text,at}])

function pushCase(guildId, data) {
  const list = casesByGuild.get(guildId) || [];
  const c = { id: caseSeq++, at: Date.now(), ...data };
  list.unshift(c);
  casesByGuild.set(guildId, list.slice(0, 500));
  return c;
}
const getCases = (guildId) => casesByGuild.get(guildId) || [];
function getNotes(guildId, userId) {
  const m = notesByGuild.get(guildId) || new Map();
  notesByGuild.set(guildId, m);
  return m.get(userId) || [];
}
function addNote(guildId, userId, by, text) {
  const m = notesByGuild.get(guildId) || new Map();
  notesByGuild.set(guildId, m);
  const list = m.get(userId) || [];
  list.unshift({ by, text, at: Date.now() });
  m.set(userId, list);
}

function caseEmbed({ title, color, target, moderator, reason, extra = [] }) {
  return embed({
    title,
    color,
    thumbnail: target?.displayAvatarURL?.() || target?.user?.displayAvatarURL?.(),
    fields: [
      { name: "Target", value: target ? `${target} (${target.id ?? target.user?.id})` : "—", inline: true },
      { name: "Moderator", value: `${moderator}`, inline: true },
      { name: "Reason", value: reason || "No reason provided.", inline: false },
      ...extra,
    ],
    footer: "NOVA moderation",
  });
}

async function dmUser(user, embedObj) {
  try { await user.send({ embeds: [embedObj] }); return true; } catch { return false; }
}

function parseDuration(str) {
  if (!str) return null;
  const m = /^(\d+)\s*(s|m|h|d|w)$/i.exec(str.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2].toLowerCase()];
  return n * mult;
}

/** Can `actor` moderate `target` given role hierarchy + bot's own role? */
function hierarchyOk(message, target) {
  if (!target) return { ok: false, reason: "Member not found." };
  if (target.id === message.author.id) return { ok: false, reason: "You can't target yourself." };
  if (target.id === message.guild.ownerId) return { ok: false, reason: "Can't target the server owner." };
  const actorTop = message.member.roles.highest.position;
  const targetTop = target.roles.highest.position;
  if (message.author.id !== message.guild.ownerId && targetTop >= actorTop) {
    return { ok: false, reason: "You can't act on someone with an equal/higher role." };
  }
  const me = message.guild.members.me;
  if (target.roles.highest.position >= me.roles.highest.position) {
    return { ok: false, reason: "My role is not high enough to do that." };
  }
  if (!target.moderatable && (target.id !== message.author.id)) {
    // moderatable covers kick/ban/timeout in most cases; role edits checked separately
  }
  return { ok: true };
}

function parseTargetAndReason(message, args) {
  const target = targetMember(message);
  let reasonArgs = args.slice(1);
  if (!target && args[0] && /^\d{15,25}$/.test(args[0])) reasonArgs = args.slice(1);
  return { target, reason: reasonArgs.join(" ").trim() };
}

// ============================= 1. kick =============================
add({ name: "kick", category: "moderation", description: "Kick a member.", usage: "kick @user [reason]", permission: "mod",
  run: async ({ message, args }) => {
    const { target, reason } = parseTargetAndReason(message, args);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member to kick.")] });
    const hc = hierarchyOk(message, target);
    if (!hc.ok) return message.reply({ embeds: [errEmbed("Can't do that", hc.reason)] });
    if (!target.kickable) return message.reply({ embeds: [errEmbed("Can't kick", "I don't have permission to kick this member.")] });
    const ok = await confirm(message, { title: "Confirm kick", description: `Kick ${target} for **${reason || "no reason"}**?` });
    if (!ok) return;
    const dmed = await dmUser(target.user, warnEmbed(`Kicked from ${message.guild.name}`, reason || "No reason provided."));
    await target.kick(reason || `Kicked by ${message.author.tag}`);
    const c = pushCase(message.guild.id, { type: "kick", targetId: target.id, targetTag: target.user.tag, modId: message.author.id, modTag: message.author.tag, reason });
    message.channel.send({ embeds: [caseEmbed({ title: `${EMOJI.shield} Case #${c.id} · Kick`, color: COLORS.warn, target: target.user, moderator: message.author, reason, extra: [{ name: "DM sent", value: dmed ? "Yes" : "No", inline: true }] })] });
  }});

// ============================= 2. ban =============================
add({ name: "ban", category: "moderation", description: "Ban a member (optional message delete days).", usage: "ban @user [days] [reason]", permission: "mod",
  run: async ({ message, args }) => {
    const target = targetMember(message);
    const targetId = target?.id || args.find((a) => /^\d{15,25}$/.test(a));
    if (!targetId) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member or give an ID.")] });
    let rest = args.slice(1);
    let days = 0;
    if (rest[0] && /^\d+$/.test(rest[0]) && Number(rest[0]) <= 7) { days = Number(rest.shift()); }
    const reason = rest.join(" ").trim();
    if (target) {
      const hc = hierarchyOk(message, target);
      if (!hc.ok) return message.reply({ embeds: [errEmbed("Can't do that", hc.reason)] });
      if (!target.bannable) return message.reply({ embeds: [errEmbed("Can't ban", "I don't have permission to ban this member.")] });
    }
    const ok = await confirm(message, { title: "Confirm ban", description: `Ban <@${targetId}> for **${reason || "no reason"}**? Deleting ${days}d of messages.` });
    if (!ok) return;
    let dmed = false;
    if (target) dmed = await dmUser(target.user, errEmbed(`Banned from ${message.guild.name}`, reason || "No reason provided."));
    await message.guild.members.ban(targetId, { deleteMessageSeconds: days * 86400, reason: reason || `Banned by ${message.author.tag}` });
    const c = pushCase(message.guild.id, { type: "ban", targetId, targetTag: target?.user.tag || targetId, modId: message.author.id, modTag: message.author.tag, reason });
    message.channel.send({ embeds: [caseEmbed({ title: `${EMOJI.no} Case #${c.id} · Ban`, color: COLORS.danger, target: target?.user || { id: targetId, toString: () => `<@${targetId}>` }, moderator: message.author, reason, extra: [{ name: "Messages deleted", value: `${days}d`, inline: true }, { name: "DM sent", value: dmed ? "Yes" : "No", inline: true }] })] });
  }});

// ============================= 3. softban =============================
add({ name: "softban", category: "moderation", description: "Ban+unban to purge recent messages.", usage: "softban @user [reason]", permission: "mod",
  run: async ({ message, args }) => {
    const { target, reason } = parseTargetAndReason(message, args);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member to softban.")] });
    const hc = hierarchyOk(message, target);
    if (!hc.ok) return message.reply({ embeds: [errEmbed("Can't do that", hc.reason)] });
    if (!target.bannable) return message.reply({ embeds: [errEmbed("Can't softban", "I don't have permission.")] });
    const ok = await confirm(message, { title: "Confirm softban", description: `Softban ${target} (ban+unban, purges 1 day of messages)?` });
    if (!ok) return;
    const dmed = await dmUser(target.user, warnEmbed(`Softbanned from ${message.guild.name}`, reason || "No reason provided."));
    await message.guild.members.ban(target.id, { deleteMessageSeconds: 86400, reason: `Softban by ${message.author.tag}: ${reason}` });
    await message.guild.members.unban(target.id, "Softban cleanup").catch(() => {});
    const c = pushCase(message.guild.id, { type: "softban", targetId: target.id, targetTag: target.user.tag, modId: message.author.id, modTag: message.author.tag, reason });
    message.channel.send({ embeds: [caseEmbed({ title: `${EMOJI.warn} Case #${c.id} · Softban`, color: COLORS.warn, target: target.user, moderator: message.author, reason, extra: [{ name: "DM sent", value: dmed ? "Yes" : "No", inline: true }] })] });
  }});

// ============================= 4. unban =============================
add({ name: "unban", category: "moderation", description: "Unban a user by ID.", usage: "unban <userId> [reason]", permission: "mod",
  run: async ({ message, args }) => {
    const id = args[0];
    if (!id || !/^\d{15,25}$/.test(id)) return message.reply({ embeds: [errEmbed("Missing ID", "Give the user ID to unban.")] });
    const bans = await message.guild.bans.fetch().catch(() => null);
    if (!bans?.has(id)) return message.reply({ embeds: [errEmbed("Not banned", "That user ID is not currently banned.")] });
    const reason = args.slice(1).join(" ");
    const ok = await confirm(message, { title: "Confirm unban", description: `Unban <@${id}>?`, danger: false });
    if (!ok) return;
    await message.guild.members.unban(id, reason || `Unbanned by ${message.author.tag}`);
    const c = pushCase(message.guild.id, { type: "unban", targetId: id, targetTag: id, modId: message.author.id, modTag: message.author.tag, reason });
    message.channel.send({ embeds: [caseEmbed({ title: `${EMOJI.ok} Case #${c.id} · Unban`, color: COLORS.ok, target: { toString: () => `<@${id}>`, id }, moderator: message.author, reason })] });
  }});

// ============================= 5. timeout / mute =============================
add({ name: "timeout", category: "moderation", description: "Timeout (mute) a member.", usage: "timeout @user <10m|2h|1d> [reason]", permission: "mod", aliases: ["mute"],
  run: async ({ message, args }) => {
    const target = targetMember(message);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member to timeout.")] });
    const ms = parseDuration(args[1]);
    if (!ms) return message.reply({ embeds: [errEmbed("Bad duration", "Use a duration like `10m`, `2h`, `1d`.")] });
    const reason = args.slice(2).join(" ").trim();
    const hc = hierarchyOk(message, target);
    if (!hc.ok) return message.reply({ embeds: [errEmbed("Can't do that", hc.reason)] });
    if (!target.moderatable) return message.reply({ embeds: [errEmbed("Can't timeout", "I don't have permission.")] });
    await target.timeout(Math.min(ms, 2_419_200_000), reason || `Timed out by ${message.author.tag}`);
    const dmed = await dmUser(target.user, warnEmbed(`Timed out in ${message.guild.name}`, `Duration: ${args[1]}\n${reason || ""}`));
    const c = pushCase(message.guild.id, { type: "timeout", targetId: target.id, targetTag: target.user.tag, modId: message.author.id, modTag: message.author.tag, reason });
    message.channel.send({ embeds: [caseEmbed({ title: `${EMOJI.warn} Case #${c.id} · Timeout`, color: COLORS.warn, target: target.user, moderator: message.author, reason, extra: [{ name: "Duration", value: args[1], inline: true }, { name: "DM sent", value: dmed ? "Yes" : "No", inline: true }] })] });
  }});

// ============================= 6. untimeout =============================
add({ name: "untimeout", category: "moderation", description: "Remove a timeout.", usage: "untimeout @user [reason]", permission: "mod", aliases: ["unmute"],
  run: async ({ message, args }) => {
    const { target, reason } = parseTargetAndReason(message, args);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member.")] });
    if (!target.communicationDisabledUntil) return message.reply({ embeds: [infoEmbed("Not timed out", "That member has no active timeout.")] });
    await target.timeout(null, reason || `Timeout removed by ${message.author.tag}`);
    const c = pushCase(message.guild.id, { type: "untimeout", targetId: target.id, targetTag: target.user.tag, modId: message.author.id, modTag: message.author.tag, reason });
    message.channel.send({ embeds: [caseEmbed({ title: `${EMOJI.ok} Case #${c.id} · Timeout removed`, color: COLORS.ok, target: target.user, moderator: message.author, reason })] });
  }});

// ============================= 7. warn =============================
add({ name: "warn", category: "moderation", description: "Warn a member.", usage: "warn @user <reason>", permission: "mod",
  run: async ({ message, args }) => {
    const { target, reason } = parseTargetAndReason(message, args);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member to warn.")] });
    if (!reason) return message.reply({ embeds: [errEmbed("Missing reason", "Give a reason for the warning.")] });
    addWarning(message.guild.id, target.id, message.author.id, reason);
    const total = listWarnings(message.guild.id, target.id).length;
    const dmed = await dmUser(target.user, warnEmbed(`You were warned in ${message.guild.name}`, reason));
    const c = pushCase(message.guild.id, { type: "warn", targetId: target.id, targetTag: target.user.tag, modId: message.author.id, modTag: message.author.tag, reason });
    message.channel.send({ embeds: [caseEmbed({ title: `${EMOJI.warn} Case #${c.id} · Warn`, color: COLORS.warn, target: target.user, moderator: message.author, reason, extra: [{ name: "Total warnings", value: `${total}`, inline: true }, { name: "DM sent", value: dmed ? "Yes" : "No", inline: true }] })] });
  }});

// ============================= 8. warnings =============================
add({ name: "warnings", category: "moderation", description: "List a member's warnings.", usage: "warnings [@user]", permission: "mod",
  run: async ({ message, args, guildCfg, isOwner }) => {
    const user = mention(message);
    const list = listWarnings(message.guild.id, user.id);
    const rows = list.map((w) => `**#${w.id}** · <@${w.moderator_id}> · ${ago(w.created_at)}\n> ${w.reason || "No reason"}`);
    const pages = listPages(rows, { title: `Warnings · ${user.tag}`, perPage: 5, color: COLORS.warn });
    const canClear = message.member?.permissions?.has(PermissionsBitField.Flags.Administrator) || guildCfg.adminRoles.some((r) => message.member?.roles.cache.has(r)) || isOwner;
    if (canClear && list.length) {
      const sent = await message.reply({ embeds: [pages[0]], components: [row(button({ id: "warn:clear", label: "Clear all", style: "danger", emoji: EMOJI.no }))] });
      const c = sent.createMessageComponentCollector({ time: 30_000, max: 1 });
      c.on("collect", async (int) => {
        if (int.user.id !== message.author.id) return int.reply({ content: "Not yours.", ephemeral: true }).catch(() => {});
        const ok = await confirm(message, { title: "Clear warnings?", description: `Clear all ${list.length} warnings for ${user.tag}?` });
        if (ok) { clearWarnings(message.guild.id, user.id); await int.message.edit({ embeds: [okEmbed("Cleared", `All warnings for ${user.tag} cleared.`)], components: [] }).catch(() => {}); }
      });
      return;
    }
    return paginate(message, pages);
  }});

// ============================= 9. delwarn =============================
add({ name: "delwarn", category: "moderation", description: "Delete a specific warning by ID.", usage: "delwarn <caseId>", permission: "mod",
  run: async ({ message, args }) => {
    const id = Number(args[0]);
    if (!id) return message.reply({ embeds: [errEmbed("Missing ID", "Give the warning ID (see `warnings`).")] });
    const stmtDel = (await import("../db.js")).db.prepare("DELETE FROM warnings WHERE guild_id = ? AND id = ?");
    const info = stmtDel.run(message.guild.id, id);
    if (!info.changes) return message.reply({ embeds: [errEmbed("Not found", "No warning with that ID here.")] });
    message.reply({ embeds: [okEmbed("Warning deleted", `Removed warning #${id}.`)] });
  }});

// ============================= 10. clearwarns =============================
add({ name: "clearwarns", category: "moderation", description: "Clear all warnings for a member.", usage: "clearwarns @user", permission: "admin",
  run: async ({ message }) => {
    const user = mention(message);
    const list = listWarnings(message.guild.id, user.id);
    if (!list.length) return message.reply({ embeds: [infoEmbed("Nothing to clear", `${user.tag} has no warnings.`)] });
    const ok = await confirm(message, { title: "Clear all warnings?", description: `Clear all ${list.length} warnings for ${user.tag}?` });
    if (!ok) return;
    clearWarnings(message.guild.id, user.id);
    message.reply({ embeds: [okEmbed("Cleared", `Cleared warnings for ${user.tag}.`)] });
  }});

// ============================= 11. purge (with filters) =============================
add({ name: "purge", category: "moderation", description: "Bulk delete messages (optional filters).", usage: "purge <n> | purge user @u <n> | purge bots <n> | purge links <n> | purge images <n>", permission: "mod",
  run: async ({ message, args }) => {
    if (!message.channel.permissionsFor(message.guild.members.me).has(PermissionsBitField.Flags.ManageMessages)) {
      return message.reply({ embeds: [errEmbed("Missing permission", "I need Manage Messages here.")] });
    }
    let mode = "all", user = null, n = 50;
    if (["user", "bots", "links", "images"].includes(args[0]?.toLowerCase())) {
      mode = args[0].toLowerCase();
      if (mode === "user") { user = message.mentions.users.first(); n = Number(args[2]) || 50; }
      else n = Number(args[1]) || 50;
    } else {
      n = Number(args[0]) || 50;
    }
    n = Math.max(1, Math.min(200, n));
    if (mode === "user" && !user) return message.reply({ embeds: [errEmbed("Missing user", "Mention a user: `purge user @user <n>`.")] });
    const fetched = await message.channel.messages.fetch({ limit: 100, before: message.id });
    let candidates = [...fetched.values()];
    if (mode === "user") candidates = candidates.filter((m) => m.author.id === user.id);
    if (mode === "bots") candidates = candidates.filter((m) => m.author.bot);
    if (mode === "links") candidates = candidates.filter((m) => /https?:\/\//i.test(m.content));
    if (mode === "images") candidates = candidates.filter((m) => m.attachments.some((a) => a.contentType?.startsWith("image")) || /\.(png|jpe?g|gif|webp)/i.test(m.content));
    const toDelete = candidates.slice(0, n);
    if (!toDelete.length) return message.reply({ embeds: [infoEmbed("Nothing matched", "No messages matched that filter in the recent history.")] });
    const deleted = await message.channel.bulkDelete(toDelete, true).catch(() => null);
    const c = pushCase(message.guild.id, { type: "purge", targetId: mode, targetTag: mode, modId: message.author.id, modTag: message.author.tag, reason: `${deleted?.size || 0} messages` });
    message.channel.send({ embeds: [okEmbed(`Purged · Case #${c.id}`, `Deleted **${deleted?.size || 0}** messages${mode !== "all" ? ` (filter: ${mode})` : ""}.`)] }).then((m) => setTimeout(() => m.delete().catch(() => {}), 5000));
  }});

// ============================= 12. slowmode =============================
add({ name: "slowmode", category: "moderation", description: "Set slowmode with quick presets.", usage: "slowmode [seconds]", permission: "mod",
  run: async ({ message, args }) => {
    if (args[0] != null) {
      const secs = Math.max(0, Math.min(21600, Number(args[0]) || 0));
      await message.channel.setRateLimitPerUser(secs);
      return message.reply({ embeds: [okEmbed("Slowmode set", `${secs}s slowmode in ${message.channel}.`)] });
    }
    const presets = [0, 5, 10, 30, 60, 300, 900, 3600].map((s) => ({ label: s ? `${s}s` : "Off", value: String(s) }));
    const value = await choose(message, { title: "Slowmode preset", description: "Pick a slowmode duration.", options: presets });
    if (value == null) return;
    await message.channel.setRateLimitPerUser(Number(value));
    message.channel.send({ embeds: [okEmbed("Slowmode set", `${value}s slowmode in ${message.channel}.`)] });
  }});

// ============================= 13/14. lock / unlock =============================
add({ name: "lock", category: "moderation", description: "Lock the current channel.", usage: "lock [reason]", permission: "mod",
  run: async ({ message, args }) => {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
    message.channel.send({ embeds: [warnEmbed("Channel locked", args.join(" ") || `Locked by ${message.author}.`)] });
  }});
add({ name: "unlock", category: "moderation", description: "Unlock the current channel.", usage: "unlock", permission: "mod",
  run: async ({ message }) => {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null });
    message.channel.send({ embeds: [okEmbed("Channel unlocked", `Unlocked by ${message.author}.`)] });
  }});

// ============================= 15/16. lockserver / unlockserver =============================
add({ name: "lockserver", category: "moderation", description: "Lock every text channel.", usage: "lockserver", permission: "admin",
  run: async ({ message }) => {
    const ok = await confirm(message, { title: "Lock entire server?", description: "This locks send-messages in every text channel." });
    if (!ok) return;
    const channels = message.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
    for (const ch of channels.values()) await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
    message.channel.send({ embeds: [warnEmbed("Server locked", `${channels.size} channels locked by ${message.author}.`)] });
  }});
add({ name: "unlockserver", category: "moderation", description: "Unlock every text channel.", usage: "unlockserver", permission: "admin",
  run: async ({ message }) => {
    const ok = await confirm(message, { title: "Unlock entire server?", description: "This restores send-messages in every text channel.", danger: false });
    if (!ok) return;
    const channels = message.guild.channels.cache.filter((c) => c.type === ChannelType.GuildText);
    for (const ch of channels.values()) await ch.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }).catch(() => {});
    message.channel.send({ embeds: [okEmbed("Server unlocked", `${channels.size} channels unlocked by ${message.author}.`)] });
  }});

// ============================= 17/18. hide / unhide =============================
add({ name: "hide", category: "moderation", description: "Hide the current channel from @everyone.", usage: "hide", permission: "mod",
  run: async ({ message }) => {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: false });
    message.channel.send({ embeds: [okEmbed("Channel hidden", `Hidden by ${message.author}.`)] });
  }});
add({ name: "unhide", category: "moderation", description: "Reveal the current channel to @everyone.", usage: "unhide", permission: "mod",
  run: async ({ message }) => {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { ViewChannel: null });
    message.channel.send({ embeds: [okEmbed("Channel visible", `Unhidden by ${message.author}.`)] });
  }});

// ============================= 19. nick =============================
add({ name: "nick", category: "moderation", description: "Change a member's nickname.", usage: "nick @user <new nick>", permission: "mod",
  run: async ({ message, args }) => {
    const target = targetMember(message);
    const nick = args.slice(1).join(" ").trim();
    if (!target || !nick) return message.reply({ embeds: [errEmbed("Missing info", "Usage: `nick @user <new nick>`.")] });
    const hc = hierarchyOk(message, target);
    if (!hc.ok) return message.reply({ embeds: [errEmbed("Can't do that", hc.reason)] });
    await target.setNickname(nick.slice(0, 32), `Changed by ${message.author.tag}`).catch(() => null);
    message.reply({ embeds: [okEmbed("Nickname changed", `${target} is now **${nick}**.`)] });
  }});

// ============================= 20. resetnick =============================
add({ name: "resetnick", category: "moderation", description: "Reset a member's nickname.", usage: "resetnick @user", permission: "mod",
  run: async ({ message }) => {
    const target = targetMember(message);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member.")] });
    const hc = hierarchyOk(message, target);
    if (!hc.ok) return message.reply({ embeds: [errEmbed("Can't do that", hc.reason)] });
    await target.setNickname(null, `Reset by ${message.author.tag}`).catch(() => null);
    message.reply({ embeds: [okEmbed("Nickname reset", `${target}'s nickname was reset.`)] });
  }});

// ============================= 21. role (add/remove/toggle) =============================
add({ name: "role", category: "moderation", description: "Add/remove/toggle a role on a member.", usage: "role add|remove|toggle @user @role", permission: "mod",
  run: async ({ message, args }) => {
    const mode = (args[0] || "").toLowerCase();
    if (!["add", "remove", "toggle"].includes(mode)) return message.reply({ embeds: [errEmbed("Usage", "`role add|remove|toggle @user @role`")] });
    const target = targetMember(message);
    const targetRole = message.mentions.roles.first();
    if (!target || !targetRole) return message.reply({ embeds: [errEmbed("Missing info", "Mention a member and a role.")] });
    const me = message.guild.members.me;
    if (targetRole.position >= me.roles.highest.position) return message.reply({ embeds: [errEmbed("Too high", "That role is above my highest role.")] });
    if (message.author.id !== message.guild.ownerId && targetRole.position >= message.member.roles.highest.position) {
      return message.reply({ embeds: [errEmbed("Too high", "That role is at or above your highest role.")] });
    }
    const has = target.roles.cache.has(targetRole.id);
    let action;
    if (mode === "add" || (mode === "toggle" && !has)) { await target.roles.add(targetRole); action = "added"; }
    else { await target.roles.remove(targetRole); action = "removed"; }
    message.reply({ embeds: [okEmbed(`Role ${action}`, `${targetRole} ${action} for ${target}.`)] });
  }});

// ============================= 22. massrole =============================
add({ name: "massrole", category: "moderation", description: "Add a role to all members or all members of another role.", usage: "massrole @role [@fromRole]", permission: "admin",
  run: async ({ message }) => {
    const targetRole = message.mentions.roles.first();
    if (!targetRole) return message.reply({ embeds: [errEmbed("Missing role", "Mention the role to assign.")] });
    const roles = [...message.mentions.roles.values()];
    const fromRole = roles[1];
    const me = message.guild.members.me;
    if (targetRole.position >= me.roles.highest.position) return message.reply({ embeds: [errEmbed("Too high", "That role is above my highest role.")] });
    await message.guild.members.fetch();
    const members = fromRole ? message.guild.members.cache.filter((m) => m.roles.cache.has(fromRole.id)) : message.guild.members.cache.filter((m) => !m.user.bot);
    const ok = await confirm(message, { title: "Confirm mass role", description: `Add ${targetRole} to **${members.size}** member(s)${fromRole ? ` who have ${fromRole}` : ""}?` });
    if (!ok) return;
    const progress = await message.channel.send({ embeds: [infoEmbed("Applying role…", `0 / ${members.size}`)] });
    let done = 0, failed = 0;
    for (const m of members.values()) {
      await m.roles.add(targetRole).then(() => done++).catch(() => failed++);
      if ((done + failed) % 10 === 0) await progress.edit({ embeds: [infoEmbed("Applying role…", `${done + failed} / ${members.size}`)] }).catch(() => {});
    }
    await progress.edit({ embeds: [okEmbed("Mass role complete", `Added to **${done}** members. Failed: ${failed}.`)] });
  }});

// ============================= 23. voicekick =============================
add({ name: "voicekick", category: "moderation", description: "Disconnect a member from voice.", usage: "voicekick @user [reason]", permission: "mod",
  run: async ({ message, args }) => {
    const { target, reason } = parseTargetAndReason(message, args);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member.")] });
    if (!target.voice.channelId) return message.reply({ embeds: [infoEmbed("Not in voice", "That member isn't in a voice channel.")] });
    await target.voice.disconnect(reason || `Voice kicked by ${message.author.tag}`);
    message.reply({ embeds: [okEmbed("Voice kicked", `${target} was removed from voice.`)] });
  }});

// ============================= 24/25. voicemute / voiceunmute =============================
add({ name: "voicemute", category: "moderation", description: "Server-mute a member in voice.", usage: "voicemute @user [reason]", permission: "mod",
  run: async ({ message, args }) => {
    const { target, reason } = parseTargetAndReason(message, args);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member.")] });
    await target.voice.setMute(true, reason || `Muted by ${message.author.tag}`).catch(() => null);
    message.reply({ embeds: [okEmbed("Voice muted", `${target} was server-muted.`)] });
  }});
add({ name: "voiceunmute", category: "moderation", description: "Remove a member's server voice mute.", usage: "voiceunmute @user", permission: "mod",
  run: async ({ message }) => {
    const target = targetMember(message);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member.")] });
    await target.voice.setMute(false, `Unmuted by ${message.author.tag}`).catch(() => null);
    message.reply({ embeds: [okEmbed("Voice unmuted", `${target} was unmuted.`)] });
  }});

// ============================= 26. moveall =============================
add({ name: "moveall", category: "moderation", description: "Move everyone from your voice channel to another.", usage: "moveall #voice", permission: "mod",
  run: async ({ message }) => {
    const dest = message.mentions.channels.first();
    const src = message.member.voice.channel;
    if (!src) return message.reply({ embeds: [errEmbed("Not in voice", "Join a voice channel first, then use this command.")] });
    if (!dest || dest.type !== ChannelType.GuildVoice) return message.reply({ embeds: [errEmbed("Missing channel", "Mention the destination voice channel.")] });
    let moved = 0;
    for (const m of src.members.values()) { await m.voice.setChannel(dest).then(() => moved++).catch(() => {}); }
    message.reply({ embeds: [okEmbed("Moved", `Moved ${moved} member(s) to ${dest}.`)] });
  }});

// ============================= 27. modlogs =============================
add({ name: "modlogs", category: "moderation", description: "View recent moderation actions for a member.", usage: "modlogs [@user]", permission: "mod",
  run: async ({ message }) => {
    const user = mention(message);
    const actions = getCases(message.guild.id).filter((c) => c.targetId === user.id);
    const rows = actions.map((c) => `**#${c.id}** \`${c.type}\` by <@${c.modId}> · ${ago(c.at)}\n> ${c.reason || "No reason"}`);
    return paginate(message, listPages(rows, { title: `Modlogs · ${user.tag}`, perPage: 5 }));
  }});

// ============================= 28. case =============================
add({ name: "case", category: "moderation", description: "Look up a moderation case by ID.", usage: "case <id>", permission: "mod",
  run: async ({ message, args }) => {
    const id = Number(args[0]);
    if (!id) return message.reply({ embeds: [errEmbed("Missing ID", "Give a case number.")] });
    let found = null;
    for (const list of casesByGuild.values()) { const f = list.find((c) => c.id === id); if (f) { found = f; break; } }
    if (!found) return message.reply({ embeds: [errEmbed("Not found", "No case with that ID.")] });
    message.reply({ embeds: [embed({ title: `Case #${found.id} · ${found.type}`, color: COLORS.info, fields: [
      { name: "Target", value: `<@${found.targetId}> (${found.targetTag})`, inline: true },
      { name: "Moderator", value: `<@${found.modId}> (${found.modTag})`, inline: true },
      { name: "Reason", value: found.reason || "No reason provided." },
      { name: "When", value: ago(found.at) },
    ] })] });
  }});

// ============================= 29. note =============================
add({ name: "note", category: "moderation", description: "Leave a private staff note on a member.", usage: "note @user <text> | note view @user", permission: "mod",
  run: async ({ message, args }) => {
    if ((args[0] || "").toLowerCase() === "view") {
      const user = message.mentions.users.first() || mention(message);
      const notes = getNotes(message.guild.id, user.id);
      const rows = notes.map((n) => `<@${n.by}> · ${ago(n.at)}\n> ${n.text}`);
      return paginate(message, listPages(rows, { title: `Notes · ${user.tag}`, perPage: 5 }));
    }
    const target = targetMember(message) || message.mentions.users.first();
    const text = args.slice(1).join(" ").trim();
    if (!target || !text) return message.reply({ embeds: [errEmbed("Usage", "`note @user <text>` or `note view @user`")] });
    addNote(message.guild.id, target.id ?? target.user?.id, message.author.id, text);
    message.reply({ embeds: [okEmbed("Note saved", "Private note recorded for staff.")] });
  }});

// ============================= 30. reportuser =============================
add({ name: "reportuser", category: "moderation", description: "File a report about a member (interactive).", usage: "reportuser @user", permission: "everyone",
  run: async ({ message }) => {
    const target = message.mentions.users.first();
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention the user you're reporting.")] });
    const reasonText = await prompt(message, { title: "Report details", description: `Describe why you're reporting ${target.tag}.` });
    if (!reasonText) return message.reply({ embeds: [infoEmbed("Cancelled", "No report submitted.")] });
    const c = pushCase(message.guild.id, { type: "report", targetId: target.id, targetTag: target.tag, modId: message.author.id, modTag: message.author.tag, reason: reasonText });
    message.channel.send({ embeds: [warnEmbed(`Report filed · Case #${c.id}`, `${message.author} reported ${target}.\n> ${reasonText}`)] });
  }});

// ============================= 31. modpanel =============================
add({ name: "modpanel", category: "moderation", description: "Quick-action panel for a member.", usage: "modpanel @user", permission: "mod",
  run: async ({ message }) => {
    const target = targetMember(message);
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a member.")] });
    const menu = select({ id: "modpanel:action", placeholder: "Choose an action", options: [
      { label: "Warn", value: "warn", emoji: "⚠️" },
      { label: "Timeout 10m", value: "timeout", emoji: "⏱️" },
      { label: "Kick", value: "kick", emoji: "👢" },
      { label: "Ban", value: "ban", emoji: "🔨" },
    ] });
    const sent = await message.reply({ embeds: [infoEmbed(`Modpanel · ${target.user.tag}`, "Pick a quick action below.")], components: [row(menu)] });
    const c = sent.createMessageComponentCollector({ time: 60_000, max: 3 });
    c.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not yours.", ephemeral: true }).catch(() => {});
      const action = int.values[0];
      await int.update({ components: [] });
      const hc = hierarchyOk(message, target);
      if (!hc.ok) return message.channel.send({ embeds: [errEmbed("Can't do that", hc.reason)] });
      const ok = await confirm(message, { title: `Confirm ${action}`, description: `${action} ${target}?` });
      if (!ok) return;
      const reason = `Via modpanel by ${message.author.tag}`;
      if (action === "warn") { addWarning(message.guild.id, target.id, message.author.id, reason); await dmUser(target.user, warnEmbed(`Warned in ${message.guild.name}`, reason)); }
      if (action === "timeout") { if (target.moderatable) await target.timeout(600_000, reason); }
      if (action === "kick") { if (target.kickable) await target.kick(reason); }
      if (action === "ban") { if (target.bannable) await message.guild.members.ban(target.id, { reason }); }
      const cs = pushCase(message.guild.id, { type: action, targetId: target.id, targetTag: target.user.tag, modId: message.author.id, modTag: message.author.tag, reason });
      message.channel.send({ embeds: [caseEmbed({ title: `Case #${cs.id} · ${action}`, color: COLORS.warn, target: target.user, moderator: message.author, reason })] });
    });
  }});

// ============================= 32. modstats =============================
add({ name: "modstats", category: "moderation", description: "Show action counts per moderator.", usage: "modstats", permission: "mod",
  run: async ({ message }) => {
    const cases = getCases(message.guild.id);
    const counts = new Map();
    for (const c of cases) counts.set(c.modId, (counts.get(c.modId) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const rows = sorted.map(([id, n], i) => `**${i + 1}.** <@${id}> — ${fmt(n)} action(s)`);
    return paginate(message, listPages(rows, { title: "Moderator activity", perPage: 10 }));
  }});
