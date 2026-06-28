import { Events } from 'discord.js';
import { logger } from '../logger.js';
import { handleVoiceUpdate } from '../tracking.js';

export default {
  name: Events.VoiceStateUpdate,
  execute(oldState, newState) {
    try {
      handleVoiceUpdate(oldState, newState);
    } catch (err) {
      logger.error('voiceStateUpdate handling failed:', err);
    }
  },
};
