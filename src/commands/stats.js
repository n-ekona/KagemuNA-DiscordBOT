import { SlashCommandBuilder, EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { getGuildConfig } from '../db.js';
import { resolveRange, formatDuration } from '../time.js';
import { buildVcRanking, buildMessageRanking } from '../aggregate.js';

const PERIOD_CHOICES = [
  { name: '今日', value: 'today' },
  { name: '直近7日', value: '7d' },
  { name: '直近30日', value: '30d' },
  { name: '今月', value: 'this_month' },
  { name: '先月', value: 'last_month' },
  { name: '全期間', value: 'all' },
];

const VOICE_TYPES = [ChannelType.GuildVoice, ChannelType.GuildStageVoice];

// Embed field values are capped at 1024 chars by Discord, so build up to a safe
// length and summarise the remainder.
function rankList(items, formatValue) {
  if (!items.length) return 'データなし';
  const cap = (name) => (name.length > 40 ? `${name.slice(0, 39)}…` : name);
  const lines = items.map((it, i) => `**${i + 1}.** ${cap(it.label)} — ${formatValue(it.value)}`);
  let out = '';
  let shown = 0;
  for (const line of lines) {
    if (out.length + line.length + 1 > 1000) break;
    out += (out ? '\n' : '') + line;
    shown++;
  }
  if (shown < lines.length) out += `\n…ほか${lines.length - shown}人`;
  return out;
}

export default {
  data: new SlashCommandBuilder()
    .setName('stats')
    .setDescription('期間内のVC時間／メッセージ数をテキストで表示します (管理者向け)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
      o.setName('top').setDescription('表示する人数 (既定10)').setMinValue(1).setMaxValue(config.maxTopUsers)
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      await interaction.reply({ content: 'このコマンドはサーバー内で実行してください。', flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: '⚠️ この操作には「サーバー管理」権限が必要です。', flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply();

    const guildId = interaction.guildId;
    const period = interaction.options.getString('period') ?? undefined;
    const from = interaction.options.getString('from') ?? undefined;
    const to = interaction.options.getString('to') ?? undefined;
    const channel = interaction.options.getChannel('channel');
    const top = interaction.options.getInteger('top') ?? 10;

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
    const msgChannelId = channel ? channel.id : undefined;
    const vcChannelId = isVoiceChannel ? channel.id : undefined;

    const vc = buildVcRanking({ guildId, start: range.start, end: range.end, channelId: vcChannelId, now, top });
    const msg = buildMessageRanking({ guildId, start: range.start, end: range.end, channelId: msgChannelId, top });

    const embed = new EmbedBuilder()
      .setTitle('📋 集計サマリー')
      .setColor(0x5865f2)
      .setDescription(`**期間:** ${range.label}` + (channel ? `\n**チャンネル:** <#${channel.id}>` : ''))
      .addFields(
        {
          name: `🔊 VCアクティブ時間 (合計 ${formatDuration(vc.totalSec)} / ${vc.participants}人)`,
          value: rankList(vc.items, (v) => formatDuration(v)),
        },
        {
          name: `💬 メッセージ数 (合計 ${msg.total.toLocaleString('ja-JP')}件 / ${msg.posters}人)`,
          value: rankList(msg.items, (v) => `${v.toLocaleString('ja-JP')}件`),
        }
      );

    await interaction.editReply({ embeds: [embed] });
  },
};
