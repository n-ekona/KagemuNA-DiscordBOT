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
import { renderBarChart } from '../chart.js';
import { buildVcRanking, buildMessageRanking } from '../aggregate.js';

const PERIOD_CHOICES = [
  { name: '今日', value: 'today' },
  { name: '直近7日', value: '7d' },
  { name: '直近30日', value: '30d' },
  { name: '今月', value: 'this_month' },
  { name: '先月', value: 'last_month' },
  { name: '全期間', value: 'all' },
];

const METRIC_CHOICES = [
  { name: '両方 (VC時間＋メッセージ数)', value: 'both' },
  { name: 'VCアクティブ時間', value: 'vc' },
  { name: 'メッセージ数', value: 'messages' },
];

const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

export default {
  data: new SlashCommandBuilder()
    .setName('graph')
    .setDescription('期間内のVCアクティブ時間／メッセージ数を帯グラフで集計します')
    .addStringOption((o) =>
      o.setName('metric').setDescription('集計する指標 (既定: 両方)').addChoices(...METRIC_CHOICES)
    )
    .addStringOption((o) =>
      o.setName('period').setDescription('期間プリセット (from/to より優先)').addChoices(...PERIOD_CHOICES)
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
    )
    .addIntegerOption((o) =>
      o
        .setName('top')
        .setDescription('表示する人数 (既定15)')
        .setMinValue(1)
        .setMaxValue(config.maxTopUsers)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'このコマンドはサーバー内で実行してください。', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const metric = interaction.options.getString('metric') ?? 'both';
    const period = interaction.options.getString('period') ?? undefined;
    const from = interaction.options.getString('from') ?? undefined;
    const to = interaction.options.getString('to') ?? undefined;
    const channel = interaction.options.getChannel('channel');
    const top = interaction.options.getInteger('top') ?? 15;

    const gconf = getGuildConfig(guildId);
    let range;
    try {
      range = resolveRange({
        from,
        to,
        period,
        timezone: gconf.timezone,
        defaultLookbackDays: config.defaultLookbackDays,
      });
    } catch (err) {
      await interaction.editReply(`⚠️ 日付指定が不正です: ${err.message}`);
      return;
    }

    const now = Date.now();
    const isVoiceChannel = channel ? VOICE_TYPES.includes(channel.type) : false;
    // Voice channels also host text chat, so a channel filter for messages applies to any type.
    const msgChannelId = channel ? channel.id : undefined;
    const vcChannelId = isVoiceChannel ? channel.id : undefined;

    const wantVc = metric === 'both' || metric === 'vc';
    const wantMsg = metric === 'both' || metric === 'messages';

    const files = [];
    const embed = new EmbedBuilder()
      .setTitle('📊 集計結果')
      .setColor(0x5865f2)
      .setDescription(
        `**期間:** ${range.label}` + (channel ? `\n**チャンネル:** <#${channel.id}>` : '')
      );

    if (wantVc) {
      const { items, totalSec, participants } = buildVcRanking({
        guildId,
        start: range.start,
        end: range.end,
        channelId: vcChannelId,
        now,
        top,
      });
      if (items.length) {
        const buf = renderBarChart({
          title: 'VCアクティブ時間 ランキング',
          subtitle: range.label,
          items,
          accent: '#3ba55d',
          formatValue: (v) => formatDuration(v),
          footer: `参加者 ${participants}人 / 合計 ${formatDuration(totalSec)}`,
        });
        files.push(new AttachmentBuilder(buf, { name: 'vc.png' }));
      }
      embed.addFields({
        name: '🔊 VC合計',
        value: participants ? `${formatDuration(totalSec)} ・ ${participants}人` : 'データなし',
        inline: true,
      });
    }

    if (wantMsg) {
      const { items, total, posters } = buildMessageRanking({
        guildId,
        start: range.start,
        end: range.end,
        channelId: msgChannelId,
        top,
      });
      if (items.length) {
        const buf = renderBarChart({
          title: 'メッセージ数 ランキング',
          subtitle: range.label,
          items,
          accent: '#5865f2',
          formatValue: (v) => `${v.toLocaleString('ja-JP')} 件`,
          footer: `投稿者 ${posters}人 / 合計 ${total.toLocaleString('ja-JP')} 件`,
        });
        files.push(new AttachmentBuilder(buf, { name: 'messages.png' }));
      }
      embed.addFields({
        name: '💬 メッセージ合計',
        value: posters ? `${total.toLocaleString('ja-JP')} 件 ・ ${posters}人` : 'データなし',
        inline: true,
      });
    }

    if (!files.length) {
      embed.addFields({
        name: 'ℹ️ 記録なし',
        value: 'この期間に集計できるデータがありませんでした。',
      });
    }

    await interaction.editReply({ embeds: [embed], files });
  },
};
