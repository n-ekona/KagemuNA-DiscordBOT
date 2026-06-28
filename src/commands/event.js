import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { getGuildConfig, getEvent, listEventChannels } from '../db.js';
import { formatRangeLabel, formatDuration } from '../time.js';
import { renderBarChart } from '../chart.js';
import { buildVcRanking, buildMessageRanking } from '../aggregate.js';
import { joinChannelMentions } from '../format.js';

export default {
  data: new SlashCommandBuilder()
    .setName('event')
    .setDescription('開催中イベント期間のVCアクティブ時間／メッセージ数ランキングを表示します')
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
    const event = getEvent(guildId);
    if (!event) {
      await interaction.editReply(
        'ℹ️ イベントが設定されていません。サーバー管理者が `/eventset period` で期間を設定できます。'
      );
      return;
    }

    const gconf = getGuildConfig(guildId);
    const now = Date.now();
    const rangeLabel = formatRangeLabel(event.startAt, event.endAt, gconf.timezone);
    const top = interaction.options.getInteger('top') ?? 15;

    // The event's channels (if any) scope BOTH metrics uniformly. Text channels
    // simply won't match any VC session, and voice channels won't match unless
    // their text chat has messages — so one list works for both, no type lookup
    // needed (also counts channels that were later deleted).
    const eventChannels = listEventChannels(guildId);
    const channelIds = eventChannels.length ? eventChannels : undefined;

    const subtitle = (event.title ? `${event.title} ・ ` : '') + rangeLabel;

    const files = [];
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${event.title ? event.title : 'イベント'} 集計`)
      .setColor(0xf1c40f)
      .setDescription(
        `**期間:** ${rangeLabel}\n**対象チャンネル:** ` +
          (eventChannels.length ? joinChannelMentions(eventChannels) : 'すべてのチャンネル')
      );

    const vc = buildVcRanking({ guildId, start: event.startAt, end: event.endAt, channelIds, now, top });
    if (vc.items.length) {
      const buf = renderBarChart({
        title: 'VCアクティブ時間 ランキング',
        subtitle,
        items: vc.items,
        accent: '#3ba55d',
        formatValue: (v) => formatDuration(v),
        footer: `参加者 ${vc.participants}人 / 合計 ${formatDuration(vc.totalSec)}`,
      });
      files.push(new AttachmentBuilder(buf, { name: 'event-vc.png' }));
    }
    embed.addFields({
      name: '🔊 VC合計',
      value: vc.participants ? `${formatDuration(vc.totalSec)} ・ ${vc.participants}人` : 'データなし',
      inline: true,
    });

    const msg = buildMessageRanking({ guildId, start: event.startAt, end: event.endAt, channelIds, top });
    if (msg.items.length) {
      const buf = renderBarChart({
        title: 'メッセージ数 ランキング',
        subtitle,
        items: msg.items,
        accent: '#5865f2',
        formatValue: (v) => `${v.toLocaleString('ja-JP')} 件`,
        footer: `投稿者 ${msg.posters}人 / 合計 ${msg.total.toLocaleString('ja-JP')} 件`,
      });
      files.push(new AttachmentBuilder(buf, { name: 'event-messages.png' }));
    }
    embed.addFields({
      name: '💬 メッセージ合計',
      value: msg.posters ? `${msg.total.toLocaleString('ja-JP')} 件 ・ ${msg.posters}人` : 'データなし',
      inline: true,
    });

    if (!files.length) {
      embed.addFields({ name: 'ℹ️ 記録なし', value: 'この期間に集計できるデータがありませんでした。' });
    }

    await interaction.editReply({ embeds: [embed], files });
  },
};
