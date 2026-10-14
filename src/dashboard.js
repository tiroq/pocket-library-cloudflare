import { FONT_ATLASES } from './generated/dashboard-font-atlases.js';

export const DASHBOARD_WIDTH = 528;
export const DEFAULT_DASHBOARD_FONT = 'golos-text';
export const DASHBOARD_FONTS = Object.freeze(['golos-text', 'inter', 'ibm-plex-sans', 'onest']);
export function normalizeDashboardFont(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_DASHBOARD_FONT;
  if (typeof value !== 'string') throw new Error('font must be a string');
  const key = value.trim().toLowerCase().replace(/[ _]+/g, '-');
  if (!DASHBOARD_FONTS.includes(key)) throw new Error('Unsupported font. Use: ' + DASHBOARD_FONTS.join(', '));
  return key;
}

export const DASHBOARD_HEIGHT = 792;
const ROW_BYTES = (DASHBOARD_WIDTH * 3 + 3) & ~3;
const BMP_SIZE = 54 + ROW_BYTES * DASHBOARD_HEIGHT;

function clean(value, limit = 140) {
  if (typeof value !== 'string') throw new Error('Text fields must be strings');
  return Array.from(value.replace(/[\x00-\x1F\x7F]/g, ' ').trim()).slice(0, limit).join('');
}

/**
 * Optional event duration, measured in whole minutes. Older iPhone Shortcuts
 * without durationMinutes retain their original layout. Stringified integers
 * are accepted because Shortcuts can serialize Number variables as Text.
 */
export function normalizeDurationMinutes(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value.trim());
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 10080) {
    throw new Error('durationMinutes must be a whole number between 0 and 10080');
  }
  return value;
}

export function formatEventDuration(value) {
  if (value == null || value === 0) return '';
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return '(' + (hours ? hours + 'H' : '') +
    (hours && minutes ? ' ' : '') +
    (minutes ? minutes + 'M' : '') + ')';
}

export function normalizeDashboard(raw) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Expected JSON object');
  if (!Array.isArray(raw.events) || !Array.isArray(raw.tasks)) throw new Error('events and tasks must be arrays');
  if (raw.events.length > 20 || raw.tasks.length > 20) throw new Error('Maximum 20 events and 20 tasks');
  const date = clean(raw.date, 70);
  if (!date) throw new Error('date is required (local date, e.g. WED 14 OCT)');
  const events = raw.events.map(e => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('Invalid event');
    const durationMinutes = normalizeDurationMinutes(e.durationMinutes);
    return { time: clean(e.time ?? '', 20), title: clean(e.title, 120),
      ...(durationMinutes === null ? {} : { durationMinutes }) };
  }).filter(e => e.title);
  const tasks = raw.tasks.map(t => {
    if (typeof t === 'string') return { title: clean(t, 120), done: false };
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Invalid task');
    return { title: clean(t.title, 120), done: t.done === true };
  }).filter(t => t.title);
  return {
    date,
    font: normalizeDashboardFont(raw.font),
    locale: raw.locale === 'ru' ? 'ru' : 'en',
    events,
    tasks,
    note: clean(raw.note ?? '', 280),
    updated: clean(raw.updated ?? '', 40),
    generatedAt: new Date().toISOString(),
  };
}

function bitmap() {
  const bytes = new Uint8Array(BMP_SIZE);
  bytes.fill(255, 54);
  const h = new DataView(bytes.buffer);
  bytes[0] = 0x42; bytes[1] = 0x4d;
  h.setUint32(2, BMP_SIZE, true);
  h.setUint32(10, 54, true);
  h.setUint32(14, 40, true);
  h.setInt32(18, DASHBOARD_WIDTH, true);
  h.setInt32(22, DASHBOARD_HEIGHT, true);
  h.setUint16(26, 1, true);
  h.setUint16(28, 24, true);
  h.setUint32(34, ROW_BYTES * DASHBOARD_HEIGHT, true);
  h.setInt32(38, 2835, true);
  h.setInt32(42, 2835, true);
  return bytes;
}

// The four real families and five exact face sizes are rasterized at build
// time (not dynamically downloaded or parsed by the Worker).
const bitmapCache = new WeakMap();
function glyphPixels(face, char, record) {
  let decoded = bitmapCache.get(record);
  if (!decoded) {
    const binary = atob(record[5]);
    decoded = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    bitmapCache.set(record, decoded);
  }
  return decoded;
}
function faceFor(data, role) {
  return FONT_ATLASES[data.font || DEFAULT_DASHBOARD_FONT][role];
}
function glyphFor(face, char) {
  return face.glyphs[char] || face.glyphs['?'];
}
function textWidth(text, face) {
  let width = 0;
  for (const char of text) width += glyphFor(face, char)[0];
  return width;
}
function ellipsize(value, face, maxWidth) {
  const text = [...String(value)];
  if (textWidth(text, face) <= maxWidth) return text.join('');
  const ellipsis = '…';
  let consumed = 0;
  let width = 0;
  const budget = Math.max(0, maxWidth - textWidth(ellipsis, face));
  for (const char of text) {
    const advance = glyphFor(face, char)[0];
    if (width + advance > budget) break;
    consumed++;
    width += advance;
  }
  return text.slice(0, consumed).join('') + ellipsis;
}

/** Word-wrap without changing the actual text of dates or events. */
export function wrapDashboardText(value, face, maxWidth, maxLines = 2) {
  let remainder = [...String(value).replace(/\s+/gu, ' ').trim()];
  const out = [];
  while (remainder.length && out.length < maxLines) {
    let width = 0, fit = 0, lastSpace = -1;
    for (const ch of remainder) {
      const advance = glyphFor(face, ch)[0];
      if (fit > 0 && width + advance > maxWidth) break;
      if (width + advance > maxWidth) break;
      width += advance;
      if (ch === ' ') lastSpace = fit;
      fit++;
    }
    if (fit === remainder.length) {
      out.push(remainder.join(''));
      return out;
    }
    if (fit === 0) fit = 1; // safety for glyph wider than the region
    const cut = lastSpace > 0 ? lastSpace : fit;
    const line = remainder.slice(0, cut).join('').trimEnd();
    remainder = remainder.slice(lastSpace > 0 ? cut + 1 : cut).join('').trimStart().split('');
    if (out.length === maxLines - 1) {
      const finalText = (line + (remainder.length ? ' ' + remainder.join('') : ''));
      out.push(ellipsize(finalText, face, maxWidth));
      return out;
    }
    out.push(line);
  }
  return out;
}

export function renderDashboardBmp(data) {
  const bytes = bitmap();
  const ru = data.locale === 'ru';
  function fillRect(x, y, width, height) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(DASHBOARD_WIDTH, Math.ceil(x + width));
    const y1 = Math.min(DASHBOARD_HEIGHT, Math.ceil(y + height));
    if (x1 <= x0 || y1 <= y0) return;
    for (let py = y0; py < y1; py++) {
      const row = 54 + (DASHBOARD_HEIGHT - 1 - py) * ROW_BYTES;
      bytes.fill(0, row + x0 * 3, row + x1 * 3);
    }
  }
  function rule(y) { fillRect(28, y, 472, 2); }
  function write(value, x, y, role, width = DASHBOARD_WIDTH - x - 25) {
    const face = faceFor(data, role);
    const clipped = ellipsize(value, face, width);
    const baseline = y + face.ascent;
    let pen = x;
    for (const char of clipped) {
      const rec = glyphFor(face, char);
      const [advance, dx, dy, w, h] = rec;
      if (w && h) {
        const bits = glyphPixels(face, char, rec);
        const stride = (w + 7) >> 3;
        const bx = Math.round(pen + dx), by = Math.round(baseline + dy);
        for (let gy = 0; gy < h; gy++) {
          for (let gx = 0; gx < w; gx++) {
            if (bits[gy * stride + (gx >> 3)] & (128 >> (gx & 7))) {
              fillRect(bx + gx, by + gy, 1, 1);
            }
          }
        }
      }
      pen += advance;
    }
  }
  const bodyFace = faceFor(data, 'body');
  // Keep the date formatted exactly as provided by the Shortcut.
  write(data.date, 28, 24, 'date', 472);
  rule(107);

  write(ru ? 'СОБЫТИЯ' : 'EVENTS', 28, 126, 'heading');
  let eventY = 166, shownEvents = 0;
  for (const event of data.events.slice(0, 6)) {
    // Reserve a right-aligned column for duration. The title wraps before it,
    // never over it, even in Cyrillic and for longer labels like (1H 30M).
    const duration = formatEventDuration(event.durationMinutes);
    const durationFace = faceFor(data, 'heading');
    const badgeWidth = duration ? Math.ceil(textWidth(duration, durationFace)) : 0;
    const titleWidth = duration ? Math.max(126, 352 - badgeWidth - 12) : 352;
    const lines = wrapDashboardText(event.title, bodyFace, titleWidth, 2);
    const rowH = Math.max(39, lines.length * 29 + 10);
    if (eventY + rowH > 486 && shownEvents > 0) break;
    write(event.time, 30, eventY + 1, 'time', 108);
    lines.forEach((line, i) => write(line, 146, eventY + i * 29, 'body', titleWidth));
    if (duration) write(duration, 500 - badgeWidth, eventY + 3, 'heading', badgeWidth + 1);
    eventY += rowH;
    shownEvents++;
  }
  if (!data.events.length) {
    write(ru ? 'Нет событий' : 'No events', 30, eventY, 'body');
    eventY += 41;
  }
  if (shownEvents < data.events.length) {
    write('+' + (data.events.length - shownEvents) + (ru ? ' ещё' : ' more'), 146, Math.min(489, eventY + 3), 'heading');
    eventY += 28;
  }

  const taskHeaderY = Math.min(541, Math.max(306, eventY + 22));
  rule(taskHeaderY - 17);
  write(ru ? 'ЗАДАЧИ' : 'TASKS', 28, taskHeaderY, 'heading');
  let taskY = taskHeaderY + 40, shownTasks = 0;
  const tasks = data.tasks.slice(0, 5);
  for (const task of tasks) {
    const lines = wrapDashboardText(task.title, bodyFace, 440, 2);
    const rowH = Math.max(39, lines.length * 28 + 9);
    if (taskY + rowH > 708) break;
    // Completed: filled square, pending: outlined square.
    if (task.done) fillRect(30, taskY + 7, 14, 14);
    else {
      fillRect(30, taskY + 7, 14, 2);
      fillRect(30, taskY + 19, 14, 2);
      fillRect(30, taskY + 7, 2, 14);
      fillRect(42, taskY + 7, 2, 14);
    }
    lines.forEach((line, i) => write(line, 58, taskY + i * 28, 'body', 440));
    taskY += rowH;
    shownTasks++;
  }
  if (!tasks.length) {
    write(ru ? 'Нет задач' : 'No tasks', 30, taskY, 'body');
    taskY += 36;
  }
  if (shownTasks < data.tasks.length && taskY < 711) {
    write('+' + (data.tasks.length - shownTasks) + (ru ? ' ещё' : ' more'), 58, taskY, 'heading');
    taskY += 27;
  }
  if (data.note && taskY < 655) {
    rule(taskY + 5);
    write(ru ? 'ЗАМЕТКА' : 'NOTE', 28, taskY + 19, 'heading');
    wrapDashboardText(data.note, bodyFace, 470, 2)
      .forEach((line, i) => write(line, 28, taskY + 47 + i * 28, 'body', 470));
  }
  rule(742);
  write((ru ? 'Обновлено ' : 'Updated ') + (data.updated || data.generatedAt.slice(11, 16) + ' UTC'),
    28, 757, 'footer', 278);
  write('X3 / POCKET LIBRARY', 361, 757, 'footer', 140);
  return bytes;
}


/**
 * Convert the same monochrome calendar raster into a compact Windows BMP for
 * CrossPoint's sleep.enter plugin. The plugin has a 1 MiB download cap, while
 * the original 24-bit BMP is ~1.25 MiB. Bitmap pixels are already pure black
 * or white, so this conversion is lossless.
 *
 * BMP: BITMAPFILEHEADER (14) + BITMAPINFOHEADER (40) + 2 BGRA palette colors
 * (8) + bottom-up, MSB-first, 1-bit scanlines padded to four bytes.
 */
export function convertDashboardBmpTo1Bit(source) {
  if (!(source instanceof Uint8Array) || source.length !== BMP_SIZE) {
    throw new Error('Expected a rendered 24-bit X3 dashboard');
  }
  const stride = Math.ceil(DASHBOARD_WIDTH / 32) * 4;
  const pixelsOffset = 62;
  const output = new Uint8Array(pixelsOffset + stride * DASHBOARD_HEIGHT);
  const header = new DataView(output.buffer);
  output[0] = 0x42; output[1] = 0x4d;
  header.setUint32(2, output.length, true);
  header.setUint32(10, pixelsOffset, true);
  header.setUint32(14, 40, true);
  header.setInt32(18, DASHBOARD_WIDTH, true);
  header.setInt32(22, DASHBOARD_HEIGHT, true);
  header.setUint16(26, 1, true);
  header.setUint16(28, 1, true);
  header.setUint32(34, stride * DASHBOARD_HEIGHT, true);
  header.setInt32(38, 2835, true);
  header.setInt32(42, 2835, true);
  header.setUint32(46, 2, true);
  // Palette index 0 = black (already zeroed); index 1 = white.
  output.set([255, 255, 255, 0], 58);
  for (let row = 0; row < DASHBOARD_HEIGHT; row++) {
    const rgbBase = 54 + row * ROW_BYTES;
    const monoBase = pixelsOffset + row * stride;
    for (let x = 0; x < DASHBOARD_WIDTH; x++) {
      if (source[rgbBase + x * 3] > 127) {
        output[monoBase + (x >>> 3)] |= 0x80 >>> (x & 7);
      }
    }
  }
  return output;
}
