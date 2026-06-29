import { ApplicationCommandOptionType, EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { logger } from './logger.js';

// Real-time mirror of every slash-command execution into a Discord channel
// (config.logChannelId). Best-effort only: any failure here is swallowed so it
// can never break the command the user actually ran.

function truncate(str, max) {
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

function formatOptionValue(opt) {
  switch (opt.type) {
    case ApplicationCommandOptionType.User:
      return `@${opt.user?.tag ?? opt.value}`;
    case ApplicationCommandOptionType.Channel:
      return `#${opt.channel?.name ?? opt.value}`;
    case ApplicationCommandOptionType.Role:
      return `@${opt.role?.name ?? opt.value}`;
    default:
      return String(opt.value);
  }
}

// Flatten the option tree into a readable "sub key:value key:value" string,
// recursing through subcommand / subcommand-group wrappers.
function describeOptions(options) {
  const parts = [];
  for (const opt of options ?? []) {
    if (
      opt.type === ApplicationCommandOptionType.Subcommand ||
      opt.type === ApplicationCommandOptionType.SubcommandGroup
    ) {
      const nested = describeOptions(opt.options);
      parts.push(nested ? `${opt.name} ${nested}` : opt.name);
    } else {
      parts.push(`${opt.name}:${formatOptionValue(opt)}`);
    }
  }
  return parts.join(' ');
}

function buildCommandString(interaction) {
  const rest = describeOptions(interaction.options?.data);
  return rest ? `${interaction.commandName} ${rest}` : interaction.commandName;
}

async function getLogChannel(client) {
  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (channel?.isTextBased()) return channel;
    logger.warn(`Command-log channel ${config.logChannelId} is not a sendable text channel.`);
    return null;
  } catch (err) {
    logger.warn(`Failed to fetch command-log channel ${config.logChannelId}:`, err?.message ?? err);
    return null;
  }
}

/**
 * Post a one-line-ish embed describing a finished command execution to the
 * configured log channel. Fire-and-forget; never throws.
 *
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {{ status: 'success' | 'error', durationMs: number, error?: unknown }} result
 */
export async function logCommandExecution(interaction, result) {
  if (!config.logChannelId) return; // feature disabled
  try {
    const channel = await getLogChannel(interaction.client);
    if (!channel) return;

    const ok = result.status === 'success';
    const embed = new EmbedBuilder()
      .setColor(ok ? 0x57f287 : 0xed4245)
      .setTitle(ok ? '✅ コマンド実行' : '❌ コマンドエラー')
      .setDescription(`\`/${buildCommandString(interaction)}\``)
      .addFields(
        { name: '実行者', value: `${interaction.user.tag} (<@${interaction.user.id}>)`, inline: true },
        { name: 'サーバー', value: interaction.guild?.name ?? 'DM', inline: true },
        { name: 'チャンネル', value: interaction.channelId ? `<#${interaction.channelId}>` : '—', inline: true },
        { name: '所要', value: `${result.durationMs} ms`, inline: true }
      )
      .setTimestamp(new Date());

    if (!ok && result.error) {
      const detail = result.error?.stack ?? String(result.error);
      embed.addFields({ name: 'エラー詳細', value: `\`\`\`\n${truncate(String(detail), 1000)}\n\`\`\`` });
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.warn('Failed to post command-execution log:', err?.message ?? err);
  }
}
