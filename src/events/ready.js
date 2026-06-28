import { Events } from 'discord.js';
import { logger } from '../logger.js';
import { reconcileVoiceOnStartup, startHeartbeat } from '../tracking.js';
import { startPresence } from '../presence.js';

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    logger.info(`Logged in as ${client.user.tag} (id: ${client.user.id}).`);
    logger.info(`Serving ${client.guilds.cache.size} guild(s).`);
    try {
      reconcileVoiceOnStartup(client);
    } catch (err) {
      logger.error('Voice reconciliation on startup failed:', err);
    }
    startHeartbeat();
    startPresence(client);
  },
};
