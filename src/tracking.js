import { config } from '../config.js';
import { logger } from './logger.js';
import * as db from './db.js';

export function displayNameFromMember(member, user) {
  return member?.displayName || user?.globalName || user?.username || 'Unknown';
}

function isAfk(guild, channelId) {
  return !config.countAfkChannel && guild.afkChannelId && channelId === guild.afkChannelId;
}

/**
 * React to a voiceStateUpdate. Opens/closes sessions on join / leave / move.
 * (Pure channel changes only — mute/deafen/stream toggles are ignored.)
 */
export function handleVoiceUpdate(oldState, newState) {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const oldCh = oldState.channelId;
  const newCh = newState.channelId;
  if (oldCh === newCh) return; // mute / deafen / video toggle — no channel change

  const member = newState.member || oldState.member;
  const user = member?.user;
  const userId = newState.id || oldState.id;
  if (!userId) return;

  const gconf = db.getGuildConfig(guild.id);
  if (gconf.excludeBots && user?.bot) return;

  const now = Date.now();
  if (user) {
    db.upsertUser({ guildId: guild.id, userId, displayName: displayNameFromMember(member, user), now });
  }

  // End the current session (leave/move) and, for a join/move into a non-AFK
  // channel, start a fresh one — atomically, so a crash can't orphan the state.
  const openChannel = newCh && !isAfk(guild, newCh) ? newCh : null;
  db.recordVoiceTransition({
    guildId: guild.id,
    userId,
    leaveAt: now,
    newChannelId: openChannel,
    openNow: now,
  });
}

/**
 * On startup: close stale sessions left over from the previous run, then re-open
 * sessions for everyone currently sitting in a voice channel. The gap (downtime)
 * is intentionally not counted.
 */
export function reconcileVoiceOnStartup(client) {
  const closed = db.closeAllOpenSessions(); // uses last_seen_at as the leave estimate
  if (closed) logger.info(`Closed ${closed} stale voice session(s) from a previous run.`);

  const now = Date.now();
  let opened = 0;
  for (const guild of client.guilds.cache.values()) {
    const gconf = db.getGuildConfig(guild.id);
    for (const vs of guild.voiceStates.cache.values()) {
      if (!vs.channelId) continue;
      if (!guild.channels.cache.has(vs.channelId)) continue; // skip deleted/unknown channels
      const userId = vs.id;
      if (!userId) continue;
      const user = vs.member?.user;
      if (gconf.excludeBots && user?.bot) continue;
      if (isAfk(guild, vs.channelId)) continue;
      if (user) {
        db.upsertUser({
          guildId: guild.id,
          userId,
          displayName: displayNameFromMember(vs.member, user),
          now,
        });
      }
      db.openVcSession({ guildId: guild.id, channelId: vs.channelId, userId, now });
      opened++;
    }
  }
  if (opened) logger.info(`Resumed tracking ${opened} member(s) currently in voice.`);
}

let heartbeatTimer = null;

export function startHeartbeat() {
  stopHeartbeat();
  // Clamp to a sane range: too small thrashes the SD card, too large widens the crash window.
  const intervalMs = Math.min(3600, Math.max(10, config.heartbeatIntervalSec)) * 1000;
  heartbeatTimer = setInterval(() => {
    try {
      db.heartbeat(Date.now());
    } catch (err) {
      logger.error('Voice heartbeat failed:', err);
    }
  }, intervalMs);
  heartbeatTimer.unref?.();
  logger.info(`Voice heartbeat running every ${config.heartbeatIntervalSec}s.`);
}

export function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
