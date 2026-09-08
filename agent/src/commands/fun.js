import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed,
  button, row, select, bar, COLORS, RNG, pick, num, clamp, mention, fmt,
} from "../ui.js";
import { ComponentType } from "discord.js";

export const commands = [];
const add = (c) => commands.push(c);

async function fetchJson(url, opts) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---------- 8ball ----------
const BALL_ANSWERS = [
  "It is certain.", "Without a doubt.", "Yes, definitely.", "You may rely on it.",
  "As I see it, yes.", "Most likely.", "Outlook good.", "Signs point to yes.",
  "Reply hazy, try again.", "Ask again later.", "Better not tell you now.",
  "Cannot predict now.", "Concentrate and ask again.", "Don't count on it.",
  "My reply is no.", "My sources say no.", "Outlook not so good.", "Very doubtful.",
];
function eightballEmbed(question) {
  const answer = pick(BALL_ANSWERS);
  return embed({
    title: "🎱 The Magic 8-Ball",
    description: `**Q:** ${question}\n**A:** ${answer}`,
    color: COLORS.brand,
  });
}
add({
  name: "8ball", category: "fun", description: "Ask the magic 8-ball a question.",
  usage: "8ball <question>", permission: "everyone",
  run: async ({ message, args }) => {
    const question = args.join(" ");
    if (!question) return message.reply({ embeds: [warnEmbed("Ask something!", "Usage: `8ball <question>`")] });
    const sent = await message.reply({
      embeds: [eightballEmbed(question)],
      components: [row(button({ id: "8ball:again", label: "Ask again", style: "primary", emoji: "🔄" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your 8ball.", ephemeral: true }).catch(() => {});
      await int.update({ embeds: [eightballEmbed(question)] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  },
});

// ---------- would you rather ----------
const WYR_PROMPTS = [
  ["have the ability to fly", "have the ability to turn invisible"],
  ["always be 10 minutes late", "always be 20 minutes early"],
  ["fight one horse-sized duck", "fight 100 duck-sized horses"],
  ["give up pizza forever", "give up burgers forever"],
  ["be able to speak every language", "be able to talk to animals"],
];
add({
  name: "wyr", category: "fun", description: "Would you rather, with a live vote tally.",
  usage: "wyr", permission: "everyone",
  run: async ({ message }) => {
    const [a, b] = pick(WYR_PROMPTS);
    const votes = { a: new Set(), b: new Set() };
    const render = () => embed({
      title: "🤔 Would You Rather…",
      description: `**A)** ${a}\n**B)** ${b}`,
      fields: [
        { name: `A (${votes.a.size})`, value: bar(votes.a.size, Math.max(1, votes.a.size + votes.b.size)), inline: true },
        { name: `B (${votes.b.size})`, value: bar(votes.b.size, Math.max(1, votes.a.size + votes.b.size)), inline: true },
      ],
      color: COLORS.info,
    });
    const sent = await message.reply({
      embeds: [render()],
      components: [row(button({ id: "wyr:a", label: "Option A", style: "primary" }), button({ id: "wyr:b", label: "Option B", style: "success" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 45_000 });
    collector.on("collect", async (int) => {
      votes.a.delete(int.user.id); votes.b.delete(int.user.id);
      (int.customId === "wyr:a" ? votes.a : votes.b).add(int.user.id);
      await int.update({ embeds: [render()] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  },
});

// ---------- truth or dare ----------
const TRUTHS = ["What's your biggest fear?", "What's the most embarrassing thing you've done?", "Who's your secret crush?", "What's a lie you've told recently?"];
const DARES = ["Send a message in all caps for the next 5 minutes.", "Change your nickname to something silly.", "Text your crush right now.", "Do 10 pushups."];
add({
  name: "truthordare", category: "fun", description: "Play truth or dare.",
  usage: "truthordare", permission: "everyone",
  run: async ({ message }) => {
    const sent = await message.reply({
      embeds: [embed({ title: "🎭 Truth or Dare", description: "Pick your fate.", color: COLORS.brand })],
      components: [row(button({ id: "tod:truth", label: "Truth", style: "primary", emoji: "🧠" }), button({ id: "tod:dare", label: "Dare", style: "danger", emoji: "🔥" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000, max: 1 });
    collector.on("collect", async (int) => {
      const truth = int.customId === "tod:truth";
      await int.update({
        embeds: [embed({ title: truth ? "🧠 Truth" : "🔥 Dare", description: pick(truth ? TRUTHS : DARES), color: truth ? COLORS.info : COLORS.danger })],
        components: [],
      }).catch(() => {});
    });
  },
});

// ---------- rate my ----------
add({
  name: "ratemy", category: "fun", description: "Get a completely scientific rating out of 100.",
  usage: "ratemy <thing>", permission: "everyone",
  run: async ({ message, args }) => {
    const thing = args.join(" ") || "vibe";
    const score = RNG(101);
    await message.reply({ embeds: [embed({
      title: `📊 Rating: ${thing}`,
      description: bar(score, 100, 16),
      color: score > 70 ? COLORS.ok : score > 40 ? COLORS.warn : COLORS.danger,
    })] });
  },
});

// ---------- ship ----------
function shipEmbed(u1, u2) {
  const score = RNG(101);
  return embed({
    title: `💘 Shipping ${u1.username} + ${u2.username}`,
    description: `**${u1.username} 💞 ${u2.username}**\n${bar(score, 100, 16)}`,
    thumbnail: u1.displayAvatarURL?.(),
    color: score > 70 ? COLORS.ok : score > 40 ? COLORS.warn : COLORS.danger,
  });
}
add({
  name: "ship", category: "fun", description: "Ship two people with a compatibility bar.",
  usage: "ship <@user> [@user2]", permission: "everyone",
  run: async ({ message }) => {
    const users = [...message.mentions.users.values()];
    const u1 = users[0] || message.author;
    const u2 = users[1] || message.client.user;
    const sent = await message.reply({
      embeds: [shipEmbed(u1, u2)],
      components: [row(button({ id: "ship:reroll", label: "Re-roll", style: "primary", emoji: "🔁" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 45_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your ship.", ephemeral: true }).catch(() => {});
      await int.update({ embeds: [shipEmbed(u1, u2)] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  },
});

// ---------- image commands ----------
function imgCmd(name, title, fetcher) {
  add({
    name, category: "fun", description: `Get a random ${title.toLowerCase()} picture.`,
    usage: name, permission: "everyone",
    run: async ({ message }) => {
      try {
        const url = await fetcher();
        await message.reply({ embeds: [embed({ title: `${title}`, image: url, color: COLORS.info })] });
      } catch {
        await message.reply({ embeds: [errEmbed("Fetch failed", "Couldn't reach the image API right now, try again shortly.")] });
      }
    },
  });
}
imgCmd("meme", "🖼️ Random Meme", async () => (await fetchJson("https://meme-api.com/gimme")).url);
imgCmd("catimg", "🐱 Random Cat", async () => (await fetchJson("https://api.thecatapi.com/v1/images/search"))[0].url);
imgCmd("dogimg", "🐶 Random Dog", async () => (await fetchJson("https://dog.ceo/api/breeds/image/random")).message);
imgCmd("foximg", "🦊 Random Fox", async () => (await fetchJson("https://randomfox.ca/floof/")).image);

// ---------- text transformers ----------
add({ name: "mock", category: "fun", description: "sPoNgEbOb mOcKiNg CaSe.", usage: "mock <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `mock <text>`")] });
    const out = [...text].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
    await message.reply({ embeds: [embed({ title: "🐸 Mocking SpongeBob", description: out, color: COLORS.warn })] });
  } });

add({ name: "clap", category: "fun", description: "👏 Add claps between words.", usage: "clap <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `clap <text>`")] });
    await message.reply({ embeds: [embed({ title: "👏 Clap Back", description: text.split(" ").join(" 👏 "), color: COLORS.brand })] });
  } });

add({ name: "reverse", category: "fun", description: "Reverse your text.", usage: "reverse <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `reverse <text>`")] });
    await message.reply({ embeds: [embed({ title: "🔁 Reversed", description: [...text].reverse().join(""), color: COLORS.info })] });
  } });

add({ name: "vaporwave", category: "fun", description: "Ｍａｋｅ  ｉｔ  ｖａｐｏｒｗａｖｅ.", usage: "vaporwave <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `vaporwave <text>`")] });
    const full = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~";
    const out = [...text].map((c) => {
      const i = full.indexOf(c);
      return i === -1 ? c : String.fromCharCode(0xFF01 + i - 1);
    }).join("");
    await message.reply({ embeds: [embed({ title: "🌆 Vaporwave", description: out || text, color: COLORS.brand })] });
  } });

add({ name: "leetspeak", category: "fun", description: "Turn text 1337.", usage: "leetspeak <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `leetspeak <text>`")] });
    const map = { a: "4", e: "3", i: "1", o: "0", s: "5", t: "7", l: "1", b: "8" };
    const out = [...text.toLowerCase()].map((c) => map[c] ?? c).join("");
    await message.reply({ embeds: [embed({ title: "💾 1337 5p34k", description: out, color: COLORS.ok })] });
  } });

add({ name: "emojify", category: "fun", description: "Turn letters into regional indicator emoji.", usage: "emojify <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ").toLowerCase();
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `emojify <text>`")] });
    const out = [...text].map((c) => {
      if (/[a-z]/.test(c)) return String.fromCodePoint(0x1F1E6 + c.charCodeAt(0) - 97) + " ";
      if (c === " ") return "   ";
      return c + " ";
    }).join("");
    await message.reply({ embeds: [embed({ title: "🔠 Emojified", description: out.slice(0, 4000) || "…", color: COLORS.info })] });
  } });

add({ name: "owoify", category: "fun", description: "OwO-ify your text.", usage: "owoify <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ");
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `owoify <text>`")] });
    const out = text.replace(/[rl]/g, "w").replace(/[RL]/g, "W").replace(/n([aeiou])/g, "ny$1").replace(/N([aeiou])/g, "Ny$1") + " owo";
    await message.reply({ embeds: [embed({ title: "🥺 OwOified", description: out, color: COLORS.warn })] });
  } });

add({ name: "binary", category: "fun", description: "Encode/decode text to binary. Prefix with `decode` to reverse.", usage: "binary [decode] <text>", permission: "everyone",
  run: async ({ message, args }) => {
    if (!args.length) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `binary <text>` or `binary decode <code>`")] });
    if (args[0]?.toLowerCase() === "decode") {
      const bits = args.slice(1).join(" ");
      try {
        const out = bits.trim().split(/\s+/).map((b) => String.fromCharCode(parseInt(b, 2))).join("");
        await message.reply({ embeds: [embed({ title: "🔓 Decoded", description: out || "—", color: COLORS.ok })] });
      } catch { await message.reply({ embeds: [errEmbed("Bad input", "That doesn't look like binary.")] }); }
      return;
    }
    const text = args.join(" ");
    const out = [...text].map((c) => c.charCodeAt(0).toString(2).padStart(8, "0")).join(" ");
    await message.reply({ embeds: [embed({ title: "🔒 Binary", description: "```\n" + out.slice(0, 1900) + "\n```", color: COLORS.info })] });
  } });

const MORSE = { a:".-",b:"-...",c:"-.-.",d:"-..",e:".",f:"..-.",g:"--.",h:"....",i:"..",j:".---",k:"-.-",l:".-..",m:"--",n:"-.",o:"---",p:".--.",q:"--.-",r:".-.",s:"...",t:"-",u:"..-",v:"...-",w:".--",x:"-..-",y:"-.--",z:"--..",0:"-----",1:".----",2:"..---",3:"...--",4:"....-",5:".....",6:"-....",7:"--...",8:"---..",9:"----." };
const MORSE_R = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));
add({ name: "morse", category: "fun", description: "Encode/decode morse code. Prefix with `decode` to reverse.", usage: "morse [decode] <text>", permission: "everyone",
  run: async ({ message, args }) => {
    if (!args.length) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `morse <text>` or `morse decode <code>`")] });
    if (args[0]?.toLowerCase() === "decode") {
      const out = args.slice(1).join(" ").split(" / ").map((w) => w.split(" ").map((s) => MORSE_R[s] ?? "").join("")).join(" ");
      await message.reply({ embeds: [embed({ title: "🔓 Decoded", description: out || "—", color: COLORS.ok })] });
      return;
    }
    const text = args.join(" ").toLowerCase();
    const out = text.split(" ").map((w) => [...w].map((c) => MORSE[c] ?? "").join(" ")).join(" / ");
    await message.reply({ embeds: [embed({ title: "📡 Morse Code", description: "```\n" + out.slice(0, 1900) + "\n```", color: COLORS.brand })] });
  } });

add({ name: "asciibox", category: "fun", description: "Put your text in an ASCII box.", usage: "asciibox <text>", permission: "everyone",
  run: async ({ message, args }) => {
    const text = args.join(" ").slice(0, 60);
    if (!text) return message.reply({ embeds: [warnEmbed("Need text", "Usage: `asciibox <text>`")] });
    const line = "─".repeat(text.length + 2);
    const out = `┌${line}┐\n│ ${text} │\n└${line}┘`;
    await message.reply({ embeds: [embed({ title: "📦 ASCII Box", description: "```\n" + out + "\n```", color: COLORS.dark })] });
  } });

// ---------- one-liners ----------
function textPool(name, title, pool, colorKey = "brand") {
  add({ name, category: "fun", description: `Get a random ${title.toLowerCase()}.`, usage: name, permission: "everyone",
    run: async ({ message, args }) => {
      const target = mention(message)?.username;
      const line = pick(pool).replace("{user}", target || "you");
      await message.reply({ embeds: [embed({ title, description: line, color: COLORS[colorKey] })] });
    } });
}
textPool("pickupline", "😏 Pickup Line", [
  "Are you a magician? Because whenever I look at you, everyone else disappears.",
  "Do you have a map? I keep getting lost in your eyes.",
  "Are you made of copper and tellurium? Because you're Cu-Te.",
  "Is your name Google? Because you have everything I've been searching for.",
]);
textPool("roast", "🔥 Roast", [
  "{user}, you're the reason the gene pool needs a lifeguard.",
  "{user}, I'd agree with you but then we'd both be wrong.",
  "{user}, you bring everyone so much joy... when you leave the room.",
  "{user} has the confidence of a 10/10 but the stats of a 4/10.",
], "danger");
textPool("compliment", "💖 Compliment", [
  "{user}, your energy could power a small city.",
  "{user}, you make hard things look easy.",
  "{user}, you're proof that good things exist.",
  "{user}, you light up every room you walk into.",
], "ok");
textPool("fortune", "🔮 Fortune Cookie", [
  "A thrilling opportunity awaits you this week.",
  "Someone you trust has good news coming your way.",
  "Patience will reward you sooner than expected.",
  "A small risk will lead to a big win.",
]);
textPool("advice", "🧭 Advice", [
  "Don't compare your chapter 1 to someone else's chapter 20.",
  "Rest is productive too.",
  "Say the kind thing — you'll rarely regret it.",
  "Progress, not perfection.",
]);
textPool("joke", "😂 Joke", [
  "Why don't scientists trust atoms? Because they make up everything.",
  "I told my computer I needed a break, and it said no problem — it'll go to sleep.",
  "Why did the scarecrow win an award? He was outstanding in his field.",
]);
textPool("dadjoke", "👔 Dad Joke", [
  "I'm afraid for the calendar. Its days are numbered.",
  "I used to hate facial hair, but then it grew on me.",
  "What do you call a fish with no eyes? A fsh.",
]);
textPool("fact", "🧠 Random Fact", [
  "Honey never spoils.",
  "Bananas are berries, but strawberries aren't.",
  "Octopuses have three hearts.",
  "A group of flamingos is called a 'flamboyance'.",
], "info");
textPool("quote", "📖 Quote", [
  '"The only way to do great work is to love what you do." — Steve Jobs',
  '"In the middle of difficulty lies opportunity." — Albert Einstein',
  '"Whether you think you can or think you can\'t, you\'re right." — Henry Ford',
], "info");

// ---------- horoscope ----------
const SIGNS = ["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"];
add({ name: "horoscope", category: "fun", description: "Pick your star sign for a horoscope.", usage: "horoscope", permission: "everyone",
  run: async ({ message }) => {
    const sent = await message.reply({
      embeds: [embed({ title: "✨ Horoscope", description: "Choose your star sign below.", color: COLORS.brand })],
      components: [row(select({ id: "horo:sign", placeholder: "Pick a sign…", options: SIGNS.map((s) => ({ label: s, value: s })) }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30_000, max: 1 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your reading.", ephemeral: true }).catch(() => {});
      const sign = int.values[0];
      const lines = ["A pleasant surprise is coming your way.", "Focus on yourself today.", "Money and love are both in your favor.", "Trust your instincts — they're sharp today.", "Someone from your past may reach out."];
      await int.update({ embeds: [embed({ title: `🔮 ${sign}`, description: pick(lines), color: COLORS.brand })], components: [] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

// ---------- insult battle ----------
add({ name: "insultbattle", category: "fun", description: "Battle another user in a roast-off.", usage: "insultbattle <@user>", permission: "everyone",
  run: async ({ message }) => {
    const target = mention(message);
    const a = message.author, b = target.id === a.id ? message.client.user : target;
    const rounds = [1, 2, 3].map(() => ({
      a: pick(["is so slow even Internet Explorer feels bad", "has the aim of a stormtrooper", "types with one finger", "still uses dial-up energy"]),
      b: pick(["laughs in dial-up modem noises", "argues with a Roomba and loses", "can't beat their own reflection", "runs on expired WiFi"]),
    }));
    const fields = rounds.map((r, i) => ({ name: `Round ${i + 1}`, value: `**${a.username}** ${r.a}\n**${b.username}** ${r.b}` }));
    const winner = pick([a, b]);
    await message.reply({ embeds: [embed({ title: "⚔️ Insult Battle", description: `${a.username} vs ${b.username}`, fields, footer: `Winner: ${winner.username} 🏆`, color: COLORS.danger })] });
  } });

// ---------- riddle ----------
const RIDDLES = [
  { q: "What has keys but no locks, space but no room, and you can enter but can't go inside?", a: "A keyboard." },
  { q: "The more you take, the more you leave behind. What am I?", a: "Footsteps." },
  { q: "What has a heart that doesn't beat?", a: "An artichoke." },
];
add({ name: "riddle", category: "fun", description: "Solve a riddle with a reveal button.", usage: "riddle", permission: "everyone",
  run: async ({ message }) => {
    const r = pick(RIDDLES);
    const sent = await message.reply({
      embeds: [embed({ title: "🧩 Riddle", description: r.q, color: COLORS.info })],
      components: [row(button({ id: "riddle:reveal", label: "Reveal Answer", style: "primary", emoji: "💡" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000, max: 1 });
    collector.on("collect", async (int) => {
      await int.update({ embeds: [embed({ title: "🧩 Riddle Solved", description: `${r.q}\n\n**Answer:** ${r.a}`, color: COLORS.ok })], components: [] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

// ---------- story generator ----------
add({ name: "story", category: "fun", description: "Generate a tiny random story.", usage: "story", permission: "everyone",
  run: async ({ message }) => {
    const hero = pick(["a sleepy wizard", "a caffeinated robot", "a curious cat", "an overconfident goblin"]);
    const place = pick(["a floating library", "the bottom of the ocean", "a neon-lit city", "a forgotten server room"]);
    const twist = pick(["discovered a talking rubber duck", "found a door that led nowhere", "accidentally became famous", "lost their shadow"]);
    await message.reply({ embeds: [embed({ title: "📚 Random Story", description: `Once upon a time, ${hero} lived in ${place}. One day, they ${twist}, and nothing was ever the same again.`, color: COLORS.brand })] });
  } });

// ---------- weighted choose ----------
add({ name: "weightedchoose", category: "fun", description: "Pick from options with weights, e.g. `apple:3 banana:1`.", usage: "weightedchoose <opt:weight ...>", permission: "everyone",
  run: async ({ message, args }) => {
    if (!args.length) return message.reply({ embeds: [warnEmbed("Need options", "Usage: `weightedchoose apple:3 banana:1`")] });
    const parsed = args.map((a) => { const [label, w] = a.split(":"); return { label, weight: num(w, 1) }; }).filter((o) => o.label);
    const total = parsed.reduce((s, o) => s + o.weight, 0);
    let r = Math.random() * total;
    let chosen = parsed[0];
    for (const o of parsed) { if (r < o.weight) { chosen = o; break; } r -= o.weight; }
    const fields = parsed.map((o) => ({ name: o.label, value: bar(o.weight, total), inline: false }));
    await message.reply({ embeds: [embed({ title: "🎯 Weighted Choice", description: `Winner: **${chosen.label}**`, fields, color: COLORS.ok })] });
  } });

// ---------- coinflip animated ----------
add({ name: "coinflip", category: "fun", description: "Flip a coin with a little animation.", usage: "coinflip", permission: "everyone",
  run: async ({ message }) => {
    const sent = await message.reply({ embeds: [embed({ title: "🪙 Flipping…", description: "Spinning the coin…", color: COLORS.warn })] });
    await new Promise((r) => setTimeout(r, 900));
    const result = pick(["Heads", "Tails"]);
    await sent.edit({ embeds: [embed({ title: "🪙 Coin Flip", description: `It landed on **${result}**!`, color: COLORS.ok })] }).catch(() => {});
  } });

// ---------- dice roller ----------
add({ name: "diceroll", category: "fun", description: "Roll dice using NdN notation, e.g. 2d6.", usage: "diceroll [NdN]", permission: "everyone",
  run: async ({ message, args }) => {
    const notation = args[0] || "1d6";
    const match = /^(\d{1,2})d(\d{1,4})$/i.exec(notation.trim());
    if (!match) return message.reply({ embeds: [warnEmbed("Bad format", "Use `NdN` like `2d6` or `1d20`.")] });
    const count = clamp(num(match[1], 1), 1, 20);
    const sides = clamp(num(match[2], 6), 2, 1000);
    const rolls = Array.from({ length: count }, () => 1 + RNG(sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    await message.reply({ embeds: [embed({ title: `🎲 Rolling ${notation}`, description: `Rolls: ${rolls.join(", ")}\n**Total: ${total}**`, color: COLORS.info })] });
  } });

// ---------- hack simulation ----------
add({ name: "hack", category: "fun", description: "Fake-hack someone for laughs.", usage: "hack [@user]", permission: "everyone",
  run: async ({ message }) => {
    const target = mention(message);
    const sent = await message.reply({ embeds: [embed({ title: `💻 Hacking ${target.username}...`, description: bar(0, 100), color: COLORS.danger })] });
    for (const pct of [15, 35, 55, 75, 92, 100]) {
      await new Promise((r) => setTimeout(r, 500));
      await sent.edit({ embeds: [embed({ title: `💻 Hacking ${target.username}...`, description: bar(pct, 100), color: COLORS.danger })] }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 400));
    await sent.edit({ embeds: [embed({ title: "✅ Hack Complete (not really)", description: `Obtained ${target.username}'s browser history. Just kidding — this is 100% fake, don't worry!`, color: COLORS.ok })] }).catch(() => {});
  } });

// ---------- action embeds ----------
function actionCmd(name, emoji, verb, gifPool) {
  add({ name, category: "fun", description: `${verb} someone.`, usage: `${name} <@user>`, permission: "everyone",
    run: async ({ message }) => {
      const target = mention(message);
      const isSelf = target.id === message.author.id;
      const desc = isSelf ? `${message.author.username} ${verb}s themselves. Sad.` : `${message.author.username} ${verb}s ${target.username}! ${emoji}`;
      await message.reply({ embeds: [embed({ title: `${emoji} ${verb.charAt(0).toUpperCase() + verb.slice(1)}!`, description: desc, image: pick(gifPool), color: COLORS.brand })] });
    } });
}
actionCmd("hug", "🤗", "hug", ["https://media.tenor.com/2roX3uxc7v4AAAAC/anime-hug.gif"]);
actionCmd("pat", "🖐️", "pat", ["https://media.tenor.com/8m4wQ7cXvJIAAAAC/pat-anime.gif"]);
actionCmd("slap", "👋", "slap", ["https://media.tenor.com/9wKqz3vT9GgAAAAC/anime-slap.gif"]);

// ---------- soundboard ----------
const SOUNDS = [
  { label: "Air horn", value: "airhorn", emoji: "📯", text: "**PAAARRRP!** 📯📯📯" },
  { label: "Rimshot", value: "rimshot", emoji: "🥁", text: "*ba dum tss* 🥁" },
  { label: "Applause", value: "applause", emoji: "👏", text: "👏👏👏 *the crowd goes wild* 👏👏👏" },
  { label: "Crickets", value: "crickets", emoji: "🦗", text: "*chirp… chirp…* 🦗" },
  { label: "Explosion", value: "explosion", emoji: "💥", text: "💥 **BOOM!** 💥" },
];
add({ name: "soundboard", category: "fun", description: "Pick a sound effect to play (as text/emoji).", usage: "soundboard", permission: "everyone",
  run: async ({ message }) => {
    const sent = await message.reply({
      embeds: [embed({ title: "🔊 Soundboard", description: "Pick a sound to play.", color: COLORS.brand })],
      components: [row(select({ id: "sb:pick", placeholder: "Choose a sound…", options: SOUNDS }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30_000, max: 1 });
    collector.on("collect", async (int) => {
      const s = SOUNDS.find((x) => x.value === int.values[0]);
      await int.update({ embeds: [embed({ title: `${s.emoji} ${s.label}`, description: s.text, color: COLORS.warn })], components: [] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });
