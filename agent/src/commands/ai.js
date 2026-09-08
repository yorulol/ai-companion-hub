/** AI commands — talking to YORU itself. */
import {
  embed, okEmbed, errEmbed, infoEmbed, warnEmbed, COLORS, EMOJI,
  button, row, paginate, confirm, choose, listPages, codeBlock, num,
} from "../ui.js";
import { chat } from "../chat-loop.js";
import { knownModels, ollamaModels, providerStatus, refreshModels } from "../ai.js";
import { lookup as searchLookups, listLookupFiles } from "../lookups.js";
import { db, getGuild, saveGuild } from "../db.js";
import { ComponentType } from "discord.js";

export const commands = [];
const add = (c) => commands.push(c);

const personas = new Map(); // channelId -> tone

const scopeFor = (message) => `c:${message.channel.id}:${message.author.id}`;

/** Split a long answer into paginated embeds. */
function answerPages(text, { title = "YORU", footer } = {}) {
  const clean = String(text || "(no response)");
  const size = 1800;
  const parts = [];
  for (let i = 0; i < clean.length; i += size) parts.push(clean.slice(i, i + size));
  return parts.map((p, i) =>
    embed({ title: parts.length > 1 ? `${title} (${i + 1}/${parts.length})` : title, description: p, footer }),
  );
}

async function askYoru(message, text, { mode = "general", isOwner = false, title = "YORU", scope } = {}) {
  await message.channel.sendTyping().catch(() => {});
  const tone = personas.get(message.channel.id);
  const userText = tone ? `[tone: ${tone}]\n${text}` : text;
  const { reply, provider, model } = await chat({
    scope: scope || scopeFor(message), userText, mode, isOwner,
  });
  return { reply, footer: `${provider} · ${model}`, pages: answerPages(reply, { title, footer: `${provider} · ${model}` }) };
}

// 1 — main chat, with Regenerate / Continue buttons
add({ name: "ai", category: "ai", description: "Chat with YORU.", usage: "ai <message>", permission: "everyone",
  aliases: ["ask", "yoru"],
  run: async ({ message, args, isOwner }) => {
    const text = args.join(" ");
    if (!text) return void message.reply({ embeds: [infoEmbed("Ask me anything", "`ai What's the fastest way to learn Rust?`")] });

    const first = await askYoru(message, text, { isOwner });
    const controls = (disabled = false) => row(
      button({ id: "ai:regen", label: "Regenerate", emoji: "🔁", style: "secondary", disabled }),
      button({ id: "ai:more", label: "Continue", emoji: "➡️", style: "primary", disabled }),
    );
    const sent = await message.reply({ embeds: [first.pages[0]], components: [controls()] });
    if (first.pages.length > 1) await paginate(message, first.pages.slice(1), { userId: message.author.id });

    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 180_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return void int.reply({ content: "Not your chat.", ephemeral: true }).catch(() => {});
      await int.deferUpdate().catch(() => {});
      const follow = int.customId === "ai:regen"
        ? await askYoru(message, `Answer this again, differently: ${text}`, { isOwner })
        : await askYoru(message, "Continue your previous answer.", { isOwner });
      await sent.edit({ embeds: [follow.pages[0]], components: [controls()] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [controls(true)] }).catch(() => {}));
  }});

// 2 — coding
add({ name: "code", category: "ai", description: "Coding help from YORU.", usage: "code <question>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    if (!args.length) return void message.reply({ embeds: [infoEmbed("Coding mode", "`code write a debounce in TypeScript`")] });
    const { reply, footer } = await askYoru(message, args.join(" "), { mode: "coding", isOwner, title: "YORU · code" });
    const body = reply.includes("```") ? reply : codeBlock(reply);
    const sent = await message.reply({
      embeds: [embed({ title: "YORU · code", description: body.slice(0, 4000), footer })],
      components: [row(button({ id: "code:explain", label: "Explain this", emoji: "🧠", style: "primary" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 180_000, max: 3 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return void int.reply({ content: "Not your chat.", ephemeral: true }).catch(() => {});
      await int.deferUpdate().catch(() => {});
      const ex = await askYoru(message, `Explain the code you just wrote, line by line, plainly.`, { mode: "coding", isOwner });
      await paginate(message, ex.pages, { userId: message.author.id });
    });
  }});

// 3 — explain
add({ name: "explain", category: "ai", description: "Explain a reply or pasted code.", usage: "explain [text] (or reply to a message)", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const ref = message.reference ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null) : null;
    const target = args.join(" ") || ref?.content;
    if (!target) return void message.reply({ embeds: [infoEmbed("Nothing to explain", "Reply to a message or paste something after the command.")] });
    const { pages } = await askYoru(message, `Explain this clearly:\n${target}`, { isOwner, title: "Explanation" });
    await paginate(message, pages, { userId: message.author.id });
  }});

// 4 — review
add({ name: "review", category: "ai", description: "Code review with findings.", usage: "review <code>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const ref = message.reference ? await message.channel.messages.fetch(message.reference.messageId).catch(() => null) : null;
    const code = args.join(" ") || ref?.content;
    if (!code) return void message.reply({ embeds: [infoEmbed("Paste some code", "`review <code>` or reply to a code message.")] });
    const { reply, footer } = await askYoru(message, `Review this code. Reply as short bullet findings, each starting with a severity word (Critical/Warning/Nit):\n${code}`, { mode: "coding", isOwner });
    const lines = reply.split("\n").filter((l) => l.trim()).slice(0, 20);
    await message.reply({ embeds: [embed({
      title: "🔍 Code review",
      description: lines.length ? lines.map((l) => `• ${l.replace(/^[-*•]\s*/, "")}`).join("\n").slice(0, 4000) : reply,
      color: COLORS.info, footer,
    })] });
  }});

// 5 — debug
add({ name: "debug", category: "ai", description: "Diagnose an error message.", usage: "debug <error or stack trace>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    if (!args.length) return void message.reply({ embeds: [infoEmbed("Paste the error", "`debug TypeError: x is not a function …`")] });
    const { pages } = await askYoru(message, `Diagnose this problem and give the fix:\n${args.join(" ")}`, { mode: "coding", isOwner, title: "🐞 Debug" });
    await paginate(message, pages, { userId: message.author.id });
  }});

// 6 — translate
const LANGS = ["English", "Spanish", "French", "German", "Portuguese", "Italian", "Dutch", "Polish", "Russian", "Arabic", "Hindi", "Japanese", "Korean", "Chinese"];
add({ name: "translate", category: "ai", description: "Translate text.", usage: "translate <text>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const text = args.join(" ");
    if (!text) return void message.reply({ embeds: [infoEmbed("Translate what?", "`translate good morning my friend`")] });
    const lang = await choose(message, {
      title: "🌍 Translate into…",
      description: `> ${text.slice(0, 300)}`,
      options: LANGS.map((l) => ({ label: l, value: l })),
    });
    if (!lang) return;
    const { pages } = await askYoru(message, `Translate into ${lang}, reply with the translation only:\n${text}`, { isOwner, title: `Translation · ${lang}` });
    await paginate(message, pages, { userId: message.author.id });
  }});

// 7 — summarize channel
add({ name: "summarize", category: "ai", description: "Summarise recent channel messages.", usage: "summarize [count]", permission: "mod",
  run: async ({ message, args, isOwner }) => {
    const n = Math.min(200, Math.max(5, num(args[0], 50)));
    const fetched = await message.channel.messages.fetch({ limit: Math.min(100, n) }).catch(() => null);
    if (!fetched?.size) return void message.reply({ embeds: [errEmbed("Can't read history", "I couldn't fetch messages here.")] });
    const transcript = [...fetched.values()].reverse()
      .filter((m) => !m.author.bot && m.content)
      .map((m) => `${m.author.username}: ${m.content}`).join("\n").slice(0, 6000);
    const { pages } = await askYoru(message, `Summarise this conversation in short bullets, then one line on what needs a decision:\n${transcript}`, { isOwner, title: `📝 Summary of ${fetched.size} messages` });
    await paginate(message, pages, { userId: message.author.id });
  }});

// 8 — brainstorm
add({ name: "brainstorm", category: "ai", description: "Generate ideas.", usage: "brainstorm <topic>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const topic = args.join(" ");
    if (!topic) return void message.reply({ embeds: [infoEmbed("Brainstorm what?", "`brainstorm names for a coffee brand`")] });
    const first = await askYoru(message, `Give 8 numbered ideas about: ${topic}`, { isOwner, title: `💡 ${topic}` });
    const sent = await message.reply({ embeds: [first.pages[0]], components: [row(button({ id: "bs:more", label: "More ideas", emoji: "✨", style: "primary" }))] });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 180_000, max: 5 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return void int.reply({ content: "Not your list.", ephemeral: true }).catch(() => {});
      await int.deferUpdate().catch(() => {});
      const more = await askYoru(message, `8 more, completely different ideas about: ${topic}`, { isOwner, title: `💡 ${topic}` });
      await message.channel.send({ embeds: [more.pages[0]] }).catch(() => {});
    });
  }});

// 9 — persona
add({ name: "persona", category: "ai", description: "View or set YORU's tone here.", usage: "persona [tone]", permission: "mod",
  run: async ({ message, args }) => {
    const tone = args.join(" ");
    if (!tone) {
      return void message.reply({ embeds: [infoEmbed("Current tone", personas.get(message.channel.id) || "Default — sharp, warm, and doesn't take disrespect.")] });
    }
    personas.set(message.channel.id, tone.slice(0, 200));
    message.reply({ embeds: [okEmbed("Tone set", `In this channel I'll be: **${tone.slice(0, 200)}**`)] });
  }});

// 10 — memory
add({ name: "memory", category: "ai", description: "See this conversation's memory.", usage: "memory", permission: "everyone",
  run: async ({ message }) => {
    const scope = scopeFor(message);
    const rows = db.prepare("SELECT COUNT(*) AS n FROM memory WHERE scope = ?").get(scope);
    const sent = await message.reply({
      embeds: [embed({ title: "🧠 Memory", description: `I'm holding **${rows?.n || 0}** turns of our conversation here.`, color: COLORS.info })],
      components: [row(button({ id: "mem:clear", label: "Clear memory", style: "danger", emoji: "🧹" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000, max: 1 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return void int.reply({ content: "Not your memory.", ephemeral: true }).catch(() => {});
      await int.deferUpdate().catch(() => {});
      const yes = await confirm(message, { title: "Clear this conversation?", description: "I'll forget everything we said in this channel." });
      if (!yes) return;
      db.prepare("DELETE FROM memory WHERE scope = ?").run(scope);
      message.channel.send({ embeds: [okEmbed("Memory cleared", "Fresh start.")] }).catch(() => {});
    });
  }});

// 11 — reset
add({ name: "reset", category: "ai", description: "Clear this conversation's memory.", usage: "reset", permission: "everyone",
  run: async ({ message }) => {
    const yes = await confirm(message, { title: "Clear this conversation?", description: "Everything we said in this channel gets forgotten." });
    if (!yes) return;
    db.prepare("DELETE FROM memory WHERE scope = ?").run(scopeFor(message));
    message.channel.send({ embeds: [okEmbed("Memory cleared", "Fresh start.")] }).catch(() => {});
  }});

// 12 — imagine
add({ name: "imagine", category: "ai", description: "Craft a great image prompt.", usage: "imagine <idea>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    if (!args.length) return void message.reply({ embeds: [infoEmbed("Describe the idea", "`imagine a neon city in the rain`")] });
    const { reply, footer } = await askYoru(message, `Turn this into one richly detailed image prompt (subject, style, lighting, lens, mood). Reply with the prompt only: ${args.join(" ")}`, { isOwner });
    message.reply({ embeds: [embed({ title: "🎨 Image prompt", description: codeBlock(reply), footer })] });
  }});

// 13 — models
add({ name: "models", category: "ai", description: "List available AI models.", usage: "models", permission: "everyone",
  run: async ({ message }) => {
    const build = async () => {
      await refreshModels().catch(() => {});
      const { free, coding } = knownModels();
      const local = await ollamaModels().catch(() => []);
      const rows = [
        `**Free models (${free.length})**`, ...free.slice(0, 60).map((m) => `• \`${m}\``),
        `\n**Coding-tuned (${coding.length})**`, ...coding.slice(0, 30).map((m) => `• \`${m}\``),
        `\n**Local Ollama (${local.length})**`, ...local.map((m) => `• \`${m}\``),
      ];
      return listPages(rows, { title: "🧬 Model pool", perPage: 15 });
    };
    await paginate(message, await build(), { userId: message.author.id });
  }});

// 14 — provider status
add({ name: "provider", category: "ai", description: "AI provider health.", usage: "provider", permission: "everyone",
  run: async ({ message }) => {
    const s = await providerStatus().catch(() => null);
    if (!s) return void message.reply({ embeds: [errEmbed("Unavailable", "Couldn't read provider status.")] });
    const dot = (v) => (v ? "🟢 online" : "⚪ off");
    message.reply({ embeds: [embed({
      title: "⚡ Provider status",
      description: `Preferred: **${s.preferred}**`,
      color: COLORS.info,
      fields: [
        { name: "OpenRouter", value: `${dot(s.openrouter)}\n${s.freeModels || 0} free models`, inline: true },
        { name: "Ollama", value: dot(s.ollama), inline: true },
        { name: "Groq", value: dot(s.groq), inline: true },
        { name: "OpenAI", value: dot(s.openai), inline: true },
        { name: "Anthropic", value: dot(s.anthropic), inline: true },
      ],
    })] });
  }});

// 15 — lookup
add({ name: "lookup", category: "ai", description: "Search the lookups folder.", usage: "lookup <query>", permission: "mod",
  run: async ({ message, args }) => {
    const q = args.join(" ");
    if (!q) return void message.reply({ embeds: [infoEmbed("Search for what?", "`lookup someusername`")] });
    const thinking = await message.reply({ embeds: [infoEmbed("Searching…", `Scanning the lookups folder for \`${q}\`.`)] });
    try {
      const out = await searchLookups(q);
      const rows = [];
      for (const m of out.matches) {
        rows.push(`**${m.file}** — ${m.error ? `error: ${m.error}` : `${m.hits?.length || 0} hits`}`);
        for (const h of (m.hits || []).slice(0, 5)) rows.push(`> ${String(typeof h === "string" ? h : JSON.stringify(h)).slice(0, 300)}`);
      }
      await thinking.delete().catch(() => {});
      if (!rows.length) return void message.reply({ embeds: [warnEmbed("No matches", `Nothing for \`${q}\` across ${out.files} files.`)] });
      await paginate(message, listPages(rows, { title: `🔎 ${q} · ${out.files} files scanned`, perPage: 12 }), { userId: message.author.id });
    } catch (err) {
      await thinking.edit({ embeds: [errEmbed("Lookup failed", String(err.message))] }).catch(() => {});
    }
  }});

// 16 — lookup files
add({ name: "lookupfiles", category: "ai", description: "List files YORU can search.", usage: "lookupfiles", permission: "mod",
  run: async ({ message }) => {
    const files = await listLookupFiles().catch(() => []);
    if (!files.length) return void message.reply({ embeds: [warnEmbed("Lookups folder is empty", "Drop PDF / CSV / TXT / JSON files into `agent/lookups/`.")] });
    await paginate(message, listPages(files.map((f) => `📄 \`${f}\``), { title: `${EMOJI.info} Lookup sources (${files.length})`, perPage: 15 }), { userId: message.author.id });
  }});

export const _guildHelpers = { getGuild, saveGuild };
