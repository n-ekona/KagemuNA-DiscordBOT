import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';

export default {
  data: new SlashCommandBuilder().setName('help').setDescription('nekonabot の使い方を表示します'),

  async execute(interaction) {
    const embed = new EmbedBuilder()
      .setTitle('🐈 nekonabot の使い方')
      .setColor(0x5865f2)
      .setDescription(
        'VCのアクティブ時間と、チャンネルごとのメッセージ数を記録し、期間を指定して帯グラフで集計します。'
      )
      .addFields(
        {
          name: '👥 みんなが使えるコマンド',
          value:
            '**/graph** — 期間を指定して集計を帯グラフ（画像）で表示\n' +
            '　`metric`(VC/メッセージ/両方) `period`(プリセット) `from` `to` `channel` `top`\n' +
            '　例: `/graph period:直近7日` / `/graph from:2026-06-01 to:2026-06-27 channel:#general`\n' +
            '**/event** — 開催中イベント期間の集計を帯グラフで表示（管理者が期間を設定）\n' +
            '**/help** — この使い方 ・ **/ping** — 応答確認',
        },
        {
          name: '🔧 管理者専用コマンド（サーバー管理権限）',
          value:
            '**/eventset** — イベント設定: `period`(期間) `channel-add`/`channel-remove`(対象ch) `show` `reset`\n' +
            '**/settings** — 記録設定: `track-add`/`track-remove`/`track-list`(対象ch) `exclude-bots` `timezone` `show`\n' +
            '**/stats** — 集計をテキストで表示',
        },
        {
          name: '🗂️ 議論フォーラム（対象サーバー・モデレーター/管理者のみ）',
          value:
            '**/forum-active** — 直近に発言があったスレッド一覧（`days` で期間指定, 既定14）\n' +
            '**/forum-summary** — フォーラム内容をAIで要約（`thread` でスレッド指定可。未指定は直近のまとめ）',
        },
        {
          name: '🎮 しりとり（対象サーバー）',
          value:
            '専用チャンネルに言葉を書くとBotが自動判定（前の最後の文字から / 「ん」で負け / 重複禁止）。\n' +
            '**/shiritori start** 掃除して開始 ・ **/shiritori reset** 状態リセット（管理者）・ **/shiritori status** 状況確認',
        },
        {
          name: '📌 集計のしくみ',
          value:
            '・ボットは**起動中のみ**、VCの入退室とメッセージ投稿（**本文は保存せず件数のみ**）を記録します。\n' +
            '・期間は開始日の00:00から終了日の23:59まで（タイムゾーン基準）。\n' +
            '・対象チャンネル未設定時は全チャンネルを集計します。',
        }
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
