import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanDashboardTitle, normalizeDashboard, planDashboardLayout,
  DASHBOARD_LAYOUT, DASHBOARD_FONTS,
  renderDashboardBmp, convertDashboardBmpTo1Bit,
} from '../src/dashboard.js';

const base = {
  locale: 'ru', date: 'ЧТ · 15.10.2026', updated: '00:13',
  events: [], tasks: [],
};

test('remove Google Calendar emoji, emoji modifiers and redundant spaces BEFORE layout', () => {
  const title = '  🎾   Теннис — урок (60 мин)  ';
  assert.equal(cleanDashboardTitle(title), 'Теннис — урок (60 мин)');
  assert.equal(cleanDashboardTitle('👨🏽‍👩🏼‍👧🏻 Семейная встреча'), 'Семейная встреча');
  assert.equal(cleanDashboardTitle('🇹🇭  Встреча 🇺🇸'), 'Встреча');
  assert.equal(cleanDashboardTitle('☀️　Тренировка\n\t в зале   '), 'Тренировка в зале');
  assert.equal(cleanDashboardTitle('Купить продукты 🛒  сегодня'), 'Купить продукты сегодня');
  assert.equal(cleanDashboardTitle('бот финанс?'), 'бот финанс?',
    'real question marks in titles must remain untouched');
  assert.equal(cleanDashboardTitle('🎾', 120), '',
    'an emoji-only title should not create an empty display row');
  assert.equal(cleanDashboardTitle('🎾   abc    ', 3), 'abc');
  const normalized = normalizeDashboard({
    ...base,
    events: [{ time: '07:00', title }],
    tasks: [{ title: '🧾   review   linkedin   for Pavlov', done: false },
      '💼   Подготовить    документы  ']
  });
  assert.equal(normalized.events[0].title, 'Теннис — урок (60 мин)');
  assert.equal(normalized.tasks[0].title, 'review linkedin for Client');
  assert.equal(normalized.tasks[1].title, 'Подготовить документы');
  assert.equal(normalized.events[0].title[0], 'Т');
});

test('screenshot regression: six shown meetings leave room for more than four tasks', () => {
  // Reproduces the actual screenshot that previously showed 6 events +3
  // with only four tasks and +10 hidden despite unused space above footer.
  for (const font of DASHBOARD_FONTS) {
    const eventTitles = [
      '🎾 Теннис — урок (60 мин)', 'GYM: Fitness', 'Занято', 'Занято',
      'Забрать детей из школы', 'Занято', 'Ужин', 'Созвон', 'Прогулка'
    ];
    const events = eventTitles.map((title, i) => ({
      title, time: String(7 + i).padStart(2, '0') + ':00',
      durationMinutes: i === 0 ? 45 : 30,
      ...(i === 1 ? { calendar: 'family' } : i % 3 === 2 ? { calendar: 'work' } : {})
    }));
    const tasks = [
      'review linkedin for Client',
      'бот финанс?',
      'https://example.com/q/bonds/SU52003RMFS9/',
      'Оформить страховку на квартиру',
      'https://example.com/s/t_6a04a671b1c88191bc44a4c06ad1345a',
      'прививки календарь',
      'Перенести телефонный номер на другой аккаунт',
      'Права В/У',
      'Invoice',
      ...Array.from({ length: 5 }, (_, i) => 'Задача ' + i),
    ];
    const data = normalizeDashboard({ ...base, font, events, tasks });
    const l = planDashboardLayout(data);
    assert.equal(data.events[0].title, 'Теннис — урок (60 мин)');
    assert.equal(l.shownEvents, 6, font + ': keep calendar event priority');
    assert.equal(l.eventsOverflow, 3);
    assert.ok(l.shownTasks >= 5,
      font + ': compact layout must show at least one more task than screenshot');
    assert.equal(l.tasksOverflow, tasks.length - l.shownTasks);
    assert.ok(l.tasks.at(-1).y + l.tasks.at(-1).height +
      (l.tasksOverflow ? DASHBOARD_LAYOUT.taskOverflowH : 0) <= DASHBOARD_LAYOUT.contentBottomY);
    assert.ok(l.tasksOverflowY == null || l.tasksOverflowY + 20 <= DASHBOARD_LAYOUT.contentBottomY);
    assert.ok(l.taskHeadingY > l.events.at(-1).y);
    const bmp = renderDashboardBmp(data);
    assert.ok(convertDashboardBmpTo1Bit(bmp).length < 1024 * 1024);
  }
});

test('tightened rows do not overlap two-line tasks, overflow counter or footer', () => {
  for (const font of DASHBOARD_FONTS) {
    const data = normalizeDashboard({
      ...base, font,
      events: Array.from({ length: 20 }, (_, i) => ({
        time: '09:00', title: 'Событие ' + i, durationMinutes: 45
      })),
      tasks: Array.from({ length: 20 }, (_, i) => ({
        title: i % 2 === 0
          ? 'Очень длинная задача с большим количеством символов, которая должна переноситься'
          : 'Короткая задача ' + i,
        done: false
      }))
    });
    const layout = planDashboardLayout(data);
    assert.ok(layout.shownEvents >= 4);
    assert.ok(layout.shownTasks >= 3);
    for (let i = 1; i < layout.tasks.length; i++) {
      assert.ok(layout.tasks[i].y >= layout.tasks[i - 1].y + layout.tasks[i - 1].height,
        font + ': task rows must not overlap');
    }
    assert.ok(!layout.tasksOverflow ||
      layout.tasksOverflowY + DASHBOARD_LAYOUT.taskOverflowH <= DASHBOARD_LAYOUT.contentBottomY,
      font + ': overflow line must fit before footer');
    assert.ok(layout.taskHeadingY < layout.taskStartY);
  }
});
