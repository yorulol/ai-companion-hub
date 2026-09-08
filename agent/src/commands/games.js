import { ComponentType } from "discord.js";
import {
  embed, okEmbed, errEmbed, warnEmbed, infoEmbed,
  button, row, select, bar, COLORS, RNG, pick, num, clamp, mention, fmt,
} from "../ui.js";
import { getBalance, setBalance } from "../db.js";
import { chat } from "../chat-loop.js";

export const commands = [];
const add = (c) => commands.push(c);

const stats = new Map(); // userId -> { wins, losses }
function bump(userId, key) {
  const s = stats.get(userId) || { wins: 0, losses: 0, draws: 0 };
  s[key] = (s[key] || 0) + 1;
  stats.set(userId, s);
}

function canBet(guildId, userId, amount) {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "Bet must be a positive number." };
  const bal = getBalance(guildId, userId).balance;
  if (amount > bal) return { ok: false, reason: `You only have ${fmt(bal)} coins.` };
  return { ok: true, bal };
}

// ---------- tictactoe ----------
function ttoWinner(b) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b1,c] of lines) if (b[a] && b[a] === b[b1] && b[a] === b[c]) return b[a];
  return b.every(Boolean) ? "draw" : null;
}
add({ name: "tictactoe", category: "games", description: "Play tic-tac-toe vs another user or the bot.", usage: "tictactoe [@user]", permission: "everyone",
  run: async ({ message }) => {
    const opponent = message.mentions.users.first();
    const vsBot = !opponent || opponent.id === message.author.id || opponent.bot;
    const p1 = message.author, p2 = vsBot ? message.client.user : opponent;
    const board = Array(9).fill(null);
    let turn = p1.id;
    const buildRows = (disabled = false) => {
      const rows = [];
      for (let r = 0; r < 3; r++) {
        const cells = [];
        for (let c = 0; c < 3; c++) {
          const i = r * 3 + c;
          cells.push(button({ id: `ttt:${i}`, label: board[i] || "\u200b", style: board[i] === "X" ? "danger" : board[i] === "O" ? "primary" : "secondary", disabled: disabled || !!board[i] }));
        }
        rows.push(row(...cells));
      }
      return rows;
    };
    const render = () => embed({ title: "⭕ Tic-Tac-Toe", description: `${p1.username} (X) vs ${p2.username} (O)\nTurn: <@${turn}>`, color: COLORS.brand });
    const sent = await message.reply({ embeds: [render()], components: buildRows() });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 120_000 });
    collector.on("collect", async (int) => {
      const idx = Number(int.customId.split(":")[1]);
      if (vsBot) {
        if (int.user.id !== p1.id) return int.reply({ content: "Not your game.", ephemeral: true }).catch(() => {});
      } else if (![p1.id, p2.id].includes(int.user.id) || int.user.id !== turn) {
        return int.reply({ content: "Not your turn.", ephemeral: true }).catch(() => {});
      }
      if (board[idx]) return int.deferUpdate().catch(() => {});
      board[idx] = turn === p1.id ? "X" : "O";
      let winner = ttoWinner(board);
      if (!winner && vsBot) {
        const empties = board.map((v, i) => (v ? null : i)).filter((v) => v !== null);
        if (empties.length) {
          const aiMove = pick(empties);
          board[aiMove] = "O";
          winner = ttoWinner(board);
        }
      } else {
        turn = turn === p1.id ? p2.id : p1.id;
      }
      if (winner) {
        collector.stop();
        const text = winner === "draw" ? "It's a draw!" : `${winner === "X" ? p1.username : p2.username} wins!`;
        if (winner !== "draw") bump(winner === "X" ? p1.id : p2.id, "wins");
        await int.update({ embeds: [embed({ title: "⭕ Tic-Tac-Toe — Game Over", description: text, color: COLORS.ok })], components: buildRows(true) }).catch(() => {});
        return;
      }
      await int.update({ embeds: [render()], components: buildRows() }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: buildRows(true) }).catch(() => {}));
  } });

// ---------- rock paper scissors ----------
add({ name: "rps", category: "games", description: "Best of 3 rock-paper-scissors vs the bot.", usage: "rps", permission: "everyone",
  run: async ({ message }) => {
    let wins = 0, losses = 0, round = 0;
    const opts = ["rock", "paper", "scissors"];
    const beats = { rock: "scissors", paper: "rock", scissors: "paper" };
    const render = (result) => embed({ title: "🪨📄✂️ Rock Paper Scissors", description: result || "Choose your move.", fields: [{ name: "Score", value: `You ${wins} — ${losses} Bot`, inline: true }], color: COLORS.brand });
    const sent = await message.reply({ embeds: [render()], components: [row(...opts.map((o) => button({ id: `rps:${o}`, label: o[0].toUpperCase() + o.slice(1), style: "primary" })))] });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your game.", ephemeral: true }).catch(() => {});
      const you = int.customId.split(":")[1];
      const bot = pick(opts);
      let outcome;
      if (you === bot) outcome = "Tie!";
      else if (beats[you] === bot) { wins++; outcome = "You win this round!"; }
      else { losses++; outcome = "Bot wins this round!"; }
      round++;
      const text = `You picked **${you}**, bot picked **${bot}**. ${outcome}`;
      if (wins === 2 || losses === 2) {
        collector.stop();
        const finalText = wins === 2 ? "🏆 You win the match!" : "🤖 Bot wins the match!";
        bump(message.author.id, wins === 2 ? "wins" : "losses");
        await int.update({ embeds: [embed({ title: "🪨📄✂️ Match Over", description: `${text}\n\n${finalText}`, color: wins === 2 ? COLORS.ok : COLORS.danger })], components: [] }).catch(() => {});
        return;
      }
      await int.update({ embeds: [render(text)] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

// ---------- connect4 ----------
add({ name: "connect4", category: "games", description: "Play Connect 4 vs another user.", usage: "connect4 <@user>", permission: "everyone",
  run: async ({ message }) => {
    const opponent = message.mentions.users.first();
    if (!opponent || opponent.bot || opponent.id === message.author.id) return message.reply({ embeds: [warnEmbed("Need an opponent", "Usage: `connect4 @user`")] });
    const ROWS = 6, COLS = 7;
    const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    const p1 = message.author, p2 = opponent;
    let turn = p1.id;
    const disc = (v) => v === "R" ? "🔴" : v === "Y" ? "🟡" : "⚪";
    const render = () => {
      const lines = grid.map((r) => r.map(disc).join("")).join("\n");
      return embed({ title: "🔴🟡 Connect 4", description: `${lines}\n\nTurn: <@${turn}>`, color: COLORS.brand });
    };
    const buttons = (disabled = false) => row(...Array.from({ length: COLS }, (_, c) => button({ id: `c4:${c}`, label: `${c + 1}`, style: "secondary", disabled: disabled || grid[0][c] !== null })));
    const checkWin = (color) => {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (grid[r][c] !== color) continue;
        const dirs = [[0,1],[1,0],[1,1],[1,-1]];
        for (const [dr, dc] of dirs) {
          let count = 1;
          for (let k = 1; k < 4; k++) { const nr = r + dr*k, nc = c + dc*k; if (grid[nr]?.[nc] === color) count++; else break; }
          if (count >= 4) return true;
        }
      }
      return false;
    };
    const sent = await message.reply({ embeds: [render()], components: [buttons()] });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 180_000 });
    collector.on("collect", async (int) => {
      if (![p1.id, p2.id].includes(int.user.id) || int.user.id !== turn) return int.reply({ content: "Not your turn.", ephemeral: true }).catch(() => {});
      const col = Number(int.customId.split(":")[1]);
      let placedRow = -1;
      for (let r = ROWS - 1; r >= 0; r--) if (!grid[r][col]) { grid[r][col] = turn === p1.id ? "R" : "Y"; placedRow = r; break; }
      if (placedRow === -1) return int.deferUpdate().catch(() => {});
      const color = turn === p1.id ? "R" : "Y";
      if (checkWin(color)) {
        collector.stop();
        bump(turn, "wins");
        await int.update({ embeds: [embed({ title: "🏆 Connect 4 — Winner!", description: `${grid.map((r) => r.map(disc).join("")).join("\n")}\n\n<@${turn}> wins!`, color: COLORS.ok })], components: [buttons(true)] }).catch(() => {});
        return;
      }
      if (grid.every((r) => r.every(Boolean))) {
        collector.stop();
        await int.update({ embeds: [embed({ title: "🤝 Connect 4 — Draw", description: "Board full, nobody wins.", color: COLORS.warn })], components: [buttons(true)] }).catch(() => {});
        return;
      }
      turn = turn === p1.id ? p2.id : p1.id;
      await int.update({ embeds: [render()], components: [buttons()] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [buttons(true)] }).catch(() => {}));
  } });

// ---------- hangman ----------
const HANGMAN_WORDS = ["discord", "javascript", "computer", "pancake", "wizard", "galaxy", "keyboard"];
const HANGMAN_ART = [
  "```\n  +---+\n      |\n      |\n      |\n     ===\n```",
  "```\n  +---+\n  O   |\n      |\n      |\n     ===\n```",
  "```\n  +---+\n  O   |\n  |   |\n      |\n     ===\n```",
  "```\n  +---+\n  O   |\n /|   |\n      |\n     ===\n```",
  "```\n  +---+\n  O   |\n /|\\  |\n      |\n     ===\n```",
  "```\n  +---+\n  O   |\n /|\\  |\n /    |\n     ===\n```",
  "```\n  +---+\n  O   |\n /|\\  |\n / \\  |\n     ===\n```",
];
add({ name: "hangman", category: "games", description: "Play hangman by guessing letters in chat.", usage: "hangman", permission: "everyone",
  run: async ({ message }) => {
    const word = pick(HANGMAN_WORDS);
    const guessed = new Set();
    let wrong = 0;
    const display = () => [...word].map((c) => (guessed.has(c) ? c : "_")).join(" ");
    const render = () => embed({ title: "🪢 Hangman", description: `${HANGMAN_ART[wrong]}\n\n\`${display()}\`\nGuessed: ${[...guessed].join(", ") || "—"}`, color: COLORS.brand });
    await message.reply({ embeds: [render()] });
    while (wrong < 6 && [...word].some((c) => !guessed.has(c))) {
      const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id && /^[a-z]$/i.test(m.content.trim()), max: 1, time: 30_000, errors: [] }).catch(() => null);
      if (!collected || !collected.size) { await message.channel.send({ embeds: [infoEmbed("Timed out", `The word was **${word}**.`)] }); return; }
      const letter = collected.first().content.trim().toLowerCase();
      if (!word.includes(letter)) wrong++;
      guessed.add(letter);
      await message.channel.send({ embeds: [render()] });
    }
    const won = [...word].every((c) => guessed.has(c));
    bump(message.author.id, won ? "wins" : "losses");
    await message.channel.send({ embeds: [embed({ title: won ? "🎉 You Won!" : "💀 You Lost", description: `The word was **${word}**.`, color: won ? COLORS.ok : COLORS.danger })] });
  } });

// ---------- trivia ----------
const TRIVIA = [
  { q: "What is the capital of Japan?", opts: ["Seoul", "Tokyo", "Beijing", "Bangkok"], a: 1 },
  { q: "What planet is known as the Red Planet?", opts: ["Venus", "Mars", "Jupiter", "Mercury"], a: 1 },
  { q: "How many continents are there?", opts: ["5", "6", "7", "8"], a: 2 },
  { q: "What is the largest ocean?", opts: ["Atlantic", "Indian", "Arctic", "Pacific"], a: 3 },
];
add({ name: "trivia", category: "games", description: "Answer a multiple-choice trivia question against the clock.", usage: "trivia", permission: "everyone",
  run: async ({ message }) => {
    const q = pick(TRIVIA);
    const sent = await message.reply({
      embeds: [embed({ title: "❓ Trivia", description: q.q, footer: "20 seconds to answer", color: COLORS.info })],
      components: [row(...q.opts.map((o, i) => button({ id: `trivia:${i}`, label: o, style: "primary" })))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 20_000, max: 1 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your quiz.", ephemeral: true }).catch(() => {});
      const chosen = Number(int.customId.split(":")[1]);
      const correct = chosen === q.a;
      bump(int.user.id, correct ? "wins" : "losses");
      await int.update({ embeds: [embed({ title: correct ? "✅ Correct!" : "❌ Wrong", description: `The answer was **${q.opts[q.a]}**.`, color: correct ? COLORS.ok : COLORS.danger })], components: [] }).catch(() => {});
    });
    collector.on("end", (c) => { if (!c.size) sent.edit({ embeds: [embed({ title: "⌛ Time's up", description: `The answer was **${q.opts[q.a]}**.`, color: COLORS.warn })], components: [] }).catch(() => {}); });
  } });

// ---------- would you rather battle ----------
add({ name: "wyrbattle", category: "games", description: "Head-to-head would-you-rather vote against another user.", usage: "wyrbattle <@user>", permission: "everyone",
  run: async ({ message }) => {
    const opponent = message.mentions.users.first();
    if (!opponent || opponent.id === message.author.id) return message.reply({ embeds: [warnEmbed("Need an opponent", "Usage: `wyrbattle @user`")] });
    const [a, b] = [pick(["Have unlimited pizza", "Have unlimited tacos"]), pick(["for the rest of your life", "for a year"])];
    const votes = {};
    const sent = await message.reply({
      embeds: [embed({ title: "⚔️ WYR Battle", description: `${message.author.username} vs ${opponent.username}\n**A)** ${a}\n**B)** ${b}`, color: COLORS.brand })],
      components: [row(button({ id: "wyrb:a", label: "A", style: "primary" }), button({ id: "wyrb:b", label: "B", style: "success" }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 30_000, filter: (i) => [message.author.id, opponent.id].includes(i.user.id) });
    collector.on("collect", async (int) => {
      votes[int.user.id] = int.customId.split(":")[1];
      await int.reply({ content: `Locked in **${votes[int.user.id].toUpperCase()}**.`, ephemeral: true }).catch(() => {});
      if (Object.keys(votes).length === 2) {
        collector.stop();
        const same = votes[message.author.id] === votes[opponent.id];
        await sent.edit({ embeds: [embed({ title: "⚔️ Results", description: same ? "You both agree! 🤝" : "You disagree! Fight resumes elsewhere. 😅", color: COLORS.ok })], components: [] }).catch(() => {});
      }
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

// ---------- blackjack ----------
function drawCard() { const v = 1 + RNG(13); return Math.min(v, 10); }
function handValue(hand) {
  let total = hand.reduce((s, c) => s + c, 0), aces = hand.filter((c) => c === 1).length;
  while (aces > 0 && total + 10 <= 21) { total += 10; aces--; }
  return total;
}
add({ name: "blackjack", category: "games", description: "Play blackjack against the dealer for coins.", usage: "blackjack <bet>", permission: "everyone",
  run: async ({ message, args, guildCfg }) => {
    const bet = num(args[0], NaN);
    const guildId = message.guild?.id || "dm";
    const check = canBet(guildId, message.author.id, bet);
    if (!check.ok) return message.reply({ embeds: [warnEmbed("Can't play", check.reason)] });
    let player = [drawCard(), drawCard()];
    let dealer = [drawCard(), drawCard()];
    const render = (reveal = false) => embed({
      title: "🃏 Blackjack",
      description: `Your hand: ${player.join(", ")} (${handValue(player)})\nDealer: ${reveal ? `${dealer.join(", ")} (${handValue(dealer)})` : `${dealer[0]}, ?`}`,
      color: COLORS.brand,
    });
    const controls = (disabled = false) => row(button({ id: "bj:hit", label: "Hit", style: "primary", disabled }), button({ id: "bj:stand", label: "Stand", style: "secondary", disabled }));
    const sent = await message.reply({ embeds: [render()], components: [controls()] });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
    const finish = async (int) => {
      collector.stop();
      let pv = handValue(player), dv = handValue(dealer);
      while (dv < 17) { dealer.push(drawCard()); dv = handValue(dealer); }
      let outcome, delta;
      if (pv > 21) { outcome = "You busted! Dealer wins."; delta = -bet; }
      else if (dv > 21 || pv > dv) { outcome = "You win!"; delta = bet; }
      else if (pv === dv) { outcome = "Push — bet returned."; delta = 0; }
      else { outcome = "Dealer wins."; delta = -bet; }
      const cur = getBalance(guildId, message.author.id);
      setBalance(guildId, message.author.id, cur.balance + delta);
      bump(message.author.id, delta > 0 ? "wins" : delta < 0 ? "losses" : "draws");
      await int.update({ embeds: [embed({ title: "🃏 Blackjack — Result", description: `${render(true).data.description}\n\n${outcome}\nBalance change: **${delta >= 0 ? "+" : ""}${fmt(delta)}**`, color: delta > 0 ? COLORS.ok : delta < 0 ? COLORS.danger : COLORS.warn })], components: [controls(true)] }).catch(() => {});
    };
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your table.", ephemeral: true }).catch(() => {});
      if (int.customId === "bj:hit") {
        player.push(drawCard());
        if (handValue(player) >= 21) return finish(int);
        await int.update({ embeds: [render()] }).catch(() => {});
      } else {
        await finish(int);
      }
    });
    collector.on("end", (c) => { if (!c.size) sent.edit({ components: [controls(true)] }).catch(() => {}); });
  } });

// ---------- slots ----------
const SLOT_EMOJI = ["🍒", "🍋", "🔔", "⭐", "💎", "7️⃣"];
add({ name: "slots", category: "games", description: "Spin the slot machine for coins.", usage: "slots <bet>", permission: "everyone",
  run: async ({ message, args }) => {
    const bet = num(args[0], NaN);
    const guildId = message.guild?.id || "dm";
    const check = canBet(guildId, message.author.id, bet);
    if (!check.ok) return message.reply({ embeds: [warnEmbed("Can't play", check.reason)] });
    const sent = await message.reply({ embeds: [embed({ title: "🎰 Slots", description: "🎰 | 🎰 | 🎰\nSpinning…", color: COLORS.warn })] });
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => setTimeout(r, 500));
      await sent.edit({ embeds: [embed({ title: "🎰 Slots", description: `${Array.from({ length: 3 }, () => pick(SLOT_EMOJI)).join(" | ")}\nSpinning…`, color: COLORS.warn })] }).catch(() => {});
    }
    const reels = Array.from({ length: 3 }, () => pick(SLOT_EMOJI));
    let mult = 0;
    if (reels[0] === reels[1] && reels[1] === reels[2]) mult = reels[0] === "7️⃣" ? 10 : 5;
    else if (reels[0] === reels[1] || reels[1] === reels[2]) mult = 1.5;
    const delta = mult > 0 ? Math.round(bet * mult) - bet : -bet;
    const cur = getBalance(guildId, message.author.id);
    setBalance(guildId, message.author.id, cur.balance + delta);
    bump(message.author.id, delta > 0 ? "wins" : "losses");
    await sent.edit({ embeds: [embed({ title: "🎰 Slots — Result", description: `${reels.join(" | ")}\n${mult > 0 ? `Winner! x${mult}` : "No match."}\nBalance change: **${delta >= 0 ? "+" : ""}${fmt(delta)}**`, color: delta > 0 ? COLORS.ok : COLORS.danger })] }).catch(() => {});
  } });

// ---------- coinflip bet ----------
add({ name: "coinflipbet", category: "games", description: "Bet coins on a coin flip.", usage: "coinflipbet <bet> <heads|tails>", permission: "everyone",
  run: async ({ message, args }) => {
    const bet = num(args[0], NaN);
    const call = (args[1] || "").toLowerCase();
    const guildId = message.guild?.id || "dm";
    const check = canBet(guildId, message.author.id, bet);
    if (!check.ok) return message.reply({ embeds: [warnEmbed("Can't play", check.reason)] });
    if (!["heads", "tails"].includes(call)) return message.reply({ embeds: [warnEmbed("Pick heads or tails", "Usage: `coinflipbet <bet> heads|tails`")] });
    const result = pick(["heads", "tails"]);
    const win = result === call;
    const delta = win ? bet : -bet;
    const cur = getBalance(guildId, message.author.id);
    setBalance(guildId, message.author.id, cur.balance + delta);
    bump(message.author.id, win ? "wins" : "losses");
    await message.reply({ embeds: [embed({ title: "🪙 Coinflip Bet", description: `Landed on **${result}**. ${win ? "You win!" : "You lose!"}\nBalance change: **${delta >= 0 ? "+" : ""}${fmt(delta)}**`, color: win ? COLORS.ok : COLORS.danger })] });
  } });

// ---------- roulette ----------
add({ name: "roulette", category: "games", description: "Bet on red, black, or a number.", usage: "roulette <bet>", permission: "everyone",
  run: async ({ message, args }) => {
    const bet = num(args[0], NaN);
    const guildId = message.guild?.id || "dm";
    const check = canBet(guildId, message.author.id, bet);
    if (!check.ok) return message.reply({ embeds: [warnEmbed("Can't play", check.reason)] });
    const sent = await message.reply({
      embeds: [embed({ title: "🎡 Roulette", description: "Pick your bet type.", color: COLORS.brand })],
      components: [row(select({ id: "rl:pick", placeholder: "Choose…", options: [
        { label: "Red (2x)", value: "red" }, { label: "Black (2x)", value: "black" }, { label: "Lucky 7 (5x)", value: "seven" },
      ] }))],
    });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 30_000, max: 1 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your table.", ephemeral: true }).catch(() => {});
      const number = RNG(37);
      const color = number === 0 ? "green" : (number % 2 === 0 ? "black" : "red");
      const choice = int.values[0];
      let win = false, mult = 0;
      if (choice === "seven" && number === 7) { win = true; mult = 5; }
      else if (choice === color) { win = true; mult = 2; }
      const delta = win ? bet * mult - bet : -bet;
      const cur = getBalance(guildId, message.author.id);
      setBalance(guildId, message.author.id, cur.balance + delta);
      bump(message.author.id, win ? "wins" : "losses");
      await int.update({ embeds: [embed({ title: "🎡 Roulette Result", description: `Ball landed on **${number} (${color})**.\n${win ? "You win!" : "You lose."}\nBalance change: **${delta >= 0 ? "+" : ""}${fmt(delta)}**`, color: win ? COLORS.ok : COLORS.danger })], components: [] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

// ---------- higher lower ----------
add({ name: "higherlower", category: "games", description: "Guess if the next number is higher or lower.", usage: "higherlower", permission: "everyone",
  run: async ({ message }) => {
    let current = 1 + RNG(100), streak = 0;
    const render = () => embed({ title: "🔢 Higher or Lower", description: `Current number: **${current}**\nStreak: ${streak}`, color: COLORS.brand });
    const controls = (disabled = false) => row(button({ id: "hl:higher", label: "Higher", style: "success", disabled }), button({ id: "hl:lower", label: "Lower", style: "danger", disabled }));
    const sent = await message.reply({ embeds: [render()], components: [controls()] });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 45_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your game.", ephemeral: true }).catch(() => {});
      const next = 1 + RNG(100);
      const guessHigher = int.customId === "hl:higher";
      const correct = (guessHigher && next >= current) || (!guessHigher && next <= current);
      current = next;
      if (correct) { streak++; await int.update({ embeds: [render()] }).catch(() => {}); }
      else {
        collector.stop();
        bump(int.user.id, "losses");
        await int.update({ embeds: [embed({ title: "💥 Wrong!", description: `The number was **${next}**. Final streak: **${streak}**.`, color: COLORS.danger })], components: [controls(true)] }).catch(() => {});
      }
    });
    collector.on("end", (c) => { if (!c.size) sent.edit({ components: [controls(true)] }).catch(() => {}); });
  } });

// ---------- memory sequence ----------
add({ name: "memorysequence", category: "games", description: "Memorize and repeat a growing sequence of buttons.", usage: "memorysequence", permission: "everyone",
  run: async ({ message }) => {
    const symbols = ["🔴", "🟢", "🔵", "🟡"];
    let seq = [pick(symbols)];
    const showSeq = async () => {
      const sent = await message.channel.send({ embeds: [embed({ title: "🧠 Memorize this!", description: seq.join(" "), color: COLORS.info })] });
      await new Promise((r) => setTimeout(r, 1500 + seq.length * 400));
      await sent.edit({ embeds: [embed({ title: "🧠 Now repeat it!", description: "Click the buttons in order.", color: COLORS.brand })], components: [row(...symbols.map((s) => button({ id: `mem:${s}`, label: s, style: "secondary" })))] }).catch(() => {});
      return sent;
    };
    let sent = await showSeq();
    let progress = 0;
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your game.", ephemeral: true }).catch(() => {});
      const val = int.customId.split(":")[1];
      if (val !== seq[progress]) {
        collector.stop();
        bump(int.user.id, "losses");
        await int.update({ embeds: [embed({ title: "❌ Wrong!", description: `The sequence was: ${seq.join(" ")}\nYou reached length ${seq.length - 1}.`, color: COLORS.danger })], components: [] }).catch(() => {});
        return;
      }
      progress++;
      if (progress === seq.length) {
        collector.stop();
        await int.update({ embeds: [embed({ title: "✅ Correct so far!", description: "Sequence grows... check the next message!", color: COLORS.ok })], components: [] }).catch(() => {});
        seq.push(pick(symbols));
        sent = await showSeq();
        progress = 0;
        const nextCollector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 60_000 });
        nextCollector.on("collect", async () => {}); // simplified continuation handled by re-invocation
        bump(message.author.id, "wins");
      } else {
        await int.deferUpdate().catch(() => {});
      }
    });
  } });

// ---------- wordle ----------
const WORDLE_WORDS = ["apple", "grape", "chair", "mouse", "table", "brave", "stone", "plane"];
add({ name: "wordle", category: "games", description: "Guess the 5-letter word with colored feedback.", usage: "wordle", permission: "everyone",
  run: async ({ message }) => {
    const word = pick(WORDLE_WORDS);
    let attempts = 0;
    const feedback = (guess) => [...guess].map((c, i) => c === word[i] ? "🟩" : word.includes(c) ? "🟨" : "⬛").join("");
    await message.reply({ embeds: [embed({ title: "🟩 Wordle", description: "Guess the 5-letter word! You have 6 tries.", color: COLORS.brand })] });
    const history = [];
    while (attempts < 6) {
      const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id && /^[a-z]{5}$/i.test(m.content.trim()), max: 1, time: 30_000, errors: [] }).catch(() => null);
      if (!collected || !collected.size) { await message.channel.send({ embeds: [infoEmbed("Timed out", `The word was **${word}**.`)] }); return; }
      const guess = collected.first().content.trim().toLowerCase();
      attempts++;
      history.push(`${feedback(guess)}  \`${guess}\``);
      if (guess === word) {
        bump(message.author.id, "wins");
        await message.channel.send({ embeds: [embed({ title: "🎉 Solved!", description: `${history.join("\n")}\n\nGot it in ${attempts} tries!`, color: COLORS.ok })] });
        return;
      }
      await message.channel.send({ embeds: [embed({ title: `🟩 Wordle (${attempts}/6)`, description: history.join("\n"), color: COLORS.brand })] });
    }
    bump(message.author.id, "losses");
    await message.channel.send({ embeds: [embed({ title: "💀 Out of tries", description: `The word was **${word}**.`, color: COLORS.danger })] });
  } });

// ---------- anagram ----------
const ANAGRAM_WORDS = ["planet", "guitar", "wizard", "castle", "dragon", "puzzle"];
add({ name: "anagram", category: "games", description: "Unscramble the word before time runs out.", usage: "anagram", permission: "everyone",
  run: async ({ message }) => {
    const word = pick(ANAGRAM_WORDS);
    let scrambled = word;
    while (scrambled === word) scrambled = [...word].sort(() => Math.random() - 0.5).join("");
    await message.reply({ embeds: [embed({ title: "🔤 Anagram", description: `Unscramble: **${scrambled.toUpperCase()}**\nYou have 20 seconds.`, color: COLORS.brand })] });
    const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 20_000, errors: [] }).catch(() => null);
    const guess = collected?.first()?.content?.trim()?.toLowerCase();
    const correct = guess === word;
    bump(message.author.id, correct ? "wins" : "losses");
    await message.channel.send({ embeds: [embed({ title: correct ? "✅ Correct!" : "❌ Not quite", description: `The word was **${word}**.`, color: correct ? COLORS.ok : COLORS.danger })] });
  } });

// ---------- typerace ----------
const RACE_PHRASES = ["the quick brown fox jumps over the lazy dog", "yoru is the fastest bot around", "practice makes perfect every single day"];
add({ name: "typerace", category: "games", description: "Race to type the phrase first.", usage: "typerace", permission: "everyone",
  run: async ({ message }) => {
    const phrase = pick(RACE_PHRASES);
    await message.reply({ embeds: [embed({ title: "⌨️ Type Race", description: `First to type this exactly wins:\n\`\`\`${phrase}\`\`\``, color: COLORS.brand })] });
    const start = Date.now();
    const collected = await message.channel.awaitMessages({ filter: (m) => m.content.trim().toLowerCase() === phrase, max: 1, time: 30_000, errors: [] }).catch(() => null);
    if (!collected || !collected.size) return message.channel.send({ embeds: [infoEmbed("No winner", "Nobody typed it in time.")] });
    const winner = collected.first().author;
    bump(winner.id, "wins");
    await message.channel.send({ embeds: [embed({ title: "🏁 We have a winner!", description: `${winner.username} typed it in ${((Date.now() - start) / 1000).toFixed(2)}s!`, color: COLORS.ok })] });
  } });

// ---------- math quiz ----------
add({ name: "mathquiz", category: "games", description: "Solve a quick math problem for speed points.", usage: "mathquiz", permission: "everyone",
  run: async ({ message }) => {
    const a = 1 + RNG(50), b = 1 + RNG(50), op = pick(["+", "-", "*"]);
    const answer = op === "+" ? a + b : op === "-" ? a - b : a * b;
    await message.reply({ embeds: [embed({ title: "🧮 Math Quiz", description: `Solve: **${a} ${op} ${b}**\nYou have 15 seconds.`, color: COLORS.info })] });
    const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id && !Number.isNaN(Number(m.content.trim())), max: 1, time: 15_000, errors: [] }).catch(() => null);
    const guess = Number(collected?.first()?.content?.trim());
    const correct = guess === answer;
    bump(message.author.id, correct ? "wins" : "losses");
    await message.channel.send({ embeds: [embed({ title: correct ? "✅ Correct!" : "❌ Wrong", description: `The answer was **${answer}**.`, color: correct ? COLORS.ok : COLORS.danger })] });
  } });

// ---------- reaction speed ----------
add({ name: "reactionspeed", category: "games", description: "Test your reflexes — click the button when it turns green.", usage: "reactionspeed", permission: "everyone",
  run: async ({ message }) => {
    const sent = await message.reply({ embeds: [embed({ title: "⏱️ Get Ready…", description: "Wait for green, then click!", color: COLORS.warn })], components: [row(button({ id: "rxn:wait", label: "Wait…", style: "danger" }))] });
    const delay = 1500 + RNG(3000);
    let ready = false, start;
    setTimeout(async () => {
      ready = true; start = Date.now();
      await sent.edit({ embeds: [embed({ title: "🟢 CLICK NOW!", description: "Go!", color: COLORS.ok })], components: [row(button({ id: "rxn:go", label: "CLICK!", style: "success" }))] }).catch(() => {});
    }, delay);
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: delay + 5000, max: 1 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your test.", ephemeral: true }).catch(() => {});
      if (!ready) {
        await int.update({ embeds: [embed({ title: "😅 Too early!", description: "You clicked before green.", color: COLORS.danger })], components: [] }).catch(() => {});
        return;
      }
      const ms = Date.now() - start;
      await int.update({ embeds: [embed({ title: "⏱️ Reaction Time", description: `**${ms}ms**`, color: COLORS.ok })], components: [] }).catch(() => {});
    });
  } });

// ---------- russian roulette (fun) ----------
add({ name: "russianroulette", category: "games", description: "Purely fictional Russian roulette for laughs.", usage: "russianroulette", permission: "everyone",
  run: async ({ message }) => {
    const chamber = RNG(6);
    const sent = await message.reply({ embeds: [embed({ title: "🔫 Russian Roulette (fake)", description: "Spinning the chamber…", color: COLORS.warn })] });
    await new Promise((r) => setTimeout(r, 1200));
    const bang = chamber === 0;
    bump(message.author.id, bang ? "losses" : "wins");
    await sent.edit({ embeds: [embed({ title: bang ? "💥 BANG! (not really)" : "😅 Click. Safe!", description: bang ? "You'd be out — good thing this is fake!" : "Lucky, you survive this round.", color: bang ? COLORS.danger : COLORS.ok })] }).catch(() => {});
  } });

// ---------- guess the number ----------
add({ name: "guessnumber", category: "games", description: "Guess the secret number between 1-100.", usage: "guessnumber", permission: "everyone",
  run: async ({ message }) => {
    const secret = 1 + RNG(100);
    await message.reply({ embeds: [embed({ title: "🎯 Guess the Number", description: "I'm thinking of a number between 1-100. You have 7 tries.", color: COLORS.brand })] });
    for (let tries = 1; tries <= 7; tries++) {
      const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id && !Number.isNaN(Number(m.content.trim())), max: 1, time: 20_000, errors: [] }).catch(() => null);
      if (!collected || !collected.size) return message.channel.send({ embeds: [infoEmbed("Timed out", `The number was **${secret}**.`)] });
      const guess = Number(collected.first().content.trim());
      if (guess === secret) {
        bump(message.author.id, "wins");
        return message.channel.send({ embeds: [okEmbed("Correct!", `You got it in ${tries} tries! The number was **${secret}**.`)] });
      }
      await message.channel.send({ embeds: [infoEmbed(guess < secret ? "Higher!" : "Lower!", `Try ${tries}/7.`)] });
    }
    bump(message.author.id, "losses");
    await message.channel.send({ embeds: [errEmbed("Out of tries", `The number was **${secret}**.`)] });
  } });

// ---------- akinator-style 20 questions ----------
add({ name: "akinator", category: "games", description: "Think of something, YORU's AI will try to guess it in 20 questions.", usage: "akinator", permission: "everyone",
  run: async ({ message }) => {
    await message.reply({ embeds: [embed({ title: "🧞 YORU Akinator", description: "Think of a person, place, or thing. I'll ask yes/no questions to guess it! Reply to each question. Say `stop` to end.", color: COLORS.brand })] });
    let history = "";
    for (let i = 1; i <= 8; i++) {
      let question;
      try {
        const res = await chat({ scope: `akinator:${message.author.id}`, userText: `You are playing 20 questions. Ask ONE short yes/no question to narrow down what the user is thinking of. Prior Q&A: ${history || "none yet"}. Just output the question, nothing else.`, mode: "general", isOwner: false });
        question = res.reply.trim().split("\n")[0];
      } catch { question = "Is it something you can hold in your hand?"; }
      await message.channel.send({ embeds: [embed({ title: `❓ Question ${i}/8`, description: question, color: COLORS.info })] });
      const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 30_000, errors: [] }).catch(() => null);
      const answer = collected?.first()?.content?.trim();
      if (!answer || answer.toLowerCase() === "stop") return message.channel.send({ embeds: [infoEmbed("Game ended", "Maybe next time!")] });
      history += `Q: ${question} A: ${answer}\n`;
    }
    let guess;
    try {
      const res = await chat({ scope: `akinator:${message.author.id}`, userText: `Based on this Q&A, give your single best guess of what the user is thinking of, in a short sentence: ${history}`, mode: "general", isOwner: false });
      guess = res.reply.trim();
    } catch { guess = "I'm stumped — you win this time!"; }
    await message.channel.send({ embeds: [embed({ title: "🔮 My Guess", description: guess, color: COLORS.brand })] });
  } });

// ---------- riddle quiz ----------
const RIDDLE_QUIZ = [
  { q: "I speak without a mouth and hear without ears. What am I?", a: "echo" },
  { q: "What has a neck but no head?", a: "bottle" },
  { q: "What gets wetter as it dries?", a: "towel" },
];
add({ name: "riddlequiz", category: "games", description: "Answer riddles for points.", usage: "riddlequiz", permission: "everyone",
  run: async ({ message }) => {
    const r = pick(RIDDLE_QUIZ);
    await message.reply({ embeds: [embed({ title: "🧩 Riddle Quiz", description: r.q, color: COLORS.info })] });
    const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 25_000, errors: [] }).catch(() => null);
    const guess = collected?.first()?.content?.trim()?.toLowerCase();
    const correct = guess?.includes(r.a);
    bump(message.author.id, correct ? "wins" : "losses");
    await message.channel.send({ embeds: [embed({ title: correct ? "✅ Correct!" : "❌ Nope", description: `Answer: **${r.a}**`, color: correct ? COLORS.ok : COLORS.danger })] });
  } });

// ---------- emoji quiz ----------
const EMOJI_QUIZ = [
  { emojis: "🦁👑", a: "lion king" },
  { emojis: "🕷️👨", a: "spiderman" },
  { emojis: "🧊❄️👸", a: "frozen" },
  { emojis: "🏠🎈", a: "up" },
];
add({ name: "emojiquiz", category: "games", description: "Guess the movie/phrase from emojis.", usage: "emojiquiz", permission: "everyone",
  run: async ({ message }) => {
    const q = pick(EMOJI_QUIZ);
    await message.reply({ embeds: [embed({ title: "🎬 Emoji Quiz", description: `What is this?\n\n# ${q.emojis}`, color: COLORS.brand })] });
    const collected = await message.channel.awaitMessages({ filter: (m) => m.author.id === message.author.id, max: 1, time: 25_000, errors: [] }).catch(() => null);
    const guess = collected?.first()?.content?.trim()?.toLowerCase();
    const correct = guess === q.a;
    bump(message.author.id, correct ? "wins" : "losses");
    await message.channel.send({ embeds: [embed({ title: correct ? "✅ Correct!" : "❌ Nope", description: `Answer: **${q.a}**`, color: correct ? COLORS.ok : COLORS.danger })] });
  } });

// ---------- checkers-lite ----------
add({ name: "checkerslite", category: "games", description: "Simple 1-row capture game vs the bot.", usage: "checkerslite", permission: "everyone",
  run: async ({ message }) => {
    let pieces = Array(5).fill(true);
    const render = () => embed({ title: "⚫ Checkers Lite", description: `Capture pieces by clicking them!\n${pieces.map((p) => (p ? "⚫" : "⬜")).join(" ")}`, color: COLORS.brand });
    const buttons = (disabled = false) => row(...pieces.map((p, i) => button({ id: `chk:${i}`, label: `${i + 1}`, style: p ? "dark" in COLORS ? "secondary" : "secondary" : "secondary", disabled: disabled || !p })));
    const sent = await message.reply({ embeds: [render()], components: [buttons()] });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 45_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your game.", ephemeral: true }).catch(() => {});
      const idx = Number(int.customId.split(":")[1]);
      pieces[idx] = false;
      if (pieces.every((p) => !p)) {
        collector.stop();
        bump(int.user.id, "wins");
        await int.update({ embeds: [embed({ title: "🏆 You cleared the board!", color: COLORS.ok })], components: [] }).catch(() => {});
        return;
      }
      await int.update({ embeds: [render()], components: [buttons()] }).catch(() => {});
    });
    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));
  } });

// ---------- dice duel ----------
add({ name: "diceduel", category: "games", description: "Roll dice against another user, highest wins.", usage: "diceduel <@user>", permission: "everyone",
  run: async ({ message }) => {
    const opponent = message.mentions.users.first() || message.client.user;
    const a = 1 + RNG(6), b = 1 + RNG(6);
    const winner = a === b ? null : a > b ? message.author : opponent;
    if (winner) bump(winner.id, "wins");
    await message.reply({ embeds: [embed({ title: "🎲 Dice Duel", description: `${message.author.username} rolled **${a}**\n${opponent.username} rolled **${b}**\n\n${winner ? `🏆 ${winner.username} wins!` : "It's a tie!"}`, color: COLORS.brand })] });
  } });

// ---------- coin tower ----------
add({ name: "cointower", category: "games", description: "Keep flipping heads to build your tower — cash out before you bust!", usage: "cointower <bet>", permission: "everyone",
  run: async ({ message, args }) => {
    const bet = num(args[0], NaN);
    const guildId = message.guild?.id || "dm";
    const check = canBet(guildId, message.author.id, bet);
    if (!check.ok) return message.reply({ embeds: [warnEmbed("Can't play", check.reason)] });
    let height = 0, mult = 1;
    const render = () => embed({ title: "🪙 Coin Tower", description: `Height: ${height} 🪙\nMultiplier: x${mult.toFixed(2)}\nPotential payout: ${fmt(Math.round(bet * mult))}`, color: COLORS.brand });
    const controls = (disabled = false) => row(button({ id: "ct:flip", label: "Flip Again", style: "primary", disabled }), button({ id: "ct:cash", label: "Cash Out", style: "success", disabled }));
    const sent = await message.reply({ embeds: [render()], components: [controls()] });
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time: 45_000 });
    collector.on("collect", async (int) => {
      if (int.user.id !== message.author.id) return int.reply({ content: "Not your tower.", ephemeral: true }).catch(() => {});
      if (int.customId === "ct:cash") {
        collector.stop();
        const payout = Math.round(bet * mult) - bet;
        const cur = getBalance(guildId, message.author.id);
        setBalance(guildId, message.author.id, cur.balance + payout);
        bump(message.author.id, "wins");
        await int.update({ embeds: [embed({ title: "💰 Cashed Out!", description: `Final height ${height}. You gained **${fmt(payout)}** coins.`, color: COLORS.ok })], components: [] }).catch(() => {});
        return;
      }
      const heads = Math.random() < 0.5;
      if (!heads) {
        collector.stop();
        const cur = getBalance(guildId, message.author.id);
        setBalance(guildId, message.author.id, cur.balance - bet);
        bump(message.author.id, "losses");
        await int.update({ embeds: [embed({ title: "💥 Tower collapsed!", description: `You lost your bet of **${fmt(bet)}**.`, color: COLORS.danger })], components: [] }).catch(() => {});
        return;
      }
      height++; mult += 0.5;
      await int.update({ embeds: [render()], components: [controls()] }).catch(() => {});
    });
    collector.on("end", (c) => { if (!c.size) sent.edit({ components: [controls(true)] }).catch(() => {}); });
  } });

// ---------- gamestats ----------
add({ name: "gamestats", category: "games", description: "View your (or the server's) win/loss stats across games.", usage: "gamestats [@user]", permission: "everyone",
  run: async ({ message }) => {
    const target = mention(message);
    const s = stats.get(target.id) || { wins: 0, losses: 0, draws: 0 };
    if (!message.mentions.users.size) {
      const top = [...stats.entries()].sort((a, b) => b[1].wins - a[1].wins).slice(0, 10);
      const lines = top.length ? top.map(([id, v], i) => `**${i + 1}.** <@${id}> — ${v.wins}W / ${v.losses || 0}L`) : ["No games played yet."];
      return message.reply({ embeds: [embed({ title: "🏆 Game Leaderboard", description: lines.join("\n"), color: COLORS.brand,
        fields: [{ name: `Your Stats (${message.author.username})`, value: `Wins: ${s.wins} • Losses: ${s.losses || 0} • Draws: ${s.draws || 0}` }] })] });
    }
    await message.reply({ embeds: [embed({ title: `🏆 Stats for ${target.username}`, description: `Wins: **${s.wins}**\nLosses: **${s.losses || 0}**\nDraws: **${s.draws || 0}**`, color: COLORS.brand })] });
  } });
