import { config } from "./config.js";
import { startServer } from "./server.js";
import { startPanels } from "./panels.js";
import { startShareServer } from "./share-server.js";
import { startBot } from "./bot.js";
import { startSelfbot } from "./selfbot.js";
import { refreshModels, refreshUnoRouterModels } from "./ai.js";
import { startOllama } from "./ollama-runner.js";
import { preloadLocalModel } from "./localmodel-runner.js";
import { refreshLocalModel } from "./ai.js";
import { bootUI, log } from "./boot-ui.js";
import { startTerminalRepl } from "./terminal-repl.js";
import { startAutoUpdate } from "./auto-update.js";

await bootUI();

// A slow starter should never stall the terminal or scare the user. If a
// service takes past its cap, we stop waiting and keep it going in the
// background. Once the terminal is up, late starters stay completely silent
// so nothing clobbers the chat prompt.
let terminalUp = false;
const waitWithCap = (promise, ms, tag) =>
  Promise.race([
    promise,
    new Promise((r) => setTimeout(() => {
      if (!terminalUp) {
        log.dim?.(tag, "still waking up in the background…");
        promise.then(() => { if (!terminalUp) log.dim?.(tag, "ready"); }).catch(() => {});
      }
      r(null);
    }, ms)),
  ]);

// Everything that prints startup lines collects into `boot`, so the terminal
// REPL only loads in after the whole stack has finished waking up.
const boot = [];

if (!config.ownerId) log.warn("owner", "OWNER_DISCORD_ID not set — the owner panel will refuse to unlock.");

startServer();
log.ok("api", `listening on :${config.port}`);

boot.push(waitWithCap(Promise.allSettled(startPanels()), 10000, "panel"));

boot.push(waitWithCap(startShareServer().catch((e) => log.warn("share", e.message)), 10000, "share"));

boot.push(waitWithCap(
  refreshModels(true).then((models) => log.ok("ai", `${models?.free?.length ?? 0} free OpenRouter models cached`)),
  20000, "ai"
));

// UnoRouter: prime the free-model pool at boot, then a background timer
// rescans every UNOROUTER_REFRESH_SEC seconds (default 30) so unavailable
// models drop out and new free ones join automatically.
if (config.providers.unorouter.enabled) {
  boot.push(waitWithCap(
    refreshUnoRouterModels(true).then((m) => log.ok("unorouter", `${m?.free?.length ?? 0} free UnoRouter models cached`)),
    20000, "unorouter"
  ));
}

boot.push(waitWithCap(
  startOllama().catch((e) => log.warn("ollama", e.message)),
  20000, "ollama"
));

// Custom-built local model: refresh the active reference and pre-warm it so
// the first reply after boot is fast. Non-fatal if it can't preload.
boot.push(waitWithCap(
  refreshLocalModel().then(() => preloadLocalModel()).catch((e) => log.warn("localmodel", e.message)),
  20000, "localmodel"
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
// From here on, late-starting services stay silent so the prompt stays clean.
terminalUp = true;
startAutoUpdate();
startTerminalRepl();
