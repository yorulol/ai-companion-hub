/**
 * Aesthetic boot UI for `npm start`.
 * Gradient banner, glossy boxes, animated robot, colored status log.
 * No dependencies.
 */
import { config } from "./config.js";

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m", italic: "\x1b[3m",
  // purple/pink/cyan spectrum for gradients
  g1: "\x1b[38;5;54m", g2: "\x1b[38;5;91m", g3: "\x1b[38;5;98m",
  g4: "\x1b[38;5;141m", g5: "\x1b[38;5;177m", g6: "\x1b[38;5;213m",
  g7: "\x1b[38;5;219m", g8: "\x1b[38;5;225m",
  purple: "\x1b[38;5;141m", purpleBright: "\x1b[38;5;177m",
  magenta: "\x1b[38;5;207m", pink: "\x1b[38;5;219m", pinkSoft: "\x1b[38;5;225m",
  cyan: "\x1b[38;5;123m", cyanDim: "\x1b[38;5;74m",
  green: "\x1b[38;5;120m", greenSoft: "\x1b[38;5;157m",
  yellow: "\x1b[38;5;222m", red: "\x1b[38;5;204m",
  grey: "\x1b[38;5;244m", greyDim: "\x1b[38;5;238m",
  white: "\x1b[38;5;255m",
};
const GRAD = [C.g1, C.g2, C.g3, C.g4, C.g5, C.g6, C.g7, C.g8];

const paint = (color, s) => `${color}${s}${C.reset}`;
const pad = (s, n) => (s + " ".repeat(n)).slice(0, n);
const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const rawLen = (s) => stripAnsi(s).length;

function gradient(text, colors = GRAD) {
  const chars = [...text];
  const step = chars.length / colors.length;
  return chars.map((ch, i) => paint(colors[Math.min(colors.length - 1, Math.floor(i / step))], ch)).join("");
}


const LOGO = [
  "  ▓██   ██▓ ▒█████   ██▀███   █    ██  ",
  "   ▒██  ██▒▒██▒  ██▒▓██ ▒ ██▒ ██  ▓██▒ ",
  "    ▒██ ██░▒██░  ██▒▓██ ░▄█ ▒▓██  ▒██░ ",
  "    ░ ▐██▓░▒██   ██░▒██▀▀█▄  ▓▓█  ░██░ ",
  "    ░ ██▒▓░░ ████▓▒░░██▓ ▒██▒▒▒█████▓  ",
  "     ██▒▒▒ ░ ▒░▒░▒░ ░ ▒▓ ░▒▓░░▒▓▒ ▒ ▒  ",
];

const W = 64;

function hr(ch = "═", color = C.g4) { return paint(color, ch.repeat(W + 2)); }

function centered(text) {
  const len = rawLen(text);
  const left = Math.max(0, Math.floor((W - len) / 2));
  const right = Math.max(0, W - len - left);
  return " ".repeat(left) + text + " ".repeat(right);
}


function banner() {
  console.log();
  console.log(paint(C.g3, "╭" + "─".repeat(W) + "╮"));
  for (let i = 0; i < LOGO.length; i++) {
    const row = pad(LOGO[i], W);
    const g = GRAD[Math.min(GRAD.length - 1, Math.floor((i / LOGO.length) * GRAD.length))];
    console.log(paint(C.g3, "│") + paint(g + C.bold, row) + paint(C.g3, "│"));
  }
  const tag = gradient("· self-hosted intelligent agent · v1.0 ·");
  console.log(paint(C.g3, "│") + centered(tag) + paint(C.g3, "│"));
  console.log(paint(C.g3, "╰" + "─".repeat(W) + "╯"));
}

function box(title, rows, accent = C.g5) {
  const t = ` ${title} `;
  const top = paint(accent, "╭─") + paint(C.bold + C.pink, t) + paint(accent, "─".repeat(Math.max(0, W - 2 - t.length)) + "╮");
  const bot = paint(accent, "╰" + "─".repeat(W) + "╯");
  console.log(top);
  for (const [k, v, color = C.cyan] of rows) {
    const key = paint(C.grey, pad(k, 22));
    const val = paint(color, v);
    const raw = ` ${stripAnsi(key)} ${stripAnsi(val)}`;
    const filler = " ".repeat(Math.max(1, W - raw.length));
    console.log(paint(accent, "│") + ` ${key} ${val}${filler}` + paint(accent, "│"));
  }
  console.log(bot);
}

function providerRows() {
  const p = config.providers;
  const on = (b) => (b ? paint(C.green, "● online") : paint(C.grey, "○ off"));
  const key = (b) => (b ? paint(C.greenSoft, "· key set") : paint(C.yellow, "· no key"));
  return [
    ["preferred", p.preferred, C.pink],
    ["openrouter", `${stripAnsi(on(p.openrouter.enabled))}  ${stripAnsi(key(!!p.openrouter.key))}`],
    ["ollama", `${stripAnsi(on(p.ollama.enabled))}  ${p.ollama.url}`],
    ["openai", `${stripAnsi(on(p.openai.enabled))}  ${stripAnsi(key(!!p.openai.key))}`],
    ["anthropic", `${stripAnsi(on(p.anthropic.enabled))}  ${stripAnsi(key(!!p.anthropic.key))}`],
    ["groq", `${stripAnsi(on(p.groq.enabled))}  ${stripAnsi(key(!!p.groq.key))}`],
    ["openclaw", `${stripAnsi(on(p.openclaw.enabled))}  ${p.openclaw.base}`],
  ];
}

function surfaceRows() {
  const p = config.panels;
  return [
    ["agent api", `http://localhost:${config.port}`, C.cyan],
    ["YORU panel", p.enabled ? `http://localhost:${p.chatPort}` : "disabled", p.enabled ? C.green : C.grey],
    ["YORU WorkSpace", p.enabled ? `http://localhost:${p.workspacePort}` : "disabled", p.enabled ? C.green : C.grey],
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
    ["email forward", config.emailForward.enabled ? (config.emailForward.key ? paint(C.green, "enabled · key set") : paint(C.yellow, "enabled · no key")) : paint(C.grey, "off"), C.reset],
  ];
}

export async function bootUI() {
  console.clear?.();
  banner();
  await animateRobot(2, 190);
  console.log(hr("─", C.g3));
  console.log(centered(paint(C.bold + C.pink, "▸ YORU is waking up ▸")));
  console.log(hr("─", C.g3));
  box("AI providers", providerRows(), C.g4);
  box("Surfaces", surfaceRows(), C.g5);
  box("System", systemRows(), C.g6);
  console.log(paint(C.grey + C.italic, "  tip: Ctrl+C to stop · type /help in the terminal for commands"));
  console.log();
}

const TAG_W = 12;
function tag(text, color) {
  const padded = pad(`[${text}]`, TAG_W);
  return paint(color, padded);
}

export const log = {
  info: (t, msg) => console.log(`${paint(C.g4, "◆")} ${tag(t, C.pink)} ${paint(C.white, msg)}`),
  ok:   (t, msg) => console.log(`${paint(C.green, "✓")} ${tag(t, C.greenSoft)} ${paint(C.white, msg)}`),
  warn: (t, msg) => console.log(`${paint(C.yellow, "▲")} ${tag(t, C.yellow)} ${paint(C.white, msg)}`),
  err:  (t, msg) => console.log(`${paint(C.red, "✗")} ${tag(t, C.red)} ${paint(C.white, msg)}`),
  dim:  (t, msg) => console.log(`${paint(C.g5, "·")} ${tag(t, C.g5)} ${paint(C.g4, msg)}`),
  step: (t, msg) => console.log(`${paint(C.cyanDim, "›")} ${tag(t, C.cyan)} ${paint(C.grey, msg)}`),
};

/* ---------- reusable spinner for long-running work ---------- */
const SPINNER = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"];
export function spinner(label, color = C.purpleBright) {
  if (!process.stdout.isTTY) {
    return { update: () => {}, stop: () => {} };
  }
  let i = 0, current = label, running = true;
  const render = () => {
    process.stdout.write(`\r${paint(color, SPINNER[i = (i + 1) % SPINNER.length])} ${paint(C.pink, current)}${" ".repeat(20)}\r`);
  };
  const t = setInterval(render, 90);
  return {
    update: (text) => { current = text; },
    stop: (final) => {
      running = false; clearInterval(t);
      process.stdout.write("\r" + " ".repeat(process.stdout.columns || 80) + "\r");
      if (final) console.log(final);
    },
  };
}

export const palette = C;
