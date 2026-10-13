# iPhone Shortcut: Share → Add to Pocket Library

Supported sources: Files, Safari downloads, Telegram/other apps exposing an actual DRM-free `.epub` file via the iOS Share Sheet. **Apple Books purchases may be DRM-protected or not exportable**; a Shortcuts action cannot bypass Apple Books DRM or extract its internal library.

## One-time setup in Apple Shortcuts

1. Open **Shortcuts** → `+` → name it **Add to Pocket Library**.
2. Open Shortcut details (ⓘ or the dropdown at top), enable **Show in Share Sheet** and set **Receive: Files** (or `Any` if your iOS version does not expose file filtering).
3. Add action **Get Contents of URL**.
4. Configure URL: `https://books.tiroq.dev/api/books`.
5. Method: **POST**; Request Body: **File** → **Shortcut Input**. This **must transmit raw EPUB bytes** (not Form/JSON/multipart). Select the file from the Share Sheet before running.
6. Under Headers, add:

   | Header | Value |
   |---|---|
   | `Authorization` | `Bearer <UPLOAD_TOKEN>` |
   | `Content-Type` | `application/epub+zip` |

   Replace `<UPLOAD_TOKEN>` with the independent upload secret from `wrangler secret put UPLOAD_TOKEN`, not the reader password. Do **not** share or export the configured shortcut.

7. Optional: after the HTTP action, add **Get Dictionary Value** (`title` from response), then **Show Notification** with `Added: <title>`. A duplicated EPUB returns `duplicate: true`.

If `Get Contents of URL` is missing a File request-body mode, check under the expanded Show More settings. iOS action labels vary by OS language/version.

## Daily use

From Files/Telegram: hold an EPUB → **Share** → **Add to Pocket Library**. A successful upload makes the book instantly available in the OPDS feed on X3 after refreshing the catalog. No automatic delivery/push to a sleeping X3: connect to hotspot and refresh OPDS when you want to download.

## Debugging

- `401 Invalid upload token`: auth header missing/wrong; ensure `Bearer ` prefix and correct secret.
- `415 Send raw EPUB bytes`: Shortcuts sent Form/multipart. Use Request Body **File**, not **Form**.
- `400 Invalid EPUB`: the shared object is not a real EPUB, malformed ZIP, or was DRM-encrypted.
- `413 EPUB exceeds 12 MiB`: MVP application upload limit.
- `503 Worker is not fully configured`: one or both Cloudflare Worker secrets missing.
- `500`: review Cloudflare Worker logs (`npx wrangler tail pocket-library`) without logging secret values.

**Security:** iOS Shortcuts may save the upload token in plain text in the shortcut definition. Treat the shortcut as a credential. Optionally create a separate upload-only token rotation schedule; never place an all-powerful Cloudflare API token on the iPhone.
