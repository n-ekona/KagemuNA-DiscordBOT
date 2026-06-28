import { ChannelType } from 'discord.js';
import { config } from '../config.js';

const DISCORD_EPOCH = 1420070400000n;

/** Epoch ms encoded in a Discord snowflake id (no API call needed). */
export function snowflakeToMs(id) {
  try {
    return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
  } catch {
    return 0;
  }
}

export function threadLastActivityMs(thread) {
  if (thread.lastMessageId) return snowflakeToMs(thread.lastMessageId);
  if (thread.archiveTimestamp) return thread.archiveTimestamp;
  return thread.createdTimestamp ?? 0;
}

/** Resolve the configured discussion forum channel, or null if missing/not a forum. */
export async function getForumChannel(guild) {
  if (!guild) return null;
  const ch =
    guild.channels.cache.get(config.forumChannelId) ||
    (await guild.channels.fetch(config.forumChannelId).catch(() => null));
  if (!ch || ch.type !== ChannelType.GuildForum) return null;
  return ch;
}

/** Forum threads with activity within the last `days`, newest first. */
export async function getActiveThreads(forum, days) {
  const cutoff = Date.now() - days * 86_400_000;
  const byId = new Map();

  const active = await forum.threads.fetchActive().catch(() => null);
  if (active) for (const t of active.threads.values()) byId.set(t.id, t);

  // Archived posts come newest-archive-first. Paginate with `before` until a
  // whole page predates the cutoff (archiveTimestamp >= lastActivity, so older
  // archives can't be in-window) or a safety cap is hit.
  let before;
  for (let page = 0; page < 10; page++) {
    const res = await forum.threads
      .fetchArchived({ type: 'public', limit: 100, before })
      .catch(() => null);
    if (!res || !res.threads.size) break;

    let pageAllOld = true;
    let last;
    for (const t of res.threads.values()) {
      byId.set(t.id, t);
      const archMs = t.archiveTimestamp ?? threadLastActivityMs(t);
      if (archMs >= cutoff) pageAllOld = false;
      last = t;
    }
    if (!res.hasMore || pageAllOld) break;
    before = last;
  }

  return [...byId.values()]
    .map((thread) => ({ thread, last: threadLastActivityMs(thread) }))
    .filter((x) => x.last >= cutoff)
    .sort((a, b) => b.last - a.last);
}

/**
 * Build a transcript (oldest -> newest, "name: content") from a thread's recent
 * messages, capped. `contentChars` lets callers detect a missing MessageContent
 * intent (messages present but every content empty).
 */
export async function gatherThreadText(thread, { messageLimit = 80, maxChars = 6000 } = {}) {
  const fetched = await thread.messages.fetch({ limit: messageLimit }).catch(() => null);
  if (!fetched) return { text: '', count: 0, contentChars: 0 };
  const msgs = [...fetched.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  let text = '';
  let contentChars = 0;
  for (const m of msgs) {
    if (m.author?.bot) continue;
    const content = (m.content || '').trim();
    contentChars += content.length;
    if (!content) continue;
    const name = m.member?.displayName || m.author?.globalName || m.author?.username || '誰か';
    const line = `${name}: ${content}\n`;
    if (text.length + line.length > maxChars) break;
    text += line;
  }
  return { text, count: msgs.length, contentChars };
}
