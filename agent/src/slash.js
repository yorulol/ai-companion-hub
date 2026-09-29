/**
 * Discord slash commands. /lookup is registered globally as both a guild- and
 * user-installed command, allowing the owner to use it wherever Discord permits
 * user apps even when the bot itself is not a member of that server.
 */
import { Events, ComponentType } from "discord.js";
import { isOwnerId } from "./config.js";
import { errEmbed, warnEmbed, infoEmbed, listPages, button, row } from "./ui.js";
import { logActivity } from "./activity.js";
import { lookup as searchLookups } from "./lookups.js";
import { chat } from "./chat-loop.js";

// Discord API values: GuildInstall (0), UserInstall (1); Guild (0), Bot DM (1), private DM (2).
const INSTALL = { integration_types: [0, 1], contexts: [0, 1, 2] };

const SLASH_COMMANDS = [
  {
    name: "lookup",
    description: "Search authorized lookup records.",
    options: [
      {
        name: "query",
        description: "Username, ID, or text to search for (min 3 characters).",
        type: 3, // ApplicationCommandOptionType.String
        required: true,
      },
    ],
    ...INSTALL,
  },
  {
    name: "ai",
    description: "Chat with YORU.",
    options: [
      {
        name: "message",
        description: "What you want to say to YORU.",
        type: 3,
        required: true,
      },
    ],
    ...INSTALL,
  },
];

async function registerCommands(client) {
  try {
    const existingGlobal = await client.application.commands.fetch();
    for (const def of SLASH_COMMANDS) {
      const current = existingGlobal.find((command) => command.name === def.name);
      if (current) await current.edit(def);
      else await client.application.commands.create(def);
    }
    console.log(`[slash] global commands registered for guild and user installs: ${SLASH_COMMANDS.map((c) => `/${c.name}`).join(", ")}`);

    // Remove the old guild-scoped copies so they cannot shadow the global commands.
    await Promise.allSettled(
      client.guilds.cache.map(async (guild) => {
        const commands = await guild.commands.fetch();
        for (const def of SLASH_COMMANDS) {
          const old = commands.find((command) => command.name === def.name);
          if (old) await old.delete();
        }
      }),
    );

    const installUrl = `https://discord.com/oauth2/authorize?client_id=${client.application.id}&integration_type=1&scope=applications.commands`;
    console.log(`[slash] install Yoru to your Discord account: ${installUrl}`);
  } catch (err) {
    console.error(`[slash] global registration failed: ${err.message}`);
  }
}

/** Hook slash registration + interaction handling onto a bot client. */
export function attachSlash(client) {
  client.on(Events.ClientReady, () => registerCommands(client));

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== "lookup") return;
      if (!isOwnerId(interaction.user.id)) {
        return void interaction.reply({
          embeds: [errEmbed("Owner only", "This command is locked to Yoru's configured owner.")],
          ephemeral: true,
        }).catch(() => {});
      }

      const q = (interaction.options.getString("query", true) || "").trim();
      if (!q) {
        return void interaction.reply({ embeds: [infoEmbed("Search for what?", "`/lookup someusername`")], ephemeral: true }).catch(() => {});
      }

      await interaction.deferReply().catch(() => {});
      logActivity("bot", `${interaction.user.tag} ran /lookup`, {
        location: interaction.guild?.name || "direct message",
        installation: interaction.guildId ? "server context" : "direct context",
      });

      try {
        const out = await searchLookups(q);
        if (out.protected) {
          return void interaction.editReply({ embeds: [warnEmbed("Protected", out.message || "That identity is whitelisted.")] }).catch(() => {});
        }
        const rows = [];
        let totalHits = 0;
        for (const m of out.matches || []) {
          if (m.error) { rows.push(`⚠️ ${m.error}`); continue; }
          for (const h of (m.hits || []).slice(0, 8)) {
            totalHits++;
            const body = h.row ? JSON.stringify(h.row) : (h.context || JSON.stringify(h));
            rows.push(`> ${String(body).slice(0, 300)}`);
          }
        }
        if (!totalHits) {
          return void interaction.editReply({ embeds: [warnEmbed("No matches", `Nothing found for \`${q}\`.`)] }).catch(() => {});
        }
        const pages = listPages(rows, { title: `🔎 ${q} · ${totalHits} result(s)`, perPage: 12 });
        await paginateInteraction(interaction, pages, { userId: interaction.user.id });
      } catch (err) {
        await interaction.editReply({ embeds: [errEmbed("Lookup failed", String(err.message))] }).catch(() => {});
      }
    } catch (err) {
      console.error("[slash] interaction error", err);
    }
  });
}

/** Same ◀ ▶ ⏹ pagination as ui.paginate, but driven by an interaction. */
async function paginateInteraction(interaction, pages, { time = 120_000, userId } = {}) {
  if (!pages.length) return interaction.editReply({ embeds: [infoEmbed("Nothing to show", "No results.")] }).catch(() => {});
  if (pages.length === 1) return interaction.editReply({ embeds: [pages[0]] }).catch(() => {});

  let i = 0;
  const controls = (disabled = false) => row(
    button({ id: "slpg:first", emoji: "⏮️", disabled: disabled || i === 0 }),
    button({ id: "slpg:prev", emoji: "◀️", disabled: disabled || i === 0 }),
    button({ id: "slpg:page", label: `${i + 1}/${pages.length}`, style: "primary", disabled: true }),
    button({ id: "slpg:next", emoji: "▶️", disabled: disabled || i === pages.length - 1 }),
    button({ id: "slpg:stop", emoji: "⏹️", style: "danger", disabled }),
  );

  await interaction.editReply({ embeds: [pages[0]], components: [controls()] }).catch(() => {});
  const sent = await interaction.fetchReply().catch(() => null);
  if (!sent) return;
  const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time });

  collector.on("collect", async (int) => {
    if (int.user.id !== userId) {
      return int.reply({ content: "These buttons aren't yours.", ephemeral: true }).catch(() => {});
    }
    if (int.customId === "slpg:stop") return collector.stop();
    if (int.customId === "slpg:first") i = 0;
    if (int.customId === "slpg:prev") i = Math.max(0, i - 1);
    if (int.customId === "slpg:next") i = Math.min(pages.length - 1, i + 1);
    await int.update({ embeds: [pages[i]], components: [controls()] }).catch(() => {});
  });
  collector.on("end", () => sent.edit({ components: [controls(true)] }).catch(() => {}));
}
