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

test('work freebusy-only calendar produces W Занято intervals without reading titles', () => {
  // This Calendar ID is not subscribed to the local CalendarApp, but Google's
  // FreeBusy API still returns availability to an authorized user.
  const sources = JSON.stringify([
    { id: 'primary', category: 'personal', showBadge: false },
    { id: 'work-only@company.com', category: 'work', mode: 'freebusy' }
  ]);
  const { ctx, posts, reads } = setupMultiCalendarSources(sources);
  const apiCalls = [];
  ctx.Utilities.parseDate = (value) => {
    const date = value.slice(0, 10);
    return new Date(date + 'T00:00:00+07:00');
  };
  ctx.Utilities.formatDate = (value, _zone, fmt) => {
    if (fmt === 'HH:mm') {
      const hour = (value.getUTCHours() + 7) % 24;
      return String(hour).padStart(2, '0') + ':' +
        String(value.getUTCMinutes()).padStart(2, '0');
    }
    return ({ 'yyyy-MM-dd': '2026-10-14', 'dd.MM.yyyy': '14.10.2026' })[fmt];
  };
  ctx.ScriptApp = { getOAuthToken: () => 'access-token' };
  ctx.UrlFetchApp.fetch = (url, opts) => {
    if (url === 'https://www.googleapis.com/calendar/v3/freeBusy') {
      apiCalls.push({ url, opts });
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({
          calendars: { 'work-only@company.com': { busy: [
            // A busy period crossing midnight should clip to local day.
            { start: '2026-10-13T16:30:00Z', end: '2026-10-13T18:00:00Z' },
            { start: '2026-10-14T02:00:00Z', end: '2026-10-14T03:30:00Z' },
            // Period ending before midnight tomorrow is out of range.
            { start: '2026-10-14T17:00:00Z', end: '2026-10-14T18:00:00Z' }
          ] } }
        })
      };
    }
    posts.push(JSON.parse(opts.payload));
    return { getResponseCode: () => 200 };
  };
  ctx.syncX3Dashboard();
  assert.deepEqual(reads, ['private@gmail.com']);
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].opts.headers.Authorization, 'Bearer access-token');
  const request = JSON.parse(apiCalls[0].opts.payload);
  assert.equal(request.timeMin, '2026-10-13T17:00:00.000Z');
  assert.equal(request.timeMax, '2026-10-14T17:00:00.000Z');
  assert.deepEqual(request.items, [{ id: 'work-only@company.com' }]);
  const work = posts[0].events.filter(e => e.calendar === 'work');
  assert.equal(work.length, 2);
  assert.deepEqual(work.map(e => [e.time, e.title, e.durationMinutes]), [
    ['00:00', 'Занято', 60], ['09:00', 'Занято', 90]
  ]);
});

test('freebusy API permission errors never wipe the last uploaded dashboard', () => {
  for (const failure of ['http403', 'calendarError', 'badJson']) {
    const { ctx, posts } = setupMultiCalendarSources(JSON.stringify([
      { id: 'work-only@company.com', category: 'work', mode: 'freebusy' }
    ]));
    ctx.Utilities.parseDate = value => new Date(value.slice(0,10) + 'T00:00:00Z');
    ctx.ScriptApp = { getOAuthToken: () => 'access-token' };
    ctx.UrlFetchApp.fetch = (_url, opts) => failure === 'http403'
      ? { getResponseCode: () => 403 }
      : failure === 'badJson'
        ? { getResponseCode: () => 200, getContentText: () => '{' }
        : { getResponseCode: () => 200,
            getContentText: () => JSON.stringify({
              calendars: { 'work-only@company.com': {
                errors: [{ reason: 'notFound' }], busy: []
              } }
            })
          };
    assert.throws(() => ctx.syncX3Dashboard(), /FreeBusy/);
    assert.equal(posts.length, 0);
  }
});

test('work calendar with CalendarApp blank title is still represented as busy', () => {
  const events = [
    { title: '', transparency: 'OPAQUE', min: 45 },
    { title: 'Busy', transparency: 'OPAQUE', min: 30 },
    { title: '', transparency: 'TRANSPARENT', min: 60 },
    { title: 'Planning', transparency: 'OPAQUE', min: 90 },
  ];
  const workCalendar = {
    getId: () => 'work@example.com',
    getEventsForDay: () => events.map((v, i) => ({
      getTitle: () => v.title,
      getTransparency: () => v.transparency,
      getStartTime: () => new Date(Date.UTC(2026,9,14,2 + i,0,0)),
      getEndTime: () => new Date(Date.UTC(2026,9,14,2 + i,0,0) + v.min*60000),
      isAllDayEvent: () => false,
      getId: () => 'event-' + i
    }))
  };
  const posts = [];
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => key === 'POCKET_UPLOAD_TOKEN' ? 'token'
        : key === 'CALENDAR_SOURCES'
          ? JSON.stringify([{ id: 'work@example.com', category: 'work' }]) : ''
    }) },
    Session: { getScriptTimeZone: () => 'Asia/Bangkok' },
    Utilities: { formatDate: (_now, _tz, fmt) => ({
      'yyyy-MM-dd': '2026-10-14',
      'dd.MM.yyyy': '14.10.2026', 'HH:mm': '09:00'
    })[fmt] },
    CalendarApp: { getCalendarById: () => workCalendar },
    Tasks: { Tasklists: { list: () => ({ items: [] }) } },
    UrlFetchApp: { fetch: (_url, opts) => {
      posts.push(JSON.parse(opts.payload));
      return { getResponseCode: () => 200 };
    } },
    console: { log: () => {} }, Date, JSON, Map
  };
  script.runInNewContext(ctx);
  ctx.syncX3Dashboard();
  assert.deepEqual(posts[0].events.map(e => [e.title, e.durationMinutes]), [
    ['Занято', 45], ['Занято', 30], ['Planning', 90]
  ]);
});
