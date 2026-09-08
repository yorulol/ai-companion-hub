import { PermissionsBitField } from "discord.js";
import { config } from "./config.js";

export const LEVELS = { everyone: 0, mod: 1, admin: 2, owner: 3 };

/**
 * Per-server permission check. Roles picked in the owner panel decide who can
 * use moderation and admin commands; server owners and the bot owner always pass.
 */
export function canRun(member, guildConfig, permission) {
  if (permission === "everyone") return true;
  if (!member) return false;
  if (member.id === config.ownerId) return true;
  if (member.guild?.ownerId === member.id) return true;

  const roleIds = member.roles?.cache ? [...member.roles.cache.keys()] : [];
  const isAdmin =
    guildConfig.adminRoles.some((r) => roleIds.includes(r)) ||
    member.permissions?.has(PermissionsBitField.Flags.Administrator);
  const isMod = guildConfig.modRoles.some((r) => roleIds.includes(r)) || isAdmin;

  if (permission === "owner") return false;
  if (permission === "admin") return isAdmin;
  if (permission === "mod") return isMod;
  return false;
}
