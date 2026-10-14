# Calendar dashboard for XTEINK X3 (CrossPoint 1.6.5)

This feature is an **addition** to the existing Pocket Library Worker. Existing OPDS and book synchronization are unchanged.

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
- The upload is limited to 24 KiB of JSON and up to 20 events and 20 tasks; the **image** displays 6 events, 5 tasks and a short note. Data is stored as `dashboard/current.json` (metadata) plus `dashboard/current.bmp`.
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
- Initial v1 shows up to six events and five tasks. The full JSON remains in R2 for a future richer UI.
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
