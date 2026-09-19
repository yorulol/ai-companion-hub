import { config } from "./config.js";
import { startServer } from "./server.js";
import { startPanels } from "./panels.js";
import { startBot } from "./bot.js";
import { startSelfbot } from "./selfbot.js";
import { refreshModels } from "./ai.js";
import { startOpenClaw } from "./openclaw-runner.js";
import { autotuneOpenClaw } from "./openclaw-autotune.js";
import { startOllama } from "./ollama-runner.js";
import { bootUI, log } from "./boot-ui.js";
import { startTerminalRepl } from "./terminal-repl.js";

await bootUI();

// A slow starter should never stall the terminal or scare the user. If a
// service takes past its cap, we stop waiting, keep it going in the
// background, and only print a dim note when it eventually finishes.
const waitWithCap = (promise, ms, tag) =>
  Promise.race([
    promise,
    new Promise((r) => setTimeout(() => {
      log.dim?.(tag, "still waking up in the background…");
      promise.then(() => log.dim?.(tag, "ready")).catch(() => {});
      r(null);
    }, ms)),
  ]);

// Everything that prints startup lines collects into `boot`, so the terminal
// REPL only loads in after the whole stack has finished waking up.
const boot = [];

if (!config.ownerId) log.warn("owner", "OWNER_DISCORD_ID not set — the owner panel will refuse to unlock.");

startServer();
log.ok("api", `listening on :${config.port}`);

boot.push(...startPanels());

boot.push(waitWithCap(
  refreshModels(true).then((models) => log.ok("ai", `${models?.free?.length ?? 0} free OpenRouter models cached`)),
  20000, "ai"
));

// OpenClaw's configured backend is Ollama. Provision the exact model first so
// the gateway cannot report healthy and then fail its first chat with a 500.
boot.push(waitWithCap(
  startOllama()
    .catch((e) => log.warn("ollama", e.message))
    .then(() => autotuneOpenClaw())
    .catch((e) => log.warn("openclaw", `autotune failed: ${e.message}`))
    .then(() => startOpenClaw({ autoInstall: true }).catch((e) => log.warn("openclaw", e.message))),
  60000, "openclaw"
));

const { isDead } = await import("./killswitch.js");
if (isDead()) {
  log.warn("killswitch", "engaged — YORU stays silent, but the bot/alt stay connected so the owner can tell it to disable the killswitch");
}

// The bot and selfbot always connect. The killswitch gate lives in chat-loop,
// so a dead agent can still hear "disable your killswitch" from Discord.
if (config.discord.botAutostart && config.discord.botToken) {
  boot.push(waitWithCap(
    startBot().then(() => log.ok("bot", "discord bot online")),
    25000, "bot"
  ));
} else {
  log.info("bot", "autostart off or no token — skipping");
}

if (config.discord.selfbotAutostart && config.discord.userToken) {
  boot.push(waitWithCap(
    startSelfbot().then(() => log.ok("selfbot", "alt account responder online")),
    25000, "selfbot"
  ));
}

// Let every startup line land first, then bring the terminal up last.
await Promise.allSettled(boot);
await new Promise((r) => setTimeout(r, 500));

process.on("SIGINT", () => {
  console.log("\n\x1b[38;5;141m◆\x1b[0m \x1b[38;5;219mYORU shutting down. Bye.\x1b[0m\n");
  process.exit(0);
});

// Terminal REPL — talk to YORU directly in the same terminal after `npm start`.
// Only activates when stdin is a TTY, so background services aren't affected.
startTerminalRepl();
