export function escXml(input = '') {
  return String(input).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}
export const escHtml = escXml;
const tag = (v) => escXml(v);
const OPDS = 'http://opds-spec.org/acquisition';
export function bookRecord(obj) {
  const m = obj.customMetadata || {};
  const id = obj.key.replace(/^books\//, '').replace(/\.epub$/, '');
  if (!/^[a-f0-9]{64}$/.test(id)) return null;
  return {
    id,
    title: m.title || 'Untitled',
    author: m.author || 'Unknown author',
    language: m.language || 'und',
    cover: m.cover || '',
    updated: obj.uploaded instanceof Date ? obj.uploaded.toISOString() : new Date(obj.uploaded || Date.now()).toISOString()
  };
}
export function renderOpds(books, origin, { cursor = '', nextCursor = '' } = {}) {
  const entries = books.map(b => `  <entry>
    <title>${tag(b.title)}</title>
    <id>urn:sha256:${tag(b.id)}</id>
    <updated>${tag(b.updated)}</updated>
    <author><name>${tag(b.author)}</name></author>
    <dc:language>${tag(b.language)}</dc:language>
    <link rel="${OPDS}" type="application/epub+zip" href="${tag(origin)}/books/${tag(b.id)}.epub" />${b.cover ? `
    <link rel="http://opds-spec.org/image/thumbnail" type="image/${b.cover === 'png' ? 'png' : 'jpeg'}" href="${tag(origin)}/covers/${tag(b.id)}.${tag(b.cover)}" />` : ''}
  </entry>`).join('\n');
  const self = `${origin}/opds.xml${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
  const next = nextCursor ? `\n  <link rel="next" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="${tag(origin)}/opds.xml?cursor=${tag(encodeURIComponent(nextCursor))}" />` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/">
  <id>urn:pocket-library:books.tiroq.dev</id>
  <title>Ivan's Pocket Library</title>
  <updated>${new Date().toISOString()}</updated>
  <link rel="self" type="application/atom+xml;profile=opds-catalog;kind=acquisition" href="${tag(self)}" />${next}
${entries}
</feed>`;
}
export function renderHome(books, more) {
  const list = books.length ? books.map(b => `<li><a href="/books/${b.id}.epub">${escHtml(b.title)}</a><small>${escHtml(b.author)}</small></li>`).join('\n') : '<li>No books yet. Share an EPUB from your iPhone.</li>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Pocket Library</title><style>body{margin:5vh auto;max-width:720px;padding:0 20px;font:16px system-ui;background:#f7f6f2;color:#242424}header{margin-bottom:32px}li{margin:12px 0;padding:10px 0;border-bottom:1px solid #dedbd3}a{color:#243e58;text-decoration:none}a:hover{text-decoration:underline}small{display:block;color:#777;margin-top:5px}p{color:#555}</style></head><body><header><h1>Pocket Library</h1><p>Private EPUB library for XTEINK X3 · <a href="/opds.xml">OPDS feed</a></p></header><h2>Books</h2><ul>${list}</ul>${more ? '<p>More books are available via the paginated OPDS feed.</p>' : ''}</body></html>`;
}
