import { FONT_ATLASES } from './generated/dashboard-font-atlases.js';

export const DASHBOARD_WIDTH = 528;
export const DEFAULT_DASHBOARD_FONT = 'golos-text';
export const DASHBOARD_FONTS = Object.freeze(['golos-text', 'inter', 'ibm-plex-sans', 'onest']);
export const DASHBOARD_CALENDAR_CATEGORIES = Object.freeze({ personal: 'P', family: 'F', shared: 'S', work: 'W' });
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
    if (e.calendar != null && e.calendar !== '' && e.calendar !== 'primary' &&
        !Object.hasOwn(DASHBOARD_CALENDAR_CATEGORIES, e.calendar)) {
      throw new Error('calendar must be personal, family, shared, work or primary');
    }
    return { time: clean(e.time ?? '', 20), title: clean(e.title, 120),
      ...(durationMinutes === null ? {} : { durationMinutes }),
      ...(Object.hasOwn(DASHBOARD_CALENDAR_CATEGORIES, e.calendar) ? { calendar: e.calendar } : {}) };
  }).filter(e => e.title);
  const tasks = raw.tasks.map(t => {
    if (typeof t === 'string') return { title: clean(t, 120), done: false };
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Invalid task');
    return { title: clean(t.title, 120), done: t.done === true,
      ...(t.overdue === true ? { overdue: true } : {}) };
  }).filter(t => t.title);
  return {
    date,
    weather: clean(raw.weather ?? '', 42),
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

/**
 * Adaptive, content-aware layout for the 528x792 X3. The fixed date/footer
 * bars never move; the events/tasks boundary is calculated per dashboard.
 *
 * We reserve enough task space for all tasks when their content is short.
 * If tasks overflow, reserve about half the usable agenda height for them.
 * Events consume any space not needed by tasks. When events are short, tasks
 * consume all the remaining space. Overflow counters are part of the fit
 * calculation, so they are never silently clipped at the bottom.
 */
export const DASHBOARD_LAYOUT = Object.freeze({
  dateRuleY: 87,
  eventHeadingY: 104,
  eventStartY: 141,
  footerRuleY: 742,
  contentBottomY: 734,
  taskHeaderOffset: 19,
  taskStartOffset: 40,
  eventOverflowH: 27,
  taskOverflowH: 27,
});

export function planDashboardLayout(data) {
  const layout = DASHBOARD_LAYOUT;
  const bodyFace = faceFor(data, 'body');
  const durationFace = faceFor(data, 'heading');
  const events = data.events.map(event => {
    const duration = formatEventDuration(event.durationMinutes);
    const durationWidth = duration ? Math.ceil(textWidth(duration, durationFace)) : 0;
    const titleWidth = duration ? Math.max(126, 352 - durationWidth - 12) : 352;
    const lines = wrapDashboardText(event.title, bodyFace, titleWidth, 2);
    return { event, duration, durationWidth, titleWidth, lines,
      height: Math.max(39, lines.length * 29 + 10) };
  });
  const tasks = data.tasks.map(task => {
    const lines = wrapDashboardText(task.title, bodyFace, 440, 2);
    return { task, lines, height: Math.max(39, lines.length * 28 + 9) };
  });

  const sectionOverhead = layout.taskHeaderOffset + layout.taskStartOffset;
  const totalTaskHeight = tasks.length ? tasks.reduce((sum, row) => sum + row.height, 0) : 39;
  // Reserve ~46% for tasks under mutual overflow, otherwise only as much as
  // they actually need. The 27px "+N" row is reserved when tasks overflow.
  const fairTaskBudget = Math.floor((layout.contentBottomY -
    layout.eventStartY - sectionOverhead) * 0.46);
  const taskReserve = Math.min(totalTaskHeight, fairTaskBudget) +
    (totalTaskHeight > fairTaskBudget ? layout.taskOverflowH : 0);
  const eventBottomLimit = layout.contentBottomY - sectionOverhead - taskReserve;

  let eventY = layout.eventStartY, shownEvents = 0;
  const eventPositions = [];
  for (const row of events) {
    const next = shownEvents + 1;
    const needsCounter = next < events.length;
    if (eventY + row.height + (needsCounter ? layout.eventOverflowH : 0) > eventBottomLimit) break;
    eventPositions.push({ ...row, y: eventY });
    eventY += row.height;
    shownEvents++;
  }
  // Both empty sections still display one compact, clear placeholder.
  if (!events.length) eventY += 39;
  const eventsOverflow = events.length - shownEvents;
  const eventsOverflowY = eventsOverflow ? eventY + 3 : null;
  if (eventsOverflow) eventY += layout.eventOverflowH;

  const taskHeadingY = eventY + layout.taskHeaderOffset;
  const taskStartY = taskHeadingY + layout.taskStartOffset;
  let taskY = taskStartY, shownTasks = 0;
  const taskPositions = [];
  for (const row of tasks) {
    const next = shownTasks + 1;
    const needsCounter = next < tasks.length;
    if (taskY + row.height + (needsCounter ? layout.taskOverflowH : 0) > layout.contentBottomY) break;
    taskPositions.push({ ...row, y: taskY });
    taskY += row.height;
    shownTasks++;
  }
  if (!tasks.length) taskY += 36;
  const tasksOverflow = tasks.length - shownTasks;
  const tasksOverflowY = tasksOverflow ? taskY + 2 : null;
  if (tasksOverflow) taskY += layout.taskOverflowH;

  // Notes are optional and lower priority than a real task or overflow count.
  let note = null;
  if (!tasksOverflow && data.note) {
    const lines = wrapDashboardText(data.note, bodyFace, 470, 2);
    const lastBottom = taskY + 47 + (lines.length - 1) * 28 + 26;
    if (lastBottom <= layout.contentBottomY) note = { y: taskY, lines };
  }
  return {
    events: eventPositions,
    tasks: taskPositions,
    shownEvents, shownTasks, eventsOverflow, tasksOverflow,
    eventsOverflowY, tasksOverflowY,
    eventBottomLimit, taskHeadingY, taskStartY, note,
  };
}

export function renderDashboardBmp(data, options = {}) {
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
  const layout = planDashboardLayout(data);
  // The date and footer are fixed anchors; everything between adapts.
  const weatherFace = faceFor(data, 'heading');
  const weather = data.weather ? ellipsize(data.weather, weatherFace, 162) : '';
  const weatherWidth = weather ? Math.ceil(textWidth(weather, weatherFace)) : 0;
  const dateWidth = weather ? 472 - weatherWidth - 14 : 472;
  write(data.date, 28, 24, 'date', dateWidth);
  if (weather) {
    write(weather, 500 - weatherWidth, 45, 'heading', weatherWidth + 1);
  }
  rule(DASHBOARD_LAYOUT.dateRuleY);

  write(ru ? 'СОБЫТИЯ' : 'EVENTS', 28, DASHBOARD_LAYOUT.eventHeadingY, 'heading');
  for (const row of layout.events) {
    const { event, y, lines, titleWidth, duration, durationWidth } = row;
    const badge = DASHBOARD_CALENDAR_CATEGORIES[event.calendar] || '';
    write(event.time, 30, y + 1, 'time', badge ? 86 : 108);
    if (badge) {
      const bx = 119, by = y + 8, size = 19;
      fillRect(bx, by, size, 1);
      fillRect(bx, by + size - 1, size, 1);
      fillRect(bx, by, 1, size);
      fillRect(bx + size - 1, by, 1, size);
      const face = faceFor(data, 'footer');
      const glyphWidth = textWidth(badge, face);
      write(badge, bx + Math.floor((size - glyphWidth) / 2), by + 2, 'footer', size - 4);
    }
    lines.forEach((line, i) => write(line, 146, y + i * 29, 'body', titleWidth));
    if (duration) write(duration, 500 - durationWidth, y + 3, 'heading', durationWidth + 1);
  }
  if (!data.events.length) {
    write(ru ? 'Нет событий' : 'No events', 30, DASHBOARD_LAYOUT.eventStartY, 'body');
  }
  if (layout.eventsOverflow) {
    write('+' + layout.eventsOverflow + (ru ? ' ещё' : ' more'), 146,
      layout.eventsOverflowY, 'heading');
  }

  rule(layout.taskHeadingY - 17);
  write(ru ? 'ЗАДАЧИ' : 'TASKS', 28, layout.taskHeadingY, 'heading');
  for (const row of layout.tasks) {
    const { task, y, lines } = row;
    if (task.done) fillRect(30, y + 7, 14, 14);
    else {
      fillRect(30, y + 7, 14, 2);
      fillRect(30, y + 19, 14, 2);
      fillRect(30, y + 7, 2, 14);
      fillRect(42, y + 7, 2, 14);
      if (task.overdue) write('!', 34, y + 5, 'footer', 8);
    }
    lines.forEach((line, i) => write(line, 58, y + i * 28, 'body', 440));
  }
  if (!data.tasks.length) {
    write(ru ? 'Нет задач' : 'No tasks', 30, layout.taskStartY, 'body');
  }
  if (layout.tasksOverflow) {
    write('+' + layout.tasksOverflow + (ru ? ' ещё' : ' more'),
      58, layout.tasksOverflowY, 'heading');
  }
  if (layout.note) {
    rule(layout.note.y + 5);
    write(ru ? 'ЗАМЕТКА' : 'NOTE', 28, layout.note.y + 19, 'heading');
    layout.note.lines.forEach((line, i) => write(line, 28,
      layout.note.y + 47 + i * 28, 'body', 470));
  }
  rule(DASHBOARD_LAYOUT.footerRuleY);
  write((ru ? 'Обновлено ' : 'Updated ') + (data.updated || data.generatedAt.slice(11, 16) + ' UTC'),
    28, 757, 'footer', options.stale ? 162 : 278);
  if (options.stale) {
    // A warning means *no recent successful upload*, not a diagnosed error.
    // Only a fresh BMP fetch to X3 can display a changed static image.
    const mins = Number.isFinite(options.staleMinutes) ? Math.round(options.staleMinutes) : 45;
    write((ru ? '! СИНХР. >' : '! STALE >') + mins + 'M', 187, 757, 'footer', 168);
  }
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
