import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  /** Absolute path to the project root (this file's directory). */
  root: ROOT,

  // --- Discord ---
  token: process.env.DISCORD_TOKEN ?? '',
  clientId: process.env.CLIENT_ID ?? '',
  /** Optional: register slash commands to a single guild (instant). Empty = global (up to ~1h). */
  guildId: process.env.GUILD_ID ?? '',

  // --- Aggregation / display ---
  timezone: process.env.TIMEZONE ?? 'Asia/Tokyo',
  locale: process.env.LOCALE ?? 'ja-JP',
  defaultLookbackDays: int(process.env.DEFAULT_LOOKBACK_DAYS, 7),
  maxTopUsers: int(process.env.MAX_TOP_USERS, 30),

  // --- Tracking behaviour ---
  /** Default for new guilds; can be overridden per-guild via /settings exclude-bots. */
  excludeBots: bool(process.env.EXCLUDE_BOTS, true),
  /** Count time spent in the guild's AFK voice channel as active VC time. */
  countAfkChannel: bool(process.env.COUNT_AFK_CHANNEL, false),
  /** How often (seconds) to persist a heartbeat for open voice sessions, bounding data loss on crash. */
  heartbeatIntervalSec: int(process.env.HEARTBEAT_INTERVAL_SEC, 30),

  // --- Storage / assets ---
  databasePath: process.env.DATABASE_PATH || path.join(ROOT, 'data', 'nekonabot.db'),
  /** Optional explicit path to a CJK-capable TTF/OTF/TTC font for chart rendering. */
  fontPath: process.env.FONT_PATH ?? '',

  // --- Forum AI summary feature (server-scoped, moderator/admin only) ---
  /** Google Gemini API key. When set, MessageContent intent is requested (enable it in the Dev Portal too). */
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  /** Guild where the forum commands are allowed/registered. */
  forumGuildId: process.env.FORUM_GUILD_ID || '1206513612043325440',
  /** The discussion forum channel (GuildForum) to read. */
  forumChannelId: process.env.FORUM_CHANNEL_ID || '1505504945586049054',
  /** Roles allowed to use the forum commands (besides server Administrators). */
  modRoleIds: (process.env.MOD_ROLE_IDS || '1206515877499899924,1206515737339101205')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  // --- Shiritori game ---
  /** Channel where the shiritori game runs (free-play: each message is a turn). */
  shiritoriChannelId: process.env.SHIRITORI_CHANNEL_ID || '1483292706414526524',

  // --- Command execution log ---
  /** Channel that receives a real-time embed for every slash-command execution. Empty = disabled. */
  logChannelId: process.env.LOG_CHANNEL_ID || '1521209178100596939',
  /** Informational: the guild the log channel lives in (BotTestServer for nekoNA Circle). */
  logGuildId: process.env.LOG_GUILD_ID || '1510242400709378108',
};

/** Throw a helpful error if required configuration is missing. */
export function assertConfig() {
  const missing = [];
  if (!config.token) missing.push('DISCORD_TOKEN');
  if (!config.clientId) missing.push('CLIENT_ID');
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.'
    );
  }
}
