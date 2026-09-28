// Notify configured owners privately, preferring the bot and falling back to the alt.
import { config } from "./config.js";
import { getBotClient } from "./bot.js";
import { getSelfbotClient } from "./selfbot.js";
import { log } from "./boot-ui.js";

export async function sendUpdateNotice(text) {
  if (!config.ownerIds.length) return;
  const clients = [getBotClient(), getSelfbotClient()].filter((client) => client?.isReady?.() || client?.user);
  for (const id of new Set(config.ownerIds)) {
    let sent = false;
    for (const client of clients) {
      try {
        const user = await client.users.fetch(id);
        await user.send({ content: text, allowedMentions: { parse: [] } });
        sent = true;
        break;
      } catch {
        // The bot may not share a server or allow DMs; try the alt instead.
      }
    }
    if (!sent) log.warn("auto-update", "could not deliver update notice to an owner on Discord");
  }
}