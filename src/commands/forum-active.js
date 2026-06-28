import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { config } from '../../config.js';
import { checkForumAccess } from '../access.js';
import { getForumChannel, getActiveThreads } from '../forum.js';

export default {
  // Registered only to the configured guild (server-scoped).
  guildId: config.forumGuildId,
  data: new SlashCommandBuilder()
    .setName('forum-active')
    .setDescription('議論フォーラムで直近に発言があったスレッドを表示 (モデレーター/管理者)')
    .addIntegerOption((o) =>
      o.setName('days').setDescription('対象期間（日数, 既定14）').setMinValue(1).setMaxValue(90)
    ),

  async execute(interaction) {
    const deny = checkForumAccess(interaction);
    if (deny) {
      await interaction.reply({ content: deny, flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply(); // public result

    const days = interaction.options.getInteger('days') ?? 14;
    const forum = await getForumChannel(interaction.guild);
    if (!forum) {
      await interaction.editReply('議論フォーラムが見つかりません（FORUM_CHANNEL_ID を確認してください）。');
      return;
    }

    const list = await getActiveThreads(forum, days);
    if (!list.length) {
      await interaction.editReply(`直近${days}日間に発言があったスレッドはありませんでした。`);
      return;
    }

    const lines = [];
    for (const { thread, last } of list.slice(0, 25)) {
      const count = thread.totalMessageSent ?? thread.messageCount ?? 0;
      const line = `**[${thread.name}](${thread.url})** ・ 💬${count} ・ <t:${Math.floor(last / 1000)}:R>`;
      if (lines.join('\n').length + line.length + 1 > 3900) break;
      lines.push(line);
    }

    const embed = new EmbedBuilder()
      .setTitle(`🗂️ 議論フォーラム：直近${days}日のアクティブスレッド（${list.length}件）`)
      .setColor(0x9b59b6)
      .setDescription(lines.join('\n'));
    if (list.length > lines.length) {
      embed.setFooter({ text: `上位${lines.length}件を表示` });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};
