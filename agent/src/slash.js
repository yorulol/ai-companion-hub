/**
 * Discord slash commands. Mirrors the prefix commands: /lookup runs the exact
 * same lookups-folder search as !lookup and enforces the same per-server
 * permission rules. Registered per-guild so the command is available instantly
 * (global registration can take up to an hour to propagate).
 */
import { Events, ComponentType } from "discord.js";
import { getGuild } from "./db.js";
import { canRun } from "./permissions.js";
import { errEmbed, warnEmbed, infoEmbed, listPages, button, row } from "./ui.js";
import { logActivity } from "./activity.js";
import { lookup as searchLookups } from "./lookups.js";

const SLASH_COMMANDS = [
  {
    name: "lookup",
    description: "Search the lookups folder.",
    options: [
      {
        name: "query",
        description: "Username, ID, or text to search for (min 3 characters).",
        type: 3, // ApplicationCommandOptionType.String
        required: true,
      },
    ],
    dm_permission: false,
  },
];

async function registerForGuild(guild) {
  try {
    await guild.commands.set(SLASH_COMMANDS);
  } catch (err) {
    console.warn(`[slash] register failed in ${guild.name}: ${err.message}`);
  }
}

/** Hook slash registration + interaction handling onto a bot client. */
export function attachSlash(client) {
  client.on(Events.ClientReady, () => {
    for (const guild of client.guilds.cache.values()) registerForGuild(guild);
  });

  // Instant availability in servers the bot joins later.
  client.on(Events.GuildCreate, (guild) => registerForGuild(guild));

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (!interaction.isChatInputCommand()) return;
      if (interaction.commandName !== "lookup") return;
      if (!interaction.inGuild() || !interaction.guild) {
        return void interaction.reply({ embeds: [errEmbed("Servers only", "Lookup runs inside a server.")], ephemeral: true }).catch(() => {});
      }

      const guildCfg = getGuild(interaction.guildId, interaction.guild.name);
      const member = interaction.member;
      if (!canRun(member, guildCfg, "mod")) {
        return void interaction.reply({
          embeds: [errEmbed("Not allowed", "`lookup` needs **mod** permission.")],
          ephemeral: true,
        }).catch(() => {});
      }

      const q = (interaction.options.getString("query", true) || "").trim();
      if (!q) {
        return void interaction.reply({ embeds: [infoEmbed("Search for what?", "`/lookup someusername`")], ephemeral: true }).catch(() => {});
      }

      await interaction.deferReply().catch(() => {});
      logActivity("bot", `${interaction.user.tag} ran /lookup`, { guild: interaction.guild.name });

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
          return void interaction.editReply({ embeds: [warnEmbed("No matches", `Nothing for \`${q}\` across ${out.files} files.`)] }).catch(() => {});
        }
        const pages = listPages(rows, { title: `🔎 ${q} · ${totalHits} hit(s) across ${out.files} files`, perPage: 12 });
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
