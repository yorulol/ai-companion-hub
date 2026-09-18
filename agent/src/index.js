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

if (!config.ownerId) log.warn("owner", "OWNER_DISCORD_ID not set — the owner panel will refuse to unlock.");

startServer();
log.ok("api", `listening on :${config.port}`);

startPanels();

refreshModels(true)
  .then((models) => log.ok("ai", `${models?.free?.length ?? 0} free OpenRouter models cached`))
  .catch((e) => log.warn("ai", `model scan failed: ${e.message}`));

// OpenClaw's configured backend is Ollama. Provision the exact model first so
// the gateway cannot report healthy and then fail its first chat with a 500.
startOllama()
  .catch((e) => log.warn("ollama", e.message))
  .then(() => autotuneOpenClaw())
  .catch((e) => log.warn("openclaw", `autotune failed: ${e.message}`))
  .then(() => startOpenClaw({ autoInstall: true }).catch((e) => log.warn("openclaw", e.message)));

const { isDead } = await import("./killswitch.js");
if (isDead()) {
  log.warn("killswitch", "engaged — YORU stays silent, but the bot/alt stay connected so the owner can tell it to disable the killswitch");
}

// The bot and selfbot always connect. The killswitch gate lives in chat-loop,
// so a dead agent can still hear "disable your killswitch" from Discord.
if (config.discord.botAutostart && config.discord.botToken) {
  startBot()
    .then(() => log.ok("bot", "discord bot online"))
    .catch((err) => log.err("bot", `failed to start: ${err.message}`));
} else {
  log.info("bot", "autostart off or no token — skipping");
}

if (config.discord.selfbotAutostart && config.discord.userToken) {
  startSelfbot()
    .then(() => log.ok("selfbot", "alt account responder online"))
    .catch((err) => log.err("selfbot", `failed to start: ${err.message}`));
}

process.on("SIGINT", () => {
  console.log("\n\x1b[38;5;141m◆\x1b[0m \x1b[38;5;219mYORU shutting down. Bye.\x1b[0m\n");
  process.exit(0);
});

// Terminal REPL — talk to YORU directly in the same terminal after `npm start`.
// Only activates when stdin is a TTY, so background services aren't affected.
startTerminalRepl();
