/**
 * Optional Google Apps Script integration:
 * Read Google Calendar + Google Tasks using your Google account and push one
 * complete snapshot to the existing private Pocket Library dashboard API.
 *
 * This is an ALTERNATIVE to the iPhone Shortcut, not an addition to its
 * existing schedule: both write the same dashboard, so last write wins.
 *
 * Before running:
 * 1. In script.google.com enable Services → Tasks API (Advanced Service).
 * 2. In Project Settings → Script Properties, configure POCKET_UPLOAD_TOKEN.
 * 3. Optionally set CALENDAR_IDS (comma-separated, defaults to primary only),
 *    DASHBOARD_FONT (golos-text/inter/ibm-plex-sans/onest), and
 *    INCLUDE_UNDATED_TASKS (true/false, default false).
 * 4. Set Apps Script timezone to your actual local timezone.
 * 5. Run syncX3Dashboard manually to grant OAuth permissions, then schedule
 *    a time-driven trigger if desired.
 *
 * Never deploy as a public web app and never commit credentials.
 */

const X3_DASHBOARD_URL = 'https://books.tiroq.dev/api/dashboard';
const X3_MAX_EVENTS = 20;
const X3_MAX_TASKS = 20;

function syncX3Dashboard() {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('POCKET_UPLOAD_TOKEN');
  if (!token) throw new Error('Set POCKET_UPLOAD_TOKEN in Script Properties first');

  const timezone = Session.getScriptTimeZone();
  const now = new Date();
  const dateKey = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  // Compute local calendar day via date-only formatting, not UTC midnight.
  const todayStart = new Date(Utilities.formatDate(now, timezone, 'yyyy/MM/dd') + ' 00:00:00');
  const tomorrow = new Date(todayStart.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);

  const calendarIds = String(properties.getProperty('CALENDAR_IDS') || '').split(',')
    .map(id => id.trim()).filter(Boolean);
  const calendars = calendarIds.length
    ? calendarIds.map(id => CalendarApp.getCalendarById(id)).filter(Boolean)
    : [CalendarApp.getDefaultCalendar()];

  const events = [];
  calendars.forEach(calendar => {
    calendar.getEvents(todayStart, tomorrow).forEach(event => {
      if (!event.getTitle()) return;
      const allDay = event.isAllDayEvent();
      const start = event.getStartTime();
      const end = event.getEndTime();
      const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
      const item = {
        time: allDay ? '' : Utilities.formatDate(start, timezone, 'HH:mm'),
        title: event.getTitle(),
      };
      if (!allDay && durationMinutes > 0 && durationMinutes <= 10080) {
        item.durationMinutes = durationMinutes;
      }
      events.push({ startMillis: start.getTime(), item });
    });
  });
  events.sort((a, b) => a.startMillis - b.startMillis);
  const orderedEvents = events.slice(0, X3_MAX_EVENTS).map(item => item.item);

  // These are Google TASKS, not CalendarApp events or Apple Reminders.
  // List across all Google Task lists and include today's + overdue tasks.
  const includeUndated = properties.getProperty('INCLUDE_UNDATED_TASKS') === 'true';
  const tasks = [];
  let listsPage;
  do {
    const page = Tasks.Tasklists.list({ maxResults: 100, pageToken: listsPage });
    for (const list of page.items || []) {
      let pageToken;
      do {
        const response = Tasks.Tasks.list(list.id, {
          maxResults: 100, pageToken,
          showCompleted: false, showDeleted: false, showHidden: false,
        });
        for (const task of response.items || []) {
          if (task.status === 'completed' || !task.title || task.deleted) continue;
          // API's due is date-oriented; compare YYYY-MM-DD without interpreting
          // the midnight timestamp in the user's local timezone.
          const due = task.due ? task.due.slice(0, 10) : null;
          if (!due && !includeUndated) continue;
          if (due && due > dateKey) continue;
          tasks.push({ title: task.title, done: false, due: due || '' });
          if (tasks.length >= X3_MAX_TASKS) break;
        }
        if (tasks.length >= X3_MAX_TASKS) break;
        pageToken = response.nextPageToken;
      } while (pageToken);
      if (tasks.length >= X3_MAX_TASKS) break;
    }
    if (tasks.length >= X3_MAX_TASKS) break;
    listsPage = page.nextPageToken;
  } while (listsPage);

  const dashboard = {
    locale: 'ru',
    font: properties.getProperty('DASHBOARD_FONT') || 'golos-text',
    date: Utilities.formatDate(now, timezone, 'dd.MM.yyyy'),
    updated: Utilities.formatDate(now, timezone, 'HH:mm'),
    events: orderedEvents,
    tasks: tasks.map(task => ({ title: task.title, done: task.done })),
    note: '',
  };

  const response = UrlFetchApp.fetch(X3_DASHBOARD_URL, {
    method: 'post',
    headers: { Authorization: 'Bearer ' + token },
    contentType: 'application/json',
    payload: JSON.stringify(dashboard),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  if (code !== 200) {
    // Don't log request payload, task names or token.
    throw new Error('Pocket Library dashboard update returned HTTP ' + code);
  }
  console.log('Pocket Library dashboard updated; events=%s tasks=%s',
    dashboard.events.length, dashboard.tasks.length);
}
