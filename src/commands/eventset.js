import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { config } from '../../config.js';
import * as db from '../db.js';
import { resolveRange, formatRangeLabel } from '../time.js';
import { joinChannelMentions } from '../format.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

export default {
  data: new SlashCommandBuilder()
    .setName('eventset')
    .setDescription('イベントの集計設定を管理します (要: サーバー管理権限)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('period')
        .setDescription('イベント期間を設定 (/event の集計対象になります)')
        .addStringOption((o) => o.setName('from').setDescription('開始日 YYYY-MM-DD').setRequired(true))
        .addStringOption((o) => o.setName('to').setDescription('終了日 YYYY-MM-DD').setRequired(true))
        .addStringOption((o) => o.setName('title').setDescription('イベント名 (任意)'))
    )
    .addSubcommand((s) =>
      s
        .setName('channel-add')
        .setDescription('イベントの集計対象チャンネルを追加 (未設定なら全チャンネル)')
        .addChannelOption((o) =>
          o
            .setName('channel')
            .setDescription('追加するチャンネル')
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildVoice,
              ChannelType.GuildStageVoice
            )
            .setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('channel-remove')
        .setDescription('イベントの集計対象チャンネルを削除')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('削除するチャンネル').setRequired(true)
        )
    )
    .addSubcommand((s) => s.setName('show').setDescription('現在のイベント設定を表示'))
    .addSubcommand((s) => s.setName('reset').setDescription('イベント設定をすべて消去')),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'このコマンドはサーバー内で実行してください。', ...EPHEMERAL });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '⚠️ この操作には「サーバー管理」権限が必要です。', ...EPHEMERAL });
      return;
    }

    const guildId = interaction.guildId;
    const gconf = db.getGuildConfig(guildId);
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'period': {
        const from = interaction.options.getString('from');
        const to = interaction.options.getString('to');
        const title = interaction.options.getString('title') ?? null;
        let range;
        try {
          range = resolveRange({ from, to, timezone: gconf.timezone });
        } catch (err) {
          await interaction.reply({ content: `⚠️ 日付指定が不正です: ${err.message}`, ...EPHEMERAL });
          return;
        }
        db.setEventPeriod({ guildId, title, startAt: range.start, endAt: range.end, now: Date.now() });
        await interaction.reply({
          content:
            `✅ イベント期間を設定しました。\n` +
            (title ? `**${title}**\n` : '') +
            `期間: ${formatRangeLabel(range.start, range.end, gconf.timezone)}\n` +
            `誰でも \`/event\` で集計を表示できます。`,
          ...EPHEMERAL,
        });
        return;
      }
      case 'channel-add': {
        const channel = interaction.options.getChannel('channel');
        db.addEventChannel(guildId, channel.id);
        await interaction.reply({
          content: `✅ <#${channel.id}> をイベント集計対象に追加しました。`,
          ...EPHEMERAL,
        });
        return;
      }
      case 'channel-remove': {
        const channel = interaction.options.getChannel('channel');
        const removed = db.removeEventChannel(guildId, channel.id);
        await interaction.reply({
          content: removed
            ? `✅ <#${channel.id}> をイベント集計対象から削除しました。`
            : `ℹ️ <#${channel.id}> は登録されていません。`,
          ...EPHEMERAL,
        });
        return;
      }
      case 'show': {
        const event = db.getEvent(guildId);
        const channels = db.listEventChannels(guildId);
        const embed = new EmbedBuilder().setTitle('🏆 イベント設定').setColor(0xf1c40f);
        if (!event) {
          embed.setDescription('未設定です。`/eventset period from: to:` で期間を設定してください。');
        } else {
          embed.addFields(
            { name: 'イベント名', value: event.title || '（未設定）', inline: true },
            { name: '期間', value: formatRangeLabel(event.startAt, event.endAt, gconf.timezone) },
            {
              name: '対象チャンネル',
              value: channels.length ? joinChannelMentions(channels, { joiner: '\n' }) : 'すべてのチャンネル',
            }
          );
        }
        await interaction.reply({ embeds: [embed], ...EPHEMERAL });
        return;
      }
      case 'reset': {
        db.resetEvent(guildId);
        await interaction.reply({ content: '✅ イベント設定を消去しました。', ...EPHEMERAL });
        return;
      }
      default:
        await interaction.reply({ content: '未対応のサブコマンドです。', ...EPHEMERAL });
    }
  },
};
