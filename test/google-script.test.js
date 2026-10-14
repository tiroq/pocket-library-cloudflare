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
        POCKET_UPLOAD_TOKEN: 'test-token', DASHBOARD_FONT: 'golos-text', EVENTS_MODE: 'all'
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
  assert.deepEqual(payload.tasks.map(t => t.title), ['Просроченная задача', 'Купить продукты']);
  assert.equal(payload.tasks.some(t => t.title === 'Готово'), false);
  assert.equal(payload.date, 'СР · 14.10.2026');
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
          EVENTS_MODE: 'all',
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
    EVENTS_MODE: 'all',
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
        : key === 'EVENTS_MODE' ? 'all'
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

test('FreeBusy 403 error exposes safe Google reason without leaking credentials or calendar IDs', () => {
  const config = JSON.stringify([
    { id: 'sensitive-work-id@company.com', category: 'work', mode: 'freebusy' }
  ]);
  const { ctx, posts } = setupMultiCalendarSources(config);
  ctx.Utilities.parseDate = value => new Date(value.slice(0, 10) + 'T00:00:00Z');
  ctx.ScriptApp = { getOAuthToken: () => 'very-secret-oauth-token' };
  ctx.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 403,
    getContentText: () => JSON.stringify({ error: {
      status: 'PERMISSION_DENIED',
      errors: [{ reason: 'insufficientPermissions', message: 'secret-work-id@company.com' }],
      details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
      message: 'Token very-secret-oauth-token for sensitive-work-id@company.com was refused'
    } })
  });
  assert.throws(() => ctx.syncX3Dashboard(), error => {
    assert.match(error.message, /HTTP 403/);
    assert.match(error.message, /insufficientPermissions/);
    assert.match(error.message, /ACCESS_TOKEN_SCOPE_INSUFFICIENT/);
    assert.doesNotMatch(error.message, /very-secret|work-id@company\.com/);
    return true;
  });
  assert.equal(posts.length, 0);
});

test('FreeBusy ignores untrusted machine reasons in Google error response', () => {
  const { ctx } = setupMultiCalendarSources(JSON.stringify([
    { id: 'secret-work@company.com', category: 'work', mode: 'freebusy' }
  ]));
  ctx.Utilities.parseDate = value => new Date(value.slice(0, 10) + 'T00:00:00Z');
  ctx.ScriptApp = { getOAuthToken: () => 'dummy-token' };
  ctx.UrlFetchApp.fetch = () => ({
    getResponseCode: () => 403,
    getContentText: () => JSON.stringify({ error: {
      status: 'PERMISSION_DENIED',
      errors: [{ reason: 'Calendar secret-work@company.com denied' }]
    } })
  });
  assert.throws(() => ctx.syncX3Dashboard(), error => {
    assert.match(error.message, /PERMISSION_DENIED/);
    assert.doesNotMatch(error.message, /secret-work/);
    return true;
  });
});

test('remaining event mode hides completed while retaining ongoing and future events', () => {
  class FakeDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-10-14T04:00:00Z'])); }
    static now() { return Date.parse('2026-10-14T04:00:00Z'); }
  }
  const { ctx, posts } = setupMultiCalendarSources(JSON.stringify([
    { id: 'primary', category: 'personal' },
    { id: 'family@group.calendar.google.com', category: 'family' },
    { id: 'friends@group.calendar.google.com', category: 'shared' },
    { id: 'work@company.com', category: 'work' }
  ]), { EVENTS_MODE: 'remaining' });
  ctx.Date = FakeDate;
  ctx.syncX3Dashboard();
  assert.deepEqual(posts[0].events.map(e => e.title), [
    'Дубликат созвона', 'Встреча с друзьями', 'Работа'
  ]);
  assert.equal(posts[0].events[0].calendar, 'work');
  assert.match(posts[0].date, /^СР · 14\.10\.2026$/);
});

test('weekday header styles can be short, full or absent', () => {
  const { ctx } = setupMultiCalendarSources();
  assert.equal(ctx.getX3Weekday('2026-10-14', 'short'), 'СР · ');
  assert.equal(ctx.getX3Weekday('2026-10-14', 'full'), 'СРЕДА · ');
  assert.equal(ctx.getX3Weekday('2026-10-14', 'none'), '');
  assert.throws(() => ctx.getX3Weekday('2026-10-14', 'unknown'), /WEEKDAY_STYLE/);
});

test('priority sorts overdue before today and undated before 20-task cap', () => {
  const { ctx, posts } = setupMultiCalendarSources(JSON.stringify([
    { id: 'primary', category: 'personal' }
  ]), { EVENTS_MODE: 'all', INCLUDE_UNDATED_TASKS: 'true' });
  ctx.Tasks = {
    Tasklists: { list: () => ({ items: [{ id: 'a' }, { id: 'b' }] }) },
    Tasks: { list: id => ({ items: id === 'a'
      ? Array.from({ length: 40 }, (_, i) =>
        ({ title: 'Без даты ' + i, status: 'needsAction' }))
      : [{ title: 'Срочно, просрочено', due: '2026-10-10T00:00:00.000Z', status: 'needsAction' },
         { title: 'Сегодня', due: '2026-10-14T00:00:00.000Z', status: 'needsAction' }] }) }
  };
  ctx.syncX3Dashboard();
  // Include 40 undated tasks to guarantee the old 20-item pre-cap would miss
  // due/overdue tasks located in a later list.
  assert.equal(posts[0].tasks.length, 20);
  assert.equal(posts[0].tasks[0].title, 'Срочно, просрочено');
  assert.equal(posts[0].tasks[0].overdue, true);
  assert.equal(posts[0].tasks[1].title, 'Сегодня');
  assert.equal(posts[0].tasks[1].overdue, undefined);
});


function makeHourlyForecast(today = '2026-10-14', tomorrow = '2026-10-15', shift = 0) {
  const time = [], temperature_2m = [], weather_code = [];
  for (const [date, temp] of [[today, 26], [tomorrow, 27]]) {
    for (let hour = 0; hour < 24; hour++) {
      time.push(date + 'T' + String(hour).padStart(2, '0') + ':00');
      temperature_2m.push(temp + hour / 4 + shift);
      weather_code.push(hour === 8 ? 0 : hour === 14 ? 3 : 61);
    }
  }
  return { hourly: { time, temperature_2m, weather_code } };
}

test('hourly Open-Meteo stores today and tomorrow and refreshes cached temperatures', () => {
  const { ctx, posts } = setupMultiCalendarSources(
    JSON.stringify([{ id: 'primary', category: 'personal' }]),
    { WEATHER_LAT: '12.55', WEATHER_LON: '99.96', EVENTS_MODE: 'all' });
  const values = new Map();
  const base = ctx.PropertiesService.getScriptProperties();
  ctx.PropertiesService.getScriptProperties = () => ({
    getProperty: key => values.has(key) ? values.get(key) : base.getProperty(key),
    setProperty: (key, value) => { values.set(key, value); return null; }
  });
  let hour = 10, outage = false, shift = 0, requests = 0;
  const originalFormat = ctx.Utilities.formatDate;
  ctx.Utilities.formatDate = (date, tz, format) =>
    format === 'HH' ? String(hour).padStart(2, '0')
      : originalFormat(date, tz, format);
  const originalFetch = ctx.UrlFetchApp.fetch;
  ctx.UrlFetchApp.fetch = (url, options) => {
    if (!url.startsWith('https://api.open-meteo.com/')) return originalFetch(url, options);
    requests++;
    assert.match(url, /latitude=12.55/);
    assert.match(url, /longitude=99.96/);
    assert.match(url, /hourly=temperature_2m,weather_code/);
    assert.match(url, /timezone=Asia%2FBangkok/);
    return outage ? { getResponseCode: () => 503 }
      : { getResponseCode: () => 200,
          getContentText: () => JSON.stringify(makeHourlyForecast(
            '2026-10-14', '2026-10-15', shift)) };
  };
  ctx.syncX3Dashboard();
  assert.equal(requests, 1);
  assert.equal(posts[0].weatherForecast.date, '2026-10-14');
  assert.equal(posts[0].weatherForecast.tomorrow, false);
  assert.deepEqual(posts[0].weatherForecast.periods.map(p => p.hour), [8, 14, 20]);
  assert.equal(posts[0].weatherForecast.periods[0].temp, 28);
  assert.equal(posts[0].headerDate.day, 14);
  assert.equal(posts[0].headerDate.weekday, 'СР');
  assert.equal(posts[0].headerDate.month, 'ОКТ');
  const saved = JSON.parse(values.get('X3_WEATHER_CACHE_V1'));
  assert.ok(saved.days['2026-10-14']);
  assert.ok(saved.days['2026-10-15']);

  outage = true;
  ctx.syncX3Dashboard(); // Same date, provider temporarily failed.
  assert.deepEqual(posts[1].weatherForecast, posts[0].weatherForecast);
  assert.equal(values.get('X3_WEATHER_CACHE_V1'), JSON.stringify(saved));

  hour = 21;
  ctx.syncX3Dashboard(); // No API access but tomorrow was cached.
  assert.equal(posts[2].weatherForecast.date, '2026-10-15');
  assert.equal(posts[2].weatherForecast.tomorrow, true);
  assert.equal(posts[2].weatherForecast.periods[0].temp, 29);

  outage = false;
  shift = 4; // New forecast changes both temperature and icon code.
  ctx.syncX3Dashboard();
  assert.equal(posts[3].weatherForecast.periods[0].temp, 33);
  assert.equal(JSON.parse(values.get('X3_WEATHER_CACHE_V1'))
    .days['2026-10-15'][0].temp, 33);
});

test('weather cache persists across midnight but is date- and location-scoped', () => {
  const { ctx } = setupMultiCalendarSources();
  const saved = { signature: '12.55000,99.96000,Asia/Bangkok', days: {
    '2026-10-14': [{ hour: 8, temp: 29, code: 0 },
      { hour: 14, temp: 32, code: 3 }, { hour: 20, temp: 27, code: 61 }],
    '2026-10-15': [{ hour: 8, temp: 26, code: 1 },
      { hour: 14, temp: 31, code: 2 }, { hour: 20, temp: 28, code: 3 }]
  } };
  const props = {
    getProperty: key => ({
      WEATHER_LAT: '12.55', WEATHER_LON: '99.96', WEATHER_MODE: 'today',
      X3_WEATHER_CACHE_V1: JSON.stringify(saved)
    })[key] || null,
    setProperty: () => {}
  };
  ctx.Utilities.formatDate = () => '07';
  ctx.UrlFetchApp.fetch = () => { throw new Error('Offline'); };
  const nextMorning = ctx.getX3Weather(props, new Date('2026-10-14T23:59:00Z'),
    'Asia/Bangkok', '2026-10-15');
  assert.equal(nextMorning.date, '2026-10-15');
  assert.equal(nextMorning.periods[0].temp, 26);
  assert.equal(ctx.getX3Weather(props, new Date(), 'Asia/Bangkok',
    '2026-10-16'), null);
  const alteredProps = {
    getProperty: key => key === 'WEATHER_LAT' ? '13.55' : props.getProperty(key),
    setProperty: () => {}
  };
  assert.equal(ctx.getX3Weather(alteredProps, new Date(), 'Asia/Bangkok',
    '2026-10-15'), null, 'never show a forecast for other coordinates');
});

test('weather can be disabled or restricted to today and rejects invalid settings', () => {
  const { ctx } = setupMultiCalendarSources();
  assert.equal(ctx.getX3Weather({
    getProperty: () => null
  }, new Date(), 'Asia/Bangkok', '2026-10-14'), null);
  for (const props of [
    { WEATHER_LAT: 'bad', WEATHER_LON: '99.96' },
    { WEATHER_LAT: '12.55' },
    { WEATHER_LAT: '12.55', WEATHER_LON: '99.96', WEATHER_MODE: 'future' }
  ]) {
    assert.throws(() => ctx.getX3Weather({
      getProperty: key => props[key] || null
    }, new Date(), 'Asia/Bangkok', '2026-10-14'), /WEATHER_/);
  }
});
