/**
 * YORU leveling commands — XP-based rank cards, leaderboards, level-role
 * announcements and admin tools. XP is stored via db.js; level-role config,
 * weekly counters and guild settings live in module-level Maps.
 */
import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed, button, row, select, bar,
  paginate, confirm, choose, listPages, fmt, mention, clamp, num, COLORS, EMOJI,
} from "../ui.js";
import { addXp, getXp, topXp, db } from "../db.js";

export const commands = [];
const add = (c) => commands.push(c);

// ------------------------------------------------------------- module state
const levelRoles = new Map(); // guildId -> [{level, roleId}]
const settings = new Map(); // guildId -> { announce: bool, channelId: string|null }
const weeklyXp = new Map(); // guildId -> Map(userId -> xp)

function getSettings(g) {
  if (!settings.has(g)) settings.set(g, { announce: true, channelId: null });
  return settings.get(g);
}
function getWeekly(g) {
  if (!weeklyXp.has(g)) weeklyXp.set(g, new Map());
  return weeklyXp.get(g);
}
function bumpWeekly(g, u, amount) {
  const m = getWeekly(g);
  m.set(u, (m.get(u) || 0) + amount);
}

// Level curve: level = floor(0.1 * sqrt(xp))  =>  xp for level L = (L/0.1)^2 = (10L)^2
function levelFromXp(xp) { return Math.floor(0.1 * Math.sqrt(Math.max(0, xp))); }
function xpForLevel(level) { return Math.pow(level * 10, 2); }
function xpProgress(xp) {
  const level = levelFromXp(xp);
  const curFloor = xpForLevel(level);
  const nextFloor = xpForLevel(level + 1);
  return { level, curFloor, nextFloor, into: xp - curFloor, span: nextFloor - curFloor };
}

function rankPosition(g, userId) {
  const rows = topXp(g, 100000);
  const idx = rows.findIndex((r) => r.user_id === userId);
  return { rank: idx === -1 ? rows.length + 1 : idx + 1, total: rows.length };
}

async function announceLevelUp(message, member, oldLevel, newLevel) {
  if (newLevel <= oldLevel) return;
  const s = getSettings(message.guild.id);
  if (!s.announce) return;
  const roles = levelRoles.get(message.guild.id) || [];
  const earned = roles.filter((r) => r.level === newLevel);
  const channel = s.channelId ? message.guild.channels.cache.get(s.channelId) : message.channel;
  if (!channel?.send) return;
  let roleNote = "";
  for (const r of earned) {
    const role = message.guild.roles.cache.get(r.roleId);
    if (role && member?.roles) {
      await member.roles.add(role).catch(() => {});
      roleNote += `\n🎖️ Unlocked role **${role.name}**!`;
    }
  }
  channel.send({ embeds: [embed({ title: "⬆️ Level Up!", description: `${member?.user?.username || "Someone"} reached **Level ${newLevel}**!${roleNote}`, color: COLORS.brand })] }).catch(() => {});
}

// ----------------------------------------------------------------- 1. rank
add({
  name: "rank", category: "levels", description: "View your (or someone's) rank card.", usage: "rank [@user]", permission: "everyone", aliases: ["level", "lvl"],
  run: async ({ message }) => {
    const target = mention(message);
    const g = message.guild.id;
    const xp = getXp(g, target.id);
    const p = xpProgress(xp);
    const { rank, total } = rankPosition(g, target.id);
    return message.reply({
      embeds: [embed({
        title: `📈 ${target.username}'s Rank`,
        thumbnail: target.displayAvatarURL?.(),
        fields: [
          { name: "Level", value: `**${p.level}**`, inline: true },
          { name: "Rank", value: `#${rank} / ${total}`, inline: true },
          { name: "Total XP", value: fmt(xp), inline: true },
          { name: "Progress to next level", value: `${bar(p.into, p.span)}\n${fmt(p.into)} / ${fmt(p.span)} XP` },
        ],
        color: COLORS.brand,
      })],
    });
  },
});

// ------------------------------------------------------------ 2. lvlboard
add({
  name: "lvlboard", category: "levels", description: "Level leaderboard for this server.", usage: "lvlboard", permission: "everyone", aliases: ["levelboard", "levels-top"],
  run: async ({ message }) => {
    const g = message.guild.id;
    const rows = topXp(g, 100);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, i) => `${medals[i] || `#${i + 1}`} <@${r.user_id}> — Level **${levelFromXp(r.xp)}** (${fmt(r.xp)} XP)`);
    const pages = listPages(lines, { title: "🏆 Level Leaderboard", perPage: 10 });
    await paginate(message, pages);
  },
});

// ------------------------------------------------------------- 3. xp add
add({
  name: "xpadd", category: "levels", description: "Admin: add XP to a user.", usage: "xpadd @user <amount>", permission: "admin", aliases: [],
  run: async ({ message, args }) => {
    if (!message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "You need Administrator to do this.")] });
    const target = message.mentions.users.first();
    const amount = num(args.find((a) => /^\d+$/.test(a)), 0);
    if (!target || amount <= 0) return message.reply({ embeds: [errEmbed("Invalid usage", "Usage: `xpadd @user <amount>`")] });
    const oldLevel = levelFromXp(getXp(message.guild.id, target.id));
    const xp = addXp(message.guild.id, target.id, amount);
    const newLevel = levelFromXp(xp);
    await announceLevelUp(message, message.guild.members.cache.get(target.id), oldLevel, newLevel);
    return message.reply({ embeds: [okEmbed("XP Added", `Gave **${fmt(amount)} XP** to ${target.username} (now Level ${newLevel}).`)] });
  },
});

// ------------------------------------------------------------ 4. xp remove
add({
  name: "xpremove", category: "levels", description: "Admin: remove XP from a user.", usage: "xpremove @user <amount>", permission: "admin", aliases: [],
  run: async ({ message, args }) => {
    if (!message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "You need Administrator to do this.")] });
    const target = message.mentions.users.first();
    const amount = num(args.find((a) => /^\d+$/.test(a)), 0);
    if (!target || amount <= 0) return message.reply({ embeds: [errEmbed("Invalid usage", "Usage: `xpremove @user <amount>`")] });
    const cur = getXp(message.guild.id, target.id);
    const xp = addXp(message.guild.id, target.id, -Math.min(cur, amount));
    return message.reply({ embeds: [okEmbed("XP Removed", `Removed **${fmt(Math.min(cur, amount))} XP** from ${target.username} (now Level ${levelFromXp(xp)}).`)] });
  },
});

// -------------------------------------------------------------- 5. xp set
add({
  name: "xpset", category: "levels", description: "Admin: set a user's XP exactly.", usage: "xpset @user <amount>", permission: "admin", aliases: [],
  run: async ({ message, args }) => {
    if (!message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "You need Administrator to do this.")] });
    const target = message.mentions.users.first();
    const amount = num(args.find((a) => /^\d+$/.test(a)), -1);
    if (!target || amount < 0) return message.reply({ embeds: [errEmbed("Invalid usage", "Usage: `xpset @user <amount>`")] });
    const cur = getXp(message.guild.id, target.id);
    const xp = addXp(message.guild.id, target.id, amount - cur);
    return message.reply({ embeds: [okEmbed("XP Set", `${target.username}'s XP is now **${fmt(xp)}** (Level ${levelFromXp(xp)}).`)] });
  },
});

// ---------------------------------------------------------- 6. levelroles set
add({
  name: "levelroles-set", category: "levels", description: "Admin: assign a role to be granted at a level.", usage: "levelroles-set <level> @role", permission: "admin", aliases: ["setlevelrole"],
  run: async ({ message, args }) => {
    if (!message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "You need Administrator to do this.")] });
    const level = num(args[0], -1);
    const role = message.mentions.roles.first();
    if (level < 1 || !role) return message.reply({ embeds: [errEmbed("Invalid usage", "Usage: `levelroles-set <level> @role`")] });
    const g = message.guild.id;
    if (!levelRoles.has(g)) levelRoles.set(g, []);
    const list = levelRoles.get(g);
    const existing = list.find((r) => r.level === level);
    if (existing) existing.roleId = role.id; else list.push({ level, roleId: role.id });
    return message.reply({ embeds: [okEmbed("Level Role Set", `Members will receive **${role.name}** upon reaching Level **${level}**.`)] });
  },
});

// --------------------------------------------------------- 7. levelroles list
add({
  name: "levelroles-list", category: "levels", description: "List configured level-role rewards.", usage: "levelroles-list", permission: "everyone", aliases: ["levelroles"],
  run: async ({ message }) => {
    const list = (levelRoles.get(message.guild.id) || []).sort((a, b) => a.level - b.level);
    const lines = list.map((r) => `**Level ${r.level}** → <@&${r.roleId}>`);
    const pages = listPages(lines, { title: "🎖️ Level Role Rewards", perPage: 10 });
    await paginate(message, pages);
  },
});

// ------------------------------------------------------- 8. levelroles remove
add({
  name: "levelroles-remove", category: "levels", description: "Admin: remove a level-role reward.", usage: "levelroles-remove <level>", permission: "admin", aliases: ["removelevelrole"],
  run: async ({ message, args }) => {
    if (!message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "You need Administrator to do this.")] });
    const level = num(args[0], -1);
    const g = message.guild.id;
    const list = levelRoles.get(g) || [];
    const idx = list.findIndex((r) => r.level === level);
    if (idx === -1) return message.reply({ embeds: [errEmbed("Not found", `No level-role reward set for Level ${level}.`)] });
    list.splice(idx, 1);
    return message.reply({ embeds: [okEmbed("Removed", `Removed the level-role reward for Level ${level}.`)] });
  },
});

// ----------------------------------------------------- 9. levelup-message
add({
  name: "levelup-message", category: "levels", description: "Toggle level-up announcements or set their channel.", usage: "levelup-message <on|off> | levelup-message channel [#channel]", permission: "admin", aliases: ["lvlup-toggle", "levelup-channel"],
  run: async ({ message, args }) => {
    if (!message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "You need Administrator to do this.")] });
    const s = getSettings(message.guild.id);
    const sub = (args[0] || "").toLowerCase();
    if (sub === "channel") {
      const channel = message.mentions.channels.first();
      s.channelId = channel ? channel.id : null;
      return message.reply({ embeds: [okEmbed("Updated", channel ? `Level-up messages will be sent in ${channel}.` : "Level-up messages will be sent in the channel where they're triggered.")] });
    }
    if (!["on", "off"].includes(sub)) return message.reply({ embeds: [errEmbed("Invalid usage", "Usage: `levelup-message <on|off>` or `levelup-message channel [#channel]`")] });
    s.announce = sub === "on";
    return message.reply({ embeds: [okEmbed("Updated", `Level-up announcements are now **${s.announce ? "enabled" : "disabled"}**.`)] });
  },
});

// ------------------------------------------------------------ 11. xpcurve
add({
  name: "xpcurve", category: "levels", description: "Explains the XP-to-level math YORU uses.", usage: "xpcurve", permission: "everyone", aliases: ["curve"],
  run: async ({ message }) => {
    const sample = [1, 5, 10, 20, 50].map((l) => `Level **${l}** requires **${fmt(xpForLevel(l))}** XP`).join("\n");
    return message.reply({
      embeds: [embed({
        title: "📐 XP Curve",
        description: `YORU computes your level as:\n\`level = floor(0.1 * sqrt(xp))\`\n\nWhich inverts to:\n\`xp required = (level * 10)²\`\n\nThis means level requirements grow quadratically — climbing early levels is fast, later ones take much longer.\n\n**Examples:**\n${sample}`,
        color: COLORS.info,
      })],
    });
  },
});

// -------------------------------------------------------- 12. weekly xp top
add({
  name: "weeklytop", category: "levels", description: "View this week's most active XP earners.", usage: "weeklytop", permission: "everyone", aliases: ["wxptop"],
  run: async ({ message }) => {
    const m = getWeekly(message.guild.id);
    const rows = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map(([id, xp], i) => `${medals[i] || `#${i + 1}`} <@${id}> — **${fmt(xp)} XP** this week`);
    const pages = listPages(lines, { title: "📅 Weekly XP Leaderboard", perPage: 10, footer: "Resets when YORU restarts or via admin tools" });
    await paginate(message, pages);
  },
});

// ------------------------------------------------------------- 13. compare
add({
  name: "compare", category: "levels", description: "Compare your level stats against another user.", usage: "compare @user", permission: "everyone", aliases: ["vs"],
  run: async ({ message }) => {
    const target = message.mentions.users.first();
    if (!target || target.id === message.author.id) return message.reply({ embeds: [errEmbed("Invalid target", "Mention someone else to compare with.")] });
    const g = message.guild.id;
    const a = { user: message.author, xp: getXp(g, message.author.id) };
    const b = { user: target, xp: getXp(g, target.id) };
    const pa = xpProgress(a.xp), pb = xpProgress(b.xp);
    const winner = a.xp === b.xp ? "It's a tie!" : (a.xp > b.xp ? `${a.user.username} is ahead!` : `${b.user.username} is ahead!`);
    return message.reply({
      embeds: [embed({
        title: `⚔️ ${a.user.username} vs ${b.user.username}`,
        fields: [
          { name: a.user.username, value: `Level **${pa.level}**\n${fmt(a.xp)} XP\n${bar(pa.into, pa.span, 8)}`, inline: true },
          { name: b.user.username, value: `Level **${pb.level}**\n${fmt(b.xp)} XP\n${bar(pb.into, pb.span, 8)}`, inline: true },
        ],
        description: `**${winner}**`,
        color: COLORS.brand,
      })],
    });
  },
});

// --------------------------------------------------------- 14a. top-chatters
add({
  name: "top-chatters", category: "levels", description: "Ranks members by total XP as a proxy for chat activity.", usage: "top-chatters", permission: "everyone", aliases: ["topchatters"],
  run: async ({ message }) => {
    const g = message.guild.id;
    const rows = topXp(g, 100);
    const lines = rows.map((r, i) => `#${i + 1} <@${r.user_id}> — **${fmt(r.xp)} XP** (Level ${levelFromXp(r.xp)})`);
    const pages = listPages(lines, { title: "💬 Top Chatters", perPage: 10, footer: "Ranked by total XP earned from chatting" });
    await paginate(message, pages);
  },
});

// ---------------------------------------------------------- 14. levelpanel
add({
  name: "levelpanel", category: "levels", description: "Interactive panel to jump between rank, leaderboard and settings.", usage: "levelpanel", permission: "everyone", aliases: ["lvlpanel"],
  run: async ({ message }) => {
    const g = message.guild.id;
    const buildRankView = () => {
      const xp = getXp(g, message.author.id);
      const p = xpProgress(xp);
      const { rank, total } = rankPosition(g, message.author.id);
      return embed({
        title: `📈 ${message.author.username}'s Rank`,
        fields: [
          { name: "Level", value: `**${p.level}**`, inline: true },
          { name: "Rank", value: `#${rank} / ${total}`, inline: true },
          { name: "Total XP", value: fmt(xp), inline: true },
          { name: "Progress", value: bar(p.into, p.span) },
        ],
        color: COLORS.brand,
      });
    };
    const buildLeaderboardView = () => {
      const rows = topXp(g, 10);
      const medals = ["🥇", "🥈", "🥉"];
      const lines = rows.map((r, i) => `${medals[i] || `#${i + 1}`} <@${r.user_id}> — Level ${levelFromXp(r.xp)} (${fmt(r.xp)} XP)`);
      return embed({ title: "🏆 Level Leaderboard (Top 10)", description: lines.join("\n") || "No data yet.", color: COLORS.brand });
    };
    const buildSettingsView = () => {
      const s = getSettings(g);
      const roles = (levelRoles.get(g) || []).sort((a, b) => a.level - b.level);
      return embed({
        title: "⚙️ Leveling Settings",
        fields: [
          { name: "Level-up Announcements", value: s.announce ? "Enabled" : "Disabled", inline: true },
          { name: "Announcement Channel", value: s.channelId ? `<#${s.channelId}>` : "Current channel", inline: true },
          { name: "Level Roles", value: roles.length ? roles.map((r) => `Level ${r.level} → <@&${r.roleId}>`).join("\n") : "None configured" },
        ],
        color: COLORS.info,
      });
    };
    const views = { rank: buildRankView, leaderboard: buildLeaderboardView, settings: buildSettingsView };
    const menu = select({
      id: "lvlpanel:nav", placeholder: "Choose a view…",
      options: [
        { label: "My Rank", value: "rank", emoji: "📈" },
        { label: "Leaderboard", value: "leaderboard", emoji: "🏆" },
        { label: "Settings", value: "settings", emoji: "⚙️" },
      ],
    });
    const sent = await message.reply({ embeds: [views.rank()], components: [row(menu)] });
    const cl = sent.createMessageComponentCollector({ time: 90_000 });
    cl.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your panel.", ephemeral: true }).catch(() => {});
      const view = views[int.values[0]];
      await int.update({ embeds: [view()] }).catch(() => {});
    });
    cl.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  },
});
