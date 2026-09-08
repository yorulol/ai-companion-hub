/**
 * YORU economy commands — a full coin economy with jobs, gathering, gambling,
 * a shop, a bank, a lottery and leaderboards. Balances persist via db.js;
 * everything else (inventories, bank, cooldowns, shop, lottery) lives in
 * module-level Maps so we never touch the shared schema.
 */
import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed, button, row, select, bar,
  paginate, confirm, choose, listPages, RNG, pick, num, clamp, mention,
  targetMember, fmt, ago, COLORS, EMOJI,
} from "../ui.js";
import { getBalance, setBalance, db } from "../db.js";

export const commands = [];
const add = (c) => commands.push(c);

// ---------------------------------------------------------------- storage --
const key = (g, u) => `${g}:${u}`;
const inventories = new Map(); // key -> { itemId: qty }
const banks = new Map(); // key -> amount
const cooldowns = new Map(); // "cmd:key" -> timestamp ready
const streaks = new Map(); // key -> { daily: n, lastDaily: ts }
const lottery = { pot: 0, tickets: new Map(), lastDraw: 0 }; // key -> ticket count
const weeklyGathered = new Map(); // not required but reserved

function bal(g, u) { return getBalance(g, u).balance; }
function addBal(g, u, amount) {
  const cur = getBalance(g, u);
  setBalance(g, u, Math.max(0, cur.balance + amount));
  return Math.max(0, cur.balance + amount);
}
function getInv(g, u) {
  const k = key(g, u);
  if (!inventories.has(k)) inventories.set(k, {});
  return inventories.get(k);
}
function addItem(g, u, id, qty = 1) {
  const inv = getInv(g, u);
  inv[id] = (inv[id] || 0) + qty;
  if (inv[id] <= 0) delete inv[id];
}
function getBank(g, u) {
  const k = key(g, u);
  if (!banks.has(k)) banks.set(k, 0);
  return banks.get(k);
}
function setBank(g, u, v) { banks.set(key(g, u), Math.max(0, v)); }

function onCooldown(cmd, g, u) {
  const k = `${cmd}:${key(g, u)}`;
  const ready = cooldowns.get(k) || 0;
  return { active: Date.now() < ready, ready, key: k };
}
function setCooldown(cmd, g, u, ms) {
  cooldowns.set(`${cmd}:${key(g, u)}`, Date.now() + ms);
}
function cooldownEmbed(name, readyAt) {
  return warnEmbed(`Not yet — ${name} is cooling down`, `Come back <t:${Math.floor(readyAt / 1000)}:R> (<t:${Math.floor(readyAt / 1000)}:T>).`);
}

const ITEMS = {
  fishing_rod: { name: "Fishing Rod", emoji: "🎣", price: 250, desc: "Improves fishing luck.", type: "tool" },
  hunting_rifle: { name: "Hunting Rifle", emoji: "🔫", price: 400, desc: "Improves hunting luck.", type: "tool" },
  pickaxe: { name: "Pickaxe", emoji: "⛏️", price: 300, desc: "Improves mining luck.", type: "tool" },
  axe: { name: "Axe", emoji: "🪓", price: 200, desc: "Improves chopping luck.", type: "tool" },
  shield: { name: "Protection Shield", emoji: "🛡️", price: 500, desc: "Blocks the next robbery attempt against you.", type: "consumable" },
  lucky_charm: { name: "Lucky Charm", emoji: "🍀", price: 750, desc: "Boosts crime & gamble odds for 1 use.", type: "consumable" },
  energy_drink: { name: "Energy Drink", emoji: "🥤", price: 150, desc: "Resets your work cooldown instantly.", type: "consumable" },
  trophy: { name: "Golden Trophy", emoji: "🏆", price: 5000, desc: "Pure flex. Does nothing.", type: "collectible" },
};

const FISH_LOOT = [
  { id: "old_boot", name: "Old Boot", emoji: "👢", value: 5, w: 20 },
  { id: "minnow", name: "Minnow", emoji: "🐟", value: 20, w: 30 },
  { id: "bass", name: "Bass", emoji: "🐠", value: 60, w: 25 },
  { id: "tuna", name: "Tuna", emoji: "🐡", value: 140, w: 15 },
  { id: "golden_fish", name: "Golden Fish", emoji: "✨🐟", value: 500, w: 5 },
];
const HUNT_LOOT = [
  { id: "rabbit", name: "Rabbit", emoji: "🐇", value: 40, w: 30 },
  { id: "boar", name: "Boar", emoji: "🐗", value: 90, w: 25 },
  { id: "deer", name: "Deer", emoji: "🦌", value: 160, w: 20 },
  { id: "bear", name: "Bear", emoji: "🐻", value: 350, w: 10 },
  { id: "white_stag", name: "White Stag", emoji: "🦌✨", value: 900, w: 3 },
];
const MINE_LOOT = [
  { id: "coal", name: "Coal", emoji: "⚫", value: 30, w: 30 },
  { id: "iron", name: "Iron Ore", emoji: "⛓️", value: 70, w: 25 },
  { id: "silver", name: "Silver Ore", emoji: "🔘", value: 150, w: 18 },
  { id: "gold", name: "Gold Ore", emoji: "🟡", value: 300, w: 10 },
  { id: "diamond", name: "Diamond", emoji: "💎", value: 800, w: 4 },
];
const CHOP_LOOT = [
  { id: "twig", name: "Twig", emoji: "🌿", value: 10, w: 30 },
  { id: "log", name: "Oak Log", emoji: "🪵", value: 35, w: 30 },
  { id: "birch", name: "Birch Log", emoji: "🪵", value: 70, w: 20 },
  { id: "rare_wood", name: "Rare Wood", emoji: "🪵✨", value: 220, w: 8 },
];

function weightedPick(loot) {
  const total = loot.reduce((s, l) => s + l.w, 0);
  let r = RNG(total);
  for (const l of loot) { if (r < l.w) return l; r -= l.w; }
  return loot[0];
}

function gatherCommand({ name, verb, loot, cooldownMs, toolId, description }) {
  add({
    name, category: "economy", description, usage: name, permission: "everyone", aliases: [],
    run: async ({ message, guildCfg }) => {
      const g = message.guild.id, u = message.author.id;
      const cd = onCooldown(name, g, u);
      if (cd.active) return message.reply({ embeds: [cooldownEmbed(name, cd.ready)] });
      const inv = getInv(g, u);
      const hasTool = toolId && inv[toolId] > 0;
      const bonus = hasTool ? 1.4 : 1;
      const found = weightedPick(loot);
      const qty = 1 + (Math.random() < 0.15 * bonus ? 1 : 0);
      addItem(g, u, found.id, qty);
      setCooldown(name, g, u, cooldownMs);
      const value = Math.round(found.value * bonus);
      return message.reply({
        embeds: [embed({
          title: `${found.emoji} You went ${verb}!`,
          description: `You caught **${qty}x ${found.name}** ${found.emoji}\nEstimated sell value: **${fmt(value * qty)}** ${EMOJI.coin}${hasTool ? `\n*Your tool gave you a luck bonus.*` : `\n*Tip: buy a tool from the shop to improve your luck.*`}`,
          color: COLORS.brand,
          footer: `Use "sell ${found.id}" or check your inventory`,
        })],
      });
    },
  });
}

// ------------------------------------------------------------- 1. balance --
add({
  name: "balance", category: "economy", description: "Check your (or someone's) coin balance.", usage: "balance [@user]", permission: "everyone", aliases: ["bal", "wallet"],
  run: async ({ message }) => {
    const target = mention(message);
    const g = message.guild.id;
    const b = bal(g, target.id);
    const bank = getBank(g, target.id);
    const total = b + bank;
    const maxRef = Math.max(total, 1000);
    const e = embed({
      title: `${EMOJI.coin} ${target.username}'s Balance`,
      description: `**Wallet:** ${fmt(b)} ${EMOJI.coin}\n**Bank:** ${fmt(bank)} ${EMOJI.coin}\n**Net worth:** ${fmt(total)} ${EMOJI.coin}\n\n${bar(total, maxRef)}`,
      thumbnail: target.displayAvatarURL?.(),
      color: COLORS.brand,
    });
    const sent = await message.reply({
      embeds: [e],
      components: [row(
        button({ id: "eco:daily", label: "Daily", style: "success", emoji: "🎁" },),
        button({ id: "eco:work", label: "Work", style: "primary", emoji: "💼" }),
        button({ id: "eco:shop", label: "Shop", style: "secondary", emoji: "🛒" }),
      )],
    });
    const cl = sent.createMessageComponentCollector({ time: 30_000 });
    cl.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your buttons.", ephemeral: true }).catch(() => {});
      await int.reply({ content: `Run \`${int.customId.split(":")[1]}\` to continue!`, ephemeral: true }).catch(() => {});
    });
    cl.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  },
});

// --------------------------------------------------------------- 2. daily --
add({
  name: "daily", category: "economy", description: "Claim your daily coins and build a streak.", usage: "daily", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const cd = onCooldown("daily", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("daily", cd.ready)] });
    const s = streaks.get(key(g, u)) || { daily: 0, lastDaily: 0 };
    const brokeStreak = Date.now() - s.lastDaily > 1000 * 60 * 60 * 48;
    s.daily = brokeStreak ? 1 : s.daily + 1;
    s.lastDaily = Date.now();
    streaks.set(key(g, u), s);
    const base = 200;
    const streakBonus = Math.min(500, s.daily * 25);
    const total = base + streakBonus;
    addBal(g, u, total);
    setCooldown("daily", g, u, 1000 * 60 * 60 * 24);
    return message.reply({
      embeds: [okEmbed("Daily Reward Claimed", `You received **${fmt(total)}** ${EMOJI.coin}\n(Base ${base} + streak bonus ${streakBonus})\n\n🔥 Streak: **${s.daily} day(s)**`)],
    });
  },
});

// -------------------------------------------------------------- 3. weekly --
add({
  name: "weekly", category: "economy", description: "Claim your weekly coin bonus.", usage: "weekly", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const cd = onCooldown("weekly", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("weekly", cd.ready)] });
    const total = 1500;
    addBal(g, u, total);
    setCooldown("weekly", g, u, 1000 * 60 * 60 * 24 * 7);
    return message.reply({ embeds: [okEmbed("Weekly Reward Claimed", `You received **${fmt(total)}** ${EMOJI.coin}. See you in 7 days!`)] });
  },
});

// ------------------------------------------------------------- 4. monthly --
add({
  name: "monthly", category: "economy", description: "Claim your monthly coin bonus.", usage: "monthly", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const cd = onCooldown("monthly", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("monthly", cd.ready)] });
    const total = 6000;
    addBal(g, u, total);
    setCooldown("monthly", g, u, 1000 * 60 * 60 * 24 * 30);
    return message.reply({ embeds: [okEmbed("Monthly Reward Claimed", `You received **${fmt(total)}** ${EMOJI.coin}. See you next month!`)] });
  },
});

// ---------------------------------------------------------------- 5. work --
const JOBS = [
  { title: "Barista", min: 60, max: 140, line: "You steamed milk and roasted beans all shift." },
  { title: "Delivery Driver", min: 80, max: 180, line: "You dodged traffic to deliver ten packages." },
  { title: "Streamer", min: 40, max: 300, line: "Your stream had wildly unpredictable donations." },
  { title: "Coder", min: 150, max: 260, line: "You shipped a feature without breaking prod (mostly)." },
  { title: "Fisherman", min: 70, max: 160, line: "You hauled nets at dawn." },
  { title: "Street Musician", min: 30, max: 220, line: "Your case filled up with coins and one button." },
];
add({
  name: "work", category: "economy", description: "Work a random job for coins.", usage: "work", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const cd = onCooldown("work", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("work", cd.ready)] });
    const job = pick(JOBS);
    const amount = job.min + RNG(job.max - job.min + 1);
    addBal(g, u, amount);
    setCooldown("work", g, u, 1000 * 60 * 30);
    return message.reply({
      embeds: [embed({ title: `💼 ${job.title} shift complete`, description: `${job.line}\n\nYou earned **${fmt(amount)}** ${EMOJI.coin}`, color: COLORS.info })],
    });
  },
});

// --------------------------------------------------------------- 6. crime --
add({
  name: "crime", category: "economy", description: "Attempt a risky crime for a big payout.", usage: "crime", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const cd = onCooldown("crime", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("crime", cd.ready)] });
    const ok = await confirm(message, {
      title: "Commit a crime?",
      description: "There's a 50% chance you get caught and pay a fine. Proceed?",
      danger: true,
    });
    if (!ok) return;
    setCooldown("crime", g, u, 1000 * 60 * 20);
    const success = Math.random() < 0.5;
    if (success) {
      const amount = 200 + RNG(600);
      addBal(g, u, amount);
      return message.channel.send({ embeds: [okEmbed("Crime Successful", `You pulled it off and made **${fmt(amount)}** ${EMOJI.coin}.`)] });
    }
    const fine = Math.min(bal(g, u), 100 + RNG(300));
    addBal(g, u, -fine);
    return message.channel.send({ embeds: [errEmbed("Busted!", `You got caught and paid a fine of **${fmt(fine)}** ${EMOJI.coin}.`)] });
  },
});

// ---------------------------------------------------------------- 7. rob --
add({
  name: "rob", category: "economy", description: "Try to rob another user's wallet.", usage: "rob @user", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const target = message.mentions.users.first();
    if (!target || target.bot || target.id === u) return message.reply({ embeds: [errEmbed("Invalid target", "Mention a real user to rob.")] });
    const cd = onCooldown("rob", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("rob", cd.ready)] });
    const targetInv = getInv(g, target.id);
    if (targetInv.shield > 0) {
      targetInv.shield -= 1;
      if (targetInv.shield <= 0) delete targetInv.shield;
      setCooldown("rob", g, u, 1000 * 60 * 15);
      return message.reply({ embeds: [warnEmbed("Blocked!", `${target.username}'s **Protection Shield** absorbed the robbery attempt.`)] });
    }
    const targetBal = bal(g, target.id);
    if (targetBal < 50) return message.reply({ embeds: [errEmbed("Too poor to rob", `${target.username} doesn't have enough coins worth stealing.`)] });
    setCooldown("rob", g, u, 1000 * 60 * 30);
    const success = Math.random() < 0.4;
    if (success) {
      const amount = Math.min(targetBal, Math.round(targetBal * (0.1 + Math.random() * 0.25)));
      addBal(g, target.id, -amount);
      addBal(g, u, amount);
      return message.reply({ embeds: [okEmbed("Robbery Successful", `You stole **${fmt(amount)}** ${EMOJI.coin} from ${target.username}!`)] });
    }
    const fine = Math.min(bal(g, u), 100 + RNG(250));
    addBal(g, u, -fine);
    return message.reply({ embeds: [errEmbed("Robbery Failed", `You got caught and paid **${fmt(fine)}** ${EMOJI.coin} in damages.`)] });
  },
});

// --------------------------------------------------------------- 8. beg --
const BEG_LINES = [
  "A stranger tossed you some spare change.",
  "You held up a sign and someone felt generous.",
  "A kind soul bought you lunch and gave extra.",
  "Nobody had change, better luck next time.",
];
add({
  name: "beg", category: "economy", description: "Beg for a small amount of coins.", usage: "beg", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const cd = onCooldown("beg", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("beg", cd.ready)] });
    setCooldown("beg", g, u, 1000 * 60 * 5);
    const success = Math.random() < 0.75;
    const line = success ? pick(BEG_LINES.slice(0, 3)) : BEG_LINES[3];
    const amount = success ? 10 + RNG(60) : 0;
    if (amount) addBal(g, u, amount);
    return message.reply({ embeds: [embed({ title: "🙏 Begging", description: `${line}${amount ? `\n\nYou got **${fmt(amount)}** ${EMOJI.coin}` : ""}`, color: success ? COLORS.ok : COLORS.dark })] });
  },
});

// --------------------------------------------------------------- 9-12 gather
gatherCommand({ name: "fish", verb: "fishing", loot: FISH_LOOT, cooldownMs: 1000 * 60 * 8, toolId: "fishing_rod", description: "Go fishing for loot you can sell." });
gatherCommand({ name: "hunt", verb: "hunting", loot: HUNT_LOOT, cooldownMs: 1000 * 60 * 10, toolId: "hunting_rifle", description: "Go hunting for loot you can sell." });
gatherCommand({ name: "mine", verb: "mining", loot: MINE_LOOT, cooldownMs: 1000 * 60 * 12, toolId: "pickaxe", description: "Go mining for ores and gems." });
gatherCommand({ name: "chop", verb: "chopping wood", loot: CHOP_LOOT, cooldownMs: 1000 * 60 * 7, toolId: "axe", description: "Chop wood to sell." });

// ------------------------------------------------------------ 13. inventory
const ALL_LOOT = [...FISH_LOOT, ...HUNT_LOOT, ...MINE_LOOT, ...CHOP_LOOT];
function lootMeta(id) { return ALL_LOOT.find((l) => l.id === id) || ITEMS[id] || { name: id, emoji: "📦", value: 0 }; }
add({
  name: "inventory", category: "economy", description: "View your item inventory.", usage: "inventory [@user]", permission: "everyone", aliases: ["inv"],
  run: async ({ message }) => {
    const target = mention(message);
    const inv = getInv(message.guild.id, target.id);
    const rows = Object.entries(inv).filter(([, q]) => q > 0).map(([id, q]) => {
      const meta = lootMeta(id);
      return `${meta.emoji || "📦"} **${meta.name || id}** — x${q}${meta.value ? ` (≈${fmt(meta.value * q)} ${EMOJI.coin})` : ""}`;
    });
    const pages = listPages(rows, { title: `🎒 ${target.username}'s Inventory`, perPage: 10 });
    await paginate(message, pages, { userId: message.author.id });
  },
});

// ---------------------------------------------------------------- 14. shop
add({
  name: "shop", category: "economy", description: "Browse and buy items from the shop.", usage: "shop", permission: "everyone", aliases: ["store"],
  run: async ({ message }) => {
    const options = Object.entries(ITEMS).map(([id, it]) => ({ label: `${it.name} — ${fmt(it.price)} coins`, value: id, description: it.desc, emoji: it.emoji }));
    const desc = Object.entries(ITEMS).map(([id, it]) => `${it.emoji} **${it.name}** — ${fmt(it.price)} ${EMOJI.coin}\n_${it.desc}_`).join("\n\n");
    const e = embed({ title: "🛒 YORU Shop", description: desc, color: COLORS.brand, footer: "Select an item below to purchase it" });
    const sent = await message.reply({ embeds: [e], components: [row(select({ id: "shop:pick", placeholder: "Choose an item to buy", options }))] });
    const cl = sent.createMessageComponentCollector({ time: 60_000, max: 1 });
    cl.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your shop menu.", ephemeral: true }).catch(() => {});
      const id = int.values[0];
      const it = ITEMS[id];
      await int.update({ components: [] }).catch(() => {});
      const ok = await confirm(message, { title: `Buy ${it.name}?`, description: `This costs **${fmt(it.price)}** ${EMOJI.coin}.`, danger: false, userId: message.author.id });
      if (!ok) return;
      const g = message.guild.id, u = message.author.id;
      if (bal(g, u) < it.price) return message.channel.send({ embeds: [errEmbed("Not enough coins", `You need **${fmt(it.price)}** ${EMOJI.coin}.`)] });
      addBal(g, u, -it.price);
      addItem(g, u, id, 1);
      message.channel.send({ embeds: [okEmbed("Purchase Complete", `You bought **${it.name}** ${it.emoji}!`)] });
    });
    cl.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  },
});

// ---------------------------------------------------------------- 15. buy
add({
  name: "buy", category: "economy", description: "Buy an item directly by name.", usage: "buy <item> [qty]", permission: "everyone", aliases: [],
  run: async ({ message, args }) => {
    const id = (args[0] || "").toLowerCase().replace(/-/g, "_");
    const qty = clamp(num(args[1], 1), 1, 99);
    const it = ITEMS[id];
    if (!it) return message.reply({ embeds: [errEmbed("Unknown item", "Use `shop` to see item ids, e.g. `buy pickaxe`.")] });
    const cost = it.price * qty;
    const g = message.guild.id, u = message.author.id;
    if (bal(g, u) < cost) return message.reply({ embeds: [errEmbed("Not enough coins", `You need **${fmt(cost)}** ${EMOJI.coin} for ${qty}x ${it.name}.`)] });
    addBal(g, u, -cost);
    addItem(g, u, id, qty);
    return message.reply({ embeds: [okEmbed("Purchased", `Bought **${qty}x ${it.name}** ${it.emoji} for **${fmt(cost)}** ${EMOJI.coin}.`)] });
  },
});

// ---------------------------------------------------------------- 16. sell
add({
  name: "sell", category: "economy", description: "Sell items from your inventory for coins.", usage: "sell <item|all> [qty]", permission: "everyone", aliases: [],
  run: async ({ message, args }) => {
    const g = message.guild.id, u = message.author.id;
    const inv = getInv(g, u);
    if (!args[0]) return message.reply({ embeds: [errEmbed("Missing item", "Usage: `sell <item> [qty]` or `sell all`.")] });
    if (args[0].toLowerCase() === "all") {
      let total = 0;
      for (const [id, q] of Object.entries(inv)) {
        const meta = lootMeta(id);
        if (!meta.value) continue;
        total += meta.value * q;
        delete inv[id];
      }
      if (!total) return message.reply({ embeds: [warnEmbed("Nothing to sell", "You have no sellable items.")] });
      addBal(g, u, total);
      return message.reply({ embeds: [okEmbed("Sold Everything", `You sold your whole inventory for **${fmt(total)}** ${EMOJI.coin}.`)] });
    }
    const id = args[0].toLowerCase().replace(/-/g, "_");
    const qty = clamp(num(args[1], 1), 1, 9999);
    const have = inv[id] || 0;
    if (have < qty) return message.reply({ embeds: [errEmbed("Not enough items", `You only have ${have}x of that item.`)] });
    const meta = lootMeta(id);
    if (!meta.value) return message.reply({ embeds: [errEmbed("Can't sell that", "That item has no sell value; try `use-item` instead.")] });
    addItem(g, u, id, -qty);
    const gain = meta.value * qty;
    addBal(g, u, gain);
    return message.reply({ embeds: [okEmbed("Sold", `Sold **${qty}x ${meta.name}** for **${fmt(gain)}** ${EMOJI.coin}.`)] });
  },
});

// ------------------------------------------------------------ 17. use-item
add({
  name: "use-item", category: "economy", description: "Use a consumable item from your inventory.", usage: "use-item <item>", permission: "everyone", aliases: ["use"],
  run: async ({ message, args }) => {
    const g = message.guild.id, u = message.author.id;
    const id = (args[0] || "").toLowerCase().replace(/-/g, "_");
    const inv = getInv(g, u);
    const it = ITEMS[id];
    if (!it || !(inv[id] > 0)) return message.reply({ embeds: [errEmbed("You don't have that", "Check `inventory` for items you own.")] });
    if (it.type !== "consumable") return message.reply({ embeds: [warnEmbed("Not usable", "That item isn't a consumable.")] });
    if (id === "energy_drink") {
      cooldowns.delete(`work:${key(g, u)}`);
      addItem(g, u, id, -1);
      return message.reply({ embeds: [okEmbed("Energized!", "Your `work` cooldown has been reset.")] });
    }
    if (id === "shield") {
      addItem(g, u, id, -1);
      addItem(g, u, "shield", 1); // remains as protection consumed on rob
      return message.reply({ embeds: [okEmbed("Shield Armed", "You are now protected from the next robbery attempt.")] });
    }
    if (id === "lucky_charm") {
      addItem(g, u, id, -1);
      addItem(g, u, "lucky_charm_active", 1);
      return message.reply({ embeds: [okEmbed("Feeling Lucky", "Your next `crime` or `gamble` gets better odds.")] });
    }
    return message.reply({ embeds: [infoEmbed("Nothing happened", "That item has no active effect.")] });
  },
});

// -------------------------------------------------------------- 18. gift --
add({
  name: "gift", category: "economy", description: "Gift coins to another user.", usage: "gift @user <amount>", permission: "everyone", aliases: ["give"],
  run: async ({ message, args }) => {
    const target = message.mentions.users.first();
    const amount = num(args.find((a) => /^\d+$/.test(a)), 0);
    if (!target || target.bot || target.id === message.author.id) return message.reply({ embeds: [errEmbed("Invalid target", "Mention a user to gift coins to.")] });
    if (amount <= 0) return message.reply({ embeds: [errEmbed("Invalid amount", "Give a positive whole number of coins.")] });
    const g = message.guild.id, u = message.author.id;
    if (bal(g, u) < amount) return message.reply({ embeds: [errEmbed("Not enough coins", `You only have **${fmt(bal(g, u))}** ${EMOJI.coin}.`)] });
    const ok = await confirm(message, { title: `Gift ${fmt(amount)} coins to ${target.username}?`, description: "This cannot be undone.", danger: false });
    if (!ok) return;
    addBal(g, u, -amount);
    addBal(g, target.id, amount);
    return message.channel.send({ embeds: [okEmbed("Gift Sent", `${message.author.username} gifted **${fmt(amount)}** ${EMOJI.coin} to ${target.username}!`)] });
  },
});

// ------------------------------------------------------------- 19. deposit
add({
  name: "deposit", category: "economy", description: "Deposit coins into your bank (safe from robbery).", usage: "deposit <amount|all>", permission: "everyone", aliases: ["dep"],
  run: async ({ message, args }) => {
    const g = message.guild.id, u = message.author.id;
    const wallet = bal(g, u);
    const amount = args[0]?.toLowerCase() === "all" ? wallet : num(args[0], 0);
    if (amount <= 0 || amount > wallet) return message.reply({ embeds: [errEmbed("Invalid amount", `You have **${fmt(wallet)}** ${EMOJI.coin} in your wallet.`)] });
    addBal(g, u, -amount);
    setBank(g, u, getBank(g, u) + amount);
    return message.reply({ embeds: [okEmbed("Deposited", `Moved **${fmt(amount)}** ${EMOJI.coin} into your bank.`)] });
  },
});

// ------------------------------------------------------------ 20. withdraw
add({
  name: "withdraw", category: "economy", description: "Withdraw coins from your bank.", usage: "withdraw <amount|all>", permission: "everyone", aliases: ["wd"],
  run: async ({ message, args }) => {
    const g = message.guild.id, u = message.author.id;
    const banked = getBank(g, u);
    const amount = args[0]?.toLowerCase() === "all" ? banked : num(args[0], 0);
    if (amount <= 0 || amount > banked) return message.reply({ embeds: [errEmbed("Invalid amount", `You have **${fmt(banked)}** ${EMOJI.coin} banked.`)] });
    setBank(g, u, banked - amount);
    addBal(g, u, amount);
    return message.reply({ embeds: [okEmbed("Withdrawn", `Moved **${fmt(amount)}** ${EMOJI.coin} into your wallet.`)] });
  },
});

// --------------------------------------------------------------- 21. bank
add({
  name: "bank", category: "economy", description: "View your bank overview.", usage: "bank", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const w = bal(g, u), b = getBank(g, u);
    return message.reply({
      embeds: [embed({
        title: `🏦 ${message.author.username}'s Bank`,
        fields: [
          { name: "Wallet", value: `${fmt(w)} ${EMOJI.coin}`, inline: true },
          { name: "Bank", value: `${fmt(b)} ${EMOJI.coin}`, inline: true },
          { name: "Total", value: `${fmt(w + b)} ${EMOJI.coin}`, inline: true },
        ],
        color: COLORS.info,
        footer: "Bank funds are safe from robbery. Use deposit/withdraw.",
      })],
    });
  },
});

// ------------------------------------------------------------- 22. richest
add({
  name: "richest", category: "economy", description: "See the wealthiest members leaderboard.", usage: "richest", permission: "everyone", aliases: ["baltop", "richlist"],
  run: async ({ message }) => {
    const g = message.guild.id;
    const rows = db.prepare("SELECT user_id, balance FROM economy WHERE guild_id = ? ORDER BY balance DESC LIMIT 100").all(g);
    const combined = rows.map((r) => ({ id: r.user_id, total: r.balance + getBank(g, r.user_id) })).sort((a, b) => b.total - a.total);
    const medals = ["🥇", "🥈", "🥉"];
    const lines = combined.map((r, i) => `${medals[i] || `#${i + 1}`} <@${r.id}> — **${fmt(r.total)}** ${EMOJI.coin}`);
    const pages = listPages(lines, { title: "💰 Richest Members", perPage: 10 });
    await paginate(message, pages);
  },
});

// -------------------------------------------------------------- 23. gamble
add({
  name: "gamble", category: "economy", description: "Flip a coin gamble at fair (49%) odds.", usage: "gamble <amount>", permission: "everyone", aliases: ["flip", "cf"],
  run: async ({ message, args }) => {
    const g = message.guild.id, u = message.author.id;
    const amount = num(args[0], 0);
    if (amount <= 0) return message.reply({ embeds: [errEmbed("Invalid amount", "Specify a positive amount of coins to gamble.")] });
    if (bal(g, u) < amount) return message.reply({ embeds: [errEmbed("Not enough coins", `You only have **${fmt(bal(g, u))}** ${EMOJI.coin}.`)] });
    const inv = getInv(g, u);
    const lucky = inv.lucky_charm_active > 0;
    if (lucky) addItem(g, u, "lucky_charm_active", -1);
    const winChance = lucky ? 0.55 : 0.49;
    const win = Math.random() < winChance;
    if (win) { addBal(g, u, amount); } else { addBal(g, u, -amount); }
    return message.reply({
      embeds: [embed({
        title: win ? "🎉 You Won!" : "💸 You Lost", color: win ? COLORS.ok : COLORS.danger,
        description: `${win ? `You doubled up and gained **${fmt(amount)}**` : `You lost **${fmt(amount)}**`} ${EMOJI.coin}\n\nOdds shown: **${Math.round(winChance * 100)}%** to win${lucky ? " (lucky charm applied)" : ""}.`,
      })],
    });
  },
});

// ------------------------------------------------------------- 24. lottery
add({
  name: "lottery", category: "economy", description: "Buy lottery tickets or trigger a draw (100/ticket).", usage: "lottery buy <qty> | lottery draw | lottery", permission: "everyone", aliases: ["lotto"],
  run: async ({ message, args, isOwner }) => {
    const g = message.guild.id, u = message.author.id;
    const sub = (args[0] || "").toLowerCase();
    const ticketPrice = 100;
    if (sub === "buy") {
      const qty = clamp(num(args[1], 1), 1, 100);
      const cost = qty * ticketPrice;
      if (bal(g, u) < cost) return message.reply({ embeds: [errEmbed("Not enough coins", `${qty} tickets cost **${fmt(cost)}** ${EMOJI.coin}.`)] });
      addBal(g, u, -cost);
      lottery.pot += cost;
      lottery.tickets.set(u, (lottery.tickets.get(u) || 0) + qty);
      return message.reply({ embeds: [okEmbed("Tickets Purchased", `You bought **${qty}** ticket(s). Pot is now **${fmt(lottery.pot)}** ${EMOJI.coin}.`)] });
    }
    if (sub === "draw") {
      if (!isOwner && !message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "Only admins can trigger a draw.")] });
      const entries = [...lottery.tickets.entries()];
      if (!entries.length) return message.reply({ embeds: [warnEmbed("No tickets sold", "Nobody has bought a ticket yet.")] });
      const pool = entries.flatMap(([id, q]) => Array(q).fill(id));
      const winner = pick(pool);
      const prize = lottery.pot;
      addBal(g, winner, prize);
      lottery.pot = 0;
      lottery.tickets.clear();
      lottery.lastDraw = Date.now();
      return message.reply({ embeds: [embed({ title: "🎟️ Lottery Draw!", description: `Congratulations <@${winner}> — you won **${fmt(prize)}** ${EMOJI.coin}!`, color: COLORS.brand })] });
    }
    return message.reply({
      embeds: [infoEmbed("Lottery", `Current pot: **${fmt(lottery.pot)}** ${EMOJI.coin}\nTickets sold: **${[...lottery.tickets.values()].reduce((a, b) => a + b, 0)}**\nTicket price: **${ticketPrice}** ${EMOJI.coin}\n\nUse \`lottery buy <qty>\` to enter, admins use \`lottery draw\`.`)],
    });
  },
});

// --------------------------------------------------------------- 25. jobs
add({
  name: "jobs", category: "economy", description: "List available jobs and apply for one.", usage: "jobs", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const options = JOBS.map((j) => ({ label: j.title, value: j.title, description: `Pays ${j.min}-${j.max} coins per shift` }));
    const chosen = await choose(message, {
      title: "💼 Available Jobs",
      description: JOBS.map((j) => `**${j.title}** — ${j.min}-${j.max} ${EMOJI.coin} per shift`).join("\n"),
      options,
    });
    if (!chosen) return;
    const k = key(message.guild.id, message.author.id);
    streaks.set(`job:${k}`, chosen);
    return message.channel.send({ embeds: [okEmbed("Job Applied", `You are now employed as a **${chosen}**! Use \`work\` to start a shift.`)] });
  },
});

// -------------------------------------------------------------- 26. payday
add({
  name: "payday", category: "economy", description: "Claim a small passive payday bonus.", usage: "payday", permission: "everyone", aliases: [],
  run: async ({ message }) => {
    const g = message.guild.id, u = message.author.id;
    const cd = onCooldown("payday", g, u);
    if (cd.active) return message.reply({ embeds: [cooldownEmbed("payday", cd.ready)] });
    const job = streaks.get(`job:${key(g, u)}`);
    const amount = job ? 120 : 60;
    addBal(g, u, amount);
    setCooldown("payday", g, u, 1000 * 60 * 60 * 4);
    return message.reply({ embeds: [okEmbed("Payday!", `You received **${fmt(amount)}** ${EMOJI.coin}${job ? ` from your job as a ${job}` : ""}.`)] });
  },
});

// -------------------------------------------------------------- 27. ecostats
add({
  name: "ecostats", category: "economy", description: "View overall economy statistics.", usage: "ecostats", permission: "everyone", aliases: ["ecostat"],
  run: async ({ message }) => {
    const g = message.guild.id;
    const rows = db.prepare("SELECT balance FROM economy WHERE guild_id = ?").all(g);
    const totalWallet = rows.reduce((s, r) => s + r.balance, 0);
    const totalBank = [...banks.entries()].filter(([k]) => k.startsWith(`${g}:`)).reduce((s, [, v]) => s + v, 0);
    const users = rows.length;
    return message.reply({
      embeds: [embed({
        title: "📊 Economy Stats",
        fields: [
          { name: "Users Tracked", value: fmt(users), inline: true },
          { name: "Total in Wallets", value: `${fmt(totalWallet)} ${EMOJI.coin}`, inline: true },
          { name: "Total in Banks", value: `${fmt(totalBank)} ${EMOJI.coin}`, inline: true },
          { name: "Lottery Pot", value: `${fmt(lottery.pot)} ${EMOJI.coin}`, inline: true },
          { name: "Average Wealth", value: users ? fmt(Math.round((totalWallet + totalBank) / users)) : "0", inline: true },
        ],
        color: COLORS.brand,
      })],
    });
  },
});

// --------------------------------------------------------- 28. resetbalance
add({
  name: "resetbalance", category: "economy", description: "Admin: reset a user's balance and bank to zero.", usage: "resetbalance @user", permission: "admin", aliases: ["ecoreset"],
  run: async ({ message }) => {
    if (!message.member.permissions.has("Administrator")) return message.reply({ embeds: [errEmbed("No permission", "You need Administrator to do this.")] });
    const target = message.mentions.users.first();
    if (!target) return message.reply({ embeds: [errEmbed("Missing target", "Mention a user to reset.")] });
    const ok = await confirm(message, { title: `Reset ${target.username}'s balance?`, description: "Their wallet, bank and inventory will be wiped to zero. This is irreversible.", danger: true });
    if (!ok) return;
    setBalance(message.guild.id, target.id, 0, 0);
    setBank(message.guild.id, target.id, 0);
    inventories.set(key(message.guild.id, target.id), {});
    return message.channel.send({ embeds: [okEmbed("Balance Reset", `${target.username}'s economy data has been wiped.`)] });
  },
});
