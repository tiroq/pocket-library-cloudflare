# X3 dashboard fonts and layout

The Worker supports **four real proportional font families** for both 24-bit and 1-bit BMPs.

| JSON `font` | Family |
|---|---|
| `"golos-text"` (default) | **Golos Text** |
| `"inter"` | Inter |
| `"ibm-plex-sans"` | IBM Plex Sans |
| `"onest"` | Onest |

Names with spaces and case differences are also accepted (`"Golos Text"`, `"IBM Plex Sans"`); the canonical kebab-case value is saved to R2. Unknown names or non-strings cause HTTP **400**, not silent substitution. Omitting `font` keeps existing Shortcuts working and selects **Golos Text**.

## Example POST

Send the usual Shortcut payload, optionally including a top-level `font` field:

```json
{
  "locale": "ru",
  "font": "golos-text",
  "date": "14.10.2569",
  "events": [
    {"time": "14:30", "title": "Забрать детей из школы"},
    {"time": "16:30", "title": "Dance class"}
  ],
  "tasks": [],
  "updated": "17:54",
  "note": ""
}
```

Use the existing `POST /api/dashboard`, `Content-Type: application/json` and `Authorization: Bearer <UPLOAD_TOKEN>` from your iPhone Shortcut. In the Shortcuts Dictionary or JSON text, add `font` as a **Text** entry containing `golos-text`, `inter`, `ibm-plex-sans`, or `onest`. No other changes needed.

The response now echoes `"font": "golos-text"`. The read-only `GET /api/dashboard` also shows the chosen font. Every POST generates both `/dashboard.bmp` and `/dashboard-1bit.bmp` from the **same monochrome raster**. The CrossPoint SD plugin still downloads `/dashboard-1bit.bmp`; no plugin changes required.

**The date is intentionally passed through unchanged.** This change does not correct Buddhist-calendar years or otherwise reformat any date. Configure the date separately in your Shortcut when desired.

The optional event duration badge is rendered right-aligned beside the event
title in **17 px Medium**, with `durationMinutes` such as 30, 60 or 90
mapped to `(30M)`, `(1H)`, or `(1H 30M)`.
More details: [Google Calendar & Tasks integration](google-calendar-tasks.md).

## Fixed typography and layout

| Element | Face | Size |
|---|---|---|
| Date | SemiBold (600) | **34 px** |
| Section headings | Medium (500) | **17 px** |
| Event time | SemiBold (600) | **21 px** |
| Event/task titles and note | Regular (400) | **22 px** |
| Updated time/footer | Regular (400) | **12 px** |

The renderer uses actual font advances rather than the old stretched 8×8 monospaced cells. It wraps event titles at word boundaries across up to **two lines**; very long names are ellipsized only after the second line. Events and tasks are laid out in a compact vertical flow, avoiding a large fixed blank region between sections. Content exceeding the 528×792 screen's available height is truncated with a count, never drawn over the footer.

## Implementation and font licensing

The 4 families are **actual font glyphs**, not a renamed or scaled copy of a single pixel font. For Cloudflare Workers performance they are rasterized *offline*, using the exact weights and sizes above, into monochrome glyph atlases. The Worker bundles only generated glyph bitmaps and positioning metrics, not original TTF/OTF files. This avoids a dynamic heavy font renderer and keeps the 1-bit BMP output efficient.

The generated atlas is checked into `src/generated/dashboard-font-atlases.js`. To rebuild it as a maintainer:

```bash
python3 -m pip install 'Pillow>=11,<13'
python3 scripts/generate-dashboard-fonts.py
npm test
```

Font sources (SIL Open Font License **1.1**, read each project's license):
- [Golos Text — Google Fonts](https://github.com/google/fonts/tree/main/ofl/golostext)
- [Inter — Google Fonts](https://github.com/google/fonts/tree/main/ofl/inter)
- [IBM Plex Sans — IBM](https://github.com/IBM/plex/tree/master/packages/plex-sans)
- [Onest — Google Fonts](https://github.com/google/fonts/tree/main/ofl/onest)

The source font files are fetched temporarily by the maintainer script. The generated atlas is raster data, and the repository retains source and license references above. For privacy, **do not** put real calendar events or credentials into tests, font generators, or GitHub logs.
