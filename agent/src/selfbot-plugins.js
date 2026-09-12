/**
 * Headless-viable reimplementations of the Illegalcord / Vencord plugins that
 * make sense on a discord.js-selfbot-v13 client (no React UI to patch).
 *
 * Each plugin exports { id, name, description, defaultConfig, hooks }.
 * The runtime calls plugin hooks with a shared context so plugins stay
 * isolated and can be toggled at runtime from the owner panel.
 *
 *   hooks: {
 *     onReady?(ctx), onMessage?(ctx, message),
 *     onMessageUpdate?(ctx, oldMsg, newMsg), onMessageDelete?(ctx, message),
 *     onOutgoing?(ctx, { content }) → { content } | null (return null = block send),
 *     onCommand?(ctx, message, { name, args, raw }) → boolean (true = handled),
 *   }
 */
import { db } from "./db.js";
import { logActivity } from "./activity.js";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(HERE, "..", "lookups");
try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
const appendLog = (file, line) => { try { appendFileSync(path.join(LOG_DIR, file), line + "\n"); } catch {} };

/* ---------- persistence ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS selfbot_plugins (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  config TEXT NOT NULL DEFAULT '{}'
);
`);

const getRow = (id) => db.prepare("SELECT enabled, config FROM selfbot_plugins WHERE id = ?").get(id);
const upsertRow = (id, enabled, config) =>
  db.prepare(`INSERT INTO selfbot_plugins (id, enabled, config) VALUES (?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, config = excluded.config`)
    .run(id, enabled ? 1 : 0, JSON.stringify(config || {}));

/* ---------- plugin definitions ---------- */
export const PLUGINS = [];
export const P = (def) => { PLUGINS.push(def); return def; };


/* 1 · AutoReplyDM — canned reply to any DM from a non-friend / unknown */
P({
  id: "autoReplyDM", name: "Auto-reply DMs",
  description: "Sends a one-time canned reply the first time a stranger DMs you (per user, resets on restart).",
  defaultConfig: { message: "hey — i'll get back to you when i can.", onlyStrangers: true },
  state: { seen: new Set() },
  hooks: {
    async onMessage(ctx, msg) {
      if (msg.guild || msg.author.id === ctx.selfId) return;
      const cfg = ctx.cfg;
      if (this.state.seen.has(msg.author.id)) return;
      if (cfg.onlyStrangers && msg.author.relationship === "FRIEND") return;
      this.state.seen.add(msg.author.id);
      await msg.channel.send(cfg.message).catch(() => {});
      logActivity("selfbot", `autoreply → ${msg.author.username}`);
    },
  },
});

/* 2 · AntiGhostPing — detects deleted mentions of self */
P({
  id: "antiGhostPing", name: "Anti ghost-ping",
  description: "Logs when a message that mentioned you gets deleted before you saw it.",
  defaultConfig: { logToFile: true, dmSelf: false },
  hooks: {
    async onMessageDelete(ctx, msg) {
      if (!msg?.mentions?.users?.has?.(ctx.selfId)) return;
      const line = `[${new Date().toISOString()}] ghost-ping in #${msg.channel?.name || msg.channelId} from @${msg.author?.username || "?"}: ${msg.content}`;
      if (ctx.cfg.logToFile) appendLog("ghost-pings.txt", line);
      if (ctx.cfg.dmSelf) {
        const me = await ctx.client.users.fetch(ctx.selfId).catch(() => null);
        me?.send?.(`👻 ${line}`).catch(() => {});
      }
      logActivity("selfbot", "ghost-ping caught");
    },
  },
});

/* 3 · MessageLogger — logs edits + deletes to a file */
P({
  id: "messageLogger", name: "Message logger",
  description: "Writes every edited/deleted message you can see to lookups/message-log.txt.",
  defaultConfig: { edits: true, deletes: true, ignoreSelf: true },
  hooks: {
    onMessageUpdate(ctx, oldMsg, newMsg) {
      if (!ctx.cfg.edits) return;
      if (ctx.cfg.ignoreSelf && newMsg.author?.id === ctx.selfId) return;
      if (oldMsg?.content === newMsg?.content) return;
      appendLog("message-log.txt", `[${new Date().toISOString()}] EDIT @${newMsg.author?.username} in #${newMsg.channel?.name || newMsg.channelId}: ${oldMsg?.content || ""} → ${newMsg.content}`);
    },
    onMessageDelete(ctx, msg) {
      if (!ctx.cfg.deletes) return;
      if (ctx.cfg.ignoreSelf && msg.author?.id === ctx.selfId) return;
      appendLog("message-log.txt", `[${new Date().toISOString()}] DEL  @${msg.author?.username} in #${msg.channel?.name || msg.channelId}: ${msg.content}`);
    },
  },
});

/* 4 · AutoReact — react to every message in configured channels */
P({
  id: "autoReact", name: "Auto-react",
  description: "Reacts to every new message in the listed channel IDs with the configured emojis.",
  defaultConfig: { channelIds: [], emojis: ["👀"] },
  hooks: {
    async onMessage(ctx, msg) {
      if (!ctx.cfg.channelIds?.includes(msg.channelId)) return;
      for (const e of ctx.cfg.emojis || []) await msg.react(e).catch(() => {});
    },
  },
});

/* 5 · Purger — $purge N deletes your last N messages in a channel */
P({
  id: "purger", name: "Self purge command",
  description: "Type $purge <n> in any channel to delete your last N messages (max 100).",
  defaultConfig: { command: "purge", max: 100 },
  hooks: {
    async onCommand(ctx, msg, { name, args }) {
      if (name !== ctx.cfg.command) return false;
      const n = Math.min(Number(args[0]) || 10, ctx.cfg.max);
      const msgs = await msg.channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!msgs) return true;
      let killed = 0;
      for (const m of msgs.values()) {
        if (killed >= n) break;
        if (m.author.id !== ctx.selfId) continue;
        await m.delete().catch(() => {});
        killed++;
      }
      logActivity("selfbot", `purged ${killed} own messages`);
      return true;
    },
  },
});

/* 6 · TextReplace — regex replace on outgoing messages */
P({
  id: "textReplace", name: "Text replace",
  description: "Regex find/replace on outgoing messages. Handy for :shrug: → ¯\\_(ツ)_/¯ etc.",
  defaultConfig: {
    rules: [
      { find: ":shrug:", flags: "g", replace: "¯\\_(ツ)_/¯" },
      { find: ":tf:", flags: "g", replace: "(╯°□°)╯︵ ┻━┻" },
    ],
  },
  hooks: {
    onOutgoing(ctx, { content }) {
      let out = content;
      for (const r of ctx.cfg.rules || []) {
        try { out = out.replace(new RegExp(r.find, r.flags || "g"), r.replace); } catch {}
      }
      return { content: out };
    },
  },
});

/* 7 · AntiTrackURL — strips tracking params from outgoing links */
P({
  id: "antiTrackURL", name: "Anti-track URLs",
  description: "Strips utm_*, fbclid, gclid, ref, mc_* etc. from any URL you send.",
  defaultConfig: { extraParams: [] },
  hooks: {
    onOutgoing(ctx, { content }) {
      const baseKill = /^(utm_|mc_|_hs|hsa_|ref$|ref_|fbclid$|gclid$|yclid$|mkt_tok$|igshid$|si$|share$)/i;
      const extra = new Set((ctx.cfg.extraParams || []).map((s) => s.toLowerCase()));
      const out = content.replace(/https?:\/\/[^\s]+/g, (u) => {
        try {
          const url = new URL(u);
          for (const k of [...url.searchParams.keys()]) {
            if (baseKill.test(k) || extra.has(k.toLowerCase())) url.searchParams.delete(k);
          }
          return url.toString().replace(/\?$/, "");
        } catch { return u; }
      });
      return { content: out };
    },
  },
});

/* 8 · FakeTyping — $type <seconds> shows typing in the channel */
P({
  id: "fakeTyping", name: "Fake typing",
  description: "$type <seconds> — shows a typing indicator in the current channel for N seconds.",
  defaultConfig: { command: "type", maxSeconds: 30 },
  hooks: {
    async onCommand(ctx, msg, { name, args }) {
      if (name !== ctx.cfg.command) return false;
      const secs = Math.min(Math.max(Number(args[0]) || 5, 1), ctx.cfg.maxSeconds);
      const until = Date.now() + secs * 1000;
      (async () => {
        while (Date.now() < until) {
          await msg.channel.sendTyping().catch(() => {});
          await new Promise((r) => setTimeout(r, 8000));
        }
      })();
      await msg.delete().catch(() => {});
      return true;
    },
  },
});

/* 9 · Presence — force custom status + online state */
P({
  id: "presence", name: "Presence",
  description: "Sets a fixed custom status and online state (online/idle/dnd/invisible) on connect.",
  defaultConfig: { status: "dnd", customText: "" },
  hooks: {
    async onReady(ctx) {
      try {
        await ctx.client.user.setStatus(ctx.cfg.status || "online");
        if (ctx.cfg.customText != null) {
          await ctx.client.user.setActivity(ctx.cfg.customText || "", { type: 4 }).catch(() => {});
        }
      } catch {}
    },
  },
});

/* 10 · StatusRotator — cycles custom status text on an interval */
P({
  id: "statusRotator", name: "Status rotator",
  description: "Rotates your custom status through a list every N seconds.",
  defaultConfig: { texts: ["afk", "coding", "sleeping"], intervalSeconds: 300 },
  state: { timer: null, i: 0 },
  hooks: {
    onReady(ctx) {
      clearInterval(this.state.timer);
      this.state.timer = setInterval(async () => {
        const list = ctx.cfg.texts || [];
        if (!list.length) return;
        this.state.i = (this.state.i + 1) % list.length;
        await ctx.client.user.setActivity(list[this.state.i], { type: 4 }).catch(() => {});
      }, Math.max(30, Number(ctx.cfg.intervalSeconds) || 300) * 1000);
    },
  },
});

/* 11 · PingSpy — logs anyone pinging you */
P({
  id: "pingSpy", name: "Ping spy",
  description: "Appends every mention of you (in servers) to lookups/pings.txt.",
  defaultConfig: {},
  hooks: {
    onMessage(ctx, msg) {
      if (!msg.guild || msg.author.id === ctx.selfId) return;
      if (!msg.mentions?.users?.has?.(ctx.selfId)) return;
      appendLog("pings.txt", `[${new Date().toISOString()}] ${msg.guild.name} #${msg.channel.name} @${msg.author.username}: ${msg.content}`);
    },
  },
});

/* 12 · CopyRaw — $raw on a reply DMs you the raw source of that message */
P({
  id: "copyRaw", name: "Copy raw",
  description: "Reply to a message with $raw — the raw content is sent to your DMs.",
  defaultConfig: { command: "raw" },
  hooks: {
    async onCommand(ctx, msg, { name }) {
      if (name !== ctx.cfg.command) return false;
      const ref = await msg.fetchReference().catch(() => null);
      if (!ref) return true;
      const me = await ctx.client.users.fetch(ctx.selfId);
      await me.send("```\n" + (ref.content || "(embed/attachment only)").slice(0, 1900) + "\n```").catch(() => {});
      await msg.delete().catch(() => {});
      return true;
    },
  },
});

/* 13 · QuoteReply — $quote quote-embeds the replied message */
P({
  id: "quoteReply", name: "Quote reply",
  description: "$quote on a reply → posts a formatted quote of that message.",
  defaultConfig: { command: "quote" },
  hooks: {
    async onCommand(ctx, msg, { name }) {
      if (name !== ctx.cfg.command) return false;
      const ref = await msg.fetchReference().catch(() => null);
      if (!ref) return true;
      const q = ref.content.split("\n").map((l) => `> ${l}`).join("\n");
      await msg.channel.send(`${q}\n— @${ref.author.username}`);
      await msg.delete().catch(() => {});
      return true;
    },
  },
});

/* 14 · ServerInfo — $serverinfo */
P({
  id: "serverInfo", name: "Server info command",
  description: "$serverinfo posts a quick summary of the current server.",
  defaultConfig: { command: "serverinfo" },
  hooks: {
    async onCommand(ctx, msg, { name }) {
      if (name !== ctx.cfg.command) return false;
      const g = msg.guild;
      if (!g) return true;
      await msg.channel.send(
        `**${g.name}**\nID: \`${g.id}\`\nOwner: <@${g.ownerId}>\nMembers: ${g.memberCount}\nChannels: ${g.channels.cache.size}\nRoles: ${g.roles.cache.size}\nCreated: <t:${Math.floor(g.createdTimestamp / 1000)}:R>`,
      );
      await msg.delete().catch(() => {});
      return true;
    },
  },
});

/* 15 · UserInfo — $userinfo <id|mention> */
P({
  id: "userInfo", name: "User info command",
  description: "$userinfo <@user|id> posts basic info about a user.",
  defaultConfig: { command: "userinfo" },
  hooks: {
    async onCommand(ctx, msg, { name, args }) {
      if (name !== ctx.cfg.command) return false;
      const id = (args[0] || "").replace(/[<@!>]/g, "") || msg.author.id;
      const u = await ctx.client.users.fetch(id).catch(() => null);
      if (!u) { await msg.channel.send("no such user."); return true; }
      await msg.channel.send(
        `**${u.username}**\nID: \`${u.id}\`\nBot: ${u.bot}\nCreated: <t:${Math.floor(u.createdTimestamp / 1000)}:R>`,
      );
      await msg.delete().catch(() => {});
      return true;
    },
  },
});

/* 16 · EmojiSpam — $spam <n> <emoji> reacts to the replied message n times */
P({
  id: "emojiSpam", name: "Reaction spam",
  description: "$react <emoji> reacts to the replied message with that emoji (headless-safe, one react).",
  defaultConfig: { command: "react" },
  hooks: {
    async onCommand(ctx, msg, { name, args }) {
      if (name !== ctx.cfg.command) return false;
      const ref = await msg.fetchReference().catch(() => null);
      if (!ref || !args[0]) return true;
      await ref.react(args[0]).catch(() => {});
      await msg.delete().catch(() => {});
      return true;
    },
  },
});

/* 17 · FriendInviteBlocker — auto-decline group DM invites from strangers */
P({
  id: "friendInviteBlocker", name: "Group DM auto-leave",
  description: "Automatically leaves group DMs you get added to by non-friends.",
  defaultConfig: { onlyStrangers: true },
  hooks: {
    onReady(ctx) {
      ctx.client.on("channelCreate", async (ch) => {
        if (ch.type !== "GROUP_DM") return;
        const owner = ch.ownerId ? await ctx.client.users.fetch(ch.ownerId).catch(() => null) : null;
        if (ctx.cfg.onlyStrangers && owner?.relationship === "FRIEND") return;
        await ch.delete().catch(() => {});
        logActivity("selfbot", `left group DM from @${owner?.username || "?"}`);
      });
    },
  },
});

/* 18 · KeywordAlerts — DMs you when a keyword appears in any channel */
P({
  id: "keywordAlerts", name: "Keyword alerts",
  description: "DMs yourself when any of the configured keywords appears anywhere.",
  defaultConfig: { keywords: [], caseSensitive: false },
  hooks: {
    async onMessage(ctx, msg) {
      const kws = ctx.cfg.keywords || [];
      if (!kws.length || msg.author.id === ctx.selfId) return;
      const hay = ctx.cfg.caseSensitive ? msg.content : msg.content.toLowerCase();
      const hit = kws.find((k) => hay.includes(ctx.cfg.caseSensitive ? k : k.toLowerCase()));
      if (!hit) return;
      const me = await ctx.client.users.fetch(ctx.selfId).catch(() => null);
      me?.send?.(`🔔 **${hit}** — ${msg.guild ? `${msg.guild.name} #${msg.channel.name}` : "DM"} · @${msg.author.username}\n${msg.content.slice(0, 500)}\n${msg.url || ""}`).catch(() => {});
    },
  },
});

/* 19 · AFKResponder — while enabled, auto-replies to DMs with an AFK message */
P({
  id: "afk", name: "AFK auto-responder",
  description: "While on, any DM gets an AFK reply (once per user per session).",
  defaultConfig: { message: "afk — will reply later." },
  state: { seen: new Set() },
  hooks: {
    async onMessage(ctx, msg) {
      if (msg.guild || msg.author.id === ctx.selfId) return;
      if (this.state.seen.has(msg.author.id)) return;
      this.state.seen.add(msg.author.id);
      await msg.channel.send(ctx.cfg.message).catch(() => {});
    },
  },
});

/* 20 · NoReplyPing — strips the mention on your reply so it doesn't ping */
P({
  id: "noReplyPing", name: "Silent replies",
  description: "Suppresses the ping on your Discord replies (Discord's 'ping off' toggle, but forced).",
  defaultConfig: {},
  hooks: {
    onOutgoing(ctx, payload) {
      payload.allowedMentions = { repliedUser: false };
      return payload;
    },
  },
});

/* 21 · Prefix — sets the self-command prefix ($ by default) */
P({
  id: "commandPrefix", name: "Command prefix",
  description: "Prefix used by all self-commands above. Only messages from you trigger commands.",
  defaultConfig: { prefix: "$" },
  hooks: {},
});

/* Register the extended 200+ self-command library. */
import { registerSelfCommands } from "./selfbot-commands.js";
registerSelfCommands(P);


/* ---------- public API ---------- */
export function listPlugins() {
  return PLUGINS.map((p) => {
    const row = getRow(p.id);
    const cfg = row?.config ? JSON.parse(row.config) : {};
    return {
      id: p.id, name: p.name, description: p.description,
      enabled: !!row?.enabled,
      config: { ...p.defaultConfig, ...cfg },
      defaultConfig: p.defaultConfig,
    };
  });
}
export function setPluginEnabled(id, enabled) {
  const p = PLUGINS.find((x) => x.id === id); if (!p) throw new Error("Unknown plugin");
  const row = getRow(id); const cfg = row?.config ? JSON.parse(row.config) : p.defaultConfig;
  upsertRow(id, enabled, cfg);
  return { id, enabled };
}
export function setPluginConfig(id, config) {
  const p = PLUGINS.find((x) => x.id === id); if (!p) throw new Error("Unknown plugin");
  const row = getRow(id);
  const merged = { ...p.defaultConfig, ...(row?.config ? JSON.parse(row.config) : {}), ...config };
  upsertRow(id, !!row?.enabled, merged);
  return { id, config: merged };
}

/* ---------- runtime ---------- */
function pluginCtx(client, plugin) {
  const row = getRow(plugin.id);
  const cfg = { ...plugin.defaultConfig, ...(row?.config ? JSON.parse(row.config) : {}) };
  return { client, selfId: client.user.id, cfg };
}
function activePlugins() {
  return PLUGINS.filter((p) => !!getRow(p.id)?.enabled);
}
function pluginByIdEnabled(id) {
  const p = PLUGINS.find((x) => x.id === id);
  return p && getRow(p.id)?.enabled ? p : null;
}
function getPrefix() {
  const row = getRow("commandPrefix");
  const cfg = row?.config ? JSON.parse(row.config) : { prefix: "$" };
  return cfg.prefix || "$";
}

/** Attach plugin hooks to a running selfbot client. */
export function attachPlugins(client) {
  // onReady immediately if client is already ready
  const runReady = () => {
    for (const p of activePlugins()) {
      try { p.hooks.onReady?.(pluginCtx(client, p)); } catch (e) { console.error(`[plugin:${p.id}]`, e.message); }
    }
  };
  if (client.readyAt) runReady(); else client.once("ready", runReady);

  client.on("messageCreate", async (msg) => {
    // Self-commands: only messages authored by you, starting with the prefix.
    if (msg.author?.id === client.user.id) {
      const prefix = getPrefix();
      if (msg.content.startsWith(prefix)) {
        const [name, ...args] = msg.content.slice(prefix.length).trim().split(/\s+/);
        for (const p of activePlugins()) {
          if (!p.hooks.onCommand) continue;
          try {
            const handled = await p.hooks.onCommand(pluginCtx(client, p), msg, { name, args, raw: msg.content });
            if (handled) return;
          } catch (e) { console.error(`[plugin:${p.id}]`, e.message); }
        }
      }
    }
    // onMessage for everyone
    for (const p of activePlugins()) {
      if (!p.hooks.onMessage) continue;
      try { await p.hooks.onMessage(pluginCtx(client, p), msg); } catch (e) { console.error(`[plugin:${p.id}]`, e.message); }
    }
  });

  client.on("messageUpdate", async (oldMsg, newMsg) => {
    for (const p of activePlugins()) {
      if (!p.hooks.onMessageUpdate) continue;
      try { await p.hooks.onMessageUpdate(pluginCtx(client, p), oldMsg, newMsg); } catch {}
    }
  });
  client.on("messageDelete", async (msg) => {
    for (const p of activePlugins()) {
      if (!p.hooks.onMessageDelete) continue;
      try { await p.hooks.onMessageDelete(pluginCtx(client, p), msg); } catch {}
    }
  });
}

/** Runs the outgoing pipeline. Returns the (possibly mutated) payload, or null to abort. */
export async function runOutgoing(client, payload) {
  let cur = { ...payload };
  for (const p of activePlugins()) {
    if (!p.hooks.onOutgoing) continue;
    try {
      const out = await p.hooks.onOutgoing(pluginCtx(client, p), cur);
      if (out === null) return null;
      if (out) cur = { ...cur, ...out };
    } catch (e) { console.error(`[plugin:${p.id}]`, e.message); }
  }
  return cur;
}
