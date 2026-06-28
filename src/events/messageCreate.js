import { Events } from 'discord.js';
import { config } from '../../config.js';
import { logger } from '../logger.js';
import * as db from '../db.js';
import { handleShiritoriSafe } from '../shiritori.js';

export default {
  name: Events.MessageCreate,
  execute(message) {
    // Shiritori game runs in its dedicated channel (handles its own errors).
    if (message.guild && message.channelId === config.shiritoriChannelId) {
      handleShiritoriSafe(message);
    }
    try {
      if (!message.guild) return; // ignore DMs
      if (message.webhookId) return; // ignore webhook posts
      if (message.system) return; // ignore system messages (joins, pins, ...)
      const author = message.author;
      if (!author) return;

      const guildId = message.guild.id;
      const gconf = db.getGuildConfig(guildId);
      if (gconf.excludeBots && author.bot) return;
      if (!db.isChannelTracked(guildId, message.channelId)) return;

      db.recordMessage({
        messageId: message.id,
        guildId,
        channelId: message.channelId,
        userId: author.id,
        createdAt: message.createdTimestamp,
      });
      db.upsertUser({
        guildId,
        userId: author.id,
        displayName: message.member?.displayName || author.globalName || author.username,
        now: Date.now(),
      });
    } catch (err) {
      logger.error('messageCreate handling failed:', err);
    }
  },
};
