import * as db from './db.js';
import { enumerateDayBuckets } from './time.js';

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

/**
 * Daily message-count trend over [start, end). Returns one point per local day
 * (chronological, oldest first) plus the period total and day count.
 * `channelIds` (array) or `channelId` (single) optional.
 */
export function buildMessageTrend({ guildId, start, end, zone, channelId, channelIds }) {
  const buckets = enumerateDayBuckets(start, end, zone);
  const points = buckets.map((b) => ({
    label: b.label,
    value: db.messageCountTotal({ guildId, start: b.start, end: b.end, channelId, channelIds }),
  }));
  const total = points.reduce((a, p) => a + p.value, 0);
  return { points, total, days: buckets.length };
}

/**
 * Daily VC active-time trend over [start, end). Values are in seconds, one point
 * per local day (chronological). Open sessions are clipped to `now`.
 */
export function buildVcTrend({ guildId, start, end, zone, channelId, channelIds, now }) {
  const buckets = enumerateDayBuckets(start, end, zone);
  const points = buckets.map((b) => ({
    label: b.label,
    value: db.vcTotalMs({ guildId, start: b.start, end: b.end, channelId, channelIds, now }) / 1000,
  }));
  const total = points.reduce((a, p) => a + p.value, 0);
  return { points, total, days: buckets.length };
}
