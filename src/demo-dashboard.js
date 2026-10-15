/**
 * Isolated, entirely synthetic snapshot for presenting the XTEINK X3.
 *
 * No Google APIs, no real calendars, no saved user content, no network calls.
 * Display time/date use Thailand's local calendar (not the server timezone).
 * Conditions are illustrative, not a live meteorological forecast.
 */
const DEMO_TIMEZONE = 'Asia/Bangkok';
const WEEKDAYS = ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
const MONTHS = ['ЯНВ', 'ФЕВ', 'МАР', 'АПР', 'МАЙ', 'ИЮН',
  'ИЮЛ', 'АВГ', 'СЕН', 'ОКТ', 'НОЯ', 'ДЕК'];
const pad = number => String(number).padStart(2, '0');

function localDateParts(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: DEMO_TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now).filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return { ...parts, weekday };
}
function nextDateKey(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}
function busy(events) {
  const items = events.map(event => {
    const [hour, minute] = event.time.split(':').map(Number);
    const start = hour * 60 + minute;
    return { start, end: Math.min(1440, start + event.durationMinutes) };
  }).sort((a, b) => a.start - b.start);
  const result = [];
  for (const interval of items) {
    const previous = result[result.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      result.push({ ...interval });
    }
  }
  return result;
}

export function buildDemoDashboardPayload(now = new Date()) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error('Expected a valid Date for demo dashboard');
  }
  const { year, month, day, hour, minute, weekday } = localDateParts(now);
  const today = year + '-' + pad(month) + '-' + pad(day);
  const tomorrow = hour >= 20;
  const weatherDate = tomorrow ? nextDateKey(year, month, day) : today;
  const dailyVariant = Number(weatherDate.slice(-2)) % 4;
  const periods = [
    { hour: 8, temp: 26 + dailyVariant % 2, code: dailyVariant === 0 ? 1 : 2 },
    { hour: 14, temp: 31 + dailyVariant % 3, code: dailyVariant === 3 ? 3 : 1 },
    { hour: 20, temp: 28 + dailyVariant % 2, code: dailyVariant % 2 ? 61 : 3 },
  ];

  const events = [
    { time: '07:30', title: 'Утренняя тренировка', durationMinutes: 45, calendar: 'personal' },
    { time: '09:00', title: 'Планирование проекта', durationMinutes: 60, calendar: 'work' },
    { time: '10:30', title: 'Занято', durationMinutes: 90, calendar: 'work' },
    { time: '13:15', title: 'Обсудить макет приложения', durationMinutes: 45, calendar: 'shared' },
    { time: '16:30', title: 'Урок рисования', durationMinutes: 60, calendar: 'family' },
    { time: '18:30', title: 'Вечерняя прогулка', durationMinutes: 45, calendar: 'personal' },
  ];

  const tasks = [
    { title: 'Подготовить презентацию', overdue: true },
    { title: 'Ответить на письмо команды', overdue: true },
    { title: 'Проверить макет X3', overdue: true },
    { title: 'Купить продукты на неделю' },
    { title: 'Прочитать статью https://example.org/blog/design' },
    { title: 'Подготовить документы для поездки' },
    { title: 'Заказать расходные материалы' },
    { title: 'Обновить список книг' },
    { title: 'Запланировать выходные' },
    { title: 'Сделать заметки после встречи' },
    { title: 'Посмотреть новые возможности E-Ink' },
    { title: 'Проверить напоминания' },
  ];

  return {
    locale: 'ru',
    font: 'golos-text',
    date: WEEKDAYS[weekday] + ' · ' + pad(day) + '.' + pad(month) + '.' + year,
    headerDate: { day, weekday: WEEKDAYS[weekday], month: MONTHS[month - 1] },
    updated: pad(hour) + ':' + pad(minute),
    weatherForecast: { date: weatherDate, tomorrow, periods },
    events, busyIntervals: busy(events),
    tasks, tasksOverdueCount: tasks.filter(task => task.overdue).length,
    // Demo only; production never receives a demo flag or fake weather data.
  };
}
