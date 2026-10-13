# Technical design and operational considerations

## Flows

```text
iPhone Share Sheet → Shortcut → HTTPS POST /api/books (Bearer) → Worker
  Worker: ZIP inspection → OPF metadata → SHA256 → R2 private object (+cover)

XTEINK X3 → HTTPS GET /opds.xml (Basic) → Worker → R2 list/customMetadata
XTEINK X3 → HTTPS GET /books/<sha>.epub (Basic) → Worker → R2 stream
Browser → HTTPS GET / (Basic) → server-rendered private list
```

## Worker endpoints

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/health` | GET | None | Liveness only (no book data) |
| `/` | GET | Basic | Private read-only web listing |
| `/opds.xml` | GET | Basic | OPDS 1 acquisition feed; follows `?cursor=...` |
| `/books/<sha256>.epub` | GET/HEAD | Basic | Fetch one EPUB |
| `/covers/<sha256>.jpg\|png` | GET/HEAD | Basic | Fetch one cover |
| `/api/status` | GET | Basic | Status/sample count |
| `/api/books` | POST | Bearer | Import raw EPUB |
| `/api/books/<sha256>` | DELETE | Bearer | Delete EPUB + associated cover |

R2 keys: `books/<sha256>.epub` with `customMetadata` (`title`, `author`, `language`, `cover`); optional `covers/<sha256>.png|jpg`. Never configure `r2.dev` access on the bucket.

## Design decisions

- No database, cron, CI deployment needed to update feed. `GET /opds.xml` reads metadata from `R2.list({include:['customMetadata']})` and generates a fresh Atom feed. R2 is strongly consistent following PUT completion.
- `sha256` IDs prevent filename collisions and casual path traversal. Same bytes uploaded twice return `duplicate: true`. Two different EPUB files with the same logical book title are distinct versions.
- OPDS pagination is implemented with Cloudflare's opaque `cursor`; actual CrossPoint handling of next pages should be verified on the device.
- No CMS/editor UI. Deletion uses an authenticated API call. Upload currently max 12 MiB to stay modest within Workers free CPU/memory budgets.
- Only small referenced PNG/JPEG covers are extracted. Metadata XML extraction is intentionally pragmatic, not a fully validating EPUB/OPF XML parser; unusual/invalid EPUB metadata can require improvements.
- Secrets are configured with Wrangler, not stored in source. Worker fails closed if unconfigured.

## Known limits and next iterations

- **CrossPoint download authentication**: upstream `OpdsBookBrowserActivity.cpp` forwards stored Basic credentials to `downloadFile`. Verify behavior on your installed 1.6.5. `HttpDownloader.cpp` calls `setInsecure()` for HTTPS, so the device does **not validate server certificates**. Use a dedicated read-only password and never reuse higher-value credentials.
- **Workers Free CPU** may reject unusually complex EPUB/large ZIP indexing; then optimize ZIP parser, offload parsing, or change Worker plan.
- **Metadata parser** handles usual EPUB2/3 tags and OPF manifest. Edge cases with nonstandard naming and exotic XML entities may show fallback metadata.
- **Private reading progress** is a separate concern. KOSync/CrossPoint sync can be integrated later using a separate service.
- **Full text/search** is omitted. For many thousands of books, consider D1 metadata index with search instead of scanning R2.
- **iOS automation** is user-initiated Share Sheet; background uploads require a native iOS app or more extensive Shortcuts automation.
- **Cloudflare Access** is *not* used on OPDS paths because its browser/OIDC login is not supported by embedded CrossPoint. If you protect admin routes with Access later, keep OPDS Basic Auth separate.

## Recovery / migration

- `wrangler secret put READ_PASSWORD` changes reader password; update X3 immediately.
- `wrangler secret put UPLOAD_TOKEN` invalidates the old Shortcut credential once changed.
- Export/migrate books using Cloudflare R2 CLI tooling, `wrangler r2 object` commands, or S3-compatible API. R2 custom metadata is used as a simple database; preserve it during bulk copies.
- Cloudflare Workers custom domain binding typically creates its DNS and TLS automatically; do not add duplicate conflicting CNAME manually.
