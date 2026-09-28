// Loaded only by the running agent, not during the supervisor's dependency pass.

export async function sendUpdateNotice(text) {
  const [{ config }, { getBotClient }, { getSelfbotClient }, { log }] = await Promise.all([
    import("./config.js"), import("./bot.js"), import("./selfbot.js"), import("./boot-ui.js"),
  ]);
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