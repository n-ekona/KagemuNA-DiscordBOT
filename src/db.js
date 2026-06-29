import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from './logger.js';

let db = null;
/** Cache of prepared statements keyed by SQL text (one connection for the process lifetime). */
const stmtCache = new Map();

function prep(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = getDb().prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb() {
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(config.databasePath);
  // WAL is friendlier to SD cards and concurrent reads; NORMAL sync is durable enough here.
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  migrate();
  logger.info(`Database ready at ${config.databasePath}`);
  return db;
}

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vc_sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id     TEXT    NOT NULL,
      channel_id   TEXT    NOT NULL,
      user_id      TEXT    NOT NULL,
      join_at      INTEGER NOT NULL,          -- epoch ms
      leave_at     INTEGER,                   -- epoch ms, NULL while session is open
      last_seen_at INTEGER NOT NULL,          -- heartbeat, epoch ms
      active       INTEGER NOT NULL DEFAULT 1 -- 1 = open, 0 = closed
    );
    CREATE INDEX IF NOT EXISTS idx_vc_guild_time ON vc_sessions(guild_id, join_at);
    CREATE INDEX IF NOT EXISTS idx_vc_active     ON vc_sessions(active);
    -- At most one OPEN session per user per guild (defends against duplicate events).
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vc_one_open ON vc_sessions(guild_id, user_id) WHERE active = 1;

    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,            -- dedups retried/duplicate events
      guild_id   TEXT    NOT NULL,
      channel_id TEXT    NOT NULL,
      user_id    TEXT    NOT NULL,
      created_at INTEGER NOT NULL             -- epoch ms (Discord message timestamp)
    );
    CREATE INDEX IF NOT EXISTS idx_msg_guild_time   ON messages(guild_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_msg_channel_time ON messages(channel_id, created_at);

    CREATE TABLE IF NOT EXISTS users (
      guild_id     TEXT    NOT NULL,
      user_id      TEXT    NOT NULL,
      display_name TEXT    NOT NULL,
      updated_at   INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS tracked_channels (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );

    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id     TEXT PRIMARY KEY,
      exclude_bots INTEGER,
      timezone     TEXT
    );

    -- One configured "event" (named aggregation period) per guild.
    CREATE TABLE IF NOT EXISTS events (
      guild_id   TEXT PRIMARY KEY,
      title      TEXT,
      start_at   INTEGER,   -- epoch ms
      end_at     INTEGER,   -- epoch ms (exclusive)
      updated_at INTEGER
    );

    -- Optional channel whitelist scoping the event aggregation.
    CREATE TABLE IF NOT EXISTS event_channels (
      guild_id   TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      PRIMARY KEY (guild_id, channel_id)
    );

    -- Shiritori game state (one chain per channel) + used-word set.
    CREATE TABLE IF NOT EXISTS shiritori_state (
      channel_id TEXT PRIMARY KEY,
      last_word  TEXT,
      last_kana  TEXT,           -- display string for "next start" (may be "え・れ")
      last_norm  TEXT,           -- normalized previous word, to recompute accepted starts
      count      INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS shiritori_used (
      channel_id TEXT NOT NULL,
      word       TEXT NOT NULL,  -- normalized hiragana
      PRIMARY KEY (channel_id, word)
    );

    -- Persistent game counter + last loss (survives chain resets).
    CREATE TABLE IF NOT EXISTS shiritori_meta (
      channel_id       TEXT PRIMARY KEY,
      round            INTEGER NOT NULL DEFAULT 1,
      last_loser_id    TEXT,
      last_loss_word   TEXT,
      last_loss_reason TEXT,
      last_count       INTEGER,
      updated_at       INTEGER
    );
  `);

  // Add columns introduced after initial release (no-op if they already exist).
  try {
    db.exec('ALTER TABLE shiritori_state ADD COLUMN last_norm TEXT');
  } catch {
    /* column already present */
  }
}

/* ------------------------------------------------------------------ *
 * Voice sessions
 * ------------------------------------------------------------------ */

export function openVcSession({ guildId, channelId, userId, now }) {
  prep(
    `INSERT INTO vc_sessions (guild_id, channel_id, user_id, join_at, leave_at, last_seen_at, active)
     VALUES (@guildId, @channelId, @userId, @now, NULL, @now, 1)`
  ).run({ guildId, channelId, userId, now });
}

export function closeUserOpenSessions({ guildId, userId, leaveAt }) {
  return prep(
    `UPDATE vc_sessions SET leave_at = @leaveAt, last_seen_at = @leaveAt, active = 0
     WHERE active = 1 AND guild_id = @guildId AND user_id = @userId`
  ).run({ guildId, userId, leaveAt }).changes;
}

/**
 * Close every still-open session.
 *  - With `at` (graceful shutdown): set leave_at = at.
 *  - Without `at` (startup after crash): set leave_at = last_seen_at (best estimate of when we lost them).
 */
export function closeAllOpenSessions(at) {
  if (at == null) {
    return prep(
      `UPDATE vc_sessions SET leave_at = last_seen_at, active = 0 WHERE active = 1`
    ).run().changes;
  }
  return prep(
    `UPDATE vc_sessions SET leave_at = @at, last_seen_at = @at, active = 0 WHERE active = 1`
  ).run({ at }).changes;
}

/** Persist a heartbeat on all open sessions so a crash loses at most one interval of time. */
export function heartbeat(now) {
  return prep(`UPDATE vc_sessions SET last_seen_at = @now WHERE active = 1`).run({ now }).changes;
}

/**
 * Atomically end a user's current open session and (optionally) start a new one.
 * Running both writes inside a single transaction prevents an orphaned or
 * duplicate session if the process dies between them.
 */
export function recordVoiceTransition({ guildId, userId, leaveAt, newChannelId, openNow }) {
  getDb().transaction(() => {
    closeUserOpenSessions({ guildId, userId, leaveAt });
    if (newChannelId) openVcSession({ guildId, channelId: newChannelId, userId, now: openNow });
  })();
}

/* ------------------------------------------------------------------ *
 * Messages
 * ------------------------------------------------------------------ */

export function recordMessage({ messageId, guildId, channelId, userId, createdAt }) {
  prep(
    `INSERT OR IGNORE INTO messages (message_id, guild_id, channel_id, user_id, created_at)
     VALUES (@messageId, @guildId, @channelId, @userId, @createdAt)`
  ).run({ messageId, guildId, channelId, userId, createdAt });
}

/* ------------------------------------------------------------------ *
 * User display names (cached snapshots, refreshed on activity)
 * ------------------------------------------------------------------ */

export function upsertUser({ guildId, userId, displayName, now }) {
  prep(
    `INSERT INTO users (guild_id, user_id, display_name, updated_at)
     VALUES (@guildId, @userId, @displayName, @now)
     ON CONFLICT(guild_id, user_id)
     DO UPDATE SET display_name = excluded.display_name, updated_at = excluded.updated_at`
  ).run({ guildId, userId, displayName: displayName || 'Unknown', now });
}

export function getDisplayName({ guildId, userId }) {
  const row = prep(
    `SELECT display_name FROM users WHERE guild_id = @guildId AND user_id = @userId`
  ).get({ guildId, userId });
  return row ? row.display_name : null;
}

/* ------------------------------------------------------------------ *
 * Tracked channels (message-counting whitelist; empty => all channels)
 * ------------------------------------------------------------------ */

export function addTrackedChannel(guildId, channelId) {
  prep(
    `INSERT OR IGNORE INTO tracked_channels (guild_id, channel_id) VALUES (@guildId, @channelId)`
  ).run({ guildId, channelId });
}

export function removeTrackedChannel(guildId, channelId) {
  return prep(
    `DELETE FROM tracked_channels WHERE guild_id = @guildId AND channel_id = @channelId`
  ).run({ guildId, channelId }).changes;
}

export function listTrackedChannels(guildId) {
  return prep(`SELECT channel_id FROM tracked_channels WHERE guild_id = @guildId`)
    .all({ guildId })
    .map((r) => r.channel_id);
}

/** True if this channel should be recorded. If a guild has no whitelist, everything is tracked. */
export function isChannelTracked(guildId, channelId) {
  const { c } = prep(
    `SELECT COUNT(*) AS c FROM tracked_channels WHERE guild_id = @guildId`
  ).get({ guildId });
  if (c === 0) return true;
  return !!prep(
    `SELECT 1 FROM tracked_channels WHERE guild_id = @guildId AND channel_id = @channelId`
  ).get({ guildId, channelId });
}

/* ------------------------------------------------------------------ *
 * Per-guild settings (fall back to global config)
 * ------------------------------------------------------------------ */

export function getGuildConfig(guildId) {
  const row = prep(
    `SELECT exclude_bots, timezone FROM guild_settings WHERE guild_id = @guildId`
  ).get({ guildId });
  return {
    excludeBots: row && row.exclude_bots != null ? !!row.exclude_bots : config.excludeBots,
    timezone: row && row.timezone ? row.timezone : config.timezone,
  };
}

export function setGuildExcludeBots(guildId, value) {
  prep(
    `INSERT INTO guild_settings (guild_id, exclude_bots) VALUES (@guildId, @value)
     ON CONFLICT(guild_id) DO UPDATE SET exclude_bots = excluded.exclude_bots`
  ).run({ guildId, value: value ? 1 : 0 });
}

export function setGuildTimezone(guildId, tz) {
  prep(
    `INSERT INTO guild_settings (guild_id, timezone) VALUES (@guildId, @tz)
     ON CONFLICT(guild_id) DO UPDATE SET timezone = excluded.timezone`
  ).run({ guildId, tz });
}

/* ------------------------------------------------------------------ *
 * Aggregation queries
 * ------------------------------------------------------------------ */

/**
 * Append an optional `channel_id IN (...)` filter, mutating `params`. Accepts a
 * single channelId or an array channelIds (array wins). Uses named params so it
 * composes with the rest of the named-param queries.
 */
function appendChannelFilter(sql, params, { channelId, channelIds }) {
  const ids = channelIds && channelIds.length ? channelIds : channelId ? [channelId] : null;
  if (!ids) return sql;
  const placeholders = ids.map((_, i) => `@c${i}`).join(', ');
  ids.forEach((id, i) => {
    params[`c${i}`] = id;
  });
  return `${sql} AND channel_id IN (${placeholders})`;
}

/** Message counts per user within [start, end). Optional channel filter. Sorted desc. */
export function messageCountsByUser({ guildId, start, end, channelId, channelIds }) {
  let sql = `SELECT user_id, COUNT(*) AS count FROM messages
             WHERE guild_id = @guildId AND created_at >= @start AND created_at < @end`;
  const params = { guildId, start, end };
  sql = appendChannelFilter(sql, params, { channelId, channelIds });
  sql += ` GROUP BY user_id ORDER BY count DESC`;
  return prep(sql).all(params);
}

/** Total message count within [start, end). Optional channel filter. Used for per-day trends. */
export function messageCountTotal({ guildId, start, end, channelId, channelIds }) {
  let sql = `SELECT COUNT(*) AS c FROM messages
             WHERE guild_id = @guildId AND created_at >= @start AND created_at < @end`;
  const params = { guildId, start, end };
  sql = appendChannelFilter(sql, params, { channelId, channelIds });
  return prep(sql).get(params).c;
}

/**
 * Total VC active milliseconds across all users, clipped to [start, end). Open
 * sessions are treated as ending "now". Optional channel filter. Used for trends.
 */
export function vcTotalMs({ guildId, start, end, channelId, channelIds, now }) {
  let sql = `
    SELECT COALESCE(SUM( MIN(COALESCE(leave_at, @now), @end) - MAX(join_at, @start) ), 0) AS ms
    FROM vc_sessions
    WHERE guild_id = @guildId
      AND join_at < @end
      AND COALESCE(leave_at, @now) > @start`;
  const params = { guildId, start, end, now };
  sql = appendChannelFilter(sql, params, { channelId, channelIds });
  return prep(sql).get(params).ms;
}

/**
 * Voice active milliseconds per user, clipped to [start, end). Open sessions are
 * treated as ending "now". Optional channel filter. Returns rows {user_id, ms} desc.
 */
export function vcDurationsByUser({ guildId, start, end, channelId, channelIds, now }) {
  let sql = `
    SELECT user_id,
           SUM( MIN(COALESCE(leave_at, @now), @end) - MAX(join_at, @start) ) AS ms
    FROM vc_sessions
    WHERE guild_id = @guildId
      AND join_at < @end
      AND COALESCE(leave_at, @now) > @start`;
  const params = { guildId, start, end, now };
  sql = appendChannelFilter(sql, params, { channelId, channelIds });
  sql += ` GROUP BY user_id HAVING ms > 0 ORDER BY ms DESC`;
  return prep(sql).all(params);
}

/* ------------------------------------------------------------------ *
 * Event (single configured aggregation period per guild)
 * ------------------------------------------------------------------ */

/** Returns { title, startAt, endAt } or null if no period has been set. */
export function getEvent(guildId) {
  const row = prep(
    `SELECT title, start_at, end_at FROM events WHERE guild_id = @guildId`
  ).get({ guildId });
  if (!row || row.start_at == null || row.end_at == null) return null;
  return { title: row.title || null, startAt: row.start_at, endAt: row.end_at };
}

export function setEventPeriod({ guildId, title, startAt, endAt, now }) {
  prep(
    `INSERT INTO events (guild_id, title, start_at, end_at, updated_at)
     VALUES (@guildId, @title, @startAt, @endAt, @now)
     ON CONFLICT(guild_id) DO UPDATE SET
       title = excluded.title, start_at = excluded.start_at,
       end_at = excluded.end_at, updated_at = excluded.updated_at`
  ).run({ guildId, title: title || null, startAt, endAt, now });
}

export function addEventChannel(guildId, channelId) {
  prep(
    `INSERT OR IGNORE INTO event_channels (guild_id, channel_id) VALUES (@guildId, @channelId)`
  ).run({ guildId, channelId });
}

export function removeEventChannel(guildId, channelId) {
  return prep(
    `DELETE FROM event_channels WHERE guild_id = @guildId AND channel_id = @channelId`
  ).run({ guildId, channelId }).changes;
}

export function listEventChannels(guildId) {
  return prep(`SELECT channel_id FROM event_channels WHERE guild_id = @guildId`)
    .all({ guildId })
    .map((r) => r.channel_id);
}

export function resetEvent(guildId) {
  getDb().transaction(() => {
    prep(`DELETE FROM events WHERE guild_id = @guildId`).run({ guildId });
    prep(`DELETE FROM event_channels WHERE guild_id = @guildId`).run({ guildId });
  })();
}

/* ------------------------------------------------------------------ *
 * Shiritori game
 * ------------------------------------------------------------------ */

export function getShiritori(channelId) {
  const row = prep(
    `SELECT last_word, last_kana, last_norm, count FROM shiritori_state WHERE channel_id = @channelId`
  ).get({ channelId });
  if (!row) return null;
  return { lastWord: row.last_word, lastKana: row.last_kana, lastNorm: row.last_norm, count: row.count };
}

export function setShiritori({ channelId, lastWord, lastKana, lastNorm = null, count, now }) {
  prep(
    `INSERT INTO shiritori_state (channel_id, last_word, last_kana, last_norm, count, updated_at)
     VALUES (@channelId, @lastWord, @lastKana, @lastNorm, @count, @now)
     ON CONFLICT(channel_id) DO UPDATE SET
       last_word = excluded.last_word, last_kana = excluded.last_kana,
       last_norm = excluded.last_norm, count = excluded.count, updated_at = excluded.updated_at`
  ).run({ channelId, lastWord, lastKana, lastNorm, count, now });
}

export function isShiritoriUsed(channelId, word) {
  return !!prep(
    `SELECT 1 FROM shiritori_used WHERE channel_id = @channelId AND word = @word`
  ).get({ channelId, word });
}

export function addShiritoriUsed(channelId, word) {
  prep(
    `INSERT OR IGNORE INTO shiritori_used (channel_id, word) VALUES (@channelId, @word)`
  ).run({ channelId, word });
}

export function resetShiritori(channelId) {
  getDb().transaction(() => {
    prep(`DELETE FROM shiritori_state WHERE channel_id = @channelId`).run({ channelId });
    prep(`DELETE FROM shiritori_used WHERE channel_id = @channelId`).run({ channelId });
  })();
}

/** Atomically record a valid move: mark the word used and advance the chain state. */
export function recordShiritoriMove({ channelId, word, normalized, lastKana, count, now }) {
  getDb().transaction(() => {
    addShiritoriUsed(channelId, normalized);
    setShiritori({ channelId, lastWord: word, lastKana, lastNorm: normalized, count, now });
  })();
}

/** Persistent game counter + last loss (defaults to round 1, no prior loss). */
export function getShiritoriMeta(channelId) {
  const row = prep(
    `SELECT round, last_loser_id, last_loss_word, last_loss_reason, last_count
     FROM shiritori_meta WHERE channel_id = @channelId`
  ).get({ channelId });
  if (!row) return { round: 1, lastLoserId: null, lastLossWord: null, lastLossReason: null, lastCount: 0 };
  return {
    round: row.round,
    lastLoserId: row.last_loser_id,
    lastLossWord: row.last_loss_word,
    lastLossReason: row.last_loss_reason,
    lastCount: row.last_count,
  };
}

/**
 * End the current round: store who lost / how, advance the round counter to
 * `round`, and clear the chain board — all atomically.
 */
export function endShiritoriRound({ channelId, round, loserId, word, reason, count, now }) {
  getDb().transaction(() => {
    prep(
      `INSERT INTO shiritori_meta (channel_id, round, last_loser_id, last_loss_word, last_loss_reason, last_count, updated_at)
       VALUES (@channelId, @round, @loserId, @word, @reason, @count, @now)
       ON CONFLICT(channel_id) DO UPDATE SET
         round = excluded.round, last_loser_id = excluded.last_loser_id,
         last_loss_word = excluded.last_loss_word, last_loss_reason = excluded.last_loss_reason,
         last_count = excluded.last_count, updated_at = excluded.updated_at`
    ).run({ channelId, round, loserId, word, reason, count, now });
    prep(`DELETE FROM shiritori_state WHERE channel_id = @channelId`).run({ channelId });
    prep(`DELETE FROM shiritori_used WHERE channel_id = @channelId`).run({ channelId });
  })();
}

export function closeDb() {
  if (db) {
    stmtCache.clear();
    db.close();
    db = null;
  }
}
