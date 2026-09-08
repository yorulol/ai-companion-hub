/**
 * Fancy terminal UI for `npm run yoru` / `yoru`.
 * Animated ASCII robot + colored status dashboard. No dependencies.
 */
import { config } from "./config.js";

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  italic: "\x1b[3m",
  purple: "\x1b[38;5;141m",
  purpleBright: "\x1b[38;5;177m",
  magenta: "\x1b[38;5;207m",
  pink: "\x1b[38;5;219m",
  cyan: "\x1b[38;5;123m",
  green: "\x1b[38;5;120m",
  yellow: "\x1b[38;5;222m",
  red: "\x1b[38;5;204m",
  grey: "\x1b[38;5;244m",
  bg: "\x1b[48;5;53m",
};

const paint = (color, s) => `${color}${s}${C.reset}`;
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");

/* ---------- animated robot frames ---------- */
const ROBOT_FRAMES = [
  [
    "         .-\"\"\"\"\"-.         ",
    "        /  ^   ^  \\        ",
    "       |   o   o   |       ",
    "       |     >     |       ",
    "        \\  \\_-_/  /        ",
    "         '-.___.-'         ",
    "        __|___|__          ",
    "       [==|===|==]         ",
    "        '-.....-'          ",
  ],
  [
    "         .-\"\"\"\"\"-.         ",
    "        /  -   -  \\        ",
    "       |   O   O   |       ",
    "       |     >     |       ",
    "        \\  \\___/  /        ",
    "         '-.___.-'         ",
    "        __|___|__          ",
    "       [==|===|==]         ",
    "        '-.....-'          ",
  ],
  [
    "         .-\"\"\"\"\"-.         ",
    "        /  ^   ^  \\        ",
    "       |   o   o   |       ",
    "       |     ~     |       ",
    "        \\  \\_-_/  /        ",
    "         '-.___.-'         ",
    "         __|___|__         ",
    "        [==|===|==]        ",
    "         '-.....-'         ",
  ],
];

const LOGO = [
  "  ▓██   ██▓ ▒█████   ██▀███   █    ██  ",
  "   ▒██  ██▒▒██▒  ██▒▓██ ▒ ██▒ ██  ▓██▒ ",
  "    ▒██ ██░▒██░  ██▒▓██ ░▄█ ▒▓██  ▒██░ ",
  "    ░ ▐██▓░▒██   ██░▒██▀▀█▄  ▓▓█  ░██░ ",
  "    ░ ██▒▓░░ ████▓▒░░██▓ ▒██▒▒▒█████▓  ",
  "     ██▒▒▒ ░ ▒░▒░▒░ ░ ▒▓ ░▒▓░░▒▓▒ ▒ ▒  ",
];

function line(width, char = "─", color = C.purple) {
  return paint(color, char.repeat(width));
}

async function animateRobot(cycles = 3, delay = 220) {
  const width = ROBOT_FRAMES[0][0].length;
  process.stdout.write("\n");
  for (let i = 0; i < cycles * ROBOT_FRAMES.length; i++) {
    const frame = ROBOT_FRAMES[i % ROBOT_FRAMES.length];
    if (i > 0) process.stdout.write(`\x1b[${frame.length}A`); // move cursor up
    for (const row of frame) {
      process.stdout.write(paint(C.purpleBright, pad(row, width)) + "\n");
    }
    await new Promise((r) => setTimeout(r, delay));
  }
}

function banner() {
  const W = 60;
  console.log();
  console.log(paint(C.purple, "╔" + "═".repeat(W) + "╗"));
  for (const row of LOGO) {
    const s = pad(row, W);
    console.log(paint(C.purple, "║") + paint(C.magenta, s) + paint(C.purple, "║"));
  }
  const tag = pad("  self-hosted AI agent · v1.0", W);
  console.log(paint(C.purple, "║") + paint(C.pink + C.italic, tag) + paint(C.purple, "║"));
  console.log(paint(C.purple, "╚" + "═".repeat(W) + "╝"));
}

function box(title, rows) {
  const W = 60;
  const t = ` ${title} `;
  const left = 2;
  const top =
    paint(C.purple, "╭─") +
    paint(C.bold + C.pink, t) +
    paint(C.purple, "─".repeat(Math.max(0, W - left - t.length)) + "╮");
  const bot = paint(C.purple, "╰" + "─".repeat(W) + "╯");
  console.log(top);
  for (const [k, v, color = C.cyan] of rows) {
    const key = paint(C.grey, pad(k, 22));
    const val = paint(color, v);
    const raw = ` ${stripAnsi(key)} ${stripAnsi(val)}`;
    const filler = " ".repeat(Math.max(1, W - raw.length));
    console.log(paint(C.purple, "│") + ` ${key} ${val}${filler}` + paint(C.purple, "│"));
  }
  console.log(bot);
}

function providerRows() {
  const p = config.providers;
  const on = (b) => (b ? paint(C.green, "● enabled") : paint(C.grey, "○ off"));
  const key = (b) => (b ? paint(C.green, "key set") : paint(C.yellow, "no key"));
  return [
    ["preferred", p.preferred, C.pink],
    ["openrouter", `${stripAnsi(on(p.openrouter.enabled))}  ${stripAnsi(key(!!p.openrouter.key))}`],
    ["ollama", `${stripAnsi(on(p.ollama.enabled))}  ${p.ollama.url}`],
    ["openai", `${stripAnsi(on(p.openai.enabled))}  ${stripAnsi(key(!!p.openai.key))}`],
    ["anthropic", `${stripAnsi(on(p.anthropic.enabled))}  ${stripAnsi(key(!!p.anthropic.key))}`],
    ["groq", `${stripAnsi(on(p.groq.enabled))}  ${stripAnsi(key(!!p.groq.key))}`],
  ];
}

function surfaceRows() {
  const p = config.panels;
  return [
    ["agent api", `http://localhost:${config.port}`, C.cyan],
    ["chat panel", p.enabled ? `http://localhost:${p.chatPort}` : "disabled", p.enabled ? C.green : C.grey],
    ["owner panel", p.enabled ? `http://localhost:${p.ownerPort}` : "disabled", p.enabled ? C.green : C.grey],
    ["discord bot", config.discord.botToken ? paint(C.green, "token detected") : paint(C.yellow, "no token"), C.reset],
    ["selfbot alt", config.discord.userToken ? paint(C.green, "token detected") : paint(C.grey, "not configured"), C.reset],
    ["owner id", config.ownerId || paint(C.red, "NOT SET — owner panel locked"), config.ownerId ? C.cyan : C.reset],
  ];
}

function systemRows() {
  const o = config.os;
  return [
    ["platform", `${o.platform} ${o.release}`, C.cyan],
    ["hostname", o.hostname, C.cyan],
    ["computer control", config.computer.enabled ? paint(C.green, "enabled") : paint(C.grey, "off"), C.reset],
    ["sandbox root", config.computer.unrestricted ? paint(C.yellow, "UNRESTRICTED (whole disk)") : config.computer.root, C.reset],
  ];
}

/** Prints the full boot UI. Call once at process start. */
export async function bootUI() {
  console.clear?.();
  banner();
  await animateRobot(2, 200);
  console.log(line(60, "─", C.purple));
  console.log(paint(C.pink + C.bold, "  YORU is waking up…"));
  console.log(line(60, "─", C.purple));
  box("AI providers", providerRows());
  box("Surfaces", surfaceRows());
  box("System", systemRows());
  console.log(paint(C.grey + C.italic, "  tip: press Ctrl+C to stop. Run `yoru` again to restart."));
  console.log();
}

/** Simple colored status log used elsewhere in the app. */
export const log = {
  info: (tag, msg) => console.log(`${paint(C.purple, "◆")} ${paint(C.pink, `[${tag}]`)} ${msg}`),
  ok: (tag, msg) => console.log(`${paint(C.green, "✓")} ${paint(C.pink, `[${tag}]`)} ${msg}`),
  warn: (tag, msg) => console.log(`${paint(C.yellow, "▲")} ${paint(C.pink, `[${tag}]`)} ${msg}`),
  err: (tag, msg) => console.log(`${paint(C.red, "✗")} ${paint(C.pink, `[${tag}]`)} ${msg}`),
};
