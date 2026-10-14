# X3 dashboard: event durations and tasks

## Duration badges

Every event in `POST /api/dashboard` can optionally include `durationMinutes`
as an integer. The default is no badge, preserving existing clients. The
Worker renders the label at the far right of the event, in 17 px Medium:

| Minutes | Label |
|---|---|
| 15 | `(15M)` |
| 30 | `(30M)` |
| 60 | `(1H)` |
| 75 | `(1H 15M)` |
| 90 | `(1H 30M)` |

Example:

```json
{
  "locale": "ru", "font": "golos-text", "date": "14.10.2569",
  "events": [
    { "time": "07:30", "title": "Теннис", "durationMinutes": 45 },
    { "time": "10:00", "title": "Встреча", "durationMinutes": 90 }
  ],
  "tasks": [{ "title": "Подготовить документы", "done": false }],
  "updated": "20:35"
}
```

Existing date formatting is unchanged.

### Add duration to the current iPhone Shortcut

Inside `Repeat with Each [Calendar Events]`, where you already extract
`Title` and `Start Date`:

1. **Get Details of Calendar Events** → `End Date` for `Repeat Item`.
2. **Get Time Between Dates** → from `Start Date` to `End Date`,
   unit **Minutes**.
3. **Round Number** to 0 decimal places, if needed. Save its result
   as a variable named `DurationMinutes`.
4. In the event's final **Dictionary**, add the Number key
   `durationMinutes` with value **DurationMinutes** (magic variable).
   Keep existing `time` and `title`.
5. Keep that Dictionary last within the loop and use `Repeat Results`
   as the outer JSON `events` array.
6. Re-run the Shortcut once to update both BMPs.

For all-day events, skip duration or send `0`; otherwise they appear
as `(24H)`. Integer minute strings (e.g. `"90"`) are accepted.
Negative, fractional, or greater-than-10080 minute durations return HTTP 400.

## Google Tasks (the tasks displayed inside Google Calendar)

Google Tasks and Google Calendar events are separate APIs. The iOS
`Find Calendar Events` action does not reliably return Google Tasks;
`Find Reminders` reads **Apple Reminders**, not Google Tasks.

The existing `tasks` array already renders Google Tasks perfectly once
their titles are supplied:

```json
"tasks": [
  { "title": "Купить продукты", "done": false },
  { "title": "Ответить на письмо", "done": true }
]
```

For **automatic** Google Tasks, use the optional companion
**[Google Apps Script](../scripts/google-calendar-tasks.gs)**,
which reads both your Google Calendar and Google Tasks under your
own Google account and posts a complete JSON snapshot to the existing Worker.
It requires no new Worker endpoint or public server.

### Google Apps Script setup

1. Open https://script.google.com/create, create a project, and paste
   `scripts/google-calendar-tasks.gs` into `Code.gs`.
2. Under **Services → +**, enable **Google Tasks API**; CalendarApp is
   built in. Official setup:
   https://developers.google.com/workspace/tasks/quickstart/apps-script
3. Under **Project Settings → Script Properties**, set
   `POCKET_UPLOAD_TOKEN` to your existing **UPLOAD_TOKEN**.
   Never commit it to GitHub.
4. Set the project's local time zone (e.g. `Asia/Bangkok`).
5. Optional Script Properties: `DASHBOARD_FONT` (one of the four
   supported fonts), `CALENDAR_IDS` (comma-separated Google Calendar IDs;
   default is only your primary calendar), and
   `INCLUDE_UNDATED_TASKS=true` for tasks without a due date.
6. Select and manually Run `syncX3Dashboard`; approve the Google
   Calendar/Tasks permissions. The console logs only event/task counts.
7. Use **Triggers → Add Trigger** to run `syncX3Dashboard` periodically.

This sends today's calendar events with durations and all incomplete
Google Tasks due today or overdue. It excludes completed tasks; by
default it also excludes tasks with no due date. The source date is
formatted by Apps Script; Worker does not change it.

**Crucial:** this is an **alternative to the iPhone Shortcut**.
Both write the *whole* dashboard. If the iPhone Shortcut continues to
send `"tasks": []` after Apps Script does its upload, it will clear
tasks again. Disable the old iPhone automation when you enable the
Apps Script trigger.

### If you prefer the current Shortcut

You may manually add dictionaries inside its `tasks` Array. But that
doesn't keep them synchronized with Google Tasks. Automatic syncing
requires Google Tasks API or another permitted integration.
