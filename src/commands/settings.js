import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { config } from '../../config.js';
import * as db from '../db.js';
import { isValidTimezone } from '../time.js';
import { joinChannelMentions } from '../format.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

export default {
  data: new SlashCommandBuilder()
    .setName('settings')
    .setDescription('集計対象や設定を管理します (要: サーバー管理権限)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) =>
      s
        .setName('track-add')
        .setDescription('メッセージ集計対象チャンネルを追加 (1つでも追加するとホワイトリスト方式に)')
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
        .setName('track-remove')
        .setDescription('メッセージ集計対象チャンネルを削除')
        .addChannelOption((o) =>
          o.setName('channel').setDescription('削除するチャンネル').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s.setName('track-list').setDescription('メッセージ集計対象チャンネルの一覧を表示')
    )
    .addSubcommand((s) =>
      s
        .setName('exclude-bots')
        .setDescription('Botを集計から除外するか設定')
        .addBooleanOption((o) =>
          o.setName('value').setDescription('true=除外する / false=含める').setRequired(true)
        )
    )
    .addSubcommand((s) =>
      s
        .setName('timezone')
        .setDescription('集計に使うタイムゾーンを設定 (例: Asia/Tokyo)')
        .addStringOption((o) =>
          o.setName('value').setDescription('IANA タイムゾーン名').setRequired(true)
        )
    )
    .addSubcommand((s) => s.setName('show').setDescription('現在の設定を表示')),

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
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case 'track-add': {
        const channel = interaction.options.getChannel('channel');
        db.addTrackedChannel(guildId, channel.id);
        await interaction.reply({
          content: `✅ <#${channel.id}> を集計対象に追加しました。\n（対象が1つ以上あると、ホワイトリスト方式＝登録チャンネルのみ集計になります）`,
          ...EPHEMERAL,
        });
        return;
      }
      case 'track-remove': {
        const channel = interaction.options.getChannel('channel');
        const removed = db.removeTrackedChannel(guildId, channel.id);
        await interaction.reply({
          content: removed
            ? `✅ <#${channel.id}> を集計対象から削除しました。`
            : `ℹ️ <#${channel.id}> は集計対象に登録されていません。`,
          ...EPHEMERAL,
        });
        return;
      }
      case 'track-list': {
        const ids = db.listTrackedChannels(guildId);
        const value = ids.length
          ? joinChannelMentions(ids, { joiner: '\n' })
          : '（未設定 — すべてのチャンネルを集計します）';
        const embed = new EmbedBuilder()
          .setTitle('📒 メッセージ集計対象チャンネル')
          .setColor(0x5865f2)
          .setDescription(value);
        await interaction.reply({ embeds: [embed], ...EPHEMERAL });
        return;
      }
      case 'exclude-bots': {
        const value = interaction.options.getBoolean('value');
        db.setGuildExcludeBots(guildId, value);
        await interaction.reply({
          content: `✅ Botの集計を${value ? '除外' : '含める'}に設定しました。（以後の記録に適用されます）`,
          ...EPHEMERAL,
        });
        return;
      }
      case 'timezone': {
        const value = interaction.options.getString('value').trim();
        if (!isValidTimezone(value)) {
          await interaction.reply({
            content: `⚠️ 「${value}」は有効なタイムゾーンではありません。例: \`Asia/Tokyo\``,
            ...EPHEMERAL,
          });
          return;
        }
        db.setGuildTimezone(guildId, value);
        await interaction.reply({ content: `✅ タイムゾーンを \`${value}\` に設定しました。`, ...EPHEMERAL });
        return;
      }
      case 'show': {
        const gconf = db.getGuildConfig(guildId);
        const ids = db.listTrackedChannels(guildId);
        const embed = new EmbedBuilder()
          .setTitle('⚙️ 現在の設定')
          .setColor(0x5865f2)
          .addFields(
            { name: 'タイムゾーン', value: `\`${gconf.timezone}\``, inline: true },
            { name: 'Bot除外', value: gconf.excludeBots ? '除外する' : '含める', inline: true },
            { name: 'AFKチャンネルを計上', value: config.countAfkChannel ? 'する' : 'しない', inline: true },
            {
              name: 'メッセージ集計対象',
              value: ids.length ? joinChannelMentions(ids, { joiner: '\n' }) : 'すべてのチャンネル',
            }
          );
        await interaction.reply({ embeds: [embed], ...EPHEMERAL });
        return;
      }
      default:
        await interaction.reply({ content: '未対応のサブコマンドです。', ...EPHEMERAL });
    }
  },
};
