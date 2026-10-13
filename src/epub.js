// Dependency-free EPUB metadata extraction for Cloudflare Workers (Node compatibility 2026-08-04+).
// Only the container.xml, OPF and optional cover are decompressed, not book contents.
import { inflateRawSync } from 'node:zlib';

const utf8 = new TextDecoder('utf-8', { fatal: true });
const MAX_XML = 1024 * 1024;
const MAX_COVER = 1024 * 1024;
function decode(bytes) { return utf8.decode(bytes); }
function u16(v, n) { return v.getUint16(n, true); }
function u32(v, n) { return v.getUint32(n, true); }

function zipEntries(data) {
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  // The End of Central Directory must be in the final 65,557 bytes.
  let eocd = -1;
  for (let p = data.length - 22; p >= Math.max(0, data.length - 65557); p--) {
    if (u32(v, p) === 0x06054b50 && p + 22 + u16(v, p + 20) === data.length) { eocd = p; break; }
  }
  if (eocd === -1) throw new Error('Missing ZIP directory');
  if (u16(v, eocd + 4) !== 0 || u16(v, eocd + 6) !== 0) throw new Error('Multi-disk ZIP unsupported');
  const count = u16(v, eocd + 10);
  if (count > 10000) throw new Error('Too many EPUB files');
  let p = u32(v, eocd + 16);
  const end = p + u32(v, eocd + 12);
  if (p > data.length || end > eocd) throw new Error('Invalid ZIP directory bounds');
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (p + 46 > end || u32(v, p) !== 0x02014b50) throw new Error('Corrupted ZIP directory');
    const flags = u16(v, p + 8), method = u16(v, p + 10);
    const compressed = u32(v, p + 20), original = u32(v, p + 24);
    const nameLen = u16(v, p + 28), extraLen = u16(v, p + 30), commentLen = u16(v, p + 32);
    const local = u32(v, p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > end) throw new Error('Invalid filename length');
    const name = decode(data.subarray(p + 46, p + 46 + nameLen));
    if (!name.startsWith('/') && !name.split('/').includes('..') && !(flags & 1)) files.set(name, { method, compressed, original, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (p !== end) throw new Error('Invalid ZIP directory size');
  return { data, v, files };
}
function unzipOne(zip, path, limit) {
  const entry = zip.files.get(path);
  if (!entry) throw new Error(`Missing EPUB component: ${path}`);
  if (entry.original > limit) throw new Error('EPUB component too large');
  const { v, data } = zip;
  const p = entry.local;
  if (p + 30 > data.length || u32(v, p) !== 0x04034b50) throw new Error('Invalid ZIP local header');
  const start = p + 30 + u16(v, p + 26) + u16(v, p + 28);
  if (start + entry.compressed > data.length) throw new Error('Truncated ZIP entry');
  const part = data.subarray(start, start + entry.compressed);
  let result;
  if (entry.method === 0) result = part;
  else if (entry.method === 8) result = inflateRawSync(part, { maxOutputLength: limit });
  else throw new Error('Unsupported ZIP compression');
  if (result.length !== entry.original || result.length > limit) throw new Error('Invalid decompressed length');
  return result;
}
function xmlDecode(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (_m, entity) => {
    const table = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (entity[0] === '#') {
      const cp = entity[1]?.toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
    }
    return table[entity.toLowerCase()] || '';
  });
}
function xmlText(xml, local) {
  const tag = `(?:[a-zA-Z_][\\w.-]*:)?${local}`;
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'));
  return m ? xmlDecode(m[1].replace(/<[^>]*>/g, '').trim()) : '';
}
function attrs(tag) {
  const result = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) result[m[1]] = xmlDecode(m[2] ?? m[3]);
  return result;
}
function resolveWithinEpub(opfPath, relative) {
  const path = decodeURIComponent(relative.split('#')[0].split('?')[0]);
  if (/^[a-z][\w+.-]*:/i.test(path) || path.startsWith('/')) throw new Error('Unsafe EPUB path');
  const parts = opfPath.split('/'); parts.pop();
  for (const item of path.split('/')) {
    if (!item || item === '.') continue;
    if (item === '..') { if (!parts.length) throw new Error('Unsafe EPUB path'); parts.pop(); }
    else parts.push(item);
  }
  return parts.join('/');
}
export function extractEpub(data) {
  if (data.length < 100 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error('Not a ZIP/EPUB');
  const zip = zipEntries(data);
  const container = decode(unzipOne(zip, 'META-INF/container.xml', MAX_XML));
  const rootfileTag = container.match(/<(?:[\w.-]+:)?rootfile\b[^>]*>/i)?.[0];
  const opfPath = rootfileTag && attrs(rootfileTag)['full-path'];
  if (!opfPath || !opfPath.endsWith('.opf') || opfPath.startsWith('/') || opfPath.split('/').includes('..')) throw new Error('EPUB missing OPF');
  const opf = decode(unzipOne(zip, opfPath, MAX_XML));
  if (!/<(?:[\w.-]+:)?package\b/i.test(opf)) throw new Error('Invalid EPUB OPF');
  const title = xmlText(opf, 'title').slice(0, 180) || 'Untitled';
  const author = xmlText(opf, 'creator').slice(0, 180) || 'Unknown author';
  const language = xmlText(opf, 'language').slice(0, 20) || 'und';
  const items = [...opf.matchAll(/<(?:[\w.-]+:)?item\b[^>]*>/gi)].map(match => attrs(match[0]));
  const coverMeta = [...opf.matchAll(/<(?:[\w.-]+:)?meta\b[^>]*>/gi)].map(match => attrs(match[0])).find(x => x.name === 'cover')?.content;
  const coverItem = items.find(x => (x.properties || '').split(/\s+/).includes('cover-image'))
      || items.find(x => x.id && x.id === coverMeta)
      || items.find(x => /cover/i.test(x.id || '') && /^image\//.test(x['media-type'] || ''));
  let cover = null;
  if (coverItem?.href) {
    const type = coverItem['media-type'];
    if (type === 'image/jpeg' || type === 'image/png') {
      try {
        const path = resolveWithinEpub(opfPath, coverItem.href);
        cover = { contentType: type, bytes: unzipOne(zip, path, MAX_COVER), extension: type === 'image/png' ? 'png' : 'jpg' };
      } catch { /* Broken/oversized cover is optional. */ }
    }
  }
  return { title, author, language, cover };
}
