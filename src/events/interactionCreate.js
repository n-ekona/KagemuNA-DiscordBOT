import { Events, MessageFlags } from 'discord.js';
import { logger } from '../logger.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Received unknown command: ${interaction.commandName}`);
      return;
    }
    try {
      await command.execute(interaction);
    } catch (err) {
      logger.error(`Error while executing /${interaction.commandName}:`, err);
      const content = '⚠️ コマンドの実行中にエラーが発生しました。';
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content });
        } else {
          await interaction.reply({ content, flags: MessageFlags.Ephemeral });
        }
      } catch (replyErr) {
        logger.error('Failed to send error response:', replyErr);
      }
    }
  },
};
