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

await bootUI();

if (!config.ownerId) log.warn("owner", "OWNER_DISCORD_ID not set — the owner panel will refuse to unlock.");

startServer();
log.ok("api", `listening on :${config.port}`);

startPanels();
if (config.panels.enabled) {
  log.ok("panel", `chat  → http://localhost:${config.panels.chatPort}`);
  log.ok("panel", `owner → http://localhost:${config.panels.ownerPort}`);
}

refreshModels(true)
  .then((n) => log.ok("ai", `${n ?? 0} free OpenRouter models cached`))
  .catch((e) => log.warn("ai", `model scan failed: ${e.message}`));

autotuneOpenClaw()
  .catch((e) => log.warn("openclaw", `autotune failed: ${e.message}`))
  .finally(() => startOpenClaw().catch((e) => log.warn("openclaw", e.message)));
startOllama().catch((e) => log.warn("ollama", e.message));

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
