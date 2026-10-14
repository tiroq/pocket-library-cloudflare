import { extractEpub } from './epub.js';
import { bookRecord, renderHome, renderOpds } from './catalog.js';
import { normalizeDashboard, renderDashboardBmp, convertDashboardBmpTo1Bit } from './dashboard.js';

const MAX_EPUB = 12 * 1024 * 1024; // Conservative: free Workers have tight CPU/memory limits.
const NO_STORE = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const ID = '[a-f0-9]{64}';

function textResponse(text, status = 200, type = 'text/plain; charset=utf-8', extra = {}) {
  return new Response(text, { status, headers: { ...NO_STORE, 'Content-Type': type, ...extra } });
}
function jsonResponse(data, status = 200) { return textResponse(JSON.stringify(data), status, 'application/json; charset=utf-8'); }
function safeEquals(a, b) {
  const x = new TextEncoder().encode(a || '');
  const y = new TextEncoder().encode(b || '');
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}
function basicOK(req, env) {
  const header = req.headers.get('Authorization') || '';
  if (!header.startsWith('Basic ')) return false;
  try {
    const v = atob(header.slice(6));
    const sep = v.indexOf(':');
    if (sep < 0) return false;
    // Force all comparisons to happen, independent of the username result.
    const userOK = safeEquals(v.slice(0, sep), env.READ_USER || 'reader');
    const passOK = safeEquals(v.slice(sep + 1), env.READ_PASSWORD);
    return userOK && passOK;
  } catch { return false; }
}
function uploaderOK(req, env) {
  const header = req.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') && safeEquals(header.slice(7), env.UPLOAD_TOKEN);
}
const unauthorizedReader = () => textResponse('Authentication required', 401, 'text/plain; charset=utf-8', { 'WWW-Authenticate': 'Basic realm="Pocket Library", charset="UTF-8"' });
const unauthorizedUploader = () => jsonResponse({ error: 'Invalid upload token' }, 401);

async function listBooks(env, cursor) {
  const opt = { prefix: 'books/', limit: 32, include: ['customMetadata'] };
  if (cursor) opt.cursor = cursor;
  const listing = await env.BOOKS_BUCKET.list(opt);
  return { books: listing.objects.map(bookRecord).filter(Boolean), nextCursor: listing.truncated ? listing.cursor : '' };
}
async function upload(req, env) {
  if (!uploaderOK(req, env)) return unauthorizedUploader();
  const length = Number(req.headers.get('Content-Length') || 0);
  if (length > MAX_EPUB) return jsonResponse({ error: 'EPUB exceeds 12 MiB limit' }, 413);
  const contentType = req.headers.get('Content-Type') || '';
  if (contentType.includes('multipart/form-data')) return jsonResponse({ error: 'Send raw EPUB bytes, not multipart/form-data' }, 415);
  if (!req.body) return jsonResponse({ error: 'Missing file body' }, 400);
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_EPUB) return jsonResponse({ error: 'EPUB exceeds 12 MiB limit' }, 413);
  let info;
  try { info = extractEpub(bytes); }
  catch (err) { return jsonResponse({ error: `Invalid EPUB: ${String(err.message || err)}` }, 400); }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const id = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
  const key = `books/${id}.epub`;
  if (await env.BOOKS_BUCKET.head(key)) return jsonResponse({ ok: true, duplicate: true, id, title: info.title, author: info.author, url: `/books/${id}.epub` });
  const cover = info.cover?.extension || '';
  if (info.cover) {
    await env.BOOKS_BUCKET.put(`covers/${id}.${cover}`, info.cover.bytes, { httpMetadata: { contentType: info.cover.contentType } });
  }
  await env.BOOKS_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: 'application/epub+zip' },
    customMetadata: { title: info.title, author: info.author, language: info.language, cover }
  });
  return jsonResponse({ ok: true, duplicate: false, id, title: info.title, author: info.author, url: `/books/${id}.epub` }, 201);
}
async function updateDashboard(req, env) {
  if (!uploaderOK(req, env)) return unauthorizedUploader();
  const limit = 24 * 1024;
  if (Number(req.headers.get('Content-Length') || 0) > limit) return jsonResponse({ error: 'Dashboard JSON too large' }, 413);
  if (!req.headers.get('Content-Type')?.toLowerCase().includes('application/json')) return jsonResponse({ error: 'Send application/json' }, 415);
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.length > limit) return jsonResponse({ error: 'Dashboard JSON too large' }, 413);
  let data;
  try { data = normalizeDashboard(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))); }
  catch (err) { return jsonResponse({ error: 'Invalid dashboard: ' + String(err.message || err) }, 400); }
  const bitmap = renderDashboardBmp(data);
  const sleepBitmap = convertDashboardBmpTo1Bit(bitmap);
  // Both representations are private. The compact file fits CrossPoint's
  // one-megabyte sleep.enter plugin download limit.
  await env.BOOKS_BUCKET.put('dashboard/current-1bit.bmp', sleepBitmap, { httpMetadata: { contentType: 'image/bmp' } });
  await env.BOOKS_BUCKET.put('dashboard/current.bmp', bitmap, { httpMetadata: { contentType: 'image/bmp' } });
  await env.BOOKS_BUCKET.put('dashboard/current.json', JSON.stringify(data), { httpMetadata: { contentType: 'application/json' } });
  return jsonResponse({ ok: true, imageUrl: '/dashboard.bmp', sleepImageUrl: '/dashboard-1bit.bmp', width: 528, height: 792,
    updatedAt: data.generatedAt, font: data.font, events: data.events.length, tasks: data.tasks.length });
}
async function sendDashboard(req, env, format = 'json') {
  const image = format !== 'json';
  const key = format === 'mono' ? 'dashboard/current-1bit.bmp'
    : image ? 'dashboard/current.bmp' : 'dashboard/current.json';
  const obj = req.method === 'HEAD' ? await env.BOOKS_BUCKET.head(key) : await env.BOOKS_BUCKET.get(key);
  if (!obj) return textResponse('Dashboard has not been uploaded yet', 404);
  const headers = new Headers(NO_STORE);
  headers.set('Content-Type', image ? 'image/bmp' : 'application/json; charset=utf-8');
  headers.set('Content-Length', String(obj.size));
  if (image) headers.set('Content-Disposition', 'inline; filename="sleep.bmp"');
  return new Response(req.method === 'HEAD' ? null : obj.body, { headers });
}
async function deleteBook(req, env, id) {
  if (!uploaderOK(req, env)) return unauthorizedUploader();
  // All three keys are id-derived; no arbitrary user-supplied paths accepted.
  await env.BOOKS_BUCKET.delete([`books/${id}.epub`, `covers/${id}.jpg`, `covers/${id}.png`]);
  return jsonResponse({ ok: true, deleted: id });
}
async function sendObject(req, env, key, mime) {
  const obj = req.method === 'HEAD' ? await env.BOOKS_BUCKET.head(key) : await env.BOOKS_BUCKET.get(key);
  if (!obj) return textResponse('Not found', 404);
  const headers = new Headers(NO_STORE);
  headers.set('Content-Type', mime);
  headers.set('Content-Length', String(obj.size));
  headers.set('Content-Disposition', 'attachment');
  return new Response(req.method === 'HEAD' ? null : obj.body, { headers });
}

export default {
  async fetch(req, env) {
    try {
      const url = new URL(req.url);
      if (url.pathname === '/health' && req.method === 'GET') return jsonResponse({ ok: true, name: 'pocket-library' });
      if (!env.BOOKS_BUCKET || !env.READ_PASSWORD || !env.UPLOAD_TOKEN) return textResponse('Worker is not fully configured', 503);
      if (url.pathname === '/api/books' && req.method === 'POST') return await upload(req, env);
      if (url.pathname === '/api/dashboard' && req.method === 'POST') return await updateDashboard(req, env);
      const matchDelete = url.pathname.match(new RegExp(`^/api/books/(${ID})$`));
      if (matchDelete && req.method === 'DELETE') return await deleteBook(req, env, matchDelete[1]);
      if (!basicOK(req, env)) return unauthorizedReader();
      if (req.method !== 'GET' && req.method !== 'HEAD') return textResponse('Method not allowed', 405);
      if (url.pathname === '/dashboard.bmp') return await sendDashboard(req, env, 'color');
      if (url.pathname === '/dashboard-1bit.bmp') return await sendDashboard(req, env, 'mono');
      if (url.pathname === '/api/dashboard') return await sendDashboard(req, env);
      if (url.pathname === '/' || url.pathname === '/opds.xml') {
        const cursor = url.searchParams.get('cursor') || '';
        if (cursor.length > 2048) return textResponse('Invalid cursor', 400);
        const { books, nextCursor } = await listBooks(env, cursor);
        if (url.pathname === '/opds.xml') return textResponse(renderOpds(books, url.origin, { cursor, nextCursor }), 200, 'application/atom+xml;profile=opds-catalog;kind=acquisition; charset=utf-8');
        return textResponse(renderHome(books, !!nextCursor), 200, 'text/html; charset=utf-8', {
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'",
          'X-Robots-Tag': 'noindex, nofollow'
        });
      }
      if (url.pathname === '/api/status') {
        const { books, nextCursor } = await listBooks(env, '');
        return jsonResponse({ ok: true, sampleCount: books.length, more: !!nextCursor });
      }
      const book = url.pathname.match(new RegExp(`^/books/(${ID})\\.epub$`));
      if (book) return await sendObject(req, env, `books/${book[1]}.epub`, 'application/epub+zip');
      const cover = url.pathname.match(new RegExp(`^/covers/(${ID})\\.(png|jpg)$`));
      if (cover) return await sendObject(req, env, `covers/${cover[1]}.${cover[2]}`, cover[2] === 'png' ? 'image/png' : 'image/jpeg');
      return textResponse('Not found', 404);
    } catch (error) {
      console.error('Worker request failed:', error?.stack || error);
      return textResponse('Internal server error', 500);
    }
  }
};
