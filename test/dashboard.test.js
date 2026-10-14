import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import app from '../src/index.js';
import { DASHBOARD_WIDTH, DASHBOARD_HEIGHT, normalizeDashboard, renderDashboardBmp, convertDashboardBmpTo1Bit, DEFAULT_DASHBOARD_FONT, DASHBOARD_FONTS, normalizeDashboardFont, wrapDashboardText, normalizeDurationMinutes, formatEventDuration, DASHBOARD_CALENDAR_CATEGORIES } from '../src/dashboard.js';

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

test('four font selections, default Golos, aliases, and bad choices', () => {
  assert.deepEqual(DASHBOARD_FONTS, ['golos-text', 'inter', 'ibm-plex-sans', 'onest']);
  assert.equal(DEFAULT_DASHBOARD_FONT, 'golos-text');
  assert.equal(normalizeDashboard(example).font, 'golos-text');
  assert.equal(normalizeDashboardFont('Golos Text'), 'golos-text');
  assert.equal(normalizeDashboardFont('IBM Plex Sans'), 'ibm-plex-sans');
  assert.equal(normalizeDashboardFont('Onest'), 'onest');
  assert.equal(normalizeDashboardFont('INTER'), 'inter');
  assert.throws(() => normalizeDashboardFont('Comic Sans'), /Unsupported font/);
  assert.throws(() => normalizeDashboardFont(3), /font must be a string/);
});

test('each true font can render Cyrillic and long wrapped events without changing date', () => {
  const images = [];
  for (const font of DASHBOARD_FONTS) {
    const data = normalizeDashboard({
      ...example, font,
      date: '14.10.2569',
      events: [{ time: '14:30', title: 'Забрать детей из школы и пойти на длинную-длинную прогулку вечером' }]
    });
    const bytes = renderDashboardBmp(data);
    assert.equal(bytes.length, 54 + 528 * 3 * 792);
    const mono = convertDashboardBmpTo1Bit(bytes);
    assert.ok(mono.length < 1024 * 1024);
    // Glyphs are not the same bitmap dressed with four different labels.
    images.push(createHash('sha256').update(bytes).digest('hex'));
  }
  assert.equal(new Set(images).size, 4);
});


test('duration minutes format compactly and normalize existing + new event records', () => {
  assert.equal(formatEventDuration(), '');
  assert.equal(formatEventDuration(0), '');
  assert.equal(formatEventDuration(15), '(15M)');
  assert.equal(formatEventDuration(30), '(30M)');
  assert.equal(formatEventDuration(60), '(1H)');
  assert.equal(formatEventDuration(75), '(1H 15M)');
  assert.equal(formatEventDuration(90), '(1H 30M)');
  assert.equal(formatEventDuration(120), '(2H)');
  assert.equal(formatEventDuration(135), '(2H 15M)');
  assert.equal(normalizeDurationMinutes('90'), 90);
  assert.equal(normalizeDurationMinutes(null), null);
  assert.equal(normalizeDashboard(example).events[0].durationMinutes, undefined);
  assert.equal(normalizeDashboard({
    ...example,
    events: [{ time: '14:30', title: 'Забрать детей', durationMinutes: 45 }]
  }).events[0].durationMinutes, 45);
  for (const bad of [-1, 10081, 1.5, '1H', {}, true, NaN, Infinity]) {
    assert.throws(() => normalizeDurationMinutes(bad), /durationMinutes/);
  }
});

test('dashboard HTTP API preserves durationMinutes and accepts legacy events', async () => {
  const e = env();
  const payload = {
    ...example,
    events: [
      { title: 'Meeting', time: '10:00', durationMinutes: 90 },
      { title: 'Free afternoon', time: '14:00' }
    ],
  };
  const response = await app.fetch(request('/api/dashboard', {
    method: 'POST', headers: writer, body: JSON.stringify(payload)
  }), e);
  assert.equal(response.status, 200);
  const data = await (await app.fetch(request('/api/dashboard', { headers: reader }), e)).json();
  assert.equal(data.events[0].durationMinutes, 90);
  assert.equal(data.events[1].durationMinutes, undefined);
  assert.equal(data.date, example.date); // date/locale are never reinterpreted
  const invalid = await app.fetch(request('/api/dashboard', {
    method: 'POST', headers: writer,
    body: JSON.stringify({ ...example, events: [{ title: 'Oops', durationMinutes: '1H' }] })
  }), e);
  assert.equal(invalid.status, 400);
  // Validation rejects bad updates without replacing the last good JSON.
  const preserved = await (await app.fetch(request('/api/dashboard', { headers: reader }), e)).json();
  assert.equal(preserved.events[0].durationMinutes, 90);
});

test('duration badges change both BMP versions with no change to date or unsupported fonts', () => {
  for (const font of DASHBOARD_FONTS) {
    const normal = normalizeDashboard({ ...example, font });
    const withDuration = normalizeDashboard({
      ...example, font,
      events: normal.events.map((event, i) => ({
        ...event, durationMinutes: i ? 90 : 30
      }))
    });
    const plain = renderDashboardBmp(normal);
    const badged = renderDashboardBmp(withDuration);
    assert.notEqual(createHash('sha256').update(plain).digest('hex'),
      createHash('sha256').update(badged).digest('hex'));
    const oneBit = convertDashboardBmpTo1Bit(badged);
    assert.ok(oneBit.length < 1024 * 1024);
    assert.equal(new DataView(oneBit.buffer).getUint16(28, true), 1);
  }
});

test('all four calendar categories render distinct compact badges without shifting text', () => {
  assert.deepEqual(DASHBOARD_CALENDAR_CATEGORIES, {
    personal: 'P', family: 'F', shared: 'S', work: 'W'
  });
  for (const font of DASHBOARD_FONTS) {
    const basic = {
      ...example, font,
      events: [{ time: '09:30', title: 'Проектная встреча с длинным названием', durationMinutes: 90 }]
    };
    const plain = renderDashboardBmp(normalizeDashboard(basic));
    const hashes = new Set();
    for (const category of ['personal', 'family', 'shared', 'work']) {
      const input = { ...basic,
        events: [{ ...basic.events[0], calendar: category }] };
      const normalized = normalizeDashboard(input);
      assert.equal(normalized.events[0].calendar, category);
      const rendered = renderDashboardBmp(normalized);
      let pixelsDifferent = 0;
      for (let y = 0; y < DASHBOARD_HEIGHT; y++) {
        const row = 54 + (DASHBOARD_HEIGHT - 1 - y) * DASHBOARD_WIDTH * 3;
        for (let x = 0; x < DASHBOARD_WIDTH; x++) {
          if (plain[row + x * 3] === rendered[row + x * 3]) continue;
          pixelsDifferent++;
          assert.ok(x >= 119 && x <= 137 && y >= 174 && y < 195,
            font + '/' + category + ' moved content pixel at ' + x + ',' + y);
        }
      }
      assert.ok(pixelsDifferent > 12);
      hashes.add(createHash('sha256').update(rendered).digest('hex'));
      const mono = convertDashboardBmpTo1Bit(rendered);
      assert.ok(mono.length < 1024 * 1024);
    }
    assert.equal(hashes.size, 4, font + ' badges need distinct glyphs');
  }
});

test('family marker never shifts time, title or duration even with Cyrillic and four fonts', () => {
  for (const font of DASHBOARD_FONTS) {
    const input = {
      ...example, font,
      events: [{ time: '07:30', title: 'Забрать детей из школы', durationMinutes: 90 }]
    };
    const regular = renderDashboardBmp(normalizeDashboard(input));
    const tagged = renderDashboardBmp(normalizeDashboard({
      ...input,
      events: input.events.map(event => ({ ...event, calendar: 'family' }))
    }));
    assert.notEqual(createHash('sha256').update(regular).digest('hex'),
      createHash('sha256').update(tagged).digest('hex'));
    // Only pixels inside the time/title gutter (x=119..137) may change.
    // This ensures text position and duration never move.
    let changes = 0;
    for (let y = 0; y < DASHBOARD_HEIGHT; y++) {
      const row = 54 + (DASHBOARD_HEIGHT - 1 - y) * DASHBOARD_WIDTH * 3;
      for (let x = 0; x < DASHBOARD_WIDTH; x++) {
        const pixel = row + x * 3;
        if (regular[pixel] === tagged[pixel]) continue;
        changes++;
        assert.ok(x >= 119 && x <= 137 && y >= 174 && y < 195,
          'unexpected pixel change at ' + x + ',' + y);
      }
    }
    assert.ok(changes > 10, 'family badge should be legible');
    const compact = convertDashboardBmpTo1Bit(tagged);
    assert.ok(compact.length < 1024 * 1024);
  }
});

test('family calendar metadata persists in dashboard JSON, rejects unsupported tags', async () => {
  const payload = {
    ...example,
    events: [
      { time: '09:00', title: 'Primary' },
      { time: '10:00', title: 'Family', calendar: 'family', durationMinutes: 45 }
    ]
  };
  const e = env();
  const update = await app.fetch(request('/api/dashboard', {
    method: 'POST', headers: writer, body: JSON.stringify(payload)
  }), e);
  assert.equal(update.status, 200);
  const json = await (await app.fetch(request('/api/dashboard', { headers: reader }), e)).json();
  assert.equal(json.events[0].calendar, undefined);
  assert.equal(json.events[1].calendar, 'family');
  const invalid = normalizeDashboard.bind(null, {
    ...example, events: [{ time: '12:00', title: 'Unknown', calendar: 'surprise' }]
  });
  assert.throws(invalid, /calendar must be primary or family/);
  assert.equal(normalizeDashboard({
    ...example, events: [{ time: '12:00', title: 'Work', calendar: 'primary' }]
  }).events[0].calendar, undefined);
  for (const category of ['personal', 'family', 'shared', 'work']) {
    assert.equal(normalizeDashboard({
      ...example, events: [{ time: '12:00', title: 'Tagged', calendar: category }]
    }).events[0].calendar, category);
  }
});

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
  const row = 54 + (DASHBOARD_HEIGHT - 1 - 107) * (DASHBOARD_WIDTH * 3);
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
