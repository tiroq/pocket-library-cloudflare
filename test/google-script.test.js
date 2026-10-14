import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const code = readFileSync(new URL('../scripts/google-calendar-tasks.gs', import.meta.url), 'utf8');
const script = new Script(code, { filename: 'google-calendar-tasks.gs' });

test('Google Apps Script example parses as standard JavaScript', () => {
  assert.ok(script);
});

test('Google Calendar event duration and Google Tasks produce one complete private payload', () => {
  const calls = [];
  const start = new Date('2026-10-14T02:30:00Z');
  const end = new Date('2026-10-14T04:00:00Z');
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: k => ({
        POCKET_UPLOAD_TOKEN: 'test-token', DASHBOARD_FONT: 'golos-text'
      })[k] })
    },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: {
      formatDate: (_date, _timezone, format) =>
        ({ 'yyyy-MM-dd': '2026-10-14', 'dd.MM.yyyy': '14.10.2026', 'HH:mm': '09:30' })[format]
    },
    CalendarApp: {
      getDefaultCalendar: () => ({
        getId: () => 'primary-id',
        getEventsForDay: () => [{
          getTitle: () => 'Командная встреча',
          getStartTime: () => start,
          getEndTime: () => end,
          isAllDayEvent: () => false
        }]
      })
    },
    Tasks: {
      Tasklists: { list: () => ({ items: [{ id: 'personal' }] }) },
      Tasks: { list: () => ({ items: [
        { title: 'Купить продукты', due: '2026-10-14T00:00:00.000Z', status: 'needsAction' },
        { title: 'Просроченная задача', due: '2026-10-13T00:00:00.000Z', status: 'needsAction' },
        { title: 'Завтра', due: '2026-10-15T00:00:00.000Z', status: 'needsAction' },
        { title: 'Готово', due: '2026-10-14T00:00:00.000Z', status: 'completed' },
      ] }) }
    },
    UrlFetchApp: {
      fetch: (url, options) => {
        calls.push({ url, options });
        return { getResponseCode: () => 200 };
      }
    },
    console: { log: () => {} },
    Date,
    JSON,
  };
  script.runInNewContext(context);
  context.syncX3Dashboard();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://books.tiroq.dev/api/dashboard');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-token');
  const payload = JSON.parse(calls[0].options.payload);
  assert.equal(payload.events[0].durationMinutes, 90);
  assert.deepEqual(payload.tasks.map(t => t.title), ['Купить продукты', 'Просроченная задача']);
  assert.equal(payload.tasks.some(t => t.title === 'Готово'), false);
  assert.equal(payload.date, '14.10.2026');
  assert.equal(payload.font, 'golos-text');
});

test('shared family calendar is added to primary and its events receive F marker metadata', () => {
  const now = new Date('2026-10-14T02:30:00Z');
  const calendarsRead = [];
  const sent = [];
  const primary = {
    getId: () => 'primary-id',
    getEventsForDay: () => [{
      getTitle: () => 'Личная встреча',
      isAllDayEvent: () => false,
      getStartTime: () => new Date('2026-10-14T02:30:00Z'),
      getEndTime: () => new Date('2026-10-14T03:30:00Z')
    }]
  };
  const family = {
    getId: () => 'family-id',
    getEventsForDay: () => [{
      getTitle: () => 'Семейное мероприятие',
      isAllDayEvent: () => false,
      getStartTime: () => new Date('2026-10-14T04:30:00Z'),
      getEndTime: () => new Date('2026-10-14T05:15:00Z')
    }]
  };
  const makeContext = (calendarIds = '') => ({
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: k => ({
          POCKET_UPLOAD_TOKEN: 'test-token',
          FAMILY_CALENDAR_ID: 'family-id',
          CALENDAR_IDS: calendarIds
        })[k]
      })
    },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: {
      formatDate: (_date, _tz, fmt) => ({
        'yyyy-MM-dd': '2026-10-14',
        'dd.MM.yyyy': '14.10.2026',
        'HH:mm': '11:30'
      })[fmt]
    },
    CalendarApp: {
      getDefaultCalendar: () => primary,
      getCalendarById: id => {
        calendarsRead.push(id);
        return id === 'family-id' ? family : id === 'primary-id' ? primary : null;
      }
    },
    Tasks: {
      Tasklists: { list: () => ({ items: [] }) },
      Tasks: { list: () => ({ items: [] }) }
    },
    UrlFetchApp: { fetch: (_url, options) => {
      sent.push(JSON.parse(options.payload));
      return { getResponseCode: () => 200 };
    } },
    console: { log: () => {} },
    Date,
    JSON
  });
  const one = makeContext();
  script.runInNewContext(one);
  one.syncX3Dashboard();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].events.map(e => e.title),
    ['Личная встреча', 'Семейное мероприятие']);
  assert.equal(sent[0].events[0].calendar, undefined);
  assert.equal(sent[0].events[1].calendar, 'family');
  assert.equal(sent[0].events[1].durationMinutes, 45);
  assert.deepEqual(calendarsRead, ['family-id']);

  // Family is not duplicated if an existing CALENDAR_IDS list also has it.
  calendarsRead.length = 0;
  const two = makeContext('primary-id,family-id,family-id');
  script.runInNewContext(two);
  two.syncX3Dashboard();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].events.length, 2);
  assert.equal(sent[1].events.filter(e => e.calendar === 'family').length, 1);
  assert.deepEqual(calendarsRead, ['primary-id', 'family-id']);
});

test('inaccessible configured family calendar fails loudly, not silently', () => {
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => k === 'POCKET_UPLOAD_TOKEN' ? 'test-token'
        : k === 'FAMILY_CALENDAR_ID' ? 'not-shared-id' : ''
    }) },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: { formatDate: () => '2026-10-14' },
    CalendarApp: {
      getDefaultCalendar: () => ({ getId: () => 'primary', getEventsForDay: () => [] }),
      getCalendarById: () => null
    },
    Date, JSON,
  };
  script.runInNewContext(ctx);
  assert.throws(() => ctx.syncX3Dashboard(), /FAMILY_CALENDAR_ID is not accessible/);
});

function setupMultiCalendarSources(sourceConfig, extraProperties = {}) {
  const posts = [];
  const reads = [];
  const timed = (name, hour, uid, minutes = 30) => ({
    getTitle: () => name,
    isAllDayEvent: () => false,
    getStartTime: () => new Date('2026-10-14T' + String(hour).padStart(2,'0') + ':00:00Z'),
    getEndTime: () => new Date(Date.parse('2026-10-14T' + String(hour).padStart(2,'0') + ':00:00Z') + minutes * 60000),
    getId: () => uid
  });
  const sources = {
    'private@gmail.com': [timed('Личное', 2, 'personal-uid'), timed('Дубликат созвона', 4, 'shared-uid')],
    'family@group.calendar.google.com': [timed('Школа', 3, 'family-uid')],
    'friends@group.calendar.google.com': [timed('Встреча с друзьями', 5, 'friends-uid')],
    'work@company.com': [timed('Дубликат созвона', 4, 'shared-uid'), timed('Работа', 6, 'work-uid')],
  };
  const primary = 'private@gmail.com';
  const getCal = id => sources[id] && {
    getId: () => id,
    getEventsForDay: () => {
      reads.push(id);
      return sources[id];
    }
  };
  const values = {
    POCKET_UPLOAD_TOKEN: 'test-token',
    ...(sourceConfig === undefined ? {} : { CALENDAR_SOURCES: sourceConfig }),
    ...extraProperties
  };
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => values[key] ?? null
    }) },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: { formatDate: (_date, _zone, fmt) => ({
      'yyyy-MM-dd': '2026-10-14',
      'dd.MM.yyyy': '14.10.2026',
      'HH:mm': '09:00'
    })[fmt] },
    CalendarApp: {
      getDefaultCalendar: () => getCal(primary),
      getCalendarById: getCal,
      getAllCalendars: () => Object.keys(sources).map(getCal)
    },
    Tasks: {
      Tasklists: { list: () => ({ items: [] }) },
      Tasks: { list: () => ({ items: [] }) }
    },
    UrlFetchApp: { fetch: (_url, args) => {
      posts.push(JSON.parse(args.payload));
      return { getResponseCode: () => 200 };
    } },
    console: { log: () => {} },
    Date, JSON, Set, Map
  };
  script.runInNewContext(ctx);
  return { ctx, posts, reads };
}

test('CALENDAR_SOURCES merges four categories, disables sources and deduplicates true invitations', () => {
  const config = JSON.stringify([
    { id: 'primary', category: 'personal', enabled: true, label: 'P' },
    { id: 'family@group.calendar.google.com', category: 'family' },
    { id: 'friends@group.calendar.google.com', category: 'shared', enabled: true },
    { id: 'work@company.com', category: 'work', enabled: true, label: 'W' },
    { id: 'unknown@example.com', category: 'work', enabled: false }
  ]);
  const { ctx, posts, reads } = setupMultiCalendarSources(config, {
    FAMILY_CALENDAR_ID: 'unknown-legacy@example.com',
    CALENDAR_IDS: 'unknown-legacy@example.com'
  });
  ctx.syncX3Dashboard();
  assert.deepEqual(reads, [
    'private@gmail.com', 'family@group.calendar.google.com',
    'friends@group.calendar.google.com', 'work@company.com'
  ]);
  assert.equal(posts.length, 1);
  const items = posts[0].events;
  assert.deepEqual(items.map(item => [item.title, item.calendar, item.durationMinutes]), [
    ['Личное', 'personal', 30],
    ['Школа', 'family', 30],
    ['Дубликат созвона', 'work', 30],
    ['Встреча с друзьями', 'shared', 30],
    ['Работа', 'work', 30]
  ]);
});

test('CALENDAR_SOURCES supports hiding personal marker and dedups calendar IDs', () => {
  const config = JSON.stringify([
    { id: 'primary', category: 'personal', showBadge: false },
    { id: 'private@gmail.com', category: 'personal', showBadge: false },
    { id: 'family@group.calendar.google.com', category: 'family' }
  ]);
  const { ctx, posts, reads } = setupMultiCalendarSources(config);
  ctx.syncX3Dashboard();
  assert.deepEqual(reads, ['private@gmail.com', 'family@group.calendar.google.com']);
  assert.equal(posts[0].events[0].calendar, undefined);
  assert.equal(posts[0].events.filter(item => item.calendar === 'family').length, 1);
});

test('CALENDAR_SOURCES rejects malformed or inaccessible entries instead of silently dropping', () => {
  const configs = [
    '{broken',
    JSON.stringify({ id: 'primary', category: 'personal' }),
    JSON.stringify([{ id: 'primary', category: 'unknown' }]),
    JSON.stringify([{ id: 'primary', category: 'family', enabled: 'yes' }]),
    JSON.stringify([{ id: 'primary', category: 'personal', label: 'W' }]),
    JSON.stringify([{ id: 'primary', category: 'personal', showBadge: 'no' }]),
    JSON.stringify([{ id: 'not-shared@gmail.com', category: 'work' }]),
    JSON.stringify([
      { id: 'primary', category: 'personal' },
      { id: 'private@gmail.com', category: 'work' }
    ])
  ];
  for (const config of configs) {
    const { ctx, posts } = setupMultiCalendarSources(config);
    assert.throws(() => ctx.syncX3Dashboard(), /CALENDAR_SOURCES|Calendar source|Duplicate calendar ID/);
    assert.equal(posts.length, 0, 'never publish incomplete snapshots');
  }
});

test('old CALENDAR_IDS + FAMILY_CALENDAR_ID and primary-only behavior remain unchanged', () => {
  const old = setupMultiCalendarSources(undefined, {
    CALENDAR_IDS: 'private@gmail.com,family@group.calendar.google.com',
    FAMILY_CALENDAR_ID: 'family@group.calendar.google.com'
  });
  old.ctx.syncX3Dashboard();
  assert.equal(old.posts[0].events[0].calendar, undefined);
  assert.equal(old.posts[0].events.find(e => e.title === 'Школа').calendar, 'family');
  assert.equal(old.reads.length, 2);

  const primaryOnly = setupMultiCalendarSources();
  primaryOnly.ctx.syncX3Dashboard();
  assert.deepEqual(primaryOnly.reads, ['private@gmail.com']);
  assert.ok(primaryOnly.posts[0].events.every(item => !item.calendar));
});
