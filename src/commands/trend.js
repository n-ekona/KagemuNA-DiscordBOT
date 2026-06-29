import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  ChannelType,
  MessageFlags,
} from 'discord.js';
import { config } from '../../config.js';
import { getGuildConfig } from '../db.js';
import { resolveRange, formatDuration } from '../time.js';
import { renderTrendChart } from '../chart.js';
import { buildMessageTrend, buildVcTrend } from '../aggregate.js';

// `period` choices. With none of period/from/to set we show BOTH the 7-day and
// 30-day trend (matches the common "週と月の推移を見たい" ask).
const PERIOD_CHOICES = [
  { name: '直近7日', value: '7d' },
  { name: '直近30日', value: '30d' },
  { name: '今月', value: 'this_month' },
  { name: '先月', value: 'last_month' },
];

const METRIC_CHOICES = [
  { name: 'メッセージ数', value: 'messages' },
  { name: 'VCアクティブ時間', value: 'vc' },
];

const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

const METRICS = {
  messages: {
    title: 'チャット数の推移',
    accent: '#5865f2',
    emoji: '💬',
    label: 'メッセージ',
    build: (args) => buildMessageTrend(args),
    formatValue: (v) => `${Math.round(v).toLocaleString('ja-JP')}件`,
    formatTotal: (v) => `${Math.round(v).toLocaleString('ja-JP')} 件`,
  },
  vc: {
    title: 'VCアクティブ時間の推移',
    accent: '#3ba55d',
    emoji: '🔊',
    label: 'VC時間',
    build: (args) => buildVcTrend(args),
    formatValue: (v) => formatDuration(v),
    formatTotal: (v) => formatDuration(v),
  },
};

export default {
  data: new SlashCommandBuilder()
    .setName('trend')
    .setDescription('日ごとのチャット数（またはVC時間）の推移をグラフで表示します')
    .addStringOption((o) =>
      o.setName('metric').setDescription('集計する指標 (既定: メッセージ数)').addChoices(...METRIC_CHOICES)
    )
    .addStringOption((o) =>
      o
        .setName('period')
        .setDescription('期間 (未指定なら 週＋月 の両方を表示)')
        .addChoices(...PERIOD_CHOICES)
    )
    .addStringOption((o) => o.setName('from').setDescription('開始日 YYYY-MM-DD (period未指定時)'))
    .addStringOption((o) => o.setName('to').setDescription('終了日 YYYY-MM-DD (period未指定時)'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('対象チャンネルで絞り込み (任意)')
        .addChannelTypes(
          ChannelType.GuildText,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildVoice,
          ChannelType.GuildStageVoice
        )
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'このコマンドはサーバー内で実行してください。', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const metricKey = interaction.options.getString('metric') ?? 'messages';
    const metric = METRICS[metricKey];
    const period = interaction.options.getString('period') ?? undefined;
    const from = interaction.options.getString('from') ?? undefined;
    const to = interaction.options.getString('to') ?? undefined;
    const channel = interaction.options.getChannel('channel');

    const gconf = getGuildConfig(guildId);
    const now = Date.now();

    // VC filter only makes sense for voice channels; message filter applies to any
    // channel type (voice channels host text chat too).
    const isVoiceChannel = channel ? VOICE_TYPES.includes(channel.type) : false;
    const channelId = metricKey === 'vc' ? (isVoiceChannel ? channel.id : undefined) : channel?.id;

    // Decide which windows to render. No explicit period/from/to => both 週 and 月.
    let presets;
    try {
      if (!period && !from && !to) {
        presets = [
          resolveRange({ period: '7d', timezone: gconf.timezone, defaultLookbackDays: config.defaultLookbackDays }),
          resolveRange({ period: '30d', timezone: gconf.timezone, defaultLookbackDays: config.defaultLookbackDays }),
        ];
      } else {
        presets = [
          resolveRange({ from, to, period, timezone: gconf.timezone, defaultLookbackDays: config.defaultLookbackDays }),
        ];
      }
    } catch (err) {
      await interaction.editReply(`⚠️ 日付指定が不正です: ${err.message}`);
      return;
    }

    const files = [];
    const embed = new EmbedBuilder()
      .setTitle(`${metric.emoji} ${metric.title}`)
      .setColor(0x5865f2)
      .setDescription(
        '日ごとの推移を表示します。' + (channel ? `\n**チャンネル:** <#${channel.id}>` : '')
      );

    presets.forEach((range, idx) => {
      const { points, total, days } = metric.build({
        guildId,
        start: range.start,
        end: range.end,
        zone: gconf.timezone,
        channelId,
        now,
      });
      const buf = renderTrendChart({
        title: metric.title,
        subtitle: range.label,
        points,
        accent: metric.accent,
        formatValue: metric.formatValue,
        footer: `${days}日間 ・ 合計 ${metric.formatTotal(total)} ・ 1日平均 ${metric.formatTotal(total / Math.max(1, days))}`,
      });
      files.push(new AttachmentBuilder(buf, { name: `trend_${idx}.png` }));
      embed.addFields({
        name: range.label,
        value: total > 0 ? `合計 ${metric.formatTotal(total)}（1日平均 ${metric.formatTotal(total / Math.max(1, days))}）` : 'データなし',
      });
    });

    await interaction.editReply({ embeds: [embed], files });
  },
};
