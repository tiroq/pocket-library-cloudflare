import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import app from '../src/index.js';
import { buildDemoDashboardPayload } from '../src/demo-dashboard.js';
import {
  DASHBOARD_FONTS, DASHBOARD_WIDTH, DASHBOARD_HEIGHT,
  normalizeDashboard, renderDashboardBmp, convertDashboardBmpTo1Bit
} from '../src/dashboard.js';

class MemoryR2 {
  constructor() { this.objects = new Map(); }
  async put(key, value, options = {}) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value)
      : new Uint8Array(value);
    this.objects.set(key, { bytes, options });
  }
  async get(key) {
    const obj = this.objects.get(key);
    return obj ? { body: obj.bytes, size: obj.bytes.byteLength } : null;
  }
  async head(key) {
    const obj = this.objects.get(key);
    return obj ? { size: obj.bytes.byteLength } : null;
  }
}
const env = () => ({
  BOOKS_BUCKET: new MemoryR2(),
  READ_USER: 'reader', READ_PASSWORD: 'read-secret', UPLOAD_TOKEN: 'write-secret'
});
const origin = 'https://books.tiroq.dev';
const request = (path, opts = {}) => new Request(origin + path, opts);
const reader = { Authorization: 'Basic ' + btoa('reader:read-secret') };
const writer = { Authorization: 'Bearer write-secret' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('demo builder uses real Thai calendar time, date and plausible synthetic weather', () => {
  const afternoon = buildDemoDashboardPayload(new Date('2026-10-14T09:45:00.000Z'));
  assert.equal(afternoon.date, 'СР · 14.10.2026');
  assert.deepEqual(afternoon.headerDate, { day: 14, weekday: 'СР', month: 'ОКТ' });
  assert.equal(afternoon.updated, '16:45');
  assert.deepEqual(afternoon.weatherForecast.periods.map(p => p.hour), [8, 14, 20]);
  assert.equal(afternoon.weatherForecast.date, '2026-10-14');
  assert.equal(afternoon.weatherForecast.tomorrow, false);
  assert.ok(afternoon.weatherForecast.periods.every(p =>
    p.temp >= 25 && p.temp <= 35 && Number.isInteger(p.code)));
  assert.ok(afternoon.events.length >= 6 && afternoon.events.length <= 20);
  assert.ok(afternoon.tasks.length >= 10 && afternoon.tasks.length <= 20);
  assert.deepEqual(new Set(afternoon.events.map(e => e.calendar)),
    new Set(['personal', 'work', 'shared', 'family']));
  assert.equal(afternoon.tasksOverdueCount, 3);
  assert.ok(afternoon.busyIntervals.length >= 5);
  assert.equal(normalizeDashboard(afternoon).tasksOverdueCount, 3);
  assert.ok(!JSON.stringify(afternoon).includes('UPLOAD_TOKEN'));

  const evening = buildDemoDashboardPayload(new Date('2026-10-14T14:10:00.000Z'));
  assert.equal(evening.date, afternoon.date, 'today icon stays on today');
  assert.equal(evening.updated, '21:10');
  assert.equal(evening.weatherForecast.tomorrow, true);
  assert.equal(evening.weatherForecast.date, '2026-10-15');

  const midnight = buildDemoDashboardPayload(new Date('2026-12-31T17:10:00.000Z'));
  assert.equal(midnight.date, 'ПТ · 01.01.2027');
  assert.equal(midnight.updated, '00:10');
  assert.equal(midnight.weatherForecast.date, '2027-01-01');
  assert.throws(() => buildDemoDashboardPayload(new Date('invalid')), /valid Date/);
});

test('DEMO MODE footer is distinct without moving the entire dashboard', () => {
  const demo = buildDemoDashboardPayload(new Date('2026-10-14T09:45:00.000Z'));
  for (const font of DASHBOARD_FONTS) {
    const data = normalizeDashboard({ ...demo, font });
    const base = renderDashboardBmp(data);
    const marked = renderDashboardBmp(data, { demo: true });
    assert.notEqual(hash(base), hash(marked), font + ': demo marker must change pixels');
    let changed = 0;
    for (let y = 0; y < DASHBOARD_HEIGHT; y++) {
      const row = 54 + (DASHBOARD_HEIGHT - 1 - y) * DASHBOARD_WIDTH * 3;
      for (let x = 0; x < DASHBOARD_WIDTH; x++) {
        if (base[row + x * 3] === marked[row + x * 3]) continue;
        changed++;
        assert.ok(x >= 195 && x <= 353 && y >= 748 && y <= 786,
          font + ': marker changed non-footer pixel at ' + x + ':' + y);
      }
    }
    assert.ok(changed > 20, font + ': DEMO MODE visible');
    const mono = convertDashboardBmpTo1Bit(marked);
    assert.equal(mono.length, 53918);
    assert.equal(new DataView(mono.buffer).getUint16(28, true), 1);
    assert.equal(new DataView(marked.buffer).getUint16(28, true), 24);
  }
});

test('demo refresh is write-token protected and never replaces real dashboard', async () => {
  const e = env();
  const prod = { date: '14.10.2026', locale: 'ru',
    events: [{ time: '09:00', title: 'Private event' }],
    tasks: [{ title: 'Private task' }] };
  assert.equal((await app.fetch(request('/dashboard/demo-1bit.bmp', {
    headers: reader
  }), e)).status, 404);
  assert.equal((await app.fetch(request('/api/dashboard/demo', {
    method: 'POST'
  }), e)).status, 401);
  assert.equal((await app.fetch(request('/api/dashboard/demo', {
    method: 'POST', headers: reader
  }), e)).status, 401);
  assert.equal(e.BOOKS_BUCKET.objects.size, 0);

  assert.equal((await app.fetch(request('/api/dashboard', {
    method: 'POST', headers: { ...writer, 'Content-Type': 'application/json' },
    body: JSON.stringify(prod)
  }), e)).status, 200);
  const original = [...e.BOOKS_BUCKET.objects.entries()]
    .filter(([k]) => k.startsWith('dashboard/current'))
    .map(([key, value]) => [key, hash(value.bytes)]);

  const response = await app.fetch(request('/api/dashboard/demo', {
    method: 'POST', headers: writer
  }), e);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.demo, true);
  assert.equal(payload.weather, 'synthetic');
  assert.equal(payload.imageUrl, '/dashboard/demo.bmp');
  assert.equal(payload.sleepImageUrl, '/dashboard/demo-1bit.bmp');
  assert.equal(payload.width, 528);
  assert.equal(payload.height, 792);
  assert.match(payload.localTime, /^[0-2]\d:[0-5]\d$/);
  assert.ok(Math.abs(Date.now() - Date.parse(payload.updatedAt)) < 60000);

  const updatedProd = await (await app.fetch(request('/api/dashboard', {
    headers: reader
  }), e)).json();
  assert.equal(updatedProd.events[0].title, 'Private event');
  assert.deepEqual([...e.BOOKS_BUCKET.objects.entries()]
    .filter(([k]) => k.startsWith('dashboard/current'))
    .map(([key, value]) => [key, hash(value.bytes)]), original);

  for (const [path, expectedDepth, expectedLength] of [
    ['/dashboard/demo-1bit.bmp', 1, 53918],
    ['/dashboard/demo.bmp', 24, 1254582],
  ]) {
    assert.equal((await app.fetch(request(path), e)).status, 401);
    const result = await app.fetch(request(path, { headers: reader }), e);
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('Content-Type'), 'image/bmp');
    assert.equal(result.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(result.headers.get('Content-Disposition'), 'inline; filename="sleep.bmp"');
    assert.equal(Number(result.headers.get('Content-Length')), expectedLength);
    const bytes = new Uint8Array(await result.arrayBuffer());
    assert.equal(bytes.length, expectedLength);
    assert.equal(new DataView(bytes.buffer).getUint16(28, true), expectedDepth);
    const head = await app.fetch(request(path, { headers: reader, method: 'HEAD' }), e);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('Content-Length'), String(expectedLength));
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  const demoData = await (await app.fetch(request('/api/dashboard/demo', {
    headers: reader
  }), e)).json();
  assert.equal(demoData.events.length, 6);
  assert.equal(demoData.tasks.length, 12);
  assert.equal(demoData.tasksOverdueCount, 3);
  assert.ok(demoData.weatherForecast);
  assert.ok(!JSON.stringify(demoData).includes('Private'));

  assert.equal((await app.fetch(request('/dashboard-1bit.bmp', {
    headers: reader
  }), e)).status, 200);
  assert.equal((await app.fetch(request('/opds.xml', {
    headers: reader
  }), { ...e, BOOKS_BUCKET: {
    ...e.BOOKS_BUCKET, list: async () => ({ objects: [], truncated: false, cursor: '' })
  } })).status, 200);
});
