import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { normalizeDashboard, renderDashboardBmp, convertDashboardBmpTo1Bit,
  DASHBOARD_FONTS } from '../src/dashboard.js';
import { refreshDashboardFreshness, dashboardStaleMinutes } from '../src/index.js';

const sample = () => ({
  date: 'СР · 14.10.2026', locale: 'ru', weather: '30° Дождь',
  events: [{ title: 'Встреча', time: '16:00', calendar: 'family', durationMinutes: 45 }],
  tasks: [{ title: 'Срок прошёл', done: false, overdue: true }]
});

test('weekday and weather header, overdue task mark and static stale footer render', () => {
  for (const font of DASHBOARD_FONTS) {
    const source = normalizeDashboard({ ...sample(), font });
    const bare = normalizeDashboard({
      ...sample(), font, weather: '',
      tasks: [{ title: 'Срок прошёл', done: false }]
    });
    const image = renderDashboardBmp(source);
    const old = renderDashboardBmp(bare);
    assert.notEqual(createHash('sha256').update(image).digest('hex'),
      createHash('sha256').update(old).digest('hex'));
    const warning = renderDashboardBmp(source, { stale: true, staleMinutes: 45 });
    assert.notEqual(createHash('sha256').update(warning).digest('hex'),
      createHash('sha256').update(image).digest('hex'));
    const compact = convertDashboardBmpTo1Bit(warning);
    assert.equal(new DataView(compact.buffer).getUint16(28, true), 1);
    assert.ok(compact.length < 1024 * 1024);
    assert.equal(source.tasks[0].overdue, true);
  }
});

test('cron marks BMP stale exactly once per successful upload', async () => {
  const objects = new Map();
  let writes = 0;
  const bucket = {
    get: async key => {
      const value = objects.get(key);
      return value ? { body: value.body, size: value.body.length } : null;
    },
    head: async key => {
      const value = objects.get(key);
      return value ? { size: value.body.length, customMetadata: value.options.customMetadata } : null;
    },
    put: async (key, body, options = {}) => {
      objects.set(key, { body: typeof body === 'string'
        ? new TextEncoder().encode(body) : new Uint8Array(body), options });
      writes++;
    }
  };
  const data = normalizeDashboard(sample());
  await bucket.put('dashboard/current.json', JSON.stringify(data));
  const env = { BOOKS_BUCKET: bucket, DASHBOARD_STALE_MINUTES: '45' };
  const started = Date.parse(data.generatedAt);
  assert.equal(dashboardStaleMinutes(env), 45);
  assert.equal(await refreshDashboardFreshness(env, new Date(started + 44 * 60000)), false);
  assert.equal(await refreshDashboardFreshness(env, new Date(started + 46 * 60000)), true);
  assert.equal(writes, 3);
  assert.equal(objects.get('dashboard/current-1bit.bmp').options.customMetadata.staleSource, data.generatedAt);
  assert.equal(await refreshDashboardFreshness(env, new Date(started + 90 * 60000)), false);
  assert.equal(writes, 3);
  const persisted = JSON.parse(new TextDecoder().decode(objects.get('dashboard/current.json').body));
  assert.equal(persisted.generatedAt, data.generatedAt);
});

test('cron is a no-op when no uploaded dashboard exists', async () => {
  assert.equal(await refreshDashboardFreshness({
    BOOKS_BUCKET: { get: async () => null }
  }), false);
});
