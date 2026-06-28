import { DateTime } from 'luxon';

const PRESETS = new Set(['today', '7d', '30d', 'this_month', 'last_month', 'all']);

/**
 * Parse a 'YYYY-MM-DD' (or 'YYYY/MM/DD') string into a luxon DateTime in the given zone.
 * `edge` = 'start' -> start of that day; 'end' -> start of the NEXT day (exclusive upper bound).
 */
function parseDay(str, zone, edge) {
  const norm = String(str).trim().replace(/\//g, '-');
  const dt = DateTime.fromFormat(norm, 'yyyy-M-d', { zone });
  if (!dt.isValid) {
    throw new Error(`日付「${str}」を解釈できません。YYYY-MM-DD 形式で指定してください。`);
  }
  return edge === 'end' ? dt.plus({ days: 1 }).startOf('day') : dt.startOf('day');
}

/**
 * Resolve a query window from optional preset / from / to.
 * Returns { start, end, label, zone } where start/end are epoch milliseconds
 * and the window is half-open: start <= t < end.
 */
export function resolveRange({ from, to, period, timezone, defaultLookbackDays = 7 }) {
  const zone = timezone || 'Asia/Tokyo';
  const now = DateTime.now().setZone(zone);

  if (period && period !== 'custom') {
    if (!PRESETS.has(period)) throw new Error(`未知の期間プリセット: ${period}`);
    let start;
    let end = now;
    let labelKind = 'range';
    switch (period) {
      case 'today':
        start = now.startOf('day');
        break;
      case '7d':
        start = now.minus({ days: 7 }).startOf('day');
        break;
      case '30d':
        start = now.minus({ days: 30 }).startOf('day');
        break;
      case 'this_month':
        start = now.startOf('month');
        break;
      case 'last_month':
        start = now.minus({ months: 1 }).startOf('month');
        end = now.startOf('month');
        break;
      case 'all':
        start = DateTime.fromMillis(0, { zone });
        labelKind = 'all';
        break;
    }
    return buildRange(start, end, zone, labelKind);
  }

  if (from || to) {
    const start = from
      ? parseDay(from, zone, 'start')
      : now.minus({ days: defaultLookbackDays }).startOf('day');
    const end = to ? parseDay(to, zone, 'end') : now;
    return buildRange(start, end, zone, 'range');
  }

  // Default: the last N days up to now.
  return buildRange(now.minus({ days: defaultLookbackDays }).startOf('day'), now, zone, 'range');
}

function buildRange(start, end, zone, labelKind) {
  if (!start.isValid || !end.isValid) throw new Error('期間の計算に失敗しました。');
  if (end.toMillis() <= start.toMillis()) {
    throw new Error('終了日は開始日より後にしてください。');
  }
  let label;
  if (labelKind === 'all') {
    label = `全期間 〜 ${end.toFormat('yyyy/MM/dd HH:mm')} (${zone})`;
  } else {
    const endDisplay = end.minus({ milliseconds: 1 });
    label = `${start.toFormat('yyyy/MM/dd')} 〜 ${endDisplay.toFormat('yyyy/MM/dd')} (${zone})`;
  }
  return { start: start.toMillis(), end: end.toMillis(), label, zone };
}

/** Human-friendly Japanese duration from a number of seconds. */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}時間${String(m).padStart(2, '0')}分`;
  if (m > 0) return `${m}分${String(sec).padStart(2, '0')}秒`;
  return `${sec}秒`;
}

export function isValidTimezone(tz) {
  return DateTime.now().setZone(tz).isValid;
}

/** Human label for a stored [startMs, endMs) window (end is exclusive). */
export function formatRangeLabel(startMs, endMs, timezone) {
  const zone = timezone || 'Asia/Tokyo';
  const s = DateTime.fromMillis(startMs, { zone }).toFormat('yyyy/MM/dd');
  const e = DateTime.fromMillis(endMs, { zone }).minus({ milliseconds: 1 }).toFormat('yyyy/MM/dd');
  return `${s} 〜 ${e} (${zone})`;
}
