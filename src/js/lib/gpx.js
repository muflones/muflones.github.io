// GPX reader shared by the build script (Node) and the submit page (browser).
//
// It deliberately does NOT use an XML parser: it only looks for the handful of
// tags we need (points, waypoints, names). That means no DOCTYPE or entity
// processing at all, so "billion laughs" / external-entity tricks cannot work,
// and the exact same code runs in Node and in the browser.

export class GpxError extends Error {
  constructor(code, detail) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

const P = '(?:[A-Za-z_][\\w.-]*:)?'; // optional namespace prefix, e.g. gpx:trkpt

function decodeText(raw, max = 120) {
  if (raw == null) return '';
  let s = String(raw);
  const cdata = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  if (cdata) s = cdata[1];
  s = s
    .replace(/<[^>]*>/g, '') // never keep markup from a file
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
  // drop control characters and emoji-style pictographs, collapse spaces
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ')
       .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
       .replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

// Like decodeText but keeps up to 1500 characters (descriptions / notes).
const decodeLong = (raw) => decodeText(raw, 1500);

function safeChar(code) {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return '';
  try { return String.fromCodePoint(code); } catch { return ''; }
}

function attr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? (m[2] ?? m[3]) : null;
}

function firstTag(body, tag) {
  if (!body) return null;
  const m = body.match(new RegExp(`<${P}${tag}\\b[^>]*>([\\s\\S]*?)</${P}${tag}\\s*>`, 'i'));
  return m ? m[1] : null;
}

function readPoints(block, tag, maxPoints, counter) {
  const out = [];
  const re = new RegExp(`<${P}${tag}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}${tag}\\s*>)`, 'gi');
  let m;
  while ((m = re.exec(block))) {
    const lat = parseFloat(attr(m[1], 'lat'));
    const lon = parseFloat(attr(m[1], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const eleRaw = firstTag(m[2], 'ele');
    const ele = eleRaw == null ? null : parseFloat(eleRaw);
    out.push({ lat, lon, ele: Number.isFinite(ele) && ele > -500 && ele < 9000 ? ele : null });
    if (++counter.n > maxPoints) throw new GpxError('too-many-points', String(maxPoints));
  }
  return out;
}

/**
 * Parse GPX text.
 * @returns {{name:string, author:string, segments:Array<Array<{lat,lon,ele}>>, waypoints:Array<{lat,lon,name}>}}
 */
export function parseGpx(text, { maxPoints = 200000 } = {}) {
  if (typeof text !== 'string' || !text.length) throw new GpxError('empty');
  const src = text.replace(/<!--[\s\S]*?-->/g, '');
  if (!new RegExp(`<${P}gpx[\\s>]`, 'i').test(src)) throw new GpxError('not-gpx');

  const counter = { n: 0 };
  const segments = [];

  // Tracks (<trk><trkseg><trkpt>) are the common case; fall back to routes (<rte><rtept>).
  const segRe = new RegExp(`<${P}trkseg\\b[^>]*>([\\s\\S]*?)</${P}trkseg\\s*>`, 'gi');
  let m;
  while ((m = segRe.exec(src))) {
    const pts = readPoints(m[1], 'trkpt', maxPoints, counter);
    if (pts.length) segments.push(pts);
  }
  if (!segments.length) {
    const rteRe = new RegExp(`<${P}rte\\b[^>]*>([\\s\\S]*?)</${P}rte\\s*>`, 'gi');
    while ((m = rteRe.exec(src))) {
      const pts = readPoints(m[1], 'rtept', maxPoints, counter);
      if (pts.length) segments.push(pts);
    }
  }
  const total = segments.reduce((n, s) => n + s.length, 0);
  if (total < 2) throw new GpxError('no-points');

  const waypoints = [];
  const wptRe = new RegExp(`<${P}wpt\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${P}wpt\\s*>)`, 'gi');
  while ((m = wptRe.exec(src)) && waypoints.length < 200) {
    const lat = parseFloat(attr(m[1], 'lat'));
    const lon = parseFloat(attr(m[1], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    waypoints.push({ lat, lon, name: decodeText(firstTag(m[2], 'name')) });
  }

  const metadata = firstTag(src, 'metadata');
  const trk = firstTag(src, 'trk') ?? firstTag(src, 'rte');
  const name = decodeText(firstTag(metadata, 'name')) || decodeText(firstTag(trk, 'name'));
  const author = decodeText(firstTag(firstTag(metadata, 'author'), 'name'));
  const desc = decodeLong(firstTag(metadata, 'desc'));
  const keywords = decodeText(firstTag(metadata, 'keywords'))
    .split(',').map((k) => k.trim()).filter(Boolean).slice(0, 8);

  return { name, author, desc, keywords, segments, waypoints };
}

/** Write a clean GPX: points and elevation only — no times, heart rate or device data. */
export function writeGpx({ name, author, desc = '', keywords = [], siteUrl, segments, waypoints = [] }) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pt = (p, tag) => `<${tag} lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">${p.ele == null ? '' : `<ele>${p.ele.toFixed(1)}</ele>`}</${tag}>`;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Muflones Trail Running Club" xmlns="http://www.topografix.com/GPX/1/1">',
    ' <metadata>',
    `  <name>${esc(name)}</name>`,
    desc ? `  <desc>${esc(desc)}</desc>` : '',
    author ? `  <author><name>${esc(author)}</name></author>` : '',
    siteUrl ? `  <link href="${esc(siteUrl)}"><text>Muflones Trail Running Club</text></link>` : '',
    keywords.length ? `  <keywords>${esc(keywords.join(', '))}</keywords>` : '',
    ' </metadata>',
    ...waypoints.map((w) => ` <wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}"><name>${esc(w.name)}</name></wpt>`),
    ` <trk><name>${esc(name)}</name>`,
    ...segments.map((seg) => `  <trkseg>\n${seg.map((p) => '   ' + pt(p, 'trkpt')).join('\n')}\n  </trkseg>`),
    ' </trk>',
    '</gpx>',
    '',
  ];
  return lines.filter((l) => l !== '').join('\n') + '\n';
}
