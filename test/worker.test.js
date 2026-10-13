import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractEpub } from '../src/epub.js';
import { escXml, renderOpds } from '../src/catalog.js';
import app from '../src/index.js';

function makeZip(files) {
  const utf8 = new TextEncoder();
  const local = [], central = [];
  let offset = 0;
  function u16(d, p, n) { d.setUint16(p, n, true); }
  function u32(d, p, n) { d.setUint32(p, n, true); }
  for (const [name, text] of Object.entries(files)) {
    const nameBytes = utf8.encode(name), raw = typeof text === 'string' ? utf8.encode(text) : text;
    const compressed = deflateRawSync(raw);
    const l = new Uint8Array(30 + nameBytes.length + compressed.length), v = new DataView(l.buffer);
    u32(v,0,0x04034b50); u16(v,4,20); u16(v,6,0x800); u16(v,8,8); u32(v,18, compressed.length); u32(v,22,raw.length); u16(v,26,nameBytes.length);
    l.set(nameBytes, 30); l.set(compressed,30+nameBytes.length); local.push(l);
    const c = new Uint8Array(46 + nameBytes.length), cv = new DataView(c.buffer);
    u32(cv,0,0x02014b50); u16(cv,4,20); u16(cv,6,20); u16(cv,8,0x800); u16(cv,10,8); u32(cv,20,compressed.length); u32(cv,24,raw.length); u16(cv,28,nameBytes.length); u32(cv,42,offset); c.set(nameBytes,46); central.push(c);
    offset += l.length;
  }
  const centralSize = central.reduce((n,v)=>n+v.length,0);
  const end = new Uint8Array(22), ev = new DataView(end.buffer);
  u32(ev,0,0x06054b50); u16(ev,8,central.length); u16(ev,10,central.length); u32(ev,12,centralSize); u32(ev,16,offset);
  const bytes = new Uint8Array(offset + centralSize + end.length); let p=0;
  for(const chunk of [...local,...central,end]){bytes.set(chunk,p);p+=chunk.length;}
  return bytes;
}
function sampleEpub({ title = 'Русский & English', author = 'Иван <Author>' } = {}) {
  return makeZip({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': `<?xml version="1.0"?><package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>${title.replaceAll('&', '&amp;')}</dc:title><dc:creator>${author.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</dc:creator><dc:language>ru</dc:language></metadata><manifest><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image" /></manifest></package>`,
    'OEBPS/images/cover.png': Uint8Array.from([137,80,78,71,13,10])
  });
}

class FakeBucket {
  constructor() { this.files = new Map(); }
  async head(key) { const o = this.files.get(key); return o ? this.snap(o, key) : null; }
  async put(key, data, props = {}) {
    const bytes = new Uint8Array(data);
    this.files.set(key, { bytes, props, uploaded: new Date('2026-10-13T00:00:00Z') });
  }
  snap(obj, key) { return { key, size: obj.bytes.length, customMetadata: obj.props.customMetadata || {}, uploaded: obj.uploaded, body: obj.bytes }; }
  async get(key) { const o = this.files.get(key); return o ? this.snap(o, key) : null; }
  async delete(keys) { for (const key of keys) this.files.delete(key); }
  async list({ prefix, cursor, limit }) {
    const all = [...this.files.entries()].filter(([key]) => key.startsWith(prefix)).sort();
    const start = Number(cursor || 0);
    const subset = all.slice(start, start + limit);
    return { objects: subset.map(([k,v]) => this.snap(v, k)), truncated: start + limit < all.length, cursor: String(start + limit) };
  }
}
const env = () => ({ BOOKS_BUCKET: new FakeBucket(), READ_USER: 'reader', READ_PASSWORD: 'correct-password', UPLOAD_TOKEN: 'top-secret-upload' });
const basic = 'Basic ' + btoa('reader:correct-password');
const get = (path, hdr = {}) => new Request(`https://books.tiroq.dev${path}`, { headers: hdr });

test('EPUB metadata, unicode and cover extraction', () => {
  const b = extractEpub(sampleEpub());
  assert.equal(b.title, 'Русский & English');
  assert.equal(b.author, 'Иван <Author>');
  assert.equal(b.language, 'ru');
  assert.equal(b.cover.extension, 'png');
});
test('xml escape is safe', () => {
  assert.equal(escXml(`a&<>'"`), 'a&amp;&lt;&gt;&apos;&quot;');
  const opds = renderOpds([{ id: 'f'.repeat(64), title: 'A & B', author: 'Иван', updated: new Date().toISOString() }], 'https://books.tiroq.dev');
  assert.match(opds, /A &amp; B/);
  assert.match(opds, /http:\/\/opds-spec.org\/acquisition/);
});
test('protect catalog, downloads, and uploads with different credentials', async () => {
  const e = env();
  assert.equal((await app.fetch(get('/opds.xml'), e)).status, 401);
  assert.equal((await app.fetch(get('/books/' + 'f'.repeat(64) + '.epub'), e)).status, 401);
  assert.equal((await app.fetch(new Request('https://books.tiroq.dev/api/books', { method: 'POST', body: sampleEpub() }), e)).status, 401);
  assert.equal((await app.fetch(get('/opds.xml', { Authorization: basic }), e)).status, 200);
  assert.equal((await app.fetch(get('/opds.xml', { Authorization: 'Basic ' + btoa('reader:wrong') }), e)).status, 401);
});
test('upload, catalog, duplicate detection, EPUB download, deletion', async () => {
  const e = env();
  const body = sampleEpub();
  async function doUpload() { return await app.fetch(new Request('https://books.tiroq.dev/api/books', { method: 'POST', headers: { Authorization: 'Bearer top-secret-upload', 'Content-Type': 'application/epub+zip' }, body }), e); }
  const r = await doUpload(); assert.equal(r.status, 201);
  const data = await r.json(); assert.equal(data.title, 'Русский & English');
  const dup = await doUpload(); assert.equal(dup.status, 200); assert.equal((await dup.json()).duplicate, true);
  const feed = await (await app.fetch(get('/opds.xml', { Authorization: basic }), e)).text();
  assert.match(feed, /Русский &amp; English/);
  assert.match(feed, new RegExp(`/books/${data.id}\\.epub`));
  const book = await app.fetch(get(data.url, { Authorization: basic }), e);
  assert.equal(book.status, 200); assert.equal(book.headers.get('Content-Type'), 'application/epub+zip');
  assert.deepEqual(new Uint8Array(await book.arrayBuffer()), body);
  assert.equal((await app.fetch(get('/covers/' + data.id + '.png', { Authorization: basic }), e)).status, 200);
  const del = await app.fetch(new Request('https://books.tiroq.dev/api/books/' + data.id, { method: 'DELETE', headers: { Authorization: 'Bearer top-secret-upload' } }), e);
  assert.equal(del.status, 200);
  const after = await (await app.fetch(get('/opds.xml', { Authorization: basic }), e)).text();
  assert.doesNotMatch(after, /Русский/);
});
test('reject malformed EPUB and multipart uploads', async () => {
  const e = env();
  const headers = { Authorization: 'Bearer top-secret-upload' };
  const bad = await app.fetch(new Request('https://books.tiroq.dev/api/books', { method: 'POST', headers, body: 'not an epub' }), e);
  assert.equal(bad.status, 400);
  const form = await app.fetch(new Request('https://books.tiroq.dev/api/books', { method: 'POST', headers: { ...headers, 'Content-Type': 'multipart/form-data; boundary=foo' }, body: 'foo' }), e);
  assert.equal(form.status, 415);
  assert.equal(e.BOOKS_BUCKET.files.size, 0);
});

test('small OPDS pages link to next page for low-memory X3', async () => {
  const e = env();
  for (let n=0; n<40; n++) await e.BOOKS_BUCKET.put(`books/${n.toString(16).padStart(64,'0')}.epub`, Uint8Array.from([1]), { customMetadata: { title: `Book ${n}`, author: 'Author' } });
  const first = await (await app.fetch(get('/opds.xml', { Authorization: basic }),e)).text();
  assert.match(first, /rel="next"/);
  const cursor = first.match(/cursor=([0-9a-zA-Z%+-]+)/)?.[1];
  assert.ok(cursor);
  const second = await (await app.fetch(get('/opds.xml?cursor='+cursor, { Authorization: basic }),e)).text();
  assert.match(second, /Book 39/);
});
