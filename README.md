# Pocket Library — private OPDS for XTEINK X3

A small **Cloudflare-only runtime**: Worker + private R2 bucket + custom domain `books.tiroq.dev`.

- **Import** EPUB from iPhone Share Sheet → Shortcuts → HTTPS POST.
- **Extract** title, author, language and (optional) cover from EPUB in the Worker.
- **Catalog** served dynamically as OPDS 1 (Atom) at `/opds.xml`; no separate cron or build is needed for added books.
- **Download** EPUB directly from `/books/<sha256>.epub` with HTTP Basic authorization (CrossPoint OPDS-compatible).
- **Deduplicate** byte-identical EPUB uploads by SHA-256.
- **Storage privacy**: R2 bucket must remain private; no public `r2.dev` or R2 custom domain.
- **Calendar dashboard**: POST your Apple Calendar/Reminders snapshot as JSON and download a private **528×792 BMP** for the XTEINK X3 sleep screen.

> The repository is the source for the Cloudflare Worker deployed separately via Wrangler. Editing GitHub code does not redeploy an existing Worker unless you have connected CI/CD; run `npm test && npx wrangler deploy` when ready.

## Installation (Mac, Node.js 22+)

1. Open Cloudflare dashboard. Enable R2 object storage if it is not yet enabled. Verify your domain `tiroq.dev` belongs to the same account.
2. Unzip project and in Terminal:

   ```bash
   cd pocket-library-cloudflare
   npm install
   npx wrangler login
   npx wrangler r2 bucket create pocket-library-private
   ```

   **Existing bucket?** If it already exists, do not recreate it; check `npx wrangler r2 bucket list`. Do not enable public access.

3. Create **two different** high-entropy secrets, e.g. with `openssl rand -hex 32` run twice. Never paste either secret into chat or your repository.

   ```bash
   npx wrangler secret put READ_PASSWORD
   npx wrangler secret put UPLOAD_TOKEN
   ```

   On the first deployment, some Wrangler versions expect the Worker to exist before `secret put`. If you get a deployment/configuration error, run `npx wrangler deploy` first, immediately put both secrets, then test. Before the secrets exist the Worker refuses to serve library data (HTTP 503).

4. Deploy:

   ```bash
   npm test
   npx wrangler deploy
   ```

   The `routes` configuration uses `custom_domain: true` for `books.tiroq.dev`. Cloudflare manages the corresponding DNS record and HTTPS certificate automatically. If an **existing** DNS record already uses `books`, resolve the conflict carefully; do not blindly delete unrelated records. `workers_dev: false` prevents an extra workers.dev hostname.

5. Test as described below, then configure CrossPoint and the iPhone Shortcut.

### Authentication

**Read-only OPDS user:** `reader` (config `vars.READ_USER`) + `READ_PASSWORD` Worker secret. The same password is used for catalog and EPUB requests.

**Upload key:** `UPLOAD_TOKEN` Worker secret, sent as `Authorization: Bearer ...` by the iPhone Shortcut. This secret can also delete books, so **do not share the Shortcut**. It is different from the read password.

Cloudflare Access login is *not* enabled on these paths: CrossPoint does not support its interactive browser login. Basic Auth is transported via HTTPS. **Important:** current CrossPoint HTTPS downloader uses `setInsecure()`, so the X3 does not verify TLS certificate authenticity. Use a strong **read-only password unique to this library**, not a password used anywhere else.

## Test

The first unauthenticated test should return `401`:

```bash
curl -i https://books.tiroq.dev/opds.xml
```

Authorized OPDS:

```bash
curl -u reader https://books.tiroq.dev/opds.xml
# curl will ask for the reader password interactively
```

Use **a freely distributable, DRM-free EPUB you own** for the import test:

```bash
read -rsp 'Upload token: ' UPLOAD_TOKEN; echo
curl -i --fail-with-body -X POST 'https://books.tiroq.dev/api/books' \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -H 'Content-Type: application/epub+zip' \
  --data-binary '@test-book.epub'
unset UPLOAD_TOKEN
```

Expected `201` JSON containing `id`, `title`, `author`. Re-uploading the exact same file gives `200` and `duplicate:true`. Re-open `/opds.xml` and the book appears immediately.

**Delete** by ID, guarded by upload token:

```bash
curl -X DELETE -H "Authorization: Bearer $UPLOAD_TOKEN" \
  "https://books.tiroq.dev/api/books/<64-character-id>"
```

## Shared family calendar badge

The Google Apps Script can load a shared family calendar through
`FAMILY_CALENDAR_ID` and mark its events with a compact **F** in the
existing time/title gap. It does not shift event titles or durations.
See [family calendar setup](docs/google-calendar-tasks.md#shared-family-calendar-and-the-tiny-f-marker).

## Google Calendar durations + Google Tasks

Calendar events can include optional `durationMinutes` values in the existing
`POST /api/dashboard` JSON. The X3 renders compact right-aligned labels
such as `(30M)` and `(1H 30M)`. Existing payloads work unchanged.
See [Google Calendar & Tasks integration](docs/google-calendar-tasks.md)
for the additional iPhone Shortcut action and the optional private
Apps Script synchronizer for Google Tasks.

## Calendar typography

The dashboard now uses **Golos Text by default**, with `font` selectable in
`POST /api/dashboard`: `golos-text`, `inter`, `ibm-plex-sans`, `onest`.
The server generates both compact and full-size BMPs in the selected font.
See **[docs/dashboard-fonts.md](docs/dashboard-fonts.md)** for exact sizes,
weights, wrapping behavior and font licenses. Date formatting is unchanged.

## Calendar sleep screen (new)

No extra server, package dependency, or R2 bucket is needed.

- Send `POST /api/dashboard` with `Content-Type: application/json` and your existing **upload** bearer token.
- The Worker generates a black-and-white **528×792, 24-bit uncompressed BMP** with English/Russian labels and stores it as `dashboard/current.bmp` in private R2.
- Read the result from `GET /dashboard.bmp` with the existing **reader** Basic password. `GET /api/dashboard` provides the last JSON for troubleshooting.
- Set CrossPoint Sleep Screen to **Custom** and upload the downloaded image as `/sleep.bmp` through X3 File Transfer.
- **Automatic fetch on sleep is not provided by stock CrossPoint 1.6.5**. It requires a future firmware integration; uploading the JSON to Cloudflare does not itself change the sleeping X3 screen.

See **[docs/calendar-dashboard.md](docs/calendar-dashboard.md)** for a working JSON example, curl validation and the iPhone Shortcut instructions.

For **automatic Custom sleep-screen refresh** on supported CrossPoint develop firmware, the Worker also exposes a compact **1-bit** BMP at `/dashboard-1bit.bmp` (read-only Basic auth). See the bundled [X3 Calendar SD plugin](plugins/x3-calendar/README.md) and [setup instructions](docs/calendar-dashboard.md#automatic-sleep-image-download-with-crosspoint-sd-plugin-events). Stable CrossPoint **1.6.5 does not support `sleep.enter`**.

## CrossPoint X3

`Settings → System → OPDS Servers → Add Server`

| Setting | Value |
|---|---|
| Name | Pocket Library |
| Server URL | `https://books.tiroq.dev/opds.xml` |
| Username | `reader` |
| Password | your `READ_PASSWORD` |

Connect X3 to iPhone Wi-Fi hotspot. Browse OPDS and download a sample EPUB. **Device integration check:** CrossPoint upstream forwards the configured Basic username/password to its EPUB downloader. If your X3 still fails, check the specific firmware version and HTTPS network logs. Never solve this by publishing the bucket or putting reusable access tokens in EPUB URLs.

## iPhone (Shortcuts Share Sheet)

Follow [docs/iphone-shortcut.md](docs/iphone-shortcut.md). The shortcut sends the raw file body directly to the Worker (no GitHub, laptop, or third-party Shortcuts app needed).

## Architecture and limits

- Worker/R2 are in Cloudflare; GitHub is **optional** for source version control, not needed for EPUB storage or catalog regeneration.
- Catalog lists books from R2 object metadata on demand with a paginated OPDS feed (`rel="next"`). It is consistent immediately after a successful R2 PUT.
- EPUB max **12 MiB** for MVP; rejects multipart uploads and malformed archives. This is an application safeguard, not Cloudflare's platform request-size limit.
- For the Workers Free plan, CPU is limited; large/complex EPUBs can require optimization or Workers Paid, even when below 12 MiB. No guarantee of $0 without checking your plan/usage.
- Full-text search, file version metadata normalization, DRM decryption and reading-progress sync are not included. Reading progress remains a separate KOSync service.
- Cover is extracted if EPUB manifest references a small JPEG/PNG. Missing cover does not block upload.
- Basic Auth usernames/passwords and bearer upload token are independent. The web UI is intentionally simple and read-only.
- OPDS pages contain a modest **32 books** each because ESP32-C3/X3 has very limited RAM.

## Security notes

- Never turn on public R2 access. Web access is exclusively through the Worker.
- Use separate strong read and upload credentials; rotate using `npx wrangler secret put`.
- Limit token exposure on iPhone: an exported/shared Shortcut may include its bearer token. Never share the shortcut or its screenshots displaying tokens.
- Make sure Cloudflare HTTPS is valid before entering secrets in CrossPoint.
- Reading/publishing DRM-protected or copyrighted books may be subject to licensing and legal restrictions. This service protects access; it does not grant redistribution rights.

See [docs/architecture.md](docs/architecture.md) for endpoints, limitations, and recovery.
