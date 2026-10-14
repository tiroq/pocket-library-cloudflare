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
 * 3. Configure CALENDAR_SOURCES as a JSON array of calendar IDs and
 *    personal/family/shared/work categories (optional, default legacy behavior).
 *    Work calendars that share only availability should use mode:'freebusy'.
 *    When using FreeBusy REST, set oauthScopes explicitly in appsscript.json;
 *    see scripts/appsscript.example.json and docs/calendar-sources.md.
 *    Existing FAMILY_CALENDAR_ID and CALENDAR_IDS continue working when
 *    CALENDAR_SOURCES is absent. Also supports DASHBOARD_FONT and
 *    INCLUDE_UNDATED_TASKS (true/false, default false).
 *    EVENTS_MODE=remaining|all, WEEKDAY_STYLE=short|full|none,
 *    TASK_SORT=due|original; optional WEATHER_LAT and WEATHER_LON.
 * 4. Set Apps Script timezone to your actual local timezone.
 * 5. Run syncX3Dashboard manually to grant OAuth permissions, then schedule
 *    a time-driven trigger if desired.
 *
 * Never deploy as a public web app and never commit credentials.
 */

const X3_DASHBOARD_URL = 'https://books.tiroq.dev/api/dashboard';
const X3_MAX_EVENTS = 20;
const X3_MAX_TASKS = 20;

// Categories remain display-only; the Worker renders a fixed P/F/S/W glyph.
const X3_CALENDAR_LABELS = { personal: 'P', family: 'F', shared: 'S', work: 'W' };

/**
 * New mode: CALENDAR_SOURCES JSON:
 * [{"id":"primary","category":"personal","enabled":true},
 *  {"id":"actual-shared-id","category":"family","enabled":true}]
 *
 * If absent, use the original CALENDAR_IDS/FAMILY_CALENDAR_ID semantics.
 * Old primary events remain unmarked; adding CALENDAR_SOURCES enables P.
 */
function getX3CalendarSources(properties) {
  const raw = properties.getProperty('CALENDAR_SOURCES');
  if (raw && String(raw).trim()) {
    if (raw.length > 8192) throw new Error('CALENDAR_SOURCES exceeds 8192 characters');
    let specs;
    try { specs = JSON.parse(raw); }
    catch { throw new Error('CALENDAR_SOURCES must contain valid JSON'); }
    if (!Array.isArray(specs) || specs.length > 20) {
      throw new Error('CALENDAR_SOURCES must be an array of at most 20 calendar entries');
    }
    const entries = [];
    const seen = new Map();
    for (const spec of specs) {
      if (!spec || Array.isArray(spec) || typeof spec !== 'object') {
        throw new Error('Every CALENDAR_SOURCES entry must be an object');
      }
      if (typeof spec.id !== 'string' || !spec.id.trim() ||
          typeof spec.category !== 'string' ||
          !Object.prototype.hasOwnProperty.call(X3_CALENDAR_LABELS, spec.category)) {
        throw new Error('Calendar source must have id and category personal/family/shared/work');
      }
      if (spec.enabled !== undefined && typeof spec.enabled !== 'boolean') {
        throw new Error('Calendar source enabled must be a boolean');
      }
      if (spec.mode !== undefined && spec.mode !== 'events' && spec.mode !== 'freebusy') {
        throw new Error('Calendar source mode must be events or freebusy');
      }
      if (spec.showBadge !== undefined && typeof spec.showBadge !== 'boolean') {
        throw new Error('Calendar source showBadge must be a boolean');
      }
      if (spec.label !== undefined && spec.label !== X3_CALENDAR_LABELS[spec.category]) {
        throw new Error('Calendar source label must match its category P/F/S/W');
      }
      if (spec.enabled === false) continue;
      const id = spec.id.trim();
      const mode = spec.mode || 'events';
      // FreeBusy only requires availability visibility, not CalendarApp
      // permission to read event titles or even a subscribed calendar.
      const calendar = id === 'primary' ? CalendarApp.getDefaultCalendar()
        : mode === 'freebusy' ? null : CalendarApp.getCalendarById(id);
      if (!calendar && mode === 'events') {
        throw new Error('CALENDAR_SOURCES calendar is not accessible. Check its ID and sharing.');
      }
      const resolvedId = calendar ? calendar.getId() : id;
      const previous = seen.get(resolvedId);
      if (previous) {
        if (previous.category !== spec.category ||
            previous.showBadge !== (spec.showBadge !== false) ||
            previous.mode !== mode) {
          throw new Error('Duplicate calendar ID with conflicting category or badge visibility');
        }
        continue;
      }
      const entry = { id: resolvedId, calendar, category: spec.category,
        showBadge: spec.showBadge !== false, mode };
      entries.push(entry);
      seen.set(resolvedId, entry);
    }
    return entries;
  }

  // Legacy mode preserves previous behavior and F-only markers.
  const familyId = String(properties.getProperty('FAMILY_CALENDAR_ID') || '').trim();
  const calendarIds = String(properties.getProperty('CALENDAR_IDS') || '').split(',')
    .map(id => id.trim()).filter(Boolean);
  const entries = calendarIds.length
    ? [...new Set(calendarIds)].map(id => ({
        id, calendar: CalendarApp.getCalendarById(id),
        category: id === familyId ? 'family' : null,
        showBadge: id === familyId
      }))
    : (() => {
        const primary = CalendarApp.getDefaultCalendar();
        return [{ id: primary.getId(), calendar: primary, category: null, showBadge: false }];
      })();
  if (familyId && !entries.some(entry => entry.id === familyId)) {
    entries.push({ id: familyId, calendar: CalendarApp.getCalendarById(familyId),
      category: 'family', showBadge: true });
  }
  if (familyId && entries.some(entry => entry.id === familyId && !entry.calendar)) {
    throw new Error('FAMILY_CALENDAR_ID is not accessible. Check the exact Google Calendar ID and sharing.');
  }
  return entries;
}

/**
 * Fetch availability without reading event titles. This works with calendars
 * shared as "See only free/busy (hide details)". Uses existing Calendar OAuth
 * permissions and Google's native freeBusy endpoint (no Advanced Calendar
 * Service required). Only the start and end of busy intervals are returned.
 */
function getX3FreeBusyIntervals(entries, now, timezone) {
  if (!entries.length) return [];
  const dateKey = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const parts = dateKey.split('-').map(Number);
  const nextDateKey = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + 1))
    .toISOString().slice(0, 10);
  // parseDate resolves both local midnights separately, including DST days.
  const fmt = 'yyyy-MM-dd HH:mm:ss';
  const begin = Utilities.parseDate(dateKey + ' 00:00:00', timezone, fmt);
  const finish = Utilities.parseDate(nextDateKey + ' 00:00:00', timezone, fmt);
  const response = UrlFetchApp.fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    contentType: 'application/json',
    payload: JSON.stringify({
      timeMin: begin.toISOString(), timeMax: finish.toISOString(),
      timeZone: timezone,
      items: entries.map(entry => ({ id: entry.id }))
    }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    // Google provides a machine-readable reason (e.g. insufficientPermissions,
    // SERVICE_DISABLED, ACCESS_TOKEN_SCOPE_INSUFFICIENT). Extract only simple
    // reason codes, NEVER raw message/body, calendar IDs, URLs or access tokens.
    let reasons = [];
    try {
      const failure = JSON.parse(response.getContentText());
      const candidates = [
        failure.error && failure.error.status,
        ...(failure.error && Array.isArray(failure.error.errors)
          ? failure.error.errors.map(error => error.reason) : []),
        ...(failure.error && Array.isArray(failure.error.details)
          ? failure.error.details.map(detail => detail.reason) : [])
      ];
      reasons = [...new Set(candidates.filter(value =>
        typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)))];
    } catch {
      // Some proxies send an HTML error page; keep the diagnostic generic.
    }
    throw new Error('Google Calendar FreeBusy API HTTP ' + response.getResponseCode() +
      (reasons.length ? ' (' + reasons.join(', ') + ')' : '') +
      '. Check Calendar API OAuth scopes (calendar.readonly), Cloud API enablement, and work sharing.');
  }
  let data;
  try { data = JSON.parse(response.getContentText()); }
  catch { throw new Error('Google Calendar FreeBusy returned invalid JSON'); }
  const intervals = [];
  for (const entry of entries) {
    const result = data.calendars && data.calendars[entry.id];
    if (!result || (result.errors && result.errors.length) || !Array.isArray(result.busy)) {
      throw new Error('Google Calendar FreeBusy has no access to a configured calendar.');
    }
    for (const block of result.busy) {
      const start = new Date(block.start);
      const end = new Date(block.end);
      const startMillis = Math.max(start.getTime(), begin.getTime());
      const endMillis = Math.min(end.getTime(), finish.getTime());
      if (!Number.isFinite(startMillis) || !Number.isFinite(endMillis) ||
          endMillis <= startMillis) continue;
      const durationMinutes = Math.round((endMillis - startMillis) / 60000);
      const item = {
        time: Utilities.formatDate(new Date(startMillis), timezone, 'HH:mm'),
        title: 'Занято'
      };
      if (entry.category && entry.showBadge) item.calendar = entry.category;
      if (durationMinutes > 0 && durationMinutes <= 10080) item.durationMinutes = durationMinutes;
      intervals.push({ startMillis, endMillis, item, category: entry.category });
    }
  }
  return intervals;
}

/**
 * Optional compact current weather, without GPS permissions or API keys.
 * Location is configured by Script Properties WEATHER_LAT / WEATHER_LON.
 * A broken external weather API should never block calendar synchronization.
 */
function getX3Weather(properties) {
  const latText = String(properties.getProperty('WEATHER_LAT') || '').trim();
  const lonText = String(properties.getProperty('WEATHER_LON') || '').trim();
  if (!latText && !lonText) return '';
  if (!latText || !lonText) throw new Error('Set both WEATHER_LAT and WEATHER_LON');
  const lat = Number(latText), lon = Number(lonText);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Invalid WEATHER_LAT / WEATHER_LON');
  }
  try {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' +
      encodeURIComponent(lat) + '&longitude=' + encodeURIComponent(lon) +
      '&current=temperature_2m,weather_code';
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      console.log('Weather API temporarily unavailable, HTTP ' + response.getResponseCode());
      return '';
    }
    const current = JSON.parse(response.getContentText()).current;
    if (!current || !Number.isFinite(current.temperature_2m) ||
        !Number.isFinite(current.weather_code)) return '';
    const code = current.weather_code;
    const label = code === 0 ? 'Ясно'
      : code <= 2 ? 'Перем.'
      : code === 3 ? 'Обл.'
      : code <= 48 ? 'Туман'
      : code <= 67 ? 'Дождь'
      : code <= 77 ? 'Снег'
      : code <= 82 ? 'Ливень'
      : code <= 86 ? 'Снег'
      : 'Гроза';
    return Math.round(current.temperature_2m) + '° ' + label;
  } catch {
    console.log('Weather temporarily unavailable');
    return '';
  }
}

function getX3Weekday(dateKey, style) {
  if (style === 'none') return '';
  if (style !== 'short' && style !== 'full') {
    throw new Error('WEEKDAY_STYLE must be short, full or none');
  }
  const dow = new Date(dateKey + 'T12:00:00Z').getUTCDay();
  const weekdays = style === 'full'
    ? ['ВОСКРЕСЕНЬЕ', 'ПОНЕДЕЛЬНИК', 'ВТОРНИК', 'СРЕДА', 'ЧЕТВЕРГ', 'ПЯТНИЦА', 'СУББОТА']
    : ['ВС', 'ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'];
  return weekdays[dow] + ' · ';
}

function syncX3Dashboard() {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('POCKET_UPLOAD_TOKEN');
  if (!token) throw new Error('Set POCKET_UPLOAD_TOKEN in Script Properties first');

  const timezone = Session.getScriptTimeZone();
  const now = new Date();
  const dateKey = Utilities.formatDate(now, timezone, 'yyyy-MM-dd');
  const eventsMode = String(properties.getProperty('EVENTS_MODE') || 'remaining').trim().toLowerCase();
  if (!['all', 'remaining'].includes(eventsMode)) {
    throw new Error('EVENTS_MODE must be remaining or all');
  }
  const weekdayStyle = String(properties.getProperty('WEEKDAY_STYLE') || 'short').trim().toLowerCase();
  const taskSort = String(properties.getProperty('TASK_SORT') || 'due').trim().toLowerCase();
  if (!['due', 'original'].includes(taskSort)) {
    throw new Error('TASK_SORT must be due or original');
  }
  // CalendarApp resolves the day's boundaries in the selected calendar's
  // own timezone, avoiding ambiguous parsing of timezone-less date strings.

  const entries = getX3CalendarSources(properties);
  const events = getX3FreeBusyIntervals(entries.filter(entry => entry.mode === 'freebusy'), now, timezone);
  const byOccurrence = new Map();
  entries.filter(entry => entry.mode !== 'freebusy' && entry.calendar).forEach(({ calendar, category, showBadge }) => {
    calendar.getEventsForDay(now).forEach(event => {
      // Transparent events block no time. Shared Free/Busy views may have
      // empty titles or the localized generic name "Busy".
      if (typeof event.getTransparency === 'function' &&
          String(event.getTransparency()).toUpperCase() === 'TRANSPARENT') return;
      const eventTitle = String(event.getTitle() || '').trim();
      if (!eventTitle && category !== 'work') return;
      const allDay = event.isAllDayEvent();
      const start = event.getStartTime();
      const end = event.getEndTime();
      const durationMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
      const item = {
        time: allDay ? '' : Utilities.formatDate(start, timezone, 'HH:mm'),
        title: category === 'work' && (!eventTitle || /^(busy|занято)$/i.test(eventTitle))
          ? 'Занято' : eventTitle,
      };
      if (category && showBadge) item.calendar = category;
      if (!allDay && durationMinutes > 0 && durationMinutes <= 10080) {
        item.durationMinutes = durationMinutes;
      }
      const startMillis = start.getTime();
      // Only collapse actual shared invitations with the same iCal UID and
      // occurrence start. Same title/time alone does not imply duplication.
      const uid = typeof event.getId === 'function' ? event.getId() : '';
      const key = uid ? uid + '\\u0000' + startMillis : null;
      if (key && byOccurrence.has(key)) {
        const existing = events[byOccurrence.get(key)];
        const priority = { personal: 0, shared: 1, family: 2, work: 3 };
        if ((priority[category] || 0) > (priority[existing.category] || 0)) {
          existing.item = item;
          existing.category = category;
          existing.endMillis = end.getTime();
        }
        return;
      }
      if (key) byOccurrence.set(key, events.length);
      events.push({ startMillis, endMillis: end.getTime(), item, category });
    });
  });
  // Filter by END, not start: an ongoing event remains visible.
  // The FreeBusy query clips today's interval, so end is start + duration.
  const remainingEvents = eventsMode === 'all' ? events : events.filter(entry =>
    (entry.endMillis || (entry.startMillis + (entry.item.durationMinutes || 0) * 60000)) > now.getTime());
  remainingEvents.sort((a, b) => a.startMillis - b.startMillis);
  const orderedEvents = remainingEvents.slice(0, X3_MAX_EVENTS).map(entry => entry.item);

  // These are Google TASKS, not CalendarApp events or Apple Reminders.
  // List across all Google Task lists and include today's + overdue tasks.
  const includeUndated = properties.getProperty('INCLUDE_UNDATED_TASKS') === 'true';
  const tasks = [];
  const MAX_TASK_CANDIDATES = 500;
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
          tasks.push({ title: task.title, done: false, due: due || '',
            overdue: Boolean(due && due < dateKey) });
          if (tasks.length >= MAX_TASK_CANDIDATES) break;
        }
        if (tasks.length >= MAX_TASK_CANDIDATES) break;
        pageToken = response.nextPageToken;
      } while (pageToken);
      if (tasks.length >= MAX_TASK_CANDIDATES) break;
    }
    if (tasks.length >= MAX_TASK_CANDIDATES) break;
    listsPage = page.nextPageToken;
  } while (listsPage);

  // Google Tasks order differs between task lists. Sort BEFORE the 20-task
  // display cap so due/overdue items never disappear behind unrelated lists.
  if (taskSort === 'due') {
    tasks.sort((a, b) => {
      const aRank = a.due ? (a.overdue ? 0 : 1) : 2;
      const bRank = b.due ? (b.overdue ? 0 : 1) : 2;
      return aRank - bRank || (a.due || '').localeCompare(b.due || '');
    });
  }

  const dashboard = {
    locale: 'ru',
    font: properties.getProperty('DASHBOARD_FONT') || 'golos-text',
    date: getX3Weekday(dateKey, weekdayStyle) + Utilities.formatDate(now, timezone, 'dd.MM.yyyy'),
    weather: getX3Weather(properties),
    updated: Utilities.formatDate(now, timezone, 'HH:mm'),
    events: orderedEvents,
    tasks: tasks.slice(0, X3_MAX_TASKS).map(task => ({ title: task.title, done: task.done,
      ...(task.overdue ? { overdue: true } : {}) })),
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

/**
 * One-time diagnostic helper: run this inside your private Apps Script project
 * to find the exact IDs of calendars that your Google account can access.
 * Does not print events, tasks or authentication tokens.
 */
function listX3CalendarIds() {
  CalendarApp.getAllCalendars().forEach(calendar => {
    console.log('%s — %s', calendar.getName(), calendar.getId());
  });
}
