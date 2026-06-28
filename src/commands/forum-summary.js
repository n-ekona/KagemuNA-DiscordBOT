import { SlashCommandBuilder, EmbedBuilder, MessageFlags, ChannelType } from 'discord.js';
import { config } from '../../config.js';
import { checkForumAccess } from '../access.js';
import { getForumChannel, getActiveThreads, gatherThreadText } from '../forum.js';
import { isAiConfigured, summarize } from '../ai.js';
import { clampMarkdownHeadings } from '../format.js';

export default {
  guildId: config.forumGuildId,
  data: new SlashCommandBuilder()
    .setName('forum-summary')
    .setDescription('議論フォーラムの内容をAIで要約 (モデレーター/管理者)')
    .addChannelOption((o) =>
      o
        .setName('thread')
        .setDescription('要約するスレッド（未指定なら直近のまとめ）')
        .addChannelTypes(ChannelType.PublicThread, ChannelType.PrivateThread)
    )
    .addIntegerOption((o) =>
      o
        .setName('days')
        .setDescription('まとめ対象の期間（日数, 既定14。thread指定時は無視）')
        .setMinValue(1)
        .setMaxValue(90)
    ),

  async execute(interaction) {
    const deny = checkForumAccess(interaction);
    if (deny) {
      await interaction.reply({ content: deny, flags: MessageFlags.Ephemeral });
      return;
    }
    if (!isAiConfigured()) {
      await interaction.reply({
        content:
          '⚠️ AI要約は未設定です。`.env` に `GEMINI_API_KEY` を設定し、Discord Developer Portal で **Message Content Intent** を有効化してから再起動してください。',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply(); // public result

    const forum = await getForumChannel(interaction.guild);
    if (!forum) {
      await interaction.editReply('議論フォーラムが見つかりません（FORUM_CHANNEL_ID を確認してください）。');
      return;
    }

    const threadOpt = interaction.options.getChannel('thread');
    const days = interaction.options.getInteger('days') ?? 14;

    let transcript = '';
    let title = '';
    let contentChars = 0;
    let totalMsgs = 0;
    let usedThreads = 0;

    if (threadOpt) {
      if (threadOpt.parentId !== forum.id) {
        await interaction.editReply('議論フォーラム内のスレッドを指定してください。');
        return;
      }
      // Single thread: fetch deeply (up to 100 msgs / 12KB) for detail.
      const g = await gatherThreadText(threadOpt, { messageLimit: 100, maxChars: 12_000 });
      transcript = `# ${threadOpt.name}\n${g.text}`;
      contentChars = g.contentChars;
      totalMsgs = g.count;
      usedThreads = g.text ? 1 : 0;
      title = `🧵 スレッド要約：${threadOpt.name}`;
    } else {
      const list = await getActiveThreads(forum, days);
      if (!list.length) {
        await interaction.editReply(`直近${days}日間に発言があったスレッドはありませんでした。`);
        return;
      }
      // Multi-thread digest: fetch shallowly per thread (40 msgs / 2.5KB) for breadth,
      // total capped ~13KB. Check the PROJECTED size before adding a part.
      const parts = [];
      for (const { thread } of list.slice(0, 6)) {
        const g = await gatherThreadText(thread, { messageLimit: 40, maxChars: 2_500 });
        contentChars += g.contentChars;
        totalMsgs += g.count;
        if (!g.text) continue;
        const part = `# ${thread.name}\n${g.text}`;
        const projected = parts.length ? parts.join('\n\n').length + 2 + part.length : part.length;
        if (projected > 13_000 && parts.length) break;
        parts.push(part);
        usedThreads++;
      }
      transcript = parts.join('\n\n');
      title = `🧵 議論フォーラム要約：直近${days}日（${usedThreads}スレッド）`;
    }

    if (!transcript.trim()) {
      // Messages fetched but no readable text -> likely the MessageContent intent
      // is off (could also be attachment-only posts). No messages at all -> empty.
      const hint =
        totalMsgs > 0
          ? '\n（メッセージ本文を取得できませんでした。Developer Portal の **Message Content Intent** が有効か、または本文の無い投稿のみの可能性があります）'
          : '';
      await interaction.editReply(`要約できる発言が見つかりませんでした。${hint}`);
      return;
    }

    let summary;
    try {
      summary = await summarize(transcript, {
        instruction:
          '次はDiscordの議論フォーラムの書き込みです。日本語で、要点を箇条書き中心に簡潔に要約してください。' +
          '議論のテーマ・主な意見・結論や未解決の論点が分かるようにまとめてください。' +
          '見出しはDiscord対応の ### まで（#### 以降は使わない）。小見出しは太字(**…**)や箇条書きで表現してください。',
        maxOutputTokens: usedThreads > 1 ? 1500 : 1024,
      });
    } catch (err) {
      await interaction.editReply(`⚠️ AI要約に失敗しました: ${String(err?.message ?? err).slice(0, 300)}`);
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(title.slice(0, 256))
      .setColor(0x1abc9c)
      .setDescription(clampMarkdownHeadings(summary).slice(0, 4096))
      .setFooter({ text: `AI: Gemini (${config.geminiModel}) ・ ${usedThreads}スレッド・本文${contentChars}字` });

    await interaction.editReply({ embeds: [embed] });
  },
};
