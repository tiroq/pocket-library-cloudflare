# Calendar dashboard for XTEINK X3 (CrossPoint 1.6.5)

This feature is an **addition** to the existing Pocket Library Worker. Existing OPDS and book synchronization are unchanged.

## Multiple Google Calendar sources

The recommended Apps Script setting is `CALENDAR_SOURCES`: assign individual
personal/family/shared/work categories and the Worker renders tiny **P/F/S/W**
badges in the existing time/title gap, with no changes to the X3 plugin.
It preserves the older Family-only mode when the new setting is absent.

See [Calendar sources: personal, family, shared, work](calendar-sources.md).

## Shared family Google Calendar

Events from a shared Family calendar can be merged with the primary calendar
using the optional Apps Script property `FAMILY_CALENDAR_ID`.
Family events get a tiny outlined **F** between the fixed start-time and title
columns, without changing title position or duration alignment.
See [Google Calendar & Tasks](google-calendar-tasks.md#shared-family-calendar-and-the-tiny-f-marker)
for exact setup.

## Font selection

An optional top-level JSON key `"font": "golos-text"` selects the font used
for both BMP outputs. Other accepted values are `"inter"`,
`"ibm-plex-sans"`, and `"onest"`. Golos Text is the default
when no key is included, so existing iPhone Shortcuts keep working.
In the Shortcuts payload Dictionary add **font** as Text; use one of these
four values. Date strings are not modified. Full details:
**[dashboard-fonts.md](dashboard-fonts.md)**.

## Context-aware dashboard: weekday, weather, remaining events and task urgency

The X3 header uses the finalized **minimal compact date and 3-slot weather
layout**. The day number appears once inside a hand-drawn calendar icon,
with the short weekday above the short month to its right — no year, no
duplicate number. Across the right are hourly forecasts at **08:00, 14:00
and 20:00**: outlined monochrome weather icon + temperature. The original
date string with the full year remains in the private JSON for backwards
compatibility, but the new header deliberately does not render the year.
There is **no additional screen height** consumed.

Example (illustrative temperatures):

```text
[ 14 ]  СР      08       14       20
        ОКТ    ☀ 26°   ☁ 32°   ☂ 28°
──────────────────────────────────────
СОБЫТИЯ
```

These pictograms are drawn directly with black pixels in the BMP (not
Unicode emoji or device-dependent fonts). The rest of the adaptive agenda
and tasks layout remains unchanged. Weather is sourced from
[Open-Meteo](https://open-meteo.com/en/docs) with no API key.

### Script Properties

| Property | Default | Supported values |
|---|---|---|
| `WEEKDAY_STYLE` | `short` | `short` (СР), `full` (СРЕДА), `none` |
| `EVENTS_MODE` | `remaining` | `remaining` (hide events that have ended), `all` (entire day) |
| `TASK_SORT` | `due` | `due` (overdue → today → undated), `original` (Google Tasks list order) |
| `INCLUDE_UNDATED_TASKS` | `false` | `true` includes tasks without due dates |
| `WEATHER_LAT` | blank | latitude between -90 and 90, optional |
| `WEATHER_LON` | blank | longitude between -180 and 180, optional |
| `WEATHER_MODE` | `auto` | `auto` (after 20:00 show tomorrow), `today` (always today) |

Set **both** `WEATHER_LAT` and `WEATHER_LON` to the coordinates of
your desired location (e.g. your configured Hua Hin coordinates); no city
or GPS coordinates are hardcoded. If both are blank the weather disappears
without disrupting the date/agenda. Only those coordinates are sent to
Open-Meteo.

On every 15-minute sync the script requests `hourly=temperature_2m,weather_code`
with the Apps Script timezone and `forecast_days=2`. It extracts the 08, 14
and 20-hour forecast for **today and tomorrow**, and caches the six points
under `X3_WEATHER_CACHE_V1` in **private Script Properties** (not just in
memory). It updates the cache when temperature, icon/weather code or other
forecast values change. **On Open-Meteo timeout/HTTP failure/invalid response,
it continues using the last successful cached forecast for the exact matching
date, location and timezone**, keeping the rest of calendar/task sync working.

With `WEATHER_MODE=auto` (default) the header switches at **20:00 local time**
to tomorrow's three forecast periods and prints a small `ЗАВТРА` label
above them; the left calendar icon still shows **today's date**. Set
`WEATHER_MODE=today` to always show today's periods. Across midnight the
previously cached tomorrow forecast becomes today's fallback. Forecasts
from a different date/location are **never** reused — if the exact day
is missing and the provider is down, the weather cells remain blank instead
of showing misinformation.

The cache is stored by Apps Script; it **is not an independent weather updater
inside the Cloudflare Worker**. The Worker draws the three glyphs/icons from
the uploaded `weatherForecast` array. The existing Cron only checks data
freshness, and an already sleeping X3 must still fetch the new BMP.

`remaining` filters out events with `end <= now`, **not** events that
started earlier but are still ongoing. This applies to both standard events
and FreeBusy-only work intervals. It is calculated by Apps Script at the
time of its next scheduled run; the static BMP does **not** change between
runs. Use `EVENTS_MODE=all` to see the full day again.

Task priority is applied **before** the 20-task upload limit, across all
Google Task lists. In `due` mode the oldest overdue tasks appear first,
then tasks due today, then undated tasks (only if enabled). Overdue tasks
are marked with a small `!` inside their existing checkbox; task titles
are not shifted. The Worker still displays tasks in the order supplied
by the uploader. No sensitive task dates need to be written to the image.

### Stale-sync footer on a static BMP

Google Apps Script updates a **snapshot** on every successful
`POST /api/dashboard`. Failed Google runs do not reach Cloudflare.
Because BMP is static, it **cannot detect a failure by itself**.

The Worker now uses a **Cloudflare Cron Trigger** (`*/15 * * * *`) to check
the original server-side `generatedAt` of that snapshot. If no successful
upload arrived within `DASHBOARD_STALE_MINUTES` (default **45 minutes**),
it rebuilds both BMP files and adds `! СИНХР. >45M` to the **footer**.
The original JSON and its upload timestamp are **never updated** by Cron.
This means the warning is accurate and is not an invented Google error.

Configure `DASHBOARD_STALE_MINUTES` in `wrangler.jsonc`, or change the
Worker variable to another integer from 15 to 1440. Cron will render
the warning only once for a stale snapshot; it won't rewrite the same
image indefinitely. A new successful upload automatically clears the
warning and updates the timestamp.

**Device limitation:** Cloudflare can regenerate the stored BMP even if
Google stops sending data, but **an already sleeping X3 still displays the
previous pixels until it fetches the newer BMP** (existing plugin or Wi-Fi
upload workflow). Neither an Apps Script trigger nor Cloudflare Cron can
push an updated image to a sleeping CrossPoint 1.6.5 device on its own.

### Rollout

1. Deploy new Cloudflare Worker from updated `main`:
   `git pull --ff-only && npm ci && npm test && npx wrangler deploy`.
   This also publishes the Cron Trigger, which is a Worker configuration.
2. Paste the latest
   [scripts/google-calendar-tasks.gs](../scripts/google-calendar-tasks.gs)
   into your existing Google Apps Script `Code.gs`. Do **not** use
   `Deploy → New deployment` for time-driven triggers.
3. Set optional Script Properties above. Leave existing
   `POCKET_UPLOAD_TOKEN`, `CALENDAR_SOURCES` and Tasks API manifest alone.
4. Run `syncX3Dashboard()` manually, then continue with the existing
   15-minute time-driven trigger. Do not create a second upload trigger.
5. Check `/dashboard-1bit.bmp`. To test stale behavior without disabling
   Google permanently, temporarily disable the Apps Script trigger and
   wait 45–60 minutes for the Cron to mark the image; then re-enable it,
   run manually and verify the warning clears. Remember to restore the
   trigger after testing.

## Compact agenda headers, links, and focused daily occupancy

The E-Ink dashboard uses minimal hand-drawn calendar/checklist icons with
**ПЛАН / ДЕЛА** captions. The event heading contains a thin **focused
occupancy bar** on the right, with black segments for scheduled meetings
including FreeBusy work intervals. The time window adapts to the day's
first/last occupied periods, with 1-hour rounded padding and a minimum
10-hour window to avoid giant bars for tiny appointments. For instance,
meetings between 07:00 and 17:00 produce a legible **06–12–18** scale
rather than 00–12–24. With zero events or a single ordinary appointment,
the scale uses stable **07:00–22:00** boundaries (extending as needed for
late-night/early-morning meetings). The bar uses *all* timed calendar
entries from the day **before** `EVENTS_MODE=remaining` removes
completed meetings. Overlapping intervals are merged; all-day events
do not fill the entire bar.

The Google Apps Script sends an optional `busyIntervals` array in minutes
from local midnight, e.g. `[{"start":420,"end":480}]`. Each endpoint is
clamped to the current calendar day. If the field is absent, older dashboard
clients derive the bar from the displayed event start times and optional
`durationMinutes` for best-effort compatibility.

The checklist heading displays a compact **N просрочено** count on the
right. The Apps Script computes `tasksOverdueCount` across all collected
Google Tasks *before* the 20-task upload limit, so this count includes tasks
not visible on the BMP. The collector currently limits its total candidates
to 500 tasks; on exceptionally large accounts the count is bounded by
those collected tasks. Older clients derive it from submitted
`overdue: true` flags. None of these badges changes the adaptive
section heights. The adaptive task fitter now tries a **one-line ellipsized
version of the next two-line task** if the complete task would not fit above
the footer. This uses the otherwise empty gap without skipping a more urgent
task or shrinking the base font; the `+N ещё` counter is reserved and still
reflects the actual number of hidden tasks. Earlier tasks remain two lines
where space permits.

Long `https://` links inside task titles or calendar event names become
compact display labels such as `example.org / bonds` while preserving
surrounding prose. Tracking query strings, fragments and opaque path IDs
are not shown. The **original title remains in stored dashboard JSON**
(subject to its existing title length cap), and nothing in Google Calendar
or Google Tasks is modified. This is a **static bitmap**, not a clickable
link. The four fonts and both BMP versions are supported.

**Rollout:** deploy the updated Cloudflare Worker, paste the new
`scripts/google-calendar-tasks.gs` into the existing private Google Apps
Script `Code.gs`, then manually execute `syncX3Dashboard` once. Its
current 15-minute trigger does not need to be recreated. The Worker
supports older payloads, but the *full-day* timeline and *full collected*
overdue count require the updated Apps Script to send the two new fields.

## Adaptive agenda layout

The dashboard uses the unused gap beneath the date: the first rule is now at
**y=87** (previously 107), with the section header and first event moved up.
Events and tasks are **not limited to 6 and 5 visible rows anymore**.

- **Three events, many tasks:** show all three events, then fill the lower
  screen with as many tasks as fit. Each task may wrap to two lines.
- **Many events, two tasks:** give events almost all available space, keeping
  room for both tasks and the task header.
- **Many of both:** give events roughly half of the agenda height and reserve
  the remaining half for tasks. Both sections show `+N ещё` when clipped.
- **Both short:** use natural compact spacing; blank space stays below the
  content instead of inserting a fixed vertical gap.
- **Notes:** display only after tasks, when there is unused space. Tasks
  and the overflow count always have priority.

The date/footer, time, category markers P/F/S/W, event titles and right-hand
duration labels keep their original horizontal positions. The 24-bit and
1-bit BMP outputs remain pixel-equivalent. Counts refer to records in the
posted JSON (currently capped at **20 events and 20 tasks**).

### Emoji-safe title normalization and task density

Every incoming event and task title is normalized **on the Worker** before
width measurement, line wrapping or writing the image. Unsupported emoji,
emoji modifiers, zero-width joiners and regional-flag symbols are removed;
the leftover Unicode whitespace is collapsed to a single space and trimmed.
Example: `🎾   Теннис — тренировка` becomes `Теннис — тренировка`, with no
leading `?` glyph or extra blank indent. Real question marks (e.g.
`Уточнить?`) and Cyrillic are preserved. This also fixes already-running
Google Apps Script and older iPhone Shortcuts — neither needs an edit.

The task row spacing is reduced only where there was redundant vertical
padding. Two-line task text retains its original **28px baseline spacing**,
and font sizes, checkbox position, footer and calendar priorities are
unchanged. The heading-to-task gap and `+N ещё` reservation are tighter, so
a day with six visible events and a mixture of short/long tasks can show
at least one more task instead of leaving unusable space above the footer.
Overflow counts always reflect what was actually rendered.

## Duration + Google Tasks

The optional `durationMinutes` integer in each `events` record is rendered
as a right-aligned label next to the event title, e.g. `(30M)`, `(1H)`
or `(1H 30M)`. The original date string is not changed.

Google Tasks shown inside Google Calendar are not Apple Reminders or ordinary
calendar events. To include them automatically, see the optional
[Google Apps Script integration](google-calendar-tasks.md), which reads both
Google Calendar and Google Tasks. To add durations to your existing
iPhone Shortcut, see the [step-by-step guide](google-calendar-tasks.md).

## API and privacy

- `POST https://books.tiroq.dev/api/dashboard` – replace the current dashboard; use the **existing upload token** (`Authorization: Bearer ...`), `Content-Type: application/json`.
- `GET https://books.tiroq.dev/dashboard.bmp` – fetch the latest **528×792, uncompressed 24-bit BMP**; use the **existing read-only Basic auth** (`reader` + `READ_PASSWORD`). The image is stored in private R2 at `dashboard/current.bmp`.
- `GET https://books.tiroq.dev/api/dashboard` – return the last uploaded JSON with Basic auth, helpful for debugging.
- Unauthorized users receive HTTP 401; missing dashboards return 404.
- The upload is limited to 24 KiB of JSON and up to 20 events and 20 tasks. The **image** now dynamically packs as many events and tasks as fit, with `+N ещё` counters for any hidden entries. A short note appears only when enough room remains. Data is stored as `dashboard/current.json` (metadata) plus `dashboard/current.bmp`.
- Calendar data is **not public**. Neither secrets nor calendar entries should be in the URL or in server logs.
- Russian and English text are supported by four pre-rasterized proportional font families. Unsupported Unicode characters may render as a fallback glyph.

## One-time smoke test from Mac

Create a JSON file `today.json` (data is an example, not a required schedule):

```json
{
  "locale": "ru",
  "date": "СРЕДА 14 ОКТЯБРЯ",
  "events": [
    {"time": "09:30", "title": "Планирование"},
    {"time": "15:00", "title": "Tennis"}
  ],
  "tasks": [
    "Проверить pull request",
    {"title": "Ответить на письмо", "done": true}
  ],
  "note": "Вопросы к следующему звонку",
  "updated": "13:41"
}
```

Send it using your **UPLOAD_TOKEN** (do not paste the token into shell history):

```bash
read -rsp 'Upload token: ' UPLOAD_TOKEN; echo
curl --fail-with-body -i -X POST 'https://books.tiroq.dev/api/dashboard' \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @today.json
unset UPLOAD_TOKEN
```

Successful result: `200` JSON with `"ok":true`, `"imageUrl":"/dashboard.bmp"`, `"width":528`, `"height":792`.

Download and inspect the BMP:

```bash
curl -u reader -o sleep.bmp 'https://books.tiroq.dev/dashboard.bmp'
file sleep.bmp
open sleep.bmp
```

Expect a ~1.25 MB Windows bitmap, 528×792, 24-bit, with Russian text displayed. Cloudflare R2 objects remain private.

## iPhone Shortcut: Update X3 Calendar

In the **Shortcuts** app, build a separate shortcut called **Update X3 Calendar**. For an initial test, **hard-code a single event and task** in a Dictionary to check upload/authentication before reading live calendars.

1. Add `Find Calendar Events`: start time is today, sort ascending, max 6–20 events.
2. `Repeat with Each` result: use `Get Details of Calendar Events` (Title, Start Date); `Format Date` (`HH:mm`); create a `Dictionary` with keys `time` (formatted start) and `title` (event title). The repeat results should be a **list of dictionaries**, not a text string.
3. Add `Find Reminders` (incomplete, due today or overdue). For each reminder produce a Dictionary with `title` and `done: false`, again yielding a list.
4. Add `Current Date` and `Format Date` for the header (e.g. `EEE d MMM` or a Russian-format date) and another `Format Date` for `HH:mm`.
5. Add `Get Contents of URL`, URL `https://books.tiroq.dev/api/dashboard`, method `POST`, headers `Authorization: Bearer <UPLOAD_TOKEN>` and `Content-Type: application/json`. Set `Request Body = JSON` and provide:
   - `locale`: `ru` or `en`.
   - `date`: formatted local date string.
   - `updated`: formatted local time.
   - `events`: the list of event dictionaries from step 2.
   - `tasks`: the list of reminder dictionaries from step 3.
   - `note`: optional plain text, e.g. current clipboard text; avoid secrets.
6. Add `Quick Look` for the HTTP response. For success, display `ok: true`. After testing, replace Quick Look with a short notification.

**Important:** this endpoint expects JSON. Do **not** send an image or `multipart/form-data` as with CrossPoint File Transfer. This is a different endpoint from `/api/books` (which expects raw EPUB bytes).

You can run this shortcut manually, from a Home Screen icon, or via an iOS Personal Automation (e.g. each morning or when Focus mode changes). iOS background execution depends on its automation and permissions rules; the Shortcut itself does not discover the X3.

## Showing the image on the X3 (stock CrossPoint, no firmware changes)

Stock CrossPoint 1.6.5 **cannot** fetch an arbitrary remote BMP by itself on every sleep. First get a working manual round-trip:

1. With X3 and iPhone/Mac on a reachable LAN, open **File Transfer** on X3 (its HTTP server is normally available only in File Transfer / Calibre Wireless mode).
2. Download `https://books.tiroq.dev/dashboard.bmp` on your Mac using read credentials (or on iPhone after authentication); name the file **sleep.bmp**.
3. Upload it to the root directory of the X3 SD card using the CrossPoint web file manager at `http://<X3-IP>/`. For scripted/manual uploads, CrossPoint expects **multipart/form-data**:
   ```bash
   curl -F 'file=@sleep.bmp' 'http://<X3-IP>/upload?path=/'
   ```
4. Set **Sleep Screen → Custom** in CrossPoint. On the next sleep the generated calendar image replaces the default screen.

The Cloudflare code now provides **generation and private distribution**. To make X3 automatically fetch `/dashboard.bmp` when entering sleep, the **device firmware needs a separate implementation or a compatible CrossPoint fork**; do not mistake Worker deployment for automatic device update.

## Limitations and next improvements

- The image is regenerated only on POST; it doesn't update itself as time passes.
- The X3 screen is static in sleep; it needs a new image to show changed events.
- The client posts **display strings** rather than OAuth credentials, so the Worker never needs access to Apple Calendar or Apple Reminders.
- Passwords on X3 should be unique and read-only, never the upload token.
- Protect the phone shortcut: it contains the upload token and allows replacing the dashboard.
- The adaptive layout uses the available 528×792 screen height: events expand when tasks are few, and tasks expand when events are few. Under simultaneous overflow the space is shared roughly half-and-half, reserving room for each `+N` count. The image can show more than six events or five tasks.
- Public R2 access must remain disabled.


## Automatic sleep image download with CrossPoint SD Plugin Events

The original `/dashboard.bmp` is a 24-bit BMP of ~1.25 MiB. **CrossPoint develop's plugin-event download is limited to 1 MiB.** The Worker therefore also saves a **pixel-identical 1-bit uncompressed BMP** (~54 KiB, black/white) whenever the existing iPhone Shortcut updates the calendar. No changes to the Shortcut JSON or authorization are necessary.

- `GET https://books.tiroq.dev/dashboard-1bit.bmp` — protected by existing `reader` Basic auth; compatible with CrossPoint's 1-bit BMP reader.
- R2 key: `dashboard/current-1bit.bmp`, in the same **private** bucket.
- Existing `GET /dashboard.bmp` remains unchanged (24-bit).
- If the new endpoint returns 404 directly after deployment, **run the iPhone Shortcut again** to generate the compact image for the first time.

### Install the bundled CrossPoint plugin

**Firmware prerequisite:** `sleep.enter` exists in [CrossPoint develop](https://github.com/crosspoint-reader/crosspoint-reader/blob/develop/docs/plugin-events.md), **not** CrossPoint **1.6.5 stable**. Upgrading/testing development firmware is a separate deliberate operation; **do not** flash firmware based on these Worker changes alone. Back up the microSD card and review release/build compatibility first.

1. In this repository run `bash scripts/make-x3-plugin-config.sh` from a **local interactive terminal**. Enter the existing `READ_PASSWORD` for the `reader` account when prompted. This creates `plugins/x3-calendar/config.json` (ignored by Git). No `UPLOAD_TOKEN` is needed on the X3.
2. Copy `plugins/x3-calendar/` (including the newly generated config) to the microSD root as `/.crosspoint/plugins/x3-calendar/`.
3. Set **Sleep Screen → Custom** in CrossPoint. If you use **Cover + Custom**, a sleep directly from a book prioritizes the EPUB cover.
4. Reboot X3 to discover the plugin, ensure a reachable saved 2.4 GHz Wi-Fi network, and run the iPhone Shortcut once.
5. Put X3 to sleep. On a supported firmware the plugin downloads `/dashboard-1bit.bmp` over HTTPS **before drawing the sleep image**, writes to `/sleep.bmp` on SD, and enters sleep.

On a failed download or offline Wi-Fi, the old `/sleep.bmp` stays intact. The firmware's sleep-entry connection is bounded, and sleep isn't blocked indefinitely. X3 does **not** periodically wake from deep sleep to repaint the screen: calendar updates are visible on the **next** sleep.

**Auth:** `config.json` has an `authorization` field containing the full value of a `Basic` Authorization header. This is Base64, **not encryption**, so protect the microSD card. The plugin does not use the upload/delete token.

See [plugins/x3-calendar/README.md](../plugins/x3-calendar/README.md) for plugin layout. The user's uncommitted config file must never be added to GitHub.
