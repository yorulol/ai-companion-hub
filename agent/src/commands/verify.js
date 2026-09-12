import { embed, okEmbed, errEmbed, button, row, COLORS } from "../ui.js";
import { newToken, verifyUrl } from "../verify.js";
import { getAutomod, setAutomod } from "../automod.js";

export const commands = [
  {
    name: "verify",
    category: "info",
    description: "Get a one-time verification link. Complete it to receive the verified role.",
    usage: "verify",
    permission: "everyone",
    run: async ({ message }) => {
      const cfg = getAutomod(message.guild.id);
      if (!cfg.verify_role_id) {
        return void message.reply({ embeds: [errEmbed("Verification not set up", "Ask an admin to run `!verifysetup <@role>` first.")] });
      }
      const token = newToken({ userId: message.author.id, guildId: message.guild.id, roleId: cfg.verify_role_id });
      const url = verifyUrl({ headers: {} }, token);
      const dm = await message.author.createDM().catch(() => null);
      const payload = {
        embeds: [embed({
          title: "🔐 Verify your account",
          description: `Open the link below and click **I'm human** to finish verification. This link expires in 15 minutes.\n\n${url}`,
          color: COLORS.info,
        })],
        components: [row(button({ style: "link", url, label: "Open verification page" }))],
      };
      if (dm) {
        await dm.send(payload).catch(() => {});
        return void message.reply({ embeds: [okEmbed("Check your DMs", "I sent you your verification link.")] });
      }
      await message.reply(payload);
    },
  },
  {
    name: "verifysetup",
    category: "admin",
    description: "Set the role given to users after they finish verification.",
    usage: "verifysetup <@role>",
    permission: "admin",
    run: async ({ message, args }) => {
      const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[0]);
      if (!role) return void message.reply({ embeds: [errEmbed("Need a role", "Mention the role or pass its ID.")] });
      setAutomod(message.guild.id, { verify_role_id: role.id });
      return void message.reply({ embeds: [okEmbed("Verify role set", `New members who run \`!verify\` will receive **${role.name}**.`)] });
    },
  },
  {
    name: "automod",
    category: "admin",
    description: "Toggle auto-moderation features (antispam, antiraid, antiinvite, antimention).",
    usage: "automod <feature> <on|off>",
    permission: "admin",
    run: async ({ message, args }) => {
      const [feature, state] = args;
      const valid = ["antispam", "antiraid", "antiinvite", "antimention"];
      if (!valid.includes(feature) || !["on", "off"].includes(state)) {
        return void message.reply({ embeds: [errEmbed("Usage", `\`!automod <${valid.join("|")}> <on|off>\``)] });
      }
      const patch = { [feature]: state === "on" ? 1 : 0 };
      const next = setAutomod(message.guild.id, patch);
      return void message.reply({ embeds: [okEmbed("Auto-mod updated",
        `antispam:${next.antispam?"on":"off"} · antiraid:${next.antiraid?"on":"off"} · antiinvite:${next.antiinvite?"on":"off"} · antimention:${next.antimention?"on":"off"}`)] });
    },
  },
  {
    name: "modlog",
    category: "admin",
    description: "Set the channel where auto-mod events are logged.",
    usage: "modlog #channel",
    permission: "admin",
    run: async ({ message }) => {
      const ch = message.mentions.channels.first() || message.channel;
      setAutomod(message.guild.id, { log_channel_id: ch.id });
      return void message.reply({ embeds: [okEmbed("Mod-log channel set", `Auto-mod events will be posted in <#${ch.id}>.`)] });
    },
  },
];
