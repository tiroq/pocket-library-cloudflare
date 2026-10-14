# Multiple Google calendars on the X3 dashboard

A **single Google Apps Script** combines calendars visible to its Google
account, labels their events by type, and sends one chronological agenda to
the private Cloudflare Worker. The Worker displays tiny **P/F/S/W** badges
between time and title, without shifting title, duration or task positions.
Google Tasks are still included in the same upload.

## One property controls all calendar sources

In Apps Script → **Project Settings → Script Properties**, add a property
named `CALENDAR_SOURCES`. Its value is a **JSON array**:

```json
[
  {"id":"primary","category":"personal","enabled":true,"label":"P"},
  {"id":"YOUR_FAMILY_CALENDAR_ID","category":"family","enabled":true,"label":"F"},
  {"id":"YOUR_SHARED_CALENDAR_ID","category":"shared","enabled":true,"label":"S"},
  {"id":"YOUR_WORK_CALENDAR_ID","category":"work","mode":"freebusy","enabled":true,"label":"W"}
]
```

These are **placeholders**, not actual calendar IDs. Copy your own IDs from
Google Calendar web Settings → calendar → **Integrate calendar → Calendar ID**,
or run `listX3CalendarIds()` from the private Apps Script and inspect its
Execution log. The pseudo-ID `"primary"` resolves to the Google account's
own primary calendar. Paste the complete array into the **Value** field of
the **single** Script Property; use one line if the editor does not accept
multiline text. No actual IDs or credentials belong in the public repo.

Supported categories and on-screen markers:

| category | marker | typical use |
|---|---|---|
| `personal` | `P` | own appointments |
| `family` | `F` | shared family schedule |
| `shared` | `S` | friends and other shared calendars |
| `work` | `W` | meetings from work accounts |

`label` is **optional**; when specified, it must match the category's
canonical letter. `enabled` defaults to `true`. Set to `false` to
temporarily exclude a calendar without deleting its settings.
`showBadge` defaults to `true`, and can be set to `false` to hide
that source's badge (particularly useful for the busiest personal calendar):

```json
{"id":"primary","category":"personal","showBadge":false}
```

A hidden badge does not reserve additional space. For normal five-character
clock times, the markers fit into an **existing 19×19 px square** in the
time/title gutter: the title and duration remain aligned across categories.

### Work calendars with Free/Busy-only sharing

If your work calendar is shared as **"See only free/busy (hide details)"**,
CalendarApp may return generic `Busy` titles, empty titles, or no detailed
events. **Set `"mode":"freebusy"` on that source**:

```json
{"id":"WORK_CALENDAR_ID","category":"work","mode":"freebusy","enabled":true}
```

This calls the **Google Calendar FreeBusy API**, not the event-title API.
For each busy interval Google exposes, the dashboard shows its start time,
a fixed privacy-preserving title **`Занято`**, and its duration, e.g.:

```text
09:00 [W] Занято                     (1H)
10:30 [W] Занято                 (1H 30M)
```

No event names, descriptions, attendees or locations are retrieved or
stored in Cloudflare. Google decides which intervals are busy; time
marked as **Free / Available** is not sent. Intervals spanning midnight
are clipped to the selected day's boundaries, including daylight-saving
time changes. Overlapping busy events may be combined into a single busy
interval by Google.

**No additional Calendar advanced service is required**: Apps Script
uses `UrlFetchApp.fetch` and `ScriptApp.getOAuthToken()` to call Google's
`POST /calendar/v3/freeBusy`, using its existing Google Calendar
authorization. Google may ask you to grant an updated permission when
you first run the new script. If Google responds HTTP 403, check the
script's granted OAuth scopes and whether **Google Calendar API** is enabled
in the Google Cloud project linked to the script. Apps Script's existing
**Tasks API** service remains necessary for Google Tasks.

`"mode":"events"` is the default for all sources, including `work`.
It displays real titles if available; when a work event has an empty title
or Google's generic `Busy` label, the script renders `Занято`.
Transparent/available events are skipped. If a work calendar gives **no
events at all**, switch it explicitly to `mode:"freebusy"`.
Other calendars (personal/family/shared) can continue using `events`.
For `freebusy` mode, the shared calendar need not be added as a
subscribed calendar in CalendarApp; the FreeBusy API checks its own
availability permissions. An inaccessible calendar causes an error
without erasing the previous dashboard.

For a quick diagnosis: if `syncX3Dashboard` reports a FreeBusy error,
confirm the **actual Calendar ID**, the work calendar's sharing permissions,
and that the Apps Script is running under the Google account which can
see that work calendar's availability in the web UI. Cross-account
organization restrictions may still prevent Google API access.

### One-time setup and migration

1. Update your Google Apps Script `Code.gs` using the latest
   [scripts/google-calendar-tasks.gs](../scripts/google-calendar-tasks.gs).
   Keep the existing `POCKET_UPLOAD_TOKEN` in Script Properties.
2. Use `listX3CalendarIds()` to find IDs of all calendars *visible* to the
   account running your Apps Script. Your primary calendar can always
   be specified by `"id":"primary"`.
3. Configure `CALENDAR_SOURCES` as JSON with your required IDs/categories.
4. Save, run `syncX3Dashboard()` once and approve any newly requested
   Google Calendar permissions.
5. Inspect the private `GET /api/dashboard` using your existing Basic
   reader credential. The events will contain `"calendar":"work"` and so
   on. Then inspect `/dashboard-1bit.bmp` for the right glyphs.
6. Keep just one existing time-driven trigger for `syncX3Dashboard`.

If `CALENDAR_SOURCES` is **absent or blank**, legacy `CALENDAR_IDS` and
`FAMILY_CALENDAR_ID` retain their previous behavior: primary/other entries
unmarked and family entries marked **F**. **Once `CALENDAR_SOURCES` is set**,
it is authoritative; the old properties are ignored. This prevents adding a
calendar twice or silently merging calendars you intended to disable.

Do not keep an active iPhone Shortcut that sends `"tasks":[]` or fewer
calendars to the **same dashboard endpoint**, as the last write wins.

## Work calendars in another Google account

The Apps Script runs under **one** signed-in Google identity. A work calendar
from another Google/Workspace account is readable only if shared with that
identity with enough rights to **see event details**. In Google Calendar:
open the work calendar's Settings → **Share with specific people**, grant
read-only access to the account running the Apps Script, and then use the
calendar ID in `CALENDAR_SOURCES`. Corporate administrators may prohibit
external sharing; this feature **cannot bypass** that policy. If sharing is
forbidden, a separate authorized collector or a different integration is
needed. Public/free-busy-only calendar visibility cannot supply meeting titles.

## Deduplication and precedence

Calendar source IDs are resolved and deduplicated (duplicates with conflicting
category/visibility settings are rejected). An inaccessible **enabled**
calendar throws an error instead of publishing a silently incomplete agenda.

When two calendars contain the **same iCal event UID at the same start time**
(e.g. the same invited meeting appears both in personal and work), only one
copy is kept. For competing categories, the retained badge prefers **work**,
then **family**, then **shared**, then **personal**. Distinct events that happen
to share a title and start time are **not** merged. Events are then sorted by
start time; no work/family category changes chronological ordering.

The dashboard accepts up to 20 calendar events and displays as many as fit
(typically up to six). Each one can carry optional `durationMinutes` and
`calendar`. Allowed `calendar` values in `POST /api/dashboard` are
`personal`, `family`, `shared`, `work`, and legacy `primary` (no badge).
Omitting the field also leaves an event unmarked. This works with all four
fonts, both the normal and compact BMP, and the existing CrossPoint plugin.

**Deployment:** merging code into GitHub does **not** deploy the Cloudflare
Worker or modify your separate Apps Script project. Deploy the Worker with
`npx wrangler deploy` in your usual authorized environment, then paste the
new script into Google Apps Script and run `syncX3Dashboard()`.
