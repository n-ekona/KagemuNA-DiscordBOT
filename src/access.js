import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';

/**
 * Gate the forum commands to the configured guild and to moderators/admins.
 * Returns null when allowed, or a Japanese rejection message when not.
 */
export function checkForumAccess(interaction) {
  if (interaction.guildId !== config.forumGuildId) {
    return 'このコマンドはこのサーバーでは使用できません。';
  }
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
  const roleCache = interaction.member?.roles?.cache;
  const hasModRole = roleCache ? config.modRoleIds.some((id) => roleCache.has(id)) : false;
  if (!isAdmin && !hasModRole) {
    return 'このコマンドはモデレーター/管理者のみ使用できます。';
  }
  return null;
}
