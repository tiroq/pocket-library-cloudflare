import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.js';
import { DASHBOARD_WIDTH, DASHBOARD_HEIGHT, normalizeDashboard, renderDashboardBmp, convertDashboardBmpTo1Bit } from '../src/dashboard.js';

class MemoryR2 {
  constructor() { this.objects = new Map(); }
  async put(key, body, options = {}) {
    this.objects.set(key, { bytes: typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body), options });
  }
  async head(key) {
    const x = this.objects.get(key); return x ? { size: x.bytes.byteLength } : null;
  }
  async get(key) {
    const x = this.objects.get(key);
    return x ? { size: x.bytes.byteLength, body: x.bytes } : null;
  }
  // The dashboard tests also assert the existing OPDS route is unaffected.
  async list({ prefix, limit, cursor }) {
    return { objects: [], truncated: false, cursor: '' };
  }
}
const env = () => ({ BOOKS_BUCKET: new MemoryR2(), READ_USER: 'reader', READ_PASSWORD: 'read-secret', UPLOAD_TOKEN: 'write-secret' });
const ROOT = 'https://books.tiroq.dev';
const reader = { Authorization: 'Basic ' + btoa('reader:read-secret') };
const writer = { Authorization: 'Bearer write-secret', 'Content-Type': 'application/json' };
const example = {
  locale: 'ru', date: 'СРЕДА 14 ОКТЯБРЯ',
  events: [{ time: '09:30', title: 'Встреча с командой' }, { time: '15:00', title: 'Tennis' }],
  tasks: ['Проверить CI', { title: 'Сделать заметки', done: true }],
  note: 'Вопросы для созвона', updated: '13:41'
};
const request = (path, options = {}) => new Request(ROOT + path, options);

test('dashboard schema validation and Unicode', () => {
  assert.equal(normalizeDashboard(example).events[0].title, 'Встреча с командой');
  assert.throws(() => normalizeDashboard({ date: 'now', tasks: [], events: 'x' }), /arrays/);
  assert.throws(() => normalizeDashboard({ date: ' ', tasks: [], events: [] }), /date/);
  assert.throws(() => normalizeDashboard({ date: 'now', tasks: [], events: [{ title: 123 }] }), /strings/);
  assert.throws(() => normalizeDashboard({ date: 'now', tasks: [], events: new Array(21).fill({ title: 'hi' }) }), /Maximum/);
});

test('render exact X3 BMP with supported 24-bit uncompressed header and Cyrillic pixels', () => {
  const bmp = renderDashboardBmp(normalizeDashboard(example));
  const view = new DataView(bmp.buffer);
  assert.equal(bmp[0], 0x42); assert.equal(bmp[1], 0x4d);
  assert.equal(view.getUint32(2, true), bmp.length);
  assert.equal(view.getInt32(18, true), DASHBOARD_WIDTH);
  assert.equal(view.getInt32(22, true), DASHBOARD_HEIGHT);
  assert.equal(view.getUint16(28, true), 24);
  assert.equal(view.getUint32(30, true), 0);
  assert.equal(view.getUint32(10, true), 54);
  // White corners, black calendar header and a black section divider.
  assert.equal(bmp[54], 255);
  assert.ok(bmp.subarray(54).includes(0));
  const row = 54 + (DASHBOARD_HEIGHT - 1 - 118) * (DASHBOARD_WIDTH * 3);
  assert.equal(bmp[row + 30 * 3], 0);
});

test('private upload, fetch, download and HEAD work with separate credentials', async () => {
  const e = env();
  assert.equal((await app.fetch(request('/dashboard.bmp', { headers: reader }), e)).status, 404);
  assert.equal((await app.fetch(request('/api/dashboard', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(example) }), e)).status, 401);
  const res = await app.fetch(request('/api/dashboard', { method: 'POST', headers: writer, body: JSON.stringify(example) }), e);
  assert.equal(res.status, 200);
  const reply = await res.json();
  assert.deepEqual([reply.ok, reply.width, reply.height, reply.events, reply.tasks], [true, 528, 792, 2, 2]);
  assert.equal((await app.fetch(request('/dashboard.bmp'), e)).status, 401);
  assert.equal((await app.fetch(request('/dashboard.bmp', { headers: writer }), e)).status, 401);
  const pic = await app.fetch(request('/dashboard.bmp', { headers: reader }), e);
  assert.equal(pic.status, 200);
  assert.equal(pic.headers.get('Content-Type'), 'image/bmp');
  assert.equal(pic.headers.get('Cache-Control'), 'private, no-store');
  const bytes = new Uint8Array(await pic.arrayBuffer());
  assert.equal(bytes[0], 0x42); assert.equal(bytes[1], 0x4d);
  const head = await app.fetch(request('/dashboard.bmp', { method: 'HEAD', headers: reader }), e);
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('Content-Length')), bytes.length);
  const data = await (await app.fetch(request('/api/dashboard', { headers: reader }), e)).json();
  assert.equal(data.events[0].title, 'Встреча с командой');
  assert.ok(!e.BOOKS_BUCKET.objects.has('books/current.bmp'));
});

test('reject malformed JSON and unsupported content types without modifying stored image', async () => {
  const e = env();
  const badType = await app.fetch(request('/api/dashboard', { method: 'POST', headers: { Authorization: 'Bearer write-secret', 'Content-Type': 'text/plain' }, body: 'hello' }), e);
  assert.equal(badType.status, 415);
  const badJson = await app.fetch(request('/api/dashboard', { method: 'POST', headers: writer, body: '{' }), e);
  assert.equal(badJson.status, 400);
  const badValue = await app.fetch(request('/api/dashboard', { method: 'POST', headers: writer, body: JSON.stringify({ date: '', events: [], tasks: [] }) }), e);
  assert.equal(badValue.status, 400);
  const oversized = await app.fetch(request('/api/dashboard', { method: 'POST', headers: writer, body: 'x'.repeat(24577) }), e);
  assert.equal(oversized.status, 413);
  assert.equal(e.BOOKS_BUCKET.objects.size, 0);
});


test('compact dashboard is valid 1-bit BMP, < 1 MiB, and pixel-identical to 24-bit dashboard', () => {
  const src = renderDashboardBmp(normalizeDashboard(example));
  const mono = convertDashboardBmpTo1Bit(src);
  const h = new DataView(mono.buffer);
  assert.equal(mono[0], 0x42); assert.equal(mono[1], 0x4d);
  assert.equal(h.getUint32(2, true), mono.length);
  assert.equal(h.getUint32(10, true), 62);
  assert.equal(h.getUint32(14, true), 40);
  assert.equal(h.getInt32(18, true), 528);
  assert.equal(h.getInt32(22, true), 792);
  assert.equal(h.getUint16(26, true), 1);
  assert.equal(h.getUint16(28, true), 1);
  assert.equal(h.getUint32(30, true), 0);
  assert.deepEqual([...mono.subarray(54, 62)], [0, 0, 0, 0, 255, 255, 255, 0]);
  const stride = Math.ceil(528 / 32) * 4;
  assert.equal(mono.length, 62 + stride * 792);
  assert.ok(mono.length < 1024 * 1024, 'CrossPoint 1 MiB download cap');
  // Compare every pixel, including each row's first/last pixel and glyphs.
  for (let row = 0; row < DASHBOARD_HEIGHT; row++) {
    const sourceRow = 54 + row * DASHBOARD_WIDTH * 3;
    const monoRow = 62 + row * stride;
    for (let x = 0; x < DASHBOARD_WIDTH; x++) {
      const actual = (mono[monoRow + (x >>> 3)] >>> (7 - (x & 7))) & 1;
      assert.equal(actual, src[sourceRow + x * 3] === 255 ? 1 : 0,
        'pixel mismatch at (' + x + ',' + row + ')');
    }
  }
});

test('compact BMP uses existing Basic read auth and is stored in private R2 on update', async () => {
  const e = env();
  assert.equal((await app.fetch(request('/dashboard-1bit.bmp', { headers: reader }), e)).status, 404);
  assert.equal((await app.fetch(request('/dashboard-1bit.bmp'), e)).status, 401);
  const post = await app.fetch(request('/api/dashboard', {
    method: 'POST', headers: writer, body: JSON.stringify(example)
  }), e);
  assert.equal(post.status, 200);
  const result = await post.json();
  assert.equal(result.sleepImageUrl, '/dashboard-1bit.bmp');
  assert.ok(e.BOOKS_BUCKET.objects.has('dashboard/current-1bit.bmp'));
  assert.ok(e.BOOKS_BUCKET.objects.has('dashboard/current.bmp'));
  assert.ok(e.BOOKS_BUCKET.objects.has('dashboard/current.json'));
  const get = await app.fetch(request('/dashboard-1bit.bmp', { headers: reader }), e);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Content-Type'), 'image/bmp');
  assert.match(get.headers.get('Content-Disposition'), /sleep.bmp/);
  assert.equal(get.headers.get('Cache-Control'), 'private, no-store');
  const bytes = new Uint8Array(await get.arrayBuffer());
  assert.equal(new DataView(bytes.buffer).getUint16(28, true), 1);
  assert.ok(bytes.length < 1024 * 1024);
  const head = await app.fetch(request('/dashboard-1bit.bmp', { method: 'HEAD', headers: reader }), e);
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get('Content-Length')), bytes.length);
  assert.equal((await app.fetch(request('/dashboard-1bit.bmp', { headers: writer }), e)).status, 401);
  assert.equal((await app.fetch(request('/opds.xml', { headers: reader }), e)).status, 200);
});
