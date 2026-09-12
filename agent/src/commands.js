/**
 * Command registry. Every command lives in a category file under ./commands/
 * and is merged here. Permission gating happens in permissions.js, the shared
 * look-and-feel (embeds, buttons, menus, pagination) lives in ui.js.
 */
import { PermissionsBitField } from "discord.js";
import { config } from "./config.js";

import { commands as funCommands } from "./commands/fun.js";
import { commands as gamesCommands } from "./commands/games.js";
import { commands as utilityCommands } from "./commands/utility.js";
import { commands as infoCommands } from "./commands/info.js";
import { commands as moderationCommands } from "./commands/moderation.js";
import { commands as adminCommands } from "./commands/admin.js";
import { commands as economyCommands } from "./commands/economy.js";
import { commands as levelsCommands } from "./commands/levels.js";
import { commands as aiCommands } from "./commands/ai.js";
import { commands as ownerCommands } from "./commands/owner.js";
import { commands as verifyCommands } from "./commands/verify.js";

const SOURCES = [
  ["info", infoCommands],
  ["utility", utilityCommands],
  ["fun", funCommands],
  ["games", gamesCommands],
  ["economy", economyCommands],
  ["levels", levelsCommands],
  ["moderation", moderationCommands],
  ["admin", adminCommands],
  ["ai", aiCommands],
  ["owner", ownerCommands],
  ["verify", verifyCommands],
];

/** @type {Array<{name:string,category:string,description:string,usage:string,permission:'everyone'|'mod'|'admin'|'owner',run:Function,aliases?:string[]}>} */
export const COMMANDS = [];

const taken = new Set();
for (const [label, list] of SOURCES) {
  for (const cmd of list || []) {
    if (!cmd?.name || typeof cmd.run !== "function") {
      console.warn(`[commands] skipped a malformed command in ${label}`);
      continue;
    }
    if (taken.has(cmd.name)) {
      console.warn(`[commands] duplicate name "${cmd.name}" in ${label} — skipped`);
      continue;
    }
    taken.add(cmd.name);
    cmd.aliases = (cmd.aliases || []).filter((a) => !taken.has(a));
    for (const a of cmd.aliases) taken.add(a);
    COMMANDS.push(cmd);
  }
}

export const CATEGORIES = [...new Set(COMMANDS.map((c) => c.category))];

/** Look up a command by name or alias. */
export const findCommand = (name) => {
  const n = String(name || "").toLowerCase();
  return COMMANDS.find((c) => c.name === n || c.aliases?.includes(n));
};

export const byCategory = (category) => COMMANDS.filter((c) => c.category === category);

export const commandSummary = () =>
  COMMANDS.map((c) => ({
    name: c.name,
    category: c.category,
    description: c.description,
    usage: c.usage,
    permission: c.permission,
    aliases: c.aliases || [],
  }));

export const _ownerId = () => config.ownerId;
export const _adminFlag = PermissionsBitField.Flags.Administrator;
