import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logger } from './logger.js';

const FONT_FAMILY = 'NekonaChart';
const EMOJI_FAMILY = 'NekonaEmoji';
let fontReady = false;
let emojiReady = false;

/**
 * Register the first CJK-capable font we can find so Japanese names render.
 * Order: explicit FONT_PATH -> bundled asset -> common system locations.
 */
function registerFont() {
  const candidates = [];
  if (config.fontPath) candidates.push(config.fontPath);
  candidates.push(
    path.join(config.root, 'assets', 'fonts', 'NotoSansCJKjp-Regular.otf'),
    path.join(config.root, 'assets', 'fonts', 'NotoSansJP-Regular.ttf'),
    // Raspberry Pi OS / Debian (fonts-noto-cjk)
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf',
    '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
    '/usr/share/fonts/noto/NotoSansCJK-Regular.ttc',
    // Other common Japanese fonts
    '/usr/share/fonts/truetype/fonts-japanese-gothic.ttf',
    '/usr/share/fonts/truetype/vlgothic/VL-Gothic-Regular.ttf',
    // Windows
    'C:\\Windows\\Fonts\\YuGothM.ttc',
    'C:\\Windows\\Fonts\\meiryo.ttc',
    'C:\\Windows\\Fonts\\msgothic.ttc',
    // macOS
    '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
    '/Library/Fonts/Arial Unicode.ttf'
  );

  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p) && GlobalFonts.registerFromPath(p, FONT_FAMILY)) {
        logger.info(`Chart font registered: ${p}`);
        fontReady = true;
        return;
      }
    } catch {
      // try the next candidate
    }
  }
  logger.warn(
    'No CJK font found for charts. Japanese characters may render as boxes. ' +
      'Install one (e.g. `sudo apt install fonts-noto-cjk`) or set FONT_PATH in .env.'
  );
}

/**
 * Register an emoji font as a fallback so emoji inside usernames don't become
 * boxes. Skia falls back across registered families per-glyph. Optional.
 */
function registerEmojiFont() {
  const candidates = [
    '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
    '/usr/share/fonts/noto/NotoColorEmoji.ttf',
    '/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf',
    'C:\\Windows\\Fonts\\seguiemj.ttf',
    '/System/Library/Fonts/Apple Color Emoji.ttc',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p) && GlobalFonts.registerFromPath(p, EMOJI_FAMILY)) {
        emojiReady = true;
        return;
      }
    } catch {
      // try the next candidate
    }
  }
}

registerFont();
registerEmojiFont();

function font(size, weight = '') {
  const families = [];
  if (fontReady) families.push(`"${FONT_FAMILY}"`);
  if (emojiReady) families.push(`"${EMOJI_FAMILY}"`);
  families.push('sans-serif');
  return `${weight ? `${weight} ` : ''}${size}px ${families.join(', ')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) {
    t = t.slice(0, -1);
  }
  return `${t}…`;
}

const COLORS = {
  bg: '#1e1f22',
  card: '#2b2d31',
  track: '#3a3c41',
  title: '#ffffff',
  subtitle: '#b5bac1',
  name: '#dbdee1',
  rank: '#949ba4',
  value: '#ffffff',
  footer: '#80848e',
};

/**
 * Render a horizontal (帯) bar-chart ranking to a PNG buffer.
 *
 * @param {object}   opts
 * @param {string}   opts.title       headline
 * @param {string}   opts.subtitle    period / context line
 * @param {Array<{label:string,value:number}>} opts.items  pre-sorted desc
 * @param {string}   opts.accent      bar color (hex)
 * @param {(v:number)=>string} opts.formatValue  numeric value -> display text
 * @param {string}  [opts.footer]
 * @returns {Buffer} PNG
 */
export function renderBarChart({ title, subtitle, items, accent, formatValue, footer }) {
  const width = 1000;
  const pad = 32;
  const headerH = 104;
  const footerH = 44;
  const rowH = 46;
  const barH = 26;

  const height = headerH + items.length * rowH + footerH;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // Header
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.title;
  ctx.font = font(30, 'bold');
  ctx.fillText(title, pad, 48);
  ctx.fillStyle = COLORS.subtitle;
  ctx.font = font(18);
  ctx.fillText(subtitle, pad, 78);

  // Accent rule under the header
  ctx.fillStyle = accent;
  ctx.fillRect(pad, headerH - 18, width - pad * 2, 3);

  // Layout columns
  const labelColW = 270;
  const valueColW = 150;
  const barX0 = pad + labelColW + 12;
  const barX1 = width - pad - valueColW;
  const barMaxW = barX1 - barX0;

  const maxValue = Math.max(1, ...items.map((it) => it.value));

  ctx.textBaseline = 'middle';
  items.forEach((it, i) => {
    const rowTop = headerH + i * rowH;
    const cy = rowTop + rowH / 2;

    // Rank
    ctx.fillStyle = COLORS.rank;
    ctx.font = font(18, 'bold');
    ctx.textAlign = 'right';
    ctx.fillText(`${i + 1}`, pad + 26, cy);

    // Name
    ctx.fillStyle = COLORS.name;
    ctx.font = font(20);
    ctx.textAlign = 'left';
    const name = truncate(ctx, it.label, labelColW - 44);
    ctx.fillText(name, pad + 40, cy);

    // Bar track
    ctx.fillStyle = COLORS.track;
    roundRect(ctx, barX0, cy - barH / 2, barMaxW, barH, 8);
    ctx.fill();

    // Bar value
    const w = Math.max(3, (it.value / maxValue) * barMaxW);
    ctx.fillStyle = accent;
    roundRect(ctx, barX0, cy - barH / 2, w, barH, 8);
    ctx.fill();

    // Value label
    ctx.fillStyle = COLORS.value;
    ctx.font = font(18, 'bold');
    ctx.textAlign = 'left';
    ctx.fillText(formatValue(it.value), barX1 + 10, cy);
  });

  // Footer
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COLORS.footer;
  ctx.font = font(14);
  ctx.fillText(footer || 'nekonabot', pad, height - 16);

  ctx.textAlign = 'left';
  return canvas.toBuffer('image/png');
}
