import { config } from '../config.js';
import { logger } from './logger.js';
import * as db from './db.js';

/* ------------------------------------------------------------------ *
 * Kana helpers (pure, unit-tested in scripts/smoketest.js)
 * ------------------------------------------------------------------ */

const SMALL_TO_LARGE = {
  ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お',
  ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', っ: 'つ', ゎ: 'わ',
};

// kana -> its vowel, used to resolve a trailing long-vowel mark ー
const VOWEL = {
  あ: 'あ', か: 'あ', さ: 'あ', た: 'あ', な: 'あ', は: 'あ', ま: 'あ', や: 'あ', ら: 'あ', わ: 'あ', が: 'あ', ざ: 'あ', だ: 'あ', ば: 'あ', ぱ: 'あ',
  い: 'い', き: 'い', し: 'い', ち: 'い', に: 'い', ひ: 'い', み: 'い', り: 'い', ぎ: 'い', じ: 'い', ぢ: 'い', び: 'い', ぴ: 'い',
  う: 'う', く: 'う', す: 'う', つ: 'う', ぬ: 'う', ふ: 'う', む: 'う', ゆ: 'う', る: 'う', ぐ: 'う', ず: 'う', づ: 'う', ぶ: 'う', ぷ: 'う',
  え: 'え', け: 'え', せ: 'え', て: 'え', ね: 'え', へ: 'え', め: 'え', れ: 'え', げ: 'え', ぜ: 'え', で: 'え', べ: 'え', ぺ: 'え',
  お: 'お', こ: 'お', そ: 'お', と: 'お', の: 'お', ほ: 'お', も: 'お', よ: 'お', ろ: 'お', を: 'お', ご: 'お', ぞ: 'お', ど: 'お', ぼ: 'お', ぽ: 'お',
};

const STRIP_DAKUTEN = {
  が: 'か', ぎ: 'き', ぐ: 'く', げ: 'け', ご: 'こ',
  ざ: 'さ', じ: 'し', ず: 'す', ぜ: 'せ', ぞ: 'そ',
  だ: 'た', ぢ: 'ち', づ: 'つ', で: 'て', ど: 'と',
  ば: 'は', び: 'ひ', ぶ: 'ふ', べ: 'へ', ぼ: 'ほ',
  ぱ: 'は', ぴ: 'ひ', ぷ: 'ふ', ぺ: 'へ', ぽ: 'ほ',
};

const katakanaToHiragana = (s) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Normalize a raw word to hiragana, or null if it isn't a usable kana word. */
export function normalizeWord(raw) {
  const s = katakanaToHiragana(String(raw).trim());
  if (!s) return null;
  if (!/^[ぁ-ゖー]+$/.test(s)) return null; // hiragana + ー only
  if (s[0] === 'ー') return null; // can't start with a long-vowel mark
  return s;
}

export function firstKana(word) {
  const c = word[0];
  return SMALL_TO_LARGE[c] || c;
}

export function lastKana(word) {
  const i = word.length - 1;
  const c = word[i];
  if (c === 'ー') {
    const prev = word[i - 1];
    const base = STRIP_DAKUTEN[prev] || SMALL_TO_LARGE[prev] || prev;
    return VOWEL[base] || prev;
  }
  return SMALL_TO_LARGE[c] || c;
}

export function endsWithN(word) {
  return word[word.length - 1] === 'ん';
}

/**
 * Comparison key for chaining. Intentionally LENIENT: small kana are treated as
 * their large form (ゃ≡や) and voiced/semi-voiced as their base (が≡か, ぱ≡は),
 * so casual play connects smoothly.
 */
export function matchKey(kana) {
  const large = SMALL_TO_LARGE[kana] || kana;
  return STRIP_DAKUTEN[large] || large;
}

const uniq = (a) => [...new Set(a)];

/**
 * Accepted starting kana for the NEXT word, given the current word.
 * For a trailing long-vowel mark ー, BOTH the vowel and the character right
 * before the ー are accepted (e.g. カレー → "え" or "れ").
 * Returns { keys: matchKeys[], display: human string like "え・れ" }.
 */
export function nextStart(word) {
  const i = word.length - 1;
  const last = word[i];
  if (last === 'ー') {
    const prevRaw = word[i - 1];
    if (!prevRaw) return { keys: [], display: '' };
    const prev = SMALL_TO_LARGE[prevRaw] || prevRaw;
    const base = STRIP_DAKUTEN[prev] || prev;
    const vowel = VOWEL[base] || prev;
    return { keys: uniq([matchKey(prev), matchKey(vowel)]), display: uniq([prev, vowel]).join('・') };
  }
  const lk = SMALL_TO_LARGE[last] || last;
  return { keys: [matchKey(lk)], display: lk };
}

/* ------------------------------------------------------------------ *
 * Game handling
 * ------------------------------------------------------------------ */

/** Bulk-delete recent messages (Discord can't bulk-delete >14d old). Returns count. */
export async function purgeChannel(channel) {
  let total = 0;
  for (let i = 0; i < 20; i++) {
    const deleted = await channel.bulkDelete(100, true).catch(() => null);
    if (!deleted || deleted.size === 0) break;
    total += deleted.size;
    if (deleted.size < 100) break;
  }
  return total;
}

/**
 * Decide the outcome of a move AND apply any DB mutation — fully synchronous, so
 * the read-modify-write can't interleave with a concurrent message (no await in
 * between). Returns a descriptor; Discord side effects are done by the caller.
 */
function decideAndApply(channelId, word, authorId) {
  const norm = normalizeWord(word);
  if (!norm) return { kind: 'invalid', reason: 'ひらがな・カタカナで1単語を入力してね。' };
  if (norm.length < 2) return { kind: 'invalid', reason: '2文字以上の言葉でお願い！' };

  const state = db.getShiritori(channelId);

  if (endsWithN(norm)) {
    const count = state?.count ?? 0;
    const endedRound = db.getShiritoriMeta(channelId).round;
    const nextRound = endedRound + 1;
    const reason = '語尾が「ん」';
    db.endShiritoriRound({ channelId, round: nextRound, loserId: authorId, word, reason, count, now: Date.now() });
    const text =
      `💀 **第${endedRound}回しりとり遊戯 終了！**\n` +
      `<@${authorId}> が「${word}」で負け（${reason}）。${count}語つながりました。\n` +
      `🔄 **第${nextRound}回しりとり遊戯、スタート！** 新しい単語をどうぞ。`;
    return { kind: 'loss', text };
  }

  if (state?.lastKana) {
    // Recompute accepted starts from the stored normalized word (falls back to
    // the single stored kana for pre-upgrade rows that have no last_norm).
    const accepted = state.lastNorm ? nextStart(state.lastNorm).keys : [matchKey(state.lastKana)];
    if (!accepted.includes(matchKey(firstKana(norm)))) {
      return { kind: 'invalid', reason: `「${state.lastKana}」から始めてね！（前の言葉: ${state.lastWord}）` };
    }
  }
  if (db.isShiritoriUsed(channelId, norm)) {
    return { kind: 'invalid', reason: 'その言葉はもう使われたよ！' };
  }

  db.recordShiritoriMove({
    channelId,
    word,
    normalized: norm,
    lastKana: nextStart(norm).display,
    count: (state?.count ?? 0) + 1,
    now: Date.now(),
  });
  return { kind: 'valid' };
}

/** Judge one message in the shiritori channel. */
export async function handleShiritoriMessage(message) {
  if (message.channelId !== config.shiritoriChannelId) return;
  if (message.author?.bot || message.system || message.webhookId) return;

  const raw = (message.content || '').trim();
  if (!raw) return;
  if (raw.startsWith('!') || raw.startsWith('！')) return; // ! prefix = chat/comment, not a turn
  const word = raw.split(/\s+/)[0]; // first token only

  const outcome = decideAndApply(config.shiritoriChannelId, word, message.author.id);

  // Discord side effects only (order no longer affects game state).
  if (outcome.kind === 'valid') {
    await message.react('✅').catch(() => {});
  } else if (outcome.kind === 'loss') {
    await message.react('💀').catch(() => {});
    await message.channel.send(outcome.text).catch(() => {});
  } else {
    await message.react('❌').catch(() => {});
    if (outcome.reason) await message.reply(outcome.reason).catch(() => {});
  }
}

export async function handleShiritoriSafe(message) {
  try {
    await handleShiritoriMessage(message);
  } catch (err) {
    logger.error('shiritori handling failed:', err);
  }
}
