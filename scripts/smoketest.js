/**
 * Offline smoke test — exercises the database, aggregation queries, time helpers
 * and chart rendering without needing a Discord token or network access.
 *
 *   npm run smoketest
 *
 * Exits non-zero on the first failed assertion.
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}`);
    failures++;
  }
}

// Use an isolated temp DB so we never touch real data. Must be set before importing config/db.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nekonabot-smoke-'));
process.env.DATABASE_PATH = path.join(tmpDir, 'smoketest.db');

const { initDb, closeDb, ...db } = await import('../src/db.js');
const { resolveRange, formatDuration, enumerateDayBuckets } = await import('../src/time.js');
const { buildVcRanking, buildMessageRanking, buildMessageTrend, buildVcTrend } = await import('../src/aggregate.js');
const { renderBarChart, renderTrendChart } = await import('../src/chart.js');

const GUILD = 'g1';
const TEXT_CH = 'c-text';
const VOICE_CH = 'c-voice';
const HOUR = 3600 * 1000;

console.log('\n1) Database + tracking');
initDb();
const now = Date.now();

// Users
db.upsertUser({ guildId: GUILD, userId: 'u1', displayName: 'あけみ', now });
db.upsertUser({ guildId: GUILD, userId: 'u2', displayName: 'Bob🐈', now });
db.upsertUser({ guildId: GUILD, userId: 'u3', displayName: 'ながいなまえのユーザーさんテスト', now });
db.upsertUser({ guildId: GUILD, userId: 'u4', displayName: 'むかしのひと', now });

// VC sessions (all within the last 7 days)
// u1: a clean 2h session ending 1h ago
db.openVcSession({ guildId: GUILD, channelId: VOICE_CH, userId: 'u1', now: now - 3 * HOUR });
db.closeUserOpenSessions({ guildId: GUILD, userId: 'u1', leaveAt: now - 1 * HOUR });
// u2: an OPEN session started 30 min ago (counts up to "now")
db.openVcSession({ guildId: GUILD, channelId: VOICE_CH, userId: 'u2', now: now - 0.5 * HOUR });
// u3: started 10 days ago, ended 2 days ago -> overlaps the last-7-days window by 5 days (tests clipping)
db.openVcSession({ guildId: GUILD, channelId: VOICE_CH, userId: 'u3', now: now - 10 * 24 * HOUR });
db.closeUserOpenSessions({ guildId: GUILD, userId: 'u3', leaveAt: now - 2 * 24 * HOUR });
// u4: started 20 days ago, ended 15 days ago -> fully outside the window (tests exclusion)
db.openVcSession({ guildId: GUILD, channelId: VOICE_CH, userId: 'u4', now: now - 20 * 24 * HOUR });
db.closeUserOpenSessions({ guildId: GUILD, userId: 'u4', leaveAt: now - 15 * 24 * HOUR });

// Messages
for (let i = 0; i < 12; i++) {
  db.recordMessage({ messageId: `m-a${i}`, guildId: GUILD, channelId: TEXT_CH, userId: 'u1', createdAt: now - i * HOUR });
}
for (let i = 0; i < 5; i++) {
  db.recordMessage({ messageId: `m-b${i}`, guildId: GUILD, channelId: TEXT_CH, userId: 'u2', createdAt: now - i * HOUR });
}
db.recordMessage({ messageId: 'm-dup', guildId: GUILD, channelId: TEXT_CH, userId: 'u1', createdAt: now });
db.recordMessage({ messageId: 'm-dup', guildId: GUILD, channelId: TEXT_CH, userId: 'u1', createdAt: now }); // dedup

check('display name stored', db.getDisplayName({ guildId: GUILD, userId: 'u1' }) === 'あけみ');
check('duplicate message ignored (u1 has 13 not 14)', db.messageCountsByUser({ guildId: GUILD, start: 0, end: now + HOUR }).find((r) => r.user_id === 'u1').count === 13);

console.log('\n2) Time helpers');
const range = resolveRange({ period: '7d', timezone: 'Asia/Tokyo' });
// '7d' starts at midnight (JST = UTC+9, so local midnight is 15:00 UTC) 7 days ago, up to now.
check('7d range starts at JST midnight', range.start % (24 * HOUR) === 15 * HOUR);
const widthDays = (range.end - range.start) / (24 * HOUR);
check('7d range spans 7 to 8 days (day-aligned start)', widthDays >= 7 && widthDays <= 8);
check('formatDuration(7320s) = "2時間02分"', formatDuration(7320) === '2時間02分');
let threw = false;
try {
  resolveRange({ from: 'not-a-date', timezone: 'Asia/Tokyo' });
} catch {
  threw = true;
}
check('invalid date throws', threw);

console.log('\n3) Aggregation');
const vc = buildVcRanking({ guildId: GUILD, start: range.start, end: range.end, now, top: 10 });
const u1vc = vc.items.find((it) => it.label === 'あけみ');
const u2vc = vc.items.find((it) => it.label === 'Bob🐈');
check('u1 VC ≈ 2h', u1vc && Math.abs(u1vc.value - 2 * 3600) < 5);
check('u2 (open session) VC ≈ 0.5h', u2vc && Math.abs(u2vc.value - 0.5 * 3600) < 60);
const u3vc = vc.items.find((it) => it.label.startsWith('ながい'));
// Overlap of [now-10d, now-2d] with [midnight(now-7d), now] = 5 days + (time since midnight) -> 5..6 days.
check(
  'u3 session clipped to in-range portion (5–6 days)',
  u3vc && u3vc.value >= 5 * 24 * 3600 - 5 && u3vc.value < 6 * 24 * 3600 + 5
);
check('u4 fully out-of-range session excluded', !vc.items.find((it) => it.label === 'むかしのひと'));

const msg = buildMessageRanking({ guildId: GUILD, start: range.start, end: range.end, top: 10 });
check('message ranking sorted desc (u1 first)', msg.items[0]?.label === 'あけみ');
const msgVoiceOnly = buildMessageRanking({ guildId: GUILD, start: range.start, end: range.end, channelId: VOICE_CH, top: 10 });
check('channel filter on messages works (voice ch has none)', msgVoiceOnly.items.length === 0);

console.log('\n4) Chart rendering');
const vcPng = renderBarChart({
  title: 'VCアクティブ時間 ランキング',
  subtitle: range.label,
  items: vc.items,
  accent: '#3ba55d',
  formatValue: (v) => formatDuration(v),
  footer: 'smoketest',
});
const msgPng = renderBarChart({
  title: 'メッセージ数 ランキング',
  subtitle: range.label,
  items: msg.items,
  accent: '#5865f2',
  formatValue: (v) => `${v.toLocaleString('ja-JP')} 件`,
  footer: 'smoketest',
});
const pngMagic = (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
check('VC chart is a non-empty PNG', Buffer.isBuffer(vcPng) && pngMagic(vcPng));
check('message chart is a non-empty PNG', Buffer.isBuffer(msgPng) && pngMagic(msgPng));

const outVc = path.join(tmpDir, 'vc.png');
const outMsg = path.join(tmpDir, 'messages.png');
fs.writeFileSync(outVc, vcPng);
fs.writeFileSync(outMsg, msgPng);
console.log(`  → wrote sample charts:\n     ${outVc}\n     ${outMsg}`);

console.log('\n4c) Daily trend (推移)');
// u1 posted m-a{0..11} at now-i*HOUR plus the dedup'd m-dup at `now`: 13 messages
// over the past ~12h, all within the 7d window -> trend total must equal 18 (all users).
const buckets = enumerateDayBuckets(range.start, range.end, 'Asia/Tokyo');
check('enumerateDayBuckets yields 7–8 day buckets for 7d', buckets.length >= 7 && buckets.length <= 8);
check('day buckets are chronological & clipped to window', buckets[0].start === range.start && buckets[buckets.length - 1].end === range.end);
const msgTrend = buildMessageTrend({ guildId: GUILD, start: range.start, end: range.end, zone: 'Asia/Tokyo' });
check('message trend total matches ranking total (18)', msgTrend.total === 18);
check('message trend has one point per day', msgTrend.points.length === buckets.length);
const msgTrendCh = buildMessageTrend({ guildId: GUILD, start: range.start, end: range.end, zone: 'Asia/Tokyo', channelId: VOICE_CH });
check('message trend channel filter (voice ch has none)', msgTrendCh.total === 0);
const vcTrend = buildVcTrend({ guildId: GUILD, start: range.start, end: range.end, zone: 'Asia/Tokyo', now });
check('vc trend total ≈ ranking total seconds', Math.abs(vcTrend.total - vc.totalSec) < 5);
const trendPng = renderTrendChart({
  title: 'チャット数の推移',
  subtitle: range.label,
  points: msgTrend.points,
  accent: '#5865f2',
  formatValue: (v) => `${Math.round(v)}件`,
  footer: 'smoketest',
});
check('trend chart is a non-empty PNG', Buffer.isBuffer(trendPng) && pngMagic(trendPng));
const outTrend = path.join(tmpDir, 'trend.png');
fs.writeFileSync(outTrend, trendPng);
console.log(`     ${outTrend}`);

console.log('\n4b) Atomic voice transition (recordVoiceTransition)');
const openCount = (uid) =>
  db.getDb().prepare('SELECT COUNT(*) AS c FROM vc_sessions WHERE guild_id=? AND user_id=? AND active=1').get(GUILD, uid).c;
db.recordVoiceTransition({ guildId: GUILD, userId: 'u1', leaveAt: now, newChannelId: VOICE_CH, openNow: now });
db.recordVoiceTransition({ guildId: GUILD, userId: 'u1', leaveAt: now, newChannelId: 'c-voice2', openNow: now });
check('transition keeps exactly 1 open session per user (unique index)', openCount('u1') === 1);
db.recordVoiceTransition({ guildId: GUILD, userId: 'u1', leaveAt: now, newChannelId: null, openNow: now });
check('transition with null channel = leave (0 open)', openCount('u1') === 0);

console.log('\n5) Settings & tracked channels');
db.setGuildTimezone(GUILD, 'America/New_York');
db.setGuildExcludeBots(GUILD, false);
const gc = db.getGuildConfig(GUILD);
check('guild timezone persisted', gc.timezone === 'America/New_York');
check('guild excludeBots persisted (false)', gc.excludeBots === false);

check('no whitelist => every channel tracked', db.isChannelTracked(GUILD, TEXT_CH) === true);
db.addTrackedChannel(GUILD, TEXT_CH);
check('whitelist: listed channel tracked', db.isChannelTracked(GUILD, TEXT_CH) === true);
check('whitelist: unlisted channel excluded', db.isChannelTracked(GUILD, 'other-ch') === false);
check('listTrackedChannels returns the added one', db.listTrackedChannels(GUILD).includes(TEXT_CH));
db.removeTrackedChannel(GUILD, TEXT_CH);
check('after remove => all channels tracked again', db.isChannelTracked(GUILD, 'other-ch') === true);

console.log('\n6) Heartbeat & graceful-shutdown close');
db.heartbeat(now); // must not throw; bumps last_seen_at on open sessions
const closedCount = db.closeAllOpenSessions(now); // only u2 is still open here
check('closeAllOpenSessions(now) closes the 1 open session', closedCount === 1);

console.log('\n7) Event configuration & channel filtering');
check('no event configured by default', db.getEvent(GUILD) === null);
db.setEventPeriod({ guildId: GUILD, title: '夏イベント', startAt: range.start, endAt: range.end, now });
const ev = db.getEvent(GUILD);
check('event period persisted', !!ev && ev.title === '夏イベント' && ev.startAt === range.start && ev.endAt === range.end);
db.addEventChannel(GUILD, TEXT_CH);
db.addEventChannel(GUILD, VOICE_CH);
check('event channels listed (2)', db.listEventChannels(GUILD).length === 2);
const evMsgText = buildMessageRanking({ guildId: GUILD, start: range.start, end: range.end, channelIds: [TEXT_CH], top: 10 });
check('channelIds filter: all 18 messages are in TEXT_CH', evMsgText.total === 18);
const evMsgVoice = buildMessageRanking({ guildId: GUILD, start: range.start, end: range.end, channelIds: [VOICE_CH], top: 10 });
check('channelIds filter: 0 messages in VOICE_CH', evMsgVoice.total === 0);
const evVcNone = buildVcRanking({ guildId: GUILD, start: range.start, end: range.end, channelIds: ['nope'], now, top: 10 });
check('channelIds filter: 0 VC in unknown channel', evVcNone.items.length === 0);
db.removeEventChannel(GUILD, VOICE_CH);
check('event channel removed (1 left)', db.listEventChannels(GUILD).length === 1);
db.resetEvent(GUILD);
check('event reset clears config + channels', db.getEvent(GUILD) === null && db.listEventChannels(GUILD).length === 0);

console.log('\n7b) Shiritori kana logic');
const shi = await import('../src/shiritori.js');
check('normalizeWord katakana -> hiragana', shi.normalizeWord('リンゴ') === 'りんご');
check('normalizeWord rejects non-kana', shi.normalizeWord('abc123') === null);
check('normalizeWord rejects leading ー', shi.normalizeWord('ーん') === null);
check('firstKana ごりら -> ご', shi.firstKana('ごりら') === 'ご');
check('lastKana りんご -> ご', shi.lastKana('りんご') === 'ご');
check('lastKana でんしゃ -> や (small kana)', shi.lastKana('でんしゃ') === 'や');
check('lastKana かー -> あ (long vowel)', shi.lastKana('かー') === 'あ');
check('endsWithN らーめん -> true', shi.endsWithN(shi.normalizeWord('ラーメン')) === true);
check('matchKey ご == こ (lenient dakuten)', shi.matchKey('ご') === shi.matchKey('こ'));
check('matchKey や == ゃ (small->large)', shi.matchKey('や') === shi.matchKey('ゃ'));
const ns = shi.nextStart('かれー');
check('nextStart ー accepts BOTH vowel and preceding char', ns.keys.includes(shi.matchKey('え')) && ns.keys.includes(shi.matchKey('れ')));
check('nextStart normal -> single key', shi.nextStart('りんご').keys.length === 1 && shi.nextStart('りんご').keys[0] === shi.matchKey('ご'));

// shiritori DB state (atomic move + reset)
db.setShiritori({ channelId: 'shch', lastWord: 'りんご', lastKana: 'ご', count: 1, now });
check('shiritori state persisted', db.getShiritori('shch')?.lastKana === 'ご');
db.recordShiritoriMove({ channelId: 'shch', word: 'ごりら', normalized: 'ごりら', lastKana: 'ら', count: 2, now });
check('recordShiritoriMove advances state + marks used', db.getShiritori('shch').count === 2 && db.isShiritoriUsed('shch', 'ごりら'));
db.resetShiritori('shch');
check('resetShiritori clears state + used', db.getShiritori('shch') === null && db.isShiritoriUsed('shch', 'ごりら') === false);

// shiritori round counter + last-loss
check('default meta round = 1', db.getShiritoriMeta('shch2').round === 1);
db.setShiritori({ channelId: 'shch2', lastWord: 'りんご', lastKana: 'ご', count: 3, now });
db.endShiritoriRound({ channelId: 'shch2', round: 2, loserId: 'u9', word: 'みかん', reason: '語尾が「ん」', count: 3, now });
const meta2 = db.getShiritoriMeta('shch2');
check('endShiritoriRound advances round + stores loss', meta2.round === 2 && meta2.lastLoserId === 'u9' && meta2.lastLossWord === 'みかん' && meta2.lastCount === 3);
check('endShiritoriRound cleared the board', db.getShiritori('shch2') === null);

const fmt = await import('../src/format.js');
check('clampMarkdownHeadings: H4 -> bold', fmt.clampMarkdownHeadings('#### 見出し\n本文') === '**見出し**\n本文');
check('clampMarkdownHeadings: H3 unchanged', fmt.clampMarkdownHeadings('### 見出し') === '### 見出し');

console.log('\n8) Slash command definitions (toJSON validation)');
for (const cmdName of ['graph', 'trend', 'event', 'eventset', 'stats', 'settings', 'help', 'ping', 'forum-active', 'forum-summary', 'shiritori']) {
  const mod = await import(`../src/commands/${cmdName}.js`);
  let json = null;
  try {
    json = mod.default.data.toJSON();
  } catch (err) {
    console.error(`    (${cmdName} toJSON threw: ${err.message})`);
  }
  check(`/${cmdName} produces valid command JSON`, !!json && json.name === cmdName);
}

closeDb();

console.log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
