import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DASHBOARD_FONTS, DASHBOARD_WIDTH, DASHBOARD_HEIGHT,
  normalizeDashboard, renderDashboardBmp, convertDashboardBmpTo1Bit,
  planDashboardLayout } from '../src/dashboard.js';

const periods = [
  { hour: 8, temp: 26, code: 0 },
  { hour: 14, temp: 32, code: 2 },
  { hour: 20, temp: 28, code: 61 }
];
const base = {
  locale: 'ru', date: 'СР · 14.10.2026', weather: '',
  headerDate: { day: 14, weekday: 'СР', month: 'ОКТ' },
  weatherForecast: { date: '2026-10-14', tomorrow: false, periods },
  events: [
    { time: '12:00', title: 'Встреча', calendar: 'work', durationMinutes: 45 }
  ],
  tasks: [{ title: 'Оплатить счёт', overdue: true }]
};
const sha = data => createHash('sha256').update(data).digest('hex');

function differentPixelsInRect(a, b, left, top, right, bottom) {
  let inside = 0, outside = 0;
  for (let y = 0; y < DASHBOARD_HEIGHT; y++) {
    const row = 54 + (DASHBOARD_HEIGHT - 1 - y) * DASHBOARD_WIDTH * 3;
    for (let x = 0; x < DASHBOARD_WIDTH; x++) {
      if (a[row + x * 3] === b[row + x * 3]) continue;
      if (x >= left && x <= right && y >= top && y <= bottom) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}

test('final icon/date/month and three 1-bit weather columns fit original header for all fonts', () => {
  for (const font of DASHBOARD_FONTS) {
    const src = normalizeDashboard({ ...base, font });
    const missing = normalizeDashboard({ ...base, font, weatherForecast: null });
    const full = renderDashboardBmp(src);
    const noWeather = renderDashboardBmp(missing);
    const change = differentPixelsInRect(full, noWeather, 182, 8, 499, 86);
    assert.ok(change.inside > 60, font + ': weather icons must be visible');
    assert.equal(change.outside, 0, font + ': weather must not displace calendar or tasks');
    assert.equal(planDashboardLayout(src).taskHeadingY,
      planDashboardLayout(missing).taskHeadingY);
    assert.equal(new DataView(full.buffer).getUint16(28, true), 24);
    const oneBit = convertDashboardBmpTo1Bit(full);
    assert.equal(new DataView(oneBit.buffer).getUint16(28, true), 1);
    assert.ok(oneBit.length < 1024 * 1024);
    const clock = normalizeDashboard({ ...base, font,
      weatherForecast: { ...base.weatherForecast, tomorrow: true,
        date: '2026-10-15' } });
    const tomorrow = renderDashboardBmp(clock);
    assert.notEqual(sha(tomorrow), sha(full), font + ': tomorrow label must render');
    assert.equal(differentPixelsInRect(full, tomorrow, 182, 8, 499, 86).outside, 0);
    assert.equal(planDashboardLayout(clock).shownTasks, planDashboardLayout(src).shownTasks);
  }
});

test('different WMO codes produce different pixel icons', () => {
  const make = code => renderDashboardBmp(normalizeDashboard({
    ...base, weatherForecast: { ...base.weatherForecast,
      periods: base.weatherForecast.periods.map(p => ({ ...p, code })) }
  }));
  const icons = [0, 2, 3, 45, 61, 75, 95].map(code => sha(make(code)));
  assert.equal(new Set(icons).size, icons.length);
});

test('legacy clients without headerDate retain full date/header weather', () => {
  const old = normalizeDashboard({
    date: '14.10.2026', locale: 'ru', weather: '25° Перем.',
    events: [], tasks: []
  });
  assert.equal(old.headerDate, null);
  assert.equal(old.weatherForecast, null);
  const image = renderDashboardBmp(old);
  assert.equal(new DataView(image.buffer).getUint16(18, true), DASHBOARD_WIDTH);
});

test('new header and forecast schema reject bad data before storing', () => {
  for (const field of [
    { headerDate: { day: 32, weekday: 'СР', month: 'ОКТ' } },
    { headerDate: { day: 14, weekday: 'СР', month: '' } },
    { weatherForecast: { date: '2026-10-14', tomorrow: false, periods: [] } },
    { weatherForecast: { date: '2026-10-14', tomorrow: false,
      periods: [{ hour: 8, temp: 29, code: 0 },
        { hour: 14, temp: Infinity, code: 3 },
        { hour: 20, temp: 25, code: 61 }] } }
  ]) {
    assert.throws(() => normalizeDashboard({ ...base, ...field }), /headerDate|weatherForecast|weather/);
  }
});
