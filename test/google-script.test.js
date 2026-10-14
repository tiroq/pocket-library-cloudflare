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
