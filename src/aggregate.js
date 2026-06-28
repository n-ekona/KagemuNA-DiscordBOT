import * as db from './db.js';

function nameFor(guildId, userId) {
  return db.getDisplayName({ guildId, userId }) || `ID:${userId}`;
}

/** VC ranking. Values are in seconds. `channelIds` (array) or `channelId` (single) optional. */
export function buildVcRanking({ guildId, start, end, channelId, channelIds, now, top }) {
  const rows = db.vcDurationsByUser({ guildId, start, end, channelId, channelIds, now });
  const items = rows.slice(0, top).map((r) => ({
    label: nameFor(guildId, r.user_id),
    value: r.ms / 1000,
    userId: r.user_id,
  }));
  const totalSec = rows.reduce((a, r) => a + r.ms, 0) / 1000;
  return { items, totalSec, participants: rows.length };
}

/** Message-count ranking. `channelIds` (array) or `channelId` (single) optional. */
export function buildMessageRanking({ guildId, start, end, channelId, channelIds, top }) {
  const rows = db.messageCountsByUser({ guildId, start, end, channelId, channelIds });
  const items = rows.slice(0, top).map((r) => ({
    label: nameFor(guildId, r.user_id),
    value: r.count,
    userId: r.user_id,
  }));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return { items, total, posters: rows.length };
}
