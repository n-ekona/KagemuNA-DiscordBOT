import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from '../../config.js';
import * as db from '../db.js';
import { checkForumAccess } from '../access.js';
import { purgeChannel } from '../shiritori.js';

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

function lastLossLine(meta) {
  if (!meta.lastLoserId || !meta.lastLossWord) return null;
  return `前回の敗因: <@${meta.lastLoserId}> が「${meta.lastLossWord}」で${meta.lastLossReason || '終了'}（${meta.lastCount ?? 0}語）`;
}

function buildOpening(meta) {
  const loss = lastLossLine(meta);
  return (
    `🎮 **第${meta.round}回しりとり遊戯、スタート！**\n` +
    (loss ? `${loss}\n` : '') +
    'このチャンネルに言葉を書いてね（ひらがな・カタカナ）。\n' +
    'ルール: 前の言葉の最後の文字から始める / 「ん」で終わると負け / 同じ言葉は使えません。\n' +
    'だれか最初の単語をどうぞ！'
  );
}

async function getShiritoriChannel(interaction) {
  const ch =
    interaction.guild.channels.cache.get(config.shiritoriChannelId) ||
    (await interaction.guild.channels.fetch(config.shiritoriChannelId).catch(() => null));
  if (!ch || ch.type !== ChannelType.GuildText) return null;
  return ch;
}

export default {
  guildId: config.forumGuildId,
  data: new SlashCommandBuilder()
    .setName('shiritori')
    .setDescription('しりとりゲームの管理')
    .addSubcommand((s) =>
      s.setName('start').setDescription('チャンネルを掃除してしりとりを開始（モデレーター/管理者）')
    )
    .addSubcommand((s) =>
      s.setName('reset').setDescription('しりとりの状態だけリセット（メッセージは消さない・モデレーター/管理者）')
    )
    .addSubcommand((s) => s.setName('status').setDescription('今のしりとりの状況を表示')),

  async execute(interaction) {
    if (interaction.guildId !== config.forumGuildId) {
      await interaction.reply({ content: 'このコマンドはこのサーバーでは使用できません。', ...EPHEMERAL });
      return;
    }
    const sub = interaction.options.getSubcommand();

    if (sub === 'status') {
      const state = db.getShiritori(config.shiritoriChannelId);
      const meta = db.getShiritoriMeta(config.shiritoriChannelId);
      const embed = new EmbedBuilder().setTitle(`🎮 第${meta.round}回しりとり遊戯`).setColor(0xe67e22);
      if (!state || !state.lastKana) {
        embed.setDescription(`まだ始まっていません。<#${config.shiritoriChannelId}> で最初の単語をどうぞ！`);
      } else {
        embed.addFields(
          { name: '前の言葉', value: state.lastWord || '—', inline: true },
          { name: '次は', value: `「${state.lastKana}」から`, inline: true },
          { name: 'つながった数', value: `${state.count}`, inline: true }
        );
      }
      const loss = lastLossLine(meta);
      if (loss) embed.addFields({ name: '前回の敗因', value: loss });
      await interaction.reply({ embeds: [embed], ...EPHEMERAL });
      return;
    }

    // start / reset are moderator/admin only
    const deny = checkForumAccess(interaction);
    if (deny) {
      await interaction.reply({ content: deny, ...EPHEMERAL });
      return;
    }

    if (sub === 'reset') {
      db.resetShiritori(config.shiritoriChannelId);
      await interaction.reply({ content: '🔄 しりとりの状態をリセットしました。', ...EPHEMERAL });
      return;
    }

    if (sub === 'start') {
      await interaction.deferReply(EPHEMERAL);
      const channel = await getShiritoriChannel(interaction);
      if (!channel) {
        await interaction.editReply(
          'しりとり用チャンネルが見つかりません（SHIRITORI_CHANNEL_ID、またはBotの「チャンネルを見る」権限を確認）。'
        );
        return;
      }

      // Surface missing bot permissions up front instead of failing silently mid-game.
      const me = interaction.guild.members.me;
      const perms = channel.permissionsFor(me);
      const need = [
        [PermissionFlagsBits.ViewChannel, 'チャンネルを見る'],
        [PermissionFlagsBits.SendMessages, 'メッセージを送信'],
        [PermissionFlagsBits.AddReactions, 'リアクションの追加'],
        [PermissionFlagsBits.ReadMessageHistory, 'メッセージ履歴を読む'],
        [PermissionFlagsBits.ManageMessages, 'メッセージの管理'],
      ];
      const missing = need.filter(([flag]) => !perms?.has(flag)).map(([, label]) => label);
      if (missing.length) {
        await interaction.editReply(
          `⚠️ Botに次の権限が不足しています（<#${channel.id}>）: ${missing.join(' / ')}\n権限を付与してから再実行してください。`
        );
        return;
      }

      let deleted = 0;
      try {
        deleted = await purgeChannel(channel);
      } catch (err) {
        await interaction.editReply(
          `メッセージ削除に失敗しました（Botに「メッセージの管理」権限が必要です）: ${String(err?.message ?? err).slice(0, 150)}`
        );
        return;
      }
      db.resetShiritori(config.shiritoriChannelId);
      const meta = db.getShiritoriMeta(config.shiritoriChannelId);
      await channel.send(buildOpening(meta)).catch(() => {});
      await interaction.editReply(
        `✅ 第${meta.round}回しりとり遊戯を開始しました（${deleted}件削除）。14日より古いメッセージは残る場合があります。`
      );
      return;
    }
  },
};
