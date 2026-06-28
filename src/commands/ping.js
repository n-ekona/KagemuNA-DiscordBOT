import { SlashCommandBuilder, MessageFlags } from 'discord.js';

export default {
  data: new SlashCommandBuilder().setName('ping').setDescription('ボットの応答と遅延を確認します'),

  async execute(interaction) {
    const ws = Math.round(interaction.client.ws.ping);
    await interaction.reply({
      content: `🏓 Pong! WebSocket遅延: ${ws < 0 ? '計測中' : `${ws}ms`}`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
