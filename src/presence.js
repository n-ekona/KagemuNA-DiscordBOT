import { ActivityType } from 'discord.js';
import { logger } from './logger.js';

let timer = null;

function buildState(client) {
  const ping = Math.round(client.ws.ping);
  const pingText = ping >= 0 ? `${ping}ms` : '計測中';
  return `🏓 ${pingText} ・ ©by・nekoNA`;
}

function update(client) {
  try {
    const state = buildState(client);
    client.user.setPresence({
      status: 'online',
      activities: [{ name: state, type: ActivityType.Custom, state }],
    });
  } catch (err) {
    logger.error('Failed to update presence:', err);
  }
}

/** Show "🏓 <ping>ms ・ ©by・nekoNA" as a custom status, refreshed periodically. */
export function startPresence(client, intervalSec = 30) {
  stopPresence();
  const ms = Math.max(15, intervalSec) * 1000; // keep within Discord presence rate limits
  update(client);
  timer = setInterval(() => update(client), ms);
  timer.unref?.();
  logger.info(`Presence updater running every ${ms / 1000}s.`);
}

export function stopPresence() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
