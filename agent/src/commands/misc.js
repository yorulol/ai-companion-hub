/** Extra polished commands: quality-of-life utilities, generators, and vibes. */
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { theme, embed } from "../ui.js";

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];
const emb = (title, desc, color = theme.primary) => embed().setTitle(title).setDescription(desc).setColor(color);

export default [
  {
    name: "compliment", category: "Fun", description: "Deliver a warm, tasteful compliment.",
    async run({ message, args }) {
      const target = message.mentions.users.first() || message.author;
      const lines = [
        "carries a calm that makes rooms softer",
        "has taste that quietly raises the bar",
        "makes hard things look easy on purpose",
        "shows up with unreasonably good energy",
        "is the kind of person other people copy",
      ];
      await message.reply({ embeds: [emb("💜 compliment", `**${target.username}** ${pick(lines)}.`)] });
    },
  },
  {
    name: "coinflip", aliases: ["flip"], category: "Fun", description: "Flip a coin.",
    async run({ message }) {
      const result = Math.random() < 0.5 ? "Heads" : "Tails";
      await message.reply({ embeds: [emb("🪙 coin flip", `**${result}**`)] });
    },
  },
  {
    name: "roll", category: "Fun", description: "Roll dice, e.g. `!roll 2d20`.",
    async run({ message, args }) {
      const m = /^(\d+)?d(\d+)$/i.exec(args[0] || "1d6") || [];
      const n = Math.min(Math.max(parseInt(m[1] || "1", 10), 1), 25);
      const s = Math.min(Math.max(parseInt(m[2] || "6", 10), 2), 1000);
      const rolls = Array.from({ length: n }, () => 1 + rand(s));
      const total = rolls.reduce((a, b) => a + b, 0);
      await message.reply({ embeds: [emb(`🎲 ${n}d${s}`, `Rolls: \`${rolls.join(", ")}\`\n**Total:** ${total}`)] });
    },
  },
  {
    name: "choose", aliases: ["pick"], category: "Fun", description: "Pick one from a list. `!choose a | b | c`",
    async run({ message, args }) {
      const opts = args.join(" ").split("|").map((s) => s.trim()).filter(Boolean);
      if (opts.length < 2) return message.reply("Give me at least two options separated by `|`.");
      await message.reply({ embeds: [emb("🎯 pick", `**${pick(opts)}**`)] });
    },
  },
  {
    name: "8ball", category: "Fun", description: "Ask the magic 8ball a question.",
    async run({ message, args }) {
      if (!args.length) return message.reply("Ask a question first.");
      const answers = [
        "It is certain.", "Without a doubt.", "Yes — definitely.", "You may rely on it.",
        "Signs point to yes.", "Reply hazy, try again.", "Ask again later.",
        "Cannot predict now.", "Don't count on it.", "My reply is no.", "Very doubtful.",
      ];
      await message.reply({ embeds: [emb("🎱 8ball", `> ${args.join(" ")}\n\n**${pick(answers)}**`)] });
    },
  },
  {
    name: "password", aliases: ["pw"], category: "Utility", description: "Generate a strong password. `!password 24`",
    async run({ message, args }) {
      const len = Math.min(Math.max(parseInt(args[0] || "20", 10), 8), 128);
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
      let out = "";
      for (let i = 0; i < len; i++) out += chars[rand(chars.length)];
      try {
        await message.author.send({ embeds: [emb("🔑 password", "```\n" + out + "\n```")] });
        await message.reply("Sent to your DMs.");
      } catch {
        await message.reply({ embeds: [emb("🔑 password", "```\n" + out + "\n```\n(DMs closed — sent here.)", theme.warn)] });
      }
    },
  },
  {
    name: "uuid", category: "Utility", description: "Generate a random UUID v4.",
    async run({ message }) {
      const id = crypto.randomUUID();
      await message.reply({ embeds: [emb("🆔 uuid", "`" + id + "`")] });
    },
  },
  {
    name: "base64", category: "Utility", description: "`!base64 encode|decode <text>`",
    async run({ message, args }) {
      const mode = (args.shift() || "").toLowerCase();
      const text = args.join(" ");
      if (!text || !["encode", "decode"].includes(mode)) return message.reply("Use `!base64 encode|decode <text>`.");
      const out = mode === "encode" ? Buffer.from(text).toString("base64") : Buffer.from(text, "base64").toString("utf8");
      await message.reply({ embeds: [emb(`🧬 base64 ${mode}`, "```\n" + out + "\n```")] });
    },
  },
  {
    name: "hash", category: "Utility", description: "`!hash sha256|sha1|md5 <text>`",
    async run({ message, args }) {
      const algo = (args.shift() || "sha256").toLowerCase();
      const text = args.join(" ");
      if (!text) return message.reply("Give me text to hash.");
      const { createHash } = await import("node:crypto");
      try {
        const digest = createHash(algo).update(text).digest("hex");
        await message.reply({ embeds: [emb(`# ${algo}`, "`" + digest + "`")] });
      } catch {
        await message.reply("Unsupported algorithm.");
      }
    },
  },
  {
    name: "reverse", category: "Fun", description: "Reverse text.",
    async run({ message, args }) {
      if (!args.length) return message.reply("Give me text to reverse.");
      await message.reply({ embeds: [emb("↩️ reversed", args.join(" ").split("").reverse().join(""))] });
    },
  },
  {
    name: "mock", category: "Fun", description: "sPoNgEbOb text.",
    async run({ message, args }) {
      if (!args.length) return message.reply("Give me text to mock.");
      const out = args.join(" ").split("").map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
      await message.reply({ embeds: [emb("🧽 mock", out)] });
    },
  },
  {
    name: "vaporwave", category: "Fun", description: "Ｖａｐｏｒｗａｖｅ text.",
    async run({ message, args }) {
      if (!args.length) return message.reply("Give me text.");
      const map = (c) => (c.charCodeAt(0) >= 33 && c.charCodeAt(0) <= 126 ? String.fromCharCode(c.charCodeAt(0) + 0xfee0) : c === " " ? "　" : c);
      await message.reply({ embeds: [emb("🌴 vaporwave", args.join(" ").split("").map(map).join(""))] });
    },
  },
  {
    name: "timer", category: "Utility", description: "Ping you in N minutes. `!timer 5 stretch`",
    async run({ message, args }) {
      const mins = parseFloat(args.shift());
      if (!mins || mins <= 0 || mins > 24 * 60) return message.reply("Give minutes between 0.1 and 1440.");
      const note = args.join(" ") || "timer done";
      await message.reply({ embeds: [emb("⏱ timer", `I'll ping you in **${mins}m** — _${note}_`)] });
      setTimeout(() => message.reply(`<@${message.author.id}> ⏰ **${note}**`).catch(() => {}), mins * 60_000);
    },
  },
  {
    name: "poll", category: "Utility", description: "Quick 2-option poll. `!poll Question | yes | no`",
    async run({ message, args }) {
      const parts = args.join(" ").split("|").map((s) => s.trim());
      if (parts.length < 3) return message.reply("Format: `!poll Question | option A | option B`");
      const [q, a, b] = parts;
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("poll:a").setLabel(a).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("poll:b").setLabel(b).setStyle(ButtonStyle.Secondary),
      );
      await message.channel.send({ embeds: [emb("📊 " + q, `**A.** ${a}\n**B.** ${b}`)], components: [row] });
    },
  },
  {
    name: "quote", category: "Fun", description: "A stoic-flavored quote.",
    async run({ message }) {
      const quotes = [
        ["You have power over your mind — not outside events.", "Marcus Aurelius"],
        ["Waste no more time arguing what a good man should be. Be one.", "Marcus Aurelius"],
        ["He who fears death will never do anything worthy of a living man.", "Seneca"],
        ["It is not that we have a short time to live, but that we waste much of it.", "Seneca"],
        ["Man conquers the world by conquering himself.", "Zeno"],
      ];
      const [q, who] = pick(quotes);
      await message.reply({ embeds: [emb("📜 quote", `_"${q}"_\n— **${who}**`)] });
    },
  },
  {
    name: "afk", category: "Utility", description: "Set an AFK message.",
    async run({ message, args, ctx }) {
      const reason = args.join(" ") || "afk";
      ctx.afk = ctx.afk || new Map();
      ctx.afk.set(message.author.id, { reason, at: Date.now() });
      await message.reply({ embeds: [emb("💤 afk", `Set: _${reason}_`)] });
    },
  },
  {
    name: "remindme", aliases: ["rm"], category: "Utility", description: "Remind you later. `!remindme 30m water`",
    async run({ message, args }) {
      const spec = args.shift() || "";
      const m = /^(\d+)(s|m|h)$/i.exec(spec);
      if (!m) return message.reply("Use format `30s`, `10m`, or `2h`.");
      const ms = parseInt(m[1], 10) * ({ s: 1000, m: 60_000, h: 3_600_000 }[m[2].toLowerCase()]);
      if (ms > 24 * 3_600_000) return message.reply("Max 24 hours.");
      const note = args.join(" ") || "reminder";
      await message.reply({ embeds: [emb("🔔 reminder set", `In **${spec}** → _${note}_`)] });
      setTimeout(() => message.reply(`<@${message.author.id}> 🔔 **${note}**`).catch(() => {}), ms);
    },
  },
  {
    name: "color", aliases: ["hex"], category: "Utility", description: "Preview a hex color. `!color #7c3aed`",
    async run({ message, args }) {
      const hex = (args[0] || "").replace("#", "").toLowerCase();
      if (!/^[0-9a-f]{6}$/.test(hex)) return message.reply("Give a 6-char hex like `#7c3aed`.");
      const e = new EmbedBuilder().setTitle(`#${hex}`).setColor(parseInt(hex, 16)).setImage(`https://singlecolorimage.com/get/${hex}/200x80`);
      await message.reply({ embeds: [e] });
    },
  },
  {
    name: "define", category: "Utility", description: "Ask YORU for a plain-english definition.",
    async run({ message, args }) {
      if (!args.length) return message.reply("What word should I define?");
      const { chat } = await import("../chat-loop.js");
      const scope = `discord:${message.channel.id}`;
      const answer = await chat({ scope, userText: `Define "${args.join(" ")}" in one short paragraph.`, mode: "general" });
      await message.reply({ embeds: [emb(`📖 ${args.join(" ")}`, String(answer.content || "").slice(0, 1500))] });
    },
  },
  {
    name: "translate", category: "Utility", description: "`!translate <lang> <text>`",
    async run({ message, args }) {
      const lang = args.shift();
      const text = args.join(" ");
      if (!lang || !text) return message.reply("Use `!translate <lang> <text>`.");
      const { chat } = await import("../chat-loop.js");
      const answer = await chat({ scope: `discord:${message.channel.id}`, userText: `Translate to ${lang} (only the translation, no notes):\n${text}`, mode: "general" });
      await message.reply({ embeds: [emb(`🌐 → ${lang}`, String(answer.content || "").slice(0, 1500))] });
    },
  },
  {
    name: "shorten", category: "Utility", description: "Shorten a URL via is.gd.",
    async run({ message, args }) {
      const url = args[0];
      if (!url || !/^https?:\/\//i.test(url)) return message.reply("Give me a full URL starting with http(s)://.");
      try {
        const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
        const short = (await res.text()).trim();
        if (!/^https?:\/\//.test(short)) throw new Error(short);
        await message.reply({ embeds: [emb("🔗 shortened", short)] });
      } catch (e) { await message.reply("Shorten failed: " + e.message); }
    },
  },
  {
    name: "qr", category: "Utility", description: "QR code for text/URL.",
    async run({ message, args }) {
      if (!args.length) return message.reply("Give text or a URL.");
      const data = encodeURIComponent(args.join(" "));
      await message.reply({ embeds: [new EmbedBuilder().setTitle("QR").setColor(theme.primary).setImage(`https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${data}`)] });
    },
  },
  {
    name: "weather", category: "Utility", description: "Quick weather for a city.",
    async run({ message, args }) {
      const q = args.join(" ");
      if (!q) return message.reply("Give me a city.");
      try {
        const res = await fetch(`https://wttr.in/${encodeURIComponent(q)}?format=j1`);
        const j = await res.json();
        const c = j.current_condition?.[0];
        if (!c) throw new Error("no data");
        await message.reply({ embeds: [emb(`⛅ ${q}`, `**${c.temp_C}°C** — ${c.weatherDesc?.[0]?.value}\nFeels **${c.FeelsLikeC}°C** · Humidity ${c.humidity}% · Wind ${c.windspeedKmph} km/h`)] });
      } catch { await message.reply("Weather lookup failed."); }
    },
  },
  {
    name: "cat", category: "Fun", description: "Random cat photo.",
    async run({ message }) {
      try {
        const res = await fetch("https://api.thecatapi.com/v1/images/search");
        const [j] = await res.json();
        await message.reply({ embeds: [new EmbedBuilder().setTitle("🐱").setColor(theme.primary).setImage(j.url)] });
      } catch { await message.reply("Couldn't fetch a cat."); }
    },
  },
  {
    name: "dog", category: "Fun", description: "Random dog photo.",
    async run({ message }) {
      try {
        const res = await fetch("https://dog.ceo/api/breeds/image/random");
        const j = await res.json();
        await message.reply({ embeds: [new EmbedBuilder().setTitle("🐶").setColor(theme.primary).setImage(j.message)] });
      } catch { await message.reply("Couldn't fetch a dog."); }
    },
  },
  {
    name: "joke", category: "Fun", description: "A tasteful joke.",
    async run({ message }) {
      try {
        const res = await fetch("https://official-joke-api.appspot.com/random_joke");
        const j = await res.json();
        await message.reply({ embeds: [emb("😆 joke", `${j.setup}\n\n**${j.punchline}**`)] });
      } catch { await message.reply("Joke API is quiet — try again."); }
    },
  },
  {
    name: "urban", category: "Fun", description: "Urban Dictionary lookup.",
    async run({ message, args }) {
      if (!args.length) return message.reply("Give me a term.");
      try {
        const res = await fetch(`https://api.urbandictionary.com/v0/define?term=${encodeURIComponent(args.join(" "))}`);
        const j = await res.json();
        const d = j.list?.[0];
        if (!d) return message.reply("No definition found.");
        await message.reply({ embeds: [emb(`📚 ${d.word}`, d.definition.slice(0, 1200))] });
      } catch { await message.reply("Urban lookup failed."); }
    },
  },
  {
    name: "ascii", category: "Fun", description: "Turn text into ASCII art.",
    async run({ message, args }) {
      if (!args.length) return message.reply("Give me text (short works best).");
      try {
        const res = await fetch(`https://artii.herokuapp.com/make?text=${encodeURIComponent(args.join(" "))}`);
        const art = await res.text();
        await message.reply("```\n" + art.slice(0, 1900) + "\n```");
      } catch { await message.reply("ASCII service unavailable."); }
    },
  },
  {
    name: "say", category: "Utility", description: "Make YORU say something (owner only).",
    ownerOnly: true,
    async run({ message, args }) {
      if (!args.length) return;
      await message.delete().catch(() => {});
      await message.channel.send(args.join(" "));
    },
  },
  {
    name: "embed", category: "Utility", description: "Send a rich embed. `!embed Title | Description`",
    ownerOnly: true,
    async run({ message, args }) {
      const [title, ...rest] = args.join(" ").split("|");
      const desc = rest.join("|").trim() || "—";
      await message.channel.send({ embeds: [emb(title?.trim() || "Untitled", desc)] });
      await message.delete().catch(() => {});
    },
  },
];
