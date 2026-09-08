import { config } from "./config.js";
import { startServer } from "./server.js";
import { startPanels } from "./panels.js";
import { startBot } from "./bot.js";
import { startSelfbot } from "./selfbot.js";
import { refreshModels } from "./ai.js";

console.log(`\n  ╔══════════════════════════════════════════╗`);
console.log(`  ║   YORU · self-hosted AI agent            ║`);
console.log(`  ║   OS: ${config.os.platform.padEnd(35)}║`);
console.log(`  ║   Owner: ${(config.ownerId || "NOT SET").padEnd(32)}║`);
console.log(`  ╚══════════════════════════════════════════╝\n`);

if (!config.ownerId) console.warn("⚠️  OWNER_DISCORD_ID not set — the owner panel will refuse to unlock.\n");

startServer();
startPanels();
refreshModels(true).catch(() => {});

if (config.discord.botAutostart && config.discord.botToken) {
  startBot().catch((err) => console.error("[bot] failed to start:", err.message));
}
if (config.discord.selfbotAutostart && config.discord.userToken) {
  startSelfbot().catch((err) => console.error("[selfbot] failed to start:", err.message));
}

process.on("SIGINT", () => { console.log("\nBye."); process.exit(0); });
