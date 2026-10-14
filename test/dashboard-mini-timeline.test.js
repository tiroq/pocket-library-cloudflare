import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  compactDashboardLinks, normalizeBusyIntervals, normalizeDashboard,
  renderDashboardBmp, convertDashboardBmpTo1Bit, planDashboardLayout,
  DASHBOARD_FONTS, DASHBOARD_HEIGHT, DASHBOARD_WIDTH, planBusyTimeline,
  DASHBOARD_LAYOUT,
} from '../src/dashboard.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const base = {
  date: 'ЧТ · 15.10.2026', locale: 'ru',
  events: [{ title: 'Счёт', time: '09:00', durationMinutes: 60 }],
  tasks: [{ title: 'Отправить письмо', overdue: true }],
};

function countPixelChangesOutsideRect(first, next, left, top, right, bottom) {
  let inside = 0, outside = 0;
  for (let y = 0; y < DASHBOARD_HEIGHT; y++) {
    const row = 54 + (DASHBOARD_HEIGHT - 1 - y) * DASHBOARD_WIDTH * 3;
    for (let x = 0; x < DASHBOARD_WIDTH; x++) {
      if (first[row + x * 3] === next[row + x * 3]) continue;
      if (x >= left && x <= right && y >= top && y <= bottom) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}

test('long task/event links shorten in display without mutating canonical titles', () => {
  const source = {
    ...base,
    events: [{
      time: '09:00',
      title: 'Обсудить https://example.org/q/bonds/SU500003R?token=abc с командой',
      durationMinutes: 60
    }],
    tasks: [
      { title: 'https://example.org/s/t_abc123fake?shareToken=xyz' },
      { title: 'Открыть https://docs.example.org/spreadsheets/d/randomLongIdentifier и проверить' },
      { title: 'Спросить о платеже?' }
    ]
  };
  assert.equal(compactDashboardLinks(source.events[0].title),
    'Обсудить example.org / bonds с командой');
  assert.equal(compactDashboardLinks(source.tasks[0].title), 'example.org');
  assert.equal(compactDashboardLinks(source.tasks[1].title),
    'Открыть docs.example.org / spreadsheets и проверить');
  assert.equal(compactDashboardLinks(source.tasks[2].title), 'Спросить о платеже?');
  const data = normalizeDashboard(source);
  assert.match(data.events[0].title, /https:\/\/example.org/);
  assert.match(data.tasks[0].title, /shareToken=xyz/);
  for (const font of DASHBOARD_FONTS) {
    data.font = font;
    const layout = planDashboardLayout(data);
    assert.equal(layout.events[0].lines.join(' '),
      'Обсудить example.org / bonds с командой');
    assert.equal(layout.tasks[0].lines.join(' '), 'example.org');
    assert.ok(convertDashboardBmpTo1Bit(renderDashboardBmp(data)).length < 1024 * 1024);
  }
});

test('valid busy minutes and overdue counts pass schema; invalid values fail', () => {
  assert.deepEqual(normalizeBusyIntervals([{ start: 0, end: 45 },
    { start: 1420, end: 1440 }]), [
    { start: 0, end: 45 }, { start: 1420, end: 1440 }
  ]);
  const good = normalizeDashboard({
    ...base,
    busyIntervals: [{ start: 0, end: 45 }, { start: 620, end: 650 }],
    tasksOverdueCount: 15
  });
  assert.equal(good.tasksOverdueCount, 15);
  assert.equal(good.busyIntervals.length, 2);
  assert.equal(normalizeDashboard(base).tasksOverdueCount, 1);
  for (const bad of [
    [{ start: -2, end: 80 }],
    [{ start: 35, end: 30 }],
    [{ start: 9.5, end: 100 }],
    [{ start: 30, end: 1450 }],
  ]) assert.throws(() => normalizeBusyIntervals(bad), /Invalid busy interval/);
  assert.throws(() => normalizeDashboard({ ...base,
    tasksOverdueCount: -1 }), /tasksOverdueCount/);
  assert.throws(() => normalizeDashboard({ ...base,
    tasksOverdueCount: '2' }), /tasksOverdueCount/);
});

test('busy scale uses actual all-day intervals even with few visible events', () => {
  for (const font of DASHBOARD_FONTS) {
    const common = normalizeDashboard({ ...base, font,
      tasksOverdueCount: 12,
      busyIntervals: [{ start: 420, end: 480 },
        { start: 620, end: 710 }, { start: 1020, end: 1060 }]
    });
    const different = { ...common,
      busyIntervals: [{ start: 780, end: 870 }],
    };
    const a = renderDashboardBmp(common);
    const b = renderDashboardBmp(different);
    const changes = countPixelChangesOutsideRect(a, b, 225, 101, 499, 126);
    assert.ok(changes.inside > 10, 'timeline should differ for different busy slots');
    assert.equal(changes.outside, 0, 'timeline may not move event rows or labels');
    assert.equal(planDashboardLayout(common).taskHeadingY,
      planDashboardLayout(different).taskHeadingY);
    assert.notEqual(hash(a), hash(b));
    assert.equal(new DataView(convertDashboardBmpTo1Bit(a).buffer).getUint16(28, true), 1);
  }
});

test('overdue heading count reacts only in section header, not task position', () => {
  const a = normalizeDashboard({ ...base, tasksOverdueCount: 0 });
  const b = normalizeDashboard({ ...base, tasksOverdueCount: 11 });
  const bmpA = renderDashboardBmp(a), bmpB = renderDashboardBmp(b);
  const y = planDashboardLayout(a).taskHeadingY;
  const changes = countPixelChangesOutsideRect(bmpA, bmpB, 330, y, 500, y + 30);
  assert.ok(changes.inside > 10);
  assert.equal(changes.outside, 0);
  assert.equal(planDashboardLayout(a).shownTasks, planDashboardLayout(b).shownTasks);
});

test('focused day scale covers meetings with rounded dynamic bounds', () => {
  const m = planBusyTimeline([
    { start: 7 * 60, end: 8 * 60 },
    { start: 16 * 60 + 30, end: 17 * 60 }
  ]);
  assert.equal(m.start, 6 * 60);
  assert.equal(m.end, 18 * 60);
  assert.deepEqual(m.ticks, [6 * 60, 12 * 60, 18 * 60]);
  assert.ok(m.blocks.every(b => b.start >= m.start && b.end <= m.end));

  const cluster = planBusyTimeline([
    { start: 12 * 60, end: 12 * 60 + 30 },
    { start: 13 * 60, end: 13 * 60 + 30 }
  ]);
  assert.ok(cluster.end - cluster.start >= 10 * 60,
    'a dense short cluster should not over-zoom the hourly bar');
  assert.ok(cluster.start <= 12 * 60 && cluster.end >= 13 * 60 + 30);
});

test('empty and single-event days retain understandable 07 to 22 scale', () => {
  const noEvents = planBusyTimeline([]);
  assert.equal(noEvents.start, 420);
  assert.equal(noEvents.end, 1320);
  const single = planBusyTimeline([{ start: 9 * 60, end: 10 * 60 }]);
  assert.equal(single.start, 420);
  assert.equal(single.end, 1320);
  const exceptional = planBusyTimeline([{ start: 23 * 60, end: 1440 }]);
  assert.ok(exceptional.end >= 1440, 'late-night meeting cannot be clipped');
  const wholeDay = planBusyTimeline([
    { start: 0, end: 80 }, { start: 1380, end: 1440 }
  ]);
  assert.equal(wholeDay.start, 0);
  assert.equal(wholeDay.end, 1440);
});

test('the chosen timeline window is confined to original header only', () => {
  for (const font of DASHBOARD_FONTS) {
    const options = [
      [{ start: 420, end: 480 }, { start: 990, end: 1020 }],
      [{ start: 500, end: 560 }],
      []
    ];
    const renders = options.map(intervals => renderDashboardBmp(normalizeDashboard({
      ...base, font, busyIntervals: intervals,
      // Avoid legacy inference when the interval list is empty.
      events: [],
    })));
    const changes = countPixelChangesOutsideRect(renders[0], renders[1], 225, 101, 499, 126);
    assert.ok(changes.inside > 8);
    assert.equal(changes.outside, 0, font);
    const empty = renderDashboardBmp(normalizeDashboard({ ...base, font, events: [], busyIntervals: [] }));
    assert.equal(hash(empty), hash(renders[2]));
    assert.equal(new DataView(convertDashboardBmpTo1Bit(renders[0]).buffer).getUint16(28, true), 1);
  }
});

test('fill the blank task strip using one-line ellipsis for the next long task', () => {
  for (const font of DASHBOARD_FONTS) {
    const events = Array.from({ length: 9 }, (_, i) => ({
      title: 'Встреча ' + (i + 1),
      time: '09:00', durationMinutes: 30
    }));
    const tasks = [
      ...Array.from({ length: 6 }, (_, i) => ({
        title: 'Короткая задача ' + (i + 1), overdue: true
      })),
      { title: 'Перенести телефонный номер на другой аккаунт и уточнить условия обслуживания', overdue: true },
      { title: 'Продолжить подготовку документов', overdue: true },
      { title: 'Оформить страховку', overdue: true }
    ];
    const data = normalizeDashboard({ ...base, font, events, tasks });
    const layout = planDashboardLayout(data);
    assert.equal(layout.shownEvents, 6, font);
    assert.equal(layout.shownTasks, 7, font + ': seventh task fits as one line');
    assert.equal(layout.tasks[6].lines.length, 1);
    assert.equal(layout.tasks[6].compact, true);
    assert.ok(layout.tasks[6].lines[0].endsWith('…'), font);
    assert.equal(layout.tasksOverflow, tasks.length - 7);
    assert.ok(layout.tasksOverflowY + DASHBOARD_LAYOUT.taskOverflowH <= DASHBOARD_LAYOUT.contentBottomY);
    assert.ok(layout.tasks[6].y + layout.tasks[6].height <= layout.tasksOverflowY);
    const mono = convertDashboardBmpTo1Bit(renderDashboardBmp(data));
    assert.equal(new DataView(mono.buffer).getUint16(28, true), 1);
  }
});
