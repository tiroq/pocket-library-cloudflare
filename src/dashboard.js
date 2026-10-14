import { FONT } from './dashboard-font.js';

export const DASHBOARD_WIDTH = 528;
export const DASHBOARD_HEIGHT = 792;
const ROW_BYTES = (DASHBOARD_WIDTH * 3 + 3) & ~3;
const BMP_SIZE = 54 + ROW_BYTES * DASHBOARD_HEIGHT;

function clean(value, limit = 140) {
  if (typeof value !== 'string') throw new Error('Text fields must be strings');
  return Array.from(value.replace(/[\x00-\x1F\x7F]/g, ' ').trim()).slice(0, limit).join('');
}

export function normalizeDashboard(raw) {
  if (!raw || Array.isArray(raw) || typeof raw !== 'object') throw new Error('Expected JSON object');
  if (!Array.isArray(raw.events) || !Array.isArray(raw.tasks)) throw new Error('events and tasks must be arrays');
  if (raw.events.length > 20 || raw.tasks.length > 20) throw new Error('Maximum 20 events and 20 tasks');
  const date = clean(raw.date, 70);
  if (!date) throw new Error('date is required (local date, e.g. WED 14 OCT)');
  const events = raw.events.map(e => {
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error('Invalid event');
    return { time: clean(e.time ?? '', 20), title: clean(e.title, 120) };
  }).filter(e => e.title);
  const tasks = raw.tasks.map(t => {
    if (typeof t === 'string') return { title: clean(t, 120), done: false };
    if (!t || typeof t !== 'object' || Array.isArray(t)) throw new Error('Invalid task');
    return { title: clean(t.title, 120), done: t.done === true };
  }).filter(t => t.title);
  return {
    date,
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
  h.setInt32(22, DASHBOARD_HEIGHT, true); // bottom-up BMP
  h.setUint16(26, 1, true);
  h.setUint16(28, 24, true); // uncompressed BGR, supported by CrossPoint
  h.setUint32(34, ROW_BYTES * DASHBOARD_HEIGHT, true);
  h.setInt32(38, 2835, true);
  h.setInt32(42, 2835, true);
  return bytes;
}

export function renderDashboardBmp(data) {
  const bytes = bitmap();
  function fillRect(x, y, width, height) {
    const x0 = Math.max(0, Math.floor(x)), y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(DASHBOARD_WIDTH, Math.ceil(x + width));
    const y1 = Math.min(DASHBOARD_HEIGHT, Math.ceil(y + height));
    for (let py = y0; py < y1; py++) {
      const row = 54 + (DASHBOARD_HEIGHT - 1 - py) * ROW_BYTES;
      bytes.fill(0, row + x0 * 3, row + x1 * 3);
    }
  }
  function fit(value, count) {
    const chars = Array.from(String(value || ''));
    return chars.length <= count ? chars.join('') : chars.slice(0, Math.max(0, count - 3)).join('') + '...';
  }
  function print(value, x, y, scale = 2, maxWidth = DASHBOARD_WIDTH - x - 24) {
    const glyphWidth = 9 * scale;
    const chars = Array.from(fit(value, Math.floor(maxWidth / glyphWidth)));
    let gx = x;
    for (const char of chars) {
      const glyph = FONT[char] || FONT['?'];
      if (!glyph) { gx += glyphWidth; continue; }
      for (let py = 0; py < 8; py++) {
        for (let px = 0; px < 8; px++) {
          if ((glyph[py] & (1 << px)) !== 0) fillRect(gx + px * scale, y + py * scale, scale, scale);
        }
      }
      gx += glyphWidth;
    }
  }
  function rule(y) { fillRect(28, y, 472, 2); }

  const ru = data.locale === 'ru';
  print(data.date.toUpperCase(), 28, 34, 3);
  rule(118);
  print(ru ? 'СОБЫТИЯ' : 'EVENTS', 28, 140, 2);
  const events = data.events.slice(0, 6);
  let y = 182;
  if (!events.length) print(ru ? 'Нет событий' : 'No events', 30, y, 2);
  for (const event of events) {
    print(event.time, 30, y, 2, 112);
    print(event.title, 144, y, 2, 354);
    y += 36;
  }
  if (data.events.length > 6) print('+' + (data.events.length - 6) + (ru ? ' еще' : ' more'), 144, y, 2);
  const tasksHead = Math.max(442, y + 34);
  rule(tasksHead - 22);
  print(ru ? 'ЗАДАЧИ' : 'TASKS', 28, tasksHead, 2);
  let ty = tasksHead + 43;
  const tasks = data.tasks.slice(0, 5);
  if (!tasks.length) print(ru ? 'Нет задач' : 'No tasks', 30, ty, 2);
  for (const task of tasks) {
    // Outline box: completed tasks are solid black.
    if (task.done) fillRect(32, ty + 3, 14, 14);
    else { fillRect(32, ty + 3, 14, 2); fillRect(32, ty + 15, 14, 2); fillRect(32, ty + 3, 2, 14); fillRect(44, ty + 3, 2, 14); }
    print(task.title, 58, ty, 2, 444);
    ty += 34;
  }
  if (data.tasks.length > 5) print('+' + (data.tasks.length - 5) + (ru ? ' еще' : ' more'), 58, ty, 2);
  if (data.note && ty < 697) {
    rule(ty + 1);
    print(ru ? 'ЗАМЕТКА' : 'NOTE', 28, ty + 14, 2);
    print(data.note, 28, ty + 45, 2);
  }
  rule(738);
  print((ru ? 'ОБНОВЛЕНО ' : 'UPDATED ') + (data.updated || data.generatedAt.slice(11, 16) + ' UTC'), 28, 752, 1);
  print('X3 / POCKET LIBRARY', 322, 752, 1, 175);
  return bytes;
}
