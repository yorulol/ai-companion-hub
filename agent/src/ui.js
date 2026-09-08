/**
 * Shared UI toolkit for every Discord command: consistent glassy-purple embeds,
 * buttons, select menus, pagination, confirmation dialogs and modal-style prompts.
 * Every command file imports from here so the whole bot looks like one product.
 */
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, ComponentType,
} from "discord.js";

export const COLORS = {
  brand: 0xa855f7,
  ok: 0x22c55e,
  warn: 0xf59e0b,
  danger: 0xef4444,
  info: 0x38bdf8,
  dark: 0x1a1030,
};

export const EMOJI = {
  ok: "✅", no: "❌", warn: "⚠️", info: "ℹ️", spark: "✨", coin: "🪙",
  shield: "🛡️", star: "⭐", fire: "🔥", left: "◀️", right: "▶️", stop: "⏹️",
};

/** Standard NOVA embed. */
export function embed({
  title, description, fields = [], color = COLORS.brand,
  thumbnail, image, footer = "NOVA", author, url, timestamp = true,
} = {}) {
  const e = new EmbedBuilder().setColor(color);
  if (title) e.setTitle(title.slice(0, 256));
  if (url) e.setURL(url);
  if (description) e.setDescription(String(description).slice(0, 4096));
  if (fields.length) {
    e.addFields(fields.slice(0, 25).map((f) => ({
      name: String(f.name).slice(0, 256),
      value: String(f.value ?? "—").slice(0, 1024) || "—",
      inline: !!f.inline,
    })));
  }
  if (thumbnail) e.setThumbnail(thumbnail);
  if (image) e.setImage(image);
  if (author) e.setAuthor(author);
  if (footer) e.setFooter({ text: footer.slice(0, 2048) });
  if (timestamp) e.setTimestamp(new Date());
  return e;
}

export const okEmbed = (title, description, extra = {}) => embed({ title: `${EMOJI.ok} ${title}`, description, color: COLORS.ok, ...extra });
export const errEmbed = (title, description, extra = {}) => embed({ title: `${EMOJI.no} ${title}`, description, color: COLORS.danger, ...extra });
export const warnEmbed = (title, description, extra = {}) => embed({ title: `${EMOJI.warn} ${title}`, description, color: COLORS.warn, ...extra });
export const infoEmbed = (title, description, extra = {}) => embed({ title: `${EMOJI.info} ${title}`, description, color: COLORS.info, ...extra });

const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger, link: ButtonStyle.Link };

/** Build one button. */
export function button({ id, label, style = "secondary", emoji, url, disabled = false }) {
  const b = new ButtonBuilder().setStyle(url ? ButtonStyle.Link : (STYLES[style] || ButtonStyle.Secondary));
  if (label) b.setLabel(label.slice(0, 80));
  if (emoji) b.setEmoji(emoji);
  if (url) b.setURL(url); else b.setCustomId(id);
  if (disabled) b.setDisabled(true);
  return b;
}

/** Build a row of buttons/menus. */
export const row = (...components) => new ActionRowBuilder().addComponents(...components.flat());

/** Build a select menu. */
export function select({ id, placeholder = "Choose…", options = [], min = 1, max = 1 }) {
  return new StringSelectMenuBuilder()
    .setCustomId(id)
    .setPlaceholder(placeholder.slice(0, 150))
    .setMinValues(min).setMaxValues(Math.max(min, Math.min(max, options.length || 1)))
    .addOptions(options.slice(0, 25).map((o) => ({
      label: String(o.label).slice(0, 100),
      value: String(o.value).slice(0, 100),
      description: o.description ? String(o.description).slice(0, 100) : undefined,
      emoji: o.emoji,
    })));
}

/** Visual progress bar, e.g. ▰▰▰▰▱▱▱▱▱▱ 40%. */
export function bar(value, max, size = 12) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const filled = Math.round(pct * size);
  return `${"▰".repeat(filled)}${"▱".repeat(size - filled)} ${Math.round(pct * 100)}%`;
}

export const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

export const codeBlock = (text, lang = "") => "```" + lang + "\n" + String(text).slice(0, 1850) + "\n```";

/**
 * Send a paginated embed with ◀ ▶ ⏹ buttons. `pages` is an array of EmbedBuilder.
 * Only the invoking user can flip pages.
 */
export async function paginate(message, pages, { time = 120_000, userId } = {}) {
  const owner = userId || message.author.id;
  if (!pages.length) return message.reply({ embeds: [infoEmbed("Nothing to show", "No results.")] });
  if (pages.length === 1) return message.reply({ embeds: [pages[0]] });

  let i = 0;
  const controls = (disabled = false) => row(
    button({ id: "pg:first", emoji: "⏮️", disabled: disabled || i === 0 }),
    button({ id: "pg:prev", emoji: EMOJI.left, disabled: disabled || i === 0 }),
    button({ id: "pg:page", label: `${i + 1}/${pages.length}`, style: "primary", disabled: true }),
    button({ id: "pg:next", emoji: EMOJI.right, disabled: disabled || i === pages.length - 1 }),
    button({ id: "pg:stop", emoji: EMOJI.stop, style: "danger", disabled }),
  );

  const sent = await message.reply({ embeds: [pages[0]], components: [controls()] });
  const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time });

  collector.on("collect", async (int) => {
    if (int.user.id !== owner) {
      return int.reply({ content: "These buttons aren't yours.", ephemeral: true }).catch(() => {});
    }
    if (int.customId === "pg:stop") return collector.stop();
    if (int.customId === "pg:first") i = 0;
    if (int.customId === "pg:prev") i = Math.max(0, i - 1);
    if (int.customId === "pg:next") i = Math.min(pages.length - 1, i + 1);
    await int.update({ embeds: [pages[i]], components: [controls()] }).catch(() => {});
  });
  collector.on("end", () => sent.edit({ components: [controls(true)] }).catch(() => {}));
  return sent;
}

/**
 * Confirmation dialog. Resolves true/false. Used by every destructive command.
 */
export async function confirm(message, { title = "Are you sure?", description = "", danger = true, time = 30_000, userId } = {}) {
  const owner = userId || message.author.id;
  const view = embed({ title: `${danger ? EMOJI.warn : EMOJI.info} ${title}`, description, color: danger ? COLORS.danger : COLORS.info });
  const buttons = (disabled = false) => row(
    button({ id: "cf:yes", label: "Confirm", style: danger ? "danger" : "success", emoji: EMOJI.ok, disabled }),
    button({ id: "cf:no", label: "Cancel", style: "secondary", emoji: EMOJI.no, disabled }),
  );
  const sent = await message.reply({ embeds: [view], components: [buttons()] });

  return new Promise((resolve) => {
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.Button, time, max: 10 });
    let done = false;
    collector.on("collect", async (int) => {
      if (int.user.id !== owner) return int.reply({ content: "Not your prompt.", ephemeral: true }).catch(() => {});
      done = true;
      const yes = int.customId === "cf:yes";
      await int.update({
        embeds: [yes ? okEmbed("Confirmed", description) : infoEmbed("Cancelled", "Nothing was changed.")],
        components: [buttons(true)],
      }).catch(() => {});
      collector.stop();
      resolve(yes);
    });
    collector.on("end", () => {
      if (!done) {
        sent.edit({ embeds: [infoEmbed("Timed out", "No answer — nothing was changed.")], components: [buttons(true)] }).catch(() => {});
        resolve(false);
      }
    });
  });
}

/** Ask the user to pick from a select menu. Resolves the chosen value or null. */
export async function choose(message, { title = "Pick one", description = "", options = [], time = 60_000, userId } = {}) {
  const owner = userId || message.author.id;
  const menu = select({ id: "ch:menu", options });
  const sent = await message.reply({ embeds: [embed({ title, description })], components: [row(menu)] });
  return new Promise((resolve) => {
    const collector = sent.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time, max: 5 });
    let value = null;
    collector.on("collect", async (int) => {
      if (int.user.id !== owner) return int.reply({ content: "Not your menu.", ephemeral: true }).catch(() => {});
      value = int.values[0];
      await int.update({ embeds: [okEmbed("Selected", `\`${value}\``)], components: [] }).catch(() => {});
      collector.stop();
    });
    collector.on("end", () => { sent.edit({ components: [] }).catch(() => {}); resolve(value); });
  });
}

/**
 * Chat-box style prompt: waits for the user's next message in the channel.
 * Resolves the message content, or null on timeout.
 */
export async function prompt(message, { title = "I need one more thing", description = "Type your answer below.", time = 60_000 } = {}) {
  await message.reply({ embeds: [infoEmbed(title, description)] });
  const collected = await message.channel.awaitMessages({
    filter: (m) => m.author.id === message.author.id,
    max: 1, time, errors: [],
  }).catch(() => null);
  return collected?.first()?.content ?? null;
}

/** Build pages of an embed list from rows of text. */
export function listPages(rows, { title, perPage = 10, color = COLORS.brand, footer } = {}) {
  const groups = chunk(rows, perPage);
  if (!groups.length) return [embed({ title, description: "Nothing here yet.", color })];
  return groups.map((g, idx) => embed({
    title, description: g.join("\n"), color,
    footer: footer || `Page ${idx + 1} of ${groups.length}`,
  }));
}

export const RNG = (n) => Math.floor(Math.random() * n);
export const pick = (arr) => arr[RNG(arr.length)];
export const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const mention = (message) => message.mentions.users.first() || message.author;
export const targetMember = (message) => message.mentions.members?.first() || null;
export const fmt = (n) => Number(n).toLocaleString("en-US");
export const ago = (ts) => `<t:${Math.floor(ts / 1000)}:R>`;
