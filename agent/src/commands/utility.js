import crypto from "node:crypto";
import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed,
  button, row, select, bar, chunk, codeBlock, paginate, confirm, choose, prompt,
  listPages, RNG, pick, num, clamp, mention, targetMember, fmt, ago, COLORS, EMOJI,
} from "../ui.js";
import { setTag, getTag, deleteTag, listTags, setAfk, getAfk, clearAfk } from "../db.js";
import { chat } from "../chat-loop.js";

export const commands = [];
const add = (c) => commands.push(c);

// ---------------- module-level state ----------------
const reminders = new Map(); // id -> {userId, channelId, text, at, timeout}
const timers = new Map(); // messageId -> interval
const todos = new Map(); // userId -> [{text, done}]
const notesStore = new Map(); // userId -> [text]
const snipeCache = new Map(); // channelId -> {content, author, at}
const stopwatches = new Map(); // userId -> startedAt
let reminderSeq = 1;
let snipeHooked = false;

function hookSnipe(client) {
  if (snipeHooked) return;
  snipeHooked = true;
  client.on("messageDelete", (msg) => {
    if (!msg || msg.partial || !msg.author || msg.author.bot) return;
    snipeCache.set(msg.channelId, { content: msg.content || "*(no text content)*", author: msg.author.tag, avatar: msg.author.displayAvatarURL?.(), at: Date.now() });
  });
}

function parseDuration(str) {
  if (!str) return null;
  const re = /(\d+)\s*(d|h|m|s)/gi;
  let match, total = 0, found = false;
  while ((match = re.exec(str))) {
    found = true;
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    total += unit === "d" ? n * 86400000 : unit === "h" ? n * 3600000 : unit === "m" ? n * 60000 : n * 1000;
  }
  return found ? total : null;
}

// ---------------- safe calculator ----------------
function safeCalc(input) {
  const tokens = input.match(/\d+(\.\d+)?|\+|-|\*|\/|\^|%|\(|\)/g);
  if (!tokens) throw new Error("No valid tokens");
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function parseExpr() {
    let v = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = next();
      const r = parseTerm();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parsePow();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next();
      const r = parsePow();
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  }
  function parsePow() {
    let v = parseUnary();
    if (peek() === "^") { next(); const r = parsePow(); v = Math.pow(v, r); }
    return v;
  }
  function parseUnary() {
    if (peek() === "-") { next(); return -parseUnary(); }
    return parseAtom();
  }
  function parseAtom() {
    if (peek() === "(") { next(); const v = parseExpr(); if (peek() === ")") next(); return v; }
    const t = next();
    if (t === undefined || Number.isNaN(Number(t))) throw new Error("Bad expression");
    return Number(t);
  }
  const result = parseExpr();
  if (pos !== tokens.length) throw new Error("Unexpected trailing tokens");
  if (!Number.isFinite(result)) throw new Error("Result is not finite");
  return result;
}

const MORSE = { A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--..","0":"-----","1":".----","2":"..---","3":"...--","4":"....-","5":".....","6":"-....","7":"--...","8":"---..","9":"----."," ":"/" };
const MORSE_REV = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

const TIMEZONES = { UTC: "UTC", "New York": "America/New_York", "Los Angeles": "America/Los_Angeles", London: "Europe/London", Paris: "Europe/Paris", Tokyo: "Asia/Tokyo", Sydney: "Australia/Sydney", Dubai: "Asia/Dubai", "Sao Paulo": "America/Sao_Paulo", Kolkata: "Asia/Kolkata" };

// ================= POLL (multi option, live buttons) =================
add({ name: "poll", category: "utility", description: "Create a multi-option poll with live vote buttons.", usage: "poll <question> | <opt1> | <opt2> ...", permission: "everyone", aliases: [],
  run: async ({ message, args }) => {
    const raw = args.join(" ");
    const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 3) return message.reply({ embeds: [warnEmbed("Usage", "`poll <question> | <option 1> | <option 2> | ...` (up to 5 options)")] });
    const question = parts[0];
    const options = parts.slice(1, 6);
    const votes = new Map(); // userId -> optIndex
    const buildEmbed = () => {
      const counts = options.map((_, i) => [...votes.values()].filter((v) => v === i).length);
      const total = counts.reduce((a, b) => a + b, 0);
      const fields = options.map((o, i) => ({ name: `${i + 1}. ${o}`, value: `${bar(counts[i], total || 1)} (${counts[i]} vote${counts[i] === 1 ? "" : "s"})` }));
      return embed({ title: `📊 ${question}`, description: `Total votes: **${total}**`, fields, footer: `Poll by ${message.author.tag}` });
    };
    const buttons = options.map((o, i) => button({ id: `poll:${i}`, label: `${i + 1}`, style: "primary" }));
    const sent = await message.reply({ embeds: [buildEmbed()], components: [row(...buttons)] });
    const collector = sent.createMessageComponentCollector({ time: 10 * 60_000 });
    collector.on("collect", async (int) => {
      const idx = Number(int.customId.split(":")[1]);
      votes.set(int.user.id, idx);
      await int.update({ embeds: [buildEmbed()] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

// ================= TIMED POLL =================
add({ name: "tpoll", category: "utility", description: "Timed poll that auto-closes.", usage: "tpoll <duration e.g. 5m> | <question> | <opt1> | <opt2>", permission: "everyone",
  run: async ({ message, args }) => {
    const raw = args.join(" ");
    const parts = raw.split("|").map((s) => s.trim()).filter(Boolean);
    if (parts.length < 4) return message.reply({ embeds: [warnEmbed("Usage", "`tpoll <duration> | <question> | <opt1> | <opt2> ...`")] });
    const ms = parseDuration(parts[0]);
    if (!ms) return message.reply({ embeds: [errEmbed("Bad duration", "Use formats like `10m`, `1h`, `30s`.")] });
    const question = parts[1];
    const options = parts.slice(2, 7);
    const votes = new Map();
    const buildEmbed = (closed = false) => {
      const counts = options.map((_, i) => [...votes.values()].filter((v) => v === i).length);
      const total = counts.reduce((a, b) => a + b, 0);
      const fields = options.map((o, i) => ({ name: `${i + 1}. ${o}`, value: `${bar(counts[i], total || 1)} (${counts[i]})` }));
      return embed({ title: `${closed ? "🔒 Closed: " : "⏱️ "}${question}`, description: closed ? "Voting has ended." : `Closes ${ago(Date.now() + ms)} · Total votes: **${total}**`, fields });
    };
    const buttons = options.map((o, i) => button({ id: `tpoll:${i}`, label: `${i + 1}`, style: "primary" }));
    const sent = await message.reply({ embeds: [buildEmbed()], components: [row(...buttons)] });
    const collector = sent.createMessageComponentCollector({ time: ms });
    collector.on("collect", async (int) => {
      votes.set(int.user.id, Number(int.customId.split(":")[1]));
      await int.update({ embeds: [buildEmbed()] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ embeds: [buildEmbed(true)], components: [] }).catch(() => {}));
  } });

// ================= REMINDME =================
add({ name: "remindme", category: "utility", description: "Set a reminder with a natural duration (10m/2h/1d).", usage: "remindme <duration> <text>", permission: "everyone",
  run: async ({ message, args, client }) => {
    const ms = parseDuration(args[0]);
    if (!ms || args.length < 2) return message.reply({ embeds: [warnEmbed("Usage", "`remindme <10m|2h|1d> <text>`")] });
    const text = args.slice(1).join(" ");
    const id = reminderSeq++;
    const at = Date.now() + ms;
    const fire = async (snoozeMs = 0) => {
      try {
        const target = message.author;
        const dm = await target.createDM();
        const btn = row(button({ id: `remind:snooze:${id}`, label: "Snooze 10m", style: "secondary", emoji: "⏰" }));
        const sent = await dm.send({ embeds: [infoEmbed("⏰ Reminder", text)], components: [btn] });
        const col = sent.createMessageComponentCollector({ time: 5 * 60_000, max: 1 });
        col.on("collect", async (int) => {
          reminders.set(reminderSeq, { userId: message.author.id, text, timeout: setTimeout(() => fire(), 10 * 60_000) });
          reminderSeq++;
          await int.update({ embeds: [okEmbed("Snoozed", "I'll remind you again in 10 minutes.")], components: [] }).catch(() => {});
        });
      } catch { message.channel.send({ embeds: [infoEmbed("⏰ Reminder", `${message.author}, ${text}`)] }).catch(() => {}); }
    };
    const timeout = setTimeout(fire, ms);
    reminders.set(id, { userId: message.author.id, channelId: message.channel.id, text, at, timeout });
    message.reply({ embeds: [okEmbed("Reminder set", `I'll remind you ${ago(at)}:\n> ${text}`)] });
  } });

add({ name: "reminders", category: "utility", description: "List your pending reminders.", usage: "reminders", permission: "everyone",
  run: async ({ message }) => {
    const mine = [...reminders.entries()].filter(([, r]) => r.userId === message.author.id);
    if (!mine.length) return message.reply({ embeds: [infoEmbed("No reminders", "You have no pending reminders.")] });
    const fields = mine.map(([id, r]) => ({ name: `#${id}`, value: `${r.text} — ${ago(r.at)}` }));
    message.reply({ embeds: [embed({ title: "⏰ Your reminders", fields })] });
  } });

// ================= TIMER (live-editing countdown) =================
add({ name: "timer", category: "utility", description: "Start a live-updating countdown timer.", usage: "timer <duration>", permission: "everyone",
  run: async ({ message, args }) => {
    const ms = parseDuration(args[0]);
    if (!ms) return message.reply({ embeds: [warnEmbed("Usage", "`timer <10s|5m|1h>`")] });
    const end = Date.now() + ms;
    const sent = await message.reply({ embeds: [embed({ title: "⏳ Timer running", description: `Ends ${ago(end)}`, fields: [{ name: "Remaining", value: bar(ms, ms) }] })] });
    const interval = setInterval(async () => {
      const remaining = end - Date.now();
      if (remaining <= 0) {
        clearInterval(interval);
        await sent.edit({ embeds: [okEmbed("Time's up!", `${message.author}, your timer finished.`)] }).catch(() => {});
        return;
      }
      await sent.edit({ embeds: [embed({ title: "⏳ Timer running", description: `Ends ${ago(end)}`, fields: [{ name: "Remaining", value: bar(remaining, ms) }] })] }).catch(() => {});
    }, 5000);
    timers.set(sent.id, interval);
  } });

// ================= STOPWATCH =================
add({ name: "stopwatch", category: "utility", description: "Start or stop a personal stopwatch.", usage: "stopwatch <start|stop>", permission: "everyone",
  run: async ({ message, args }) => {
    const sub = (args[0] || "").toLowerCase();
    if (sub === "start") {
      stopwatches.set(message.author.id, Date.now());
      return message.reply({ embeds: [okEmbed("Stopwatch started", "Use `stopwatch stop` to see elapsed time.")] });
    }
    if (sub === "stop") {
      const started = stopwatches.get(message.author.id);
      if (!started) return message.reply({ embeds: [warnEmbed("Not running", "You haven't started a stopwatch. Use `stopwatch start`.")] });
      stopwatches.delete(message.author.id);
      const elapsed = Date.now() - started;
      const s = Math.floor(elapsed / 1000);
      return message.reply({ embeds: [okEmbed("Stopwatch stopped", `Elapsed: **${Math.floor(s / 60)}m ${s % 60}s**`)] });
    }
    message.reply({ embeds: [warnEmbed("Usage", "`stopwatch start` or `stopwatch stop`")] });
  } });

// ================= CALCULATOR =================
add({ name: "calc", category: "utility", description: "Evaluate a math expression safely.", usage: "calc <expression>", permission: "everyone",
  run: async ({ message, args }) => {
    const expr = args.join(" ");
    if (!expr) return message.reply({ embeds: [warnEmbed("Usage", "`calc 2 + 2 * (3 - 1) ^ 2`")] });
    try {
      const result = safeCalc(expr);
      message.reply({ embeds: [embed({ title: "🧮 Calculator", fields: [{ name: "Expression", value: codeBlock(expr) }, { name: "Result", value: codeBlock(fmt(result)) }], color: COLORS.info })] });
    } catch (e) {
      message.reply({ embeds: [errEmbed("Couldn't calculate that", `Only numbers and \`+ - * / % ^ ()\` are supported.\n${e.message}`)] });
    }
  } });

// ================= UNIT CONVERTER =================
const UNIT_CATEGORIES = {
  length: { m: 1, km: 1000, cm: 0.01, mm: 0.001, mi: 1609.34, yd: 0.9144, ft: 0.3048, in: 0.0254 },
  weight: { kg: 1, g: 0.001, lb: 0.453592, oz: 0.0283495, ton: 1000 },
  temperature: null,
};
add({ name: "unitconvert", category: "utility", description: "Convert between units using a category select menu.", usage: "unitconvert <value> <from> <to>", permission: "everyone",
  run: async ({ message, args }) => {
    const cat = await choose(message, { title: "Unit converter", description: "Pick a category, then reply e.g. `10 km mi`.", options: Object.keys(UNIT_CATEGORIES).map((k) => ({ label: k, value: k })) });
    if (!cat) return;
    const answer = await prompt(message, { title: `${cat} conversion`, description: "Type: `<value> <from unit> <to unit>` e.g. `10 km mi`" });
    if (!answer) return message.reply({ embeds: [warnEmbed("Timed out", "No answer received.")] });
    const [valStr, from, to] = answer.trim().split(/\s+/);
    const value = num(valStr, NaN);
    if (Number.isNaN(value) || !from || !to) return message.reply({ embeds: [errEmbed("Bad input", "Expected format: `<value> <from> <to>`")] });
    if (cat === "temperature") {
      const c = from === "c" ? value : from === "f" ? (value - 32) * (5 / 9) : value - 273.15;
      const outVal = to === "c" ? c : to === "f" ? c * (9 / 5) + 32 : c + 273.15;
      return message.reply({ embeds: [okEmbed("Converted", `${value}${from} = **${outVal.toFixed(2)}${to}**`)] });
    }
    const table = UNIT_CATEGORIES[cat];
    if (!table[from] || !table[to]) return message.reply({ embeds: [errEmbed("Unknown unit", `Valid units: ${Object.keys(table).join(", ")}`)] });
    const result = (value * table[from]) / table[to];
    message.reply({ embeds: [okEmbed("Converted", `${value} ${from} = **${result.toFixed(4)} ${to}**`)] });
  } });

// ================= CURRENCY =================
add({ name: "currency", category: "utility", description: "Convert between currencies.", usage: "currency <amount> <from> <to>", permission: "everyone",
  run: async ({ message, args }) => {
    const [amountStr, from, to] = args;
    const amount = num(amountStr, NaN);
    if (Number.isNaN(amount) || !from || !to) return message.reply({ embeds: [warnEmbed("Usage", "`currency 100 USD EUR`")] });
    try {
      const res = await fetch(`https://api.exchangerate-api.com/v4/latest/${from.toUpperCase()}`);
      if (!res.ok) throw new Error("API error");
      const data = await res.json();
      const rate = data.rates?.[to.toUpperCase()];
      if (!rate) return message.reply({ embeds: [errEmbed("Unknown currency", `Couldn't find rate for ${to.toUpperCase()}.`)] });
      const converted = amount * rate;
      message.reply({ embeds: [embed({ title: "💱 Currency conversion", description: `**${fmt(amount)} ${from.toUpperCase()}** = **${fmt(converted.toFixed(2))} ${to.toUpperCase()}**`, footer: `Rate: 1 ${from.toUpperCase()} = ${rate} ${to.toUpperCase()}` })] });
    } catch {
      message.reply({ embeds: [errEmbed("Conversion failed", "Currency service is unavailable right now.")] });
    }
  } });

// ================= WEATHER =================
add({ name: "weather", category: "utility", description: "Get the current weather for a location.", usage: "weather <city>", permission: "everyone",
  run: async ({ message, args }) => {
    const city = args.join(" ");
    if (!city) return message.reply({ embeds: [warnEmbed("Usage", "`weather London`")] });
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
      if (!res.ok) throw new Error("bad response");
      const data = await res.json();
      const cur = data.current_condition?.[0];
      const area = data.nearest_area?.[0];
      if (!cur) throw new Error("no data");
      const name = `${area?.areaName?.[0]?.value || city}, ${area?.country?.[0]?.value || ""}`;
      message.reply({ embeds: [embed({
        title: `🌤️ Weather in ${name}`,
        fields: [
          { name: "Condition", value: cur.weatherDesc?.[0]?.value || "—", inline: true },
          { name: "Temperature", value: `${cur.temp_C}°C / ${cur.temp_F}°F`, inline: true },
          { name: "Feels like", value: `${cur.FeelsLikeC}°C / ${cur.FeelsLikeF}°F`, inline: true },
          { name: "Humidity", value: `${cur.humidity}%`, inline: true },
          { name: "Wind", value: `${cur.windspeedKmph} km/h`, inline: true },
          { name: "UV Index", value: `${cur.uvIndex}`, inline: true },
        ],
        color: COLORS.info,
      })] });
    } catch {
      message.reply({ embeds: [errEmbed("Weather lookup failed", "Couldn't find weather for that location.")] });
    }
  } });

// ================= AI-BACKED COMMANDS =================
add({ name: "translate", category: "utility", description: "Translate text using AI.", usage: "translate <lang> <text>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const lang = args[0];
    const text = args.slice(1).join(" ");
    if (!lang || !text) return message.reply({ embeds: [warnEmbed("Usage", "`translate spanish Hello there`")] });
    try {
      const { reply } = await chat({ scope: `translate:${message.channel.id}`, userText: `Translate the following text into ${lang}. Reply with only the translation, nothing else:\n${text}`, mode: "utility", isOwner });
      message.reply({ embeds: [embed({ title: `🌐 Translation (${lang})`, description: reply, color: COLORS.info })] });
    } catch { message.reply({ embeds: [errEmbed("Translation failed", "The AI service is unavailable.")] }); }
  } });

add({ name: "define", category: "utility", description: "Define a word or phrase using AI.", usage: "define <word>", permission: "everyone",
  run: async ({ message, args, isOwner }) => {
    const term = args.join(" ");
    if (!term) return message.reply({ embeds: [warnEmbed("Usage", "`define serendipity`")] });
    try {
      const { reply } = await chat({ scope: `define:${message.channel.id}`, userText: `Give a concise dictionary-style definition (with part of speech) for: "${term}". Keep it under 80 words.`, mode: "utility", isOwner });
      message.reply({ embeds: [embed({ title: `📖 ${term}`, description: reply, color: COLORS.brand })] });
    } catch { message.reply({ embeds: [errEmbed("Definition failed", "The AI service is unavailable.")] }); }
  } });

add({ name: "summarize", category: "utility", description: "Summarize a replied-to message using AI.", usage: "summarize (reply to a message)", permission: "everyone",
  run: async ({ message, isOwner }) => {
    const ref = message.reference && await message.fetchReference().catch(() => null);
    if (!ref?.content) return message.reply({ embeds: [warnEmbed("Reply required", "Reply to a message with text and run `summarize`.")] });
    try {
      const { reply } = await chat({ scope: `summarize:${message.channel.id}`, userText: `Summarize the following message concisely:\n${ref.content}`, mode: "utility", isOwner });
      message.reply({ embeds: [embed({ title: "📝 Summary", description: reply, color: COLORS.info })] });
    } catch { message.reply({ embeds: [errEmbed("Summary failed", "The AI service is unavailable.")] }); }
  } });

// ================= ENCODE / DECODE =================
function makeCodec(name, label, encodeFn, decodeFn) {
  add({ name, category: "utility", description: `${label} encode/decode.`, usage: `${name} <encode|decode> <text>`, permission: "everyone",
    run: async ({ message, args }) => {
      const mode = (args[0] || "").toLowerCase();
      const text = args.slice(1).join(" ");
      if (!["encode", "decode"].includes(mode) || !text) return message.reply({ embeds: [warnEmbed("Usage", `\`${name} <encode|decode> <text>\``)] });
      try {
        const result = mode === "encode" ? encodeFn(text) : decodeFn(text);
        message.reply({ embeds: [embed({ title: `${label} — ${mode}`, fields: [{ name: "Input", value: codeBlock(text) }, { name: "Output", value: codeBlock(result) }] })] });
      } catch { message.reply({ embeds: [errEmbed("Failed", `Couldn't ${mode} that ${label} value.`)] }); }
    } });
}
makeCodec("base64", "Base64", (t) => Buffer.from(t, "utf8").toString("base64"), (t) => Buffer.from(t, "base64").toString("utf8"));
makeCodec("hex", "Hex", (t) => Buffer.from(t, "utf8").toString("hex"), (t) => Buffer.from(t, "hex").toString("utf8"));
makeCodec("urlencode", "URL", (t) => encodeURIComponent(t), (t) => decodeURIComponent(t));
makeCodec("rot13", "ROT13", (t) => t.replace(/[a-zA-Z]/g, (c) => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c.charCodeAt(0) + 13) ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13)), (t) => t.replace(/[a-zA-Z]/g, (c) => String.fromCharCode((c <= "Z" ? 90 : 122) >= (c.charCodeAt(0) + 13) ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13)));
makeCodec("morse", "Morse code", (t) => t.toUpperCase().split("").map((c) => MORSE[c] ?? c).join(" "), (t) => t.trim().split(" ").map((c) => MORSE_REV[c] ?? c).join(""));

// ================= HASHING / UUID / PASSWORD =================
add({ name: "sha256", category: "utility", description: "Generate a SHA-256 hash.", usage: "sha256 <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Usage", "`sha256 <text>`")] });
    message.reply({ embeds: [embed({ title: "🔐 SHA-256", fields: [{ name: "Hash", value: codeBlock(crypto.createHash("sha256").update(text).digest("hex")) }] })] });
  } });

add({ name: "md5", category: "utility", description: "Generate an MD5 hash.", usage: "md5 <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Usage", "`md5 <text>`")] });
    message.reply({ embeds: [embed({ title: "🔐 MD5", fields: [{ name: "Hash", value: codeBlock(crypto.createHash("md5").update(text).digest("hex")) }] })] });
  } });

add({ name: "uuid", category: "utility", description: "Generate a random UUID.", usage: "uuid", permission: "everyone",
  run: async ({ message }) => message.reply({ embeds: [embed({ title: "🆔 UUID", fields: [{ name: "Generated", value: codeBlock(crypto.randomUUID()) }] })] }) });

function genPassword(len = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+";
  return Array.from({ length: len }, () => chars[crypto.randomInt(chars.length)]).join("");
}
add({ name: "password", category: "utility", description: "Generate a strong password (sent via DM).", usage: "password [length]", permission: "everyone",
  run: async ({ message, args }) => {
    const len = clamp(num(args[0], 16), 8, 64);
    const send = async () => {
      const pass = genPassword(len);
      const comp = row(button({ id: "pw:regen", label: "Regenerate", style: "primary", emoji: "🔁" }));
      try {
        const dm = await message.author.createDM();
        const sent = await dm.send({ embeds: [embed({ title: "🔑 Your generated password", description: codeBlock(pass), color: COLORS.ok, footer: "Keep this secret. This message is only visible to you." })], components: [comp] });
        const col = sent.createMessageComponentCollector({ time: 5 * 60_000 });
        col.on("collect", async (int) => {
          if (int.user.id !== message.author.id) return int.reply({ content: "Not yours.", ephemeral: true }).catch(() => {});
          const newPass = genPassword(len);
          await int.update({ embeds: [embed({ title: "🔑 Your generated password", description: codeBlock(newPass), color: COLORS.ok, footer: "Keep this secret. This message is only visible to you." })] }).catch(() => {});
        });
        message.reply({ embeds: [okEmbed("Sent!", "Check your DMs for your new password.")] });
      } catch {
        message.reply({ embeds: [errEmbed("Couldn't DM you", "Enable DMs from server members and try again.")] });
      }
    };
    send();
  } });

// ================= QR / SHORTLINK =================
add({ name: "qr", category: "utility", description: "Generate a QR code from text.", usage: "qr <text/url>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Usage", "`qr https://example.com`")] });
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
    message.reply({ embeds: [embed({ title: "🔳 QR Code", description: `\`${text}\``, image: url, color: COLORS.brand })] });
  } });

add({ name: "shortlink", category: "utility", description: "Shorten a URL.", usage: "shortlink <url>", permission: "everyone",
  run: async ({ message, args }) => {
    const url = args[0];
    if (!url || !/^https?:\/\//i.test(url)) return message.reply({ embeds: [warnEmbed("Usage", "`shortlink https://example.com/long/path`")] });
    try {
      const res = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(url)}`);
      const short = await res.text();
      if (!res.ok || !short.startsWith("http")) throw new Error("bad response");
      message.reply({ embeds: [okEmbed("Shortened", `${short}`)] });
    } catch { message.reply({ embeds: [errEmbed("Shorten failed", "Could not reach the shortlink service.")] }); }
  } });

// ================= COLOUR =================
add({ name: "color", category: "utility", description: "Preview a hex colour.", usage: "color <#hex>", permission: "everyone", aliases: ["colour"],
  run: async ({ message, args }) => {
    const hex = (args[0] || "").replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return message.reply({ embeds: [warnEmbed("Usage", "`color #a855f7`")] });
    const swatch = `https://singlecolorimage.com/get/${hex}/200x100`;
    message.reply({ embeds: [embed({ title: `🎨 #${hex.toUpperCase()}`, color: parseInt(hex, 16), image: swatch, fields: [{ name: "RGB", value: `${parseInt(hex.slice(0, 2), 16)}, ${parseInt(hex.slice(2, 4), 16)}, ${parseInt(hex.slice(4, 6), 16)}` }] })] });
  } });

// ================= TIMESTAMP =================
add({ name: "timestamp", category: "utility", description: "Generate a Discord timestamp in various formats.", usage: "timestamp [unix seconds]", permission: "everyone",
  run: async ({ message, args }) => {
    const secs = args[0] ? num(args[0], Math.floor(Date.now() / 1000)) : Math.floor(Date.now() / 1000);
    const formats = [
      { label: "Short time (t)", value: "t" }, { label: "Long time (T)", value: "T" },
      { label: "Short date (d)", value: "d" }, { label: "Long date (D)", value: "D" },
      { label: "Short date/time (f)", value: "f" }, { label: "Long date/time (F)", value: "F" },
      { label: "Relative (R)", value: "R" },
    ];
    const value = await choose(message, { title: "Pick a timestamp format", options: formats });
    if (!value) return;
    message.channel.send({ embeds: [embed({ title: "🕒 Timestamp", fields: [{ name: "Renders as", value: `<t:${secs}:${value}>` }, { name: "Copy this", value: codeBlock(`<t:${secs}:${value}>`) }] })] });
  } });

add({ name: "epoch", category: "utility", description: "Convert between unix timestamp and readable date.", usage: "epoch [unix seconds]", permission: "everyone",
  run: async ({ message, args }) => {
    const secs = args[0] ? num(args[0], NaN) : Math.floor(Date.now() / 1000);
    if (Number.isNaN(secs)) return message.reply({ embeds: [errEmbed("Bad input", "Provide a valid unix timestamp in seconds.")] });
    message.reply({ embeds: [embed({ title: "🕰️ Epoch converter", fields: [{ name: "Unix (s)", value: `${secs}`, inline: true }, { name: "ISO", value: new Date(secs * 1000).toISOString(), inline: true }, { name: "Discord", value: `<t:${secs}:F>` }] })] });
  } });

// ================= WORLD CLOCK =================
add({ name: "worldclock", category: "utility", description: "See the current time in several timezones.", usage: "worldclock", permission: "everyone",
  run: async ({ message }) => {
    const fields = Object.entries(TIMEZONES).map(([name, tz]) => ({
      name, value: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: true, weekday: "short" }).format(new Date()), inline: true,
    }));
    message.reply({ embeds: [embed({ title: "🌍 World clock", fields })] });
  } });

// ================= TODO =================
add({ name: "todo", category: "utility", description: "Manage a personal to-do list.", usage: "todo <add|list|done> [text/index]", permission: "everyone",
  run: async ({ message, args }) => {
    const sub = (args[0] || "list").toLowerCase();
    const list = todos.get(message.author.id) || [];
    todos.set(message.author.id, list);
    if (sub === "add") {
      const text = args.slice(1).join(" ");
      if (!text) return message.reply({ embeds: [warnEmbed("Usage", "`todo add Buy milk`")] });
      list.push({ text, done: false });
      return message.reply({ embeds: [okEmbed("Added", `Added to your list: "${text}"`)] });
    }
    if (sub === "done") {
      const idx = num(args[1], NaN) - 1;
      if (!list[idx]) return message.reply({ embeds: [errEmbed("Not found", "That item doesn't exist.")] });
      list[idx].done = true;
      return message.reply({ embeds: [okEmbed("Marked done", list[idx].text)] });
    }
    if (!list.length) return message.reply({ embeds: [infoEmbed("Empty list", "Add items with `todo add <text>`.")] });
    const buildEmbed = () => embed({ title: `📋 ${message.author.username}'s to-do list`, description: list.map((t, i) => `${t.done ? "✅" : "⬜"} **${i + 1}.** ${t.text}`).join("\n") });
    const comps = row(button({ id: "todo:clear", label: "Clear completed", style: "danger", emoji: "🧹" }));
    const sent = await message.reply({ embeds: [buildEmbed()], components: [comps] });
    const col = sent.createMessageComponentCollector({ time: 60_000, max: 5 });
    col.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your list.", ephemeral: true }).catch(() => {});
      const filtered = list.filter((t) => !t.done);
      todos.set(message.author.id, filtered);
      await int.update({ embeds: [embed({ title: `📋 ${message.author.username}'s to-do list`, description: filtered.length ? filtered.map((t, i) => `⬜ **${i + 1}.** ${t.text}`).join("\n") : "Nothing left — nice work!" })], components: [] }).catch(() => {});
    });
  } });

// ================= NOTES =================
add({ name: "notes", category: "utility", description: "Save and view personal notes.", usage: "notes <add|list|clear> [text]", permission: "everyone",
  run: async ({ message, args }) => {
    const sub = (args[0] || "list").toLowerCase();
    const mine = notesStore.get(message.author.id) || [];
    notesStore.set(message.author.id, mine);
    if (sub === "add") {
      const text = args.slice(1).join(" ");
      if (!text) return message.reply({ embeds: [warnEmbed("Usage", "`notes add Remember to hydrate`")] });
      mine.push(text);
      return message.reply({ embeds: [okEmbed("Note saved", text)] });
    }
    if (sub === "clear") {
      notesStore.set(message.author.id, []);
      return message.reply({ embeds: [okEmbed("Cleared", "All your notes were removed.")] });
    }
    if (!mine.length) return message.reply({ embeds: [infoEmbed("No notes", "Add one with `notes add <text>`.")] });
    const pages = listPages(mine.map((n, i) => `**${i + 1}.** ${n}`), { title: `🗒️ ${message.author.username}'s notes` });
    paginate(message, pages);
  } });

// ================= TAGS =================
add({ name: "tag", category: "utility", description: "Show, set, delete or list custom tags.", usage: "tag <show|set|delete|list> [name] [content]", permission: "everyone",
  run: async ({ message, args }) => {
    const sub = (args[0] || "").toLowerCase();
    const guildId = message.guild?.id || "dm";
    if (sub === "set") {
      const name = args[1]?.toLowerCase();
      const content = args.slice(2).join(" ");
      if (!name || !content) return message.reply({ embeds: [warnEmbed("Usage", "`tag set welcome Hello there!`")] });
      setTag(guildId, name, content);
      return message.reply({ embeds: [okEmbed("Tag saved", `Tag \`${name}\` has been set.`)] });
    }
    if (sub === "delete") {
      const name = args[1]?.toLowerCase();
      if (!name) return message.reply({ embeds: [warnEmbed("Usage", "`tag delete welcome`")] });
      deleteTag(guildId, name);
      return message.reply({ embeds: [okEmbed("Tag deleted", `Tag \`${name}\` was removed if it existed.`)] });
    }
    if (sub === "list") {
      const names = listTags(guildId);
      const pages = listPages(names.map((n) => `\`${n}\``), { title: "🏷️ Server tags" });
      return paginate(message, pages);
    }
    const name = (sub === "show" ? args[1] : sub)?.toLowerCase();
    if (!name) return message.reply({ embeds: [warnEmbed("Usage", "`tag show <name>` / `tag set` / `tag delete` / `tag list`")] });
    const content = getTag(guildId, name);
    if (!content) return message.reply({ embeds: [errEmbed("Not found", `No tag named \`${name}\`.`)] });
    message.reply({ embeds: [embed({ title: `🏷️ ${name}`, description: content })] });
  } });

// ================= AFK =================
add({ name: "afk", category: "utility", description: "Mark yourself as AFK.", usage: "afk [reason]", permission: "everyone",
  run: async ({ message, args }) => {
    const guildId = message.guild?.id || "dm";
    const reason = args.join(" ") || "AFK";
    setAfk(guildId, message.author.id, reason);
    message.reply({ embeds: [embed({ title: "💤 You are now AFK", description: reason, color: COLORS.dark })] });
  } });

add({ name: "unafk", category: "utility", description: "Remove your AFK status.", usage: "unafk", permission: "everyone",
  run: async ({ message }) => {
    const guildId = message.guild?.id || "dm";
    const was = getAfk(guildId, message.author.id);
    clearAfk(guildId, message.author.id);
    if (!was) return message.reply({ embeds: [infoEmbed("Not AFK", "You weren't marked AFK.")] });
    message.reply({ embeds: [okEmbed("Welcome back!", `You were AFK for ${ago(was.since)}.`)] });
  } });

// ================= SNIPE =================
add({ name: "snipe", category: "utility", description: "Show the last deleted message in this channel.", usage: "snipe", permission: "everyone",
  run: async ({ message, client }) => {
    hookSnipe(client);
    const cached = snipeCache.get(message.channel.id);
    if (!cached) return message.reply({ embeds: [infoEmbed("Nothing to snipe", "No recently deleted messages found here.")] });
    message.reply({ embeds: [embed({ title: "🔫 Sniped message", description: cached.content, footer: `${cached.author} · ${ago(cached.at)}`, thumbnail: cached.avatar })] });
  } });

// ================= EMBED BUILDER =================
add({ name: "embedbuilder", category: "utility", description: "Interactively build and post a custom embed.", usage: "embedbuilder", permission: "everyone",
  run: async ({ message }) => {
    const title = await prompt(message, { title: "Embed builder — step 1/3", description: "What should the title be? (or type `skip`)" });
    const description = await prompt(message, { title: "Embed builder — step 2/3", description: "What should the description be? (or type `skip`)" });
    const colorAns = await prompt(message, { title: "Embed builder — step 3/3", description: "Pick a hex colour, e.g. `#a855f7` (or type `skip`)" });
    let color = COLORS.brand;
    if (colorAns && /^#?[0-9a-f]{6}$/i.test(colorAns)) color = parseInt(colorAns.replace("#", ""), 16);
    const final = embed({
      title: title && title.toLowerCase() !== "skip" ? title : undefined,
      description: description && description.toLowerCase() !== "skip" ? description : "*(no description)*",
      color,
      footer: `Built by ${message.author.tag}`,
    });
    message.channel.send({ embeds: [final] });
  } });

// ================= ANNOUNCEMENT PREVIEWER =================
add({ name: "announce", category: "utility", description: "Preview and post a formatted announcement.", usage: "announce <title> | <message>", permission: "mod",
  run: async ({ message, args }) => {
    const raw = args.join(" ");
    const [title, ...rest] = raw.split("|");
    const body = rest.join("|").trim();
    if (!title || !body) return message.reply({ embeds: [warnEmbed("Usage", "`announce <title> | <message text>`")] });
    const preview = embed({ title: `📣 ${title.trim()}`, description: body, color: COLORS.warn, footer: `Announcement by ${message.author.tag}` });
    const yes = await confirm(message, { title: "Post this announcement?", description: "Review the preview above before confirming.", danger: false });
    if (yes) message.channel.send({ embeds: [preview] });
  } });

