#!/usr/bin/env node
// Builds the static site into dist/.
//
//   node scripts/build.mjs          build the site
//   node scripts/build.mjs --check  same checks, then print a summary (used on pull requests)
//
// No dependencies: only Node's standard library and the shared code in src/js/lib.

import { readFile, writeFile, mkdir, rm, readdir, stat, cp } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseGpx, writeGpx } from '../src/js/lib/gpx.js';
import { analyse, profile, simplify, haversine } from '../src/js/lib/stats.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const OUT = join(ROOT, 'dist');
const TRACKS = join(ROOT, 'tracks');
const CHECK = process.argv.includes('--check');

const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
const BASE = normaliseBase(config.basePath || '/');
const errors = [];
const warnings = [];
const summary = [];

function normaliseBase(b) {
  let s = String(b).trim();
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.endsWith('/')) s += '/';
  return s;
}

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const r1 = (x) => Math.round(x * 10) / 10;

// ---------- sidecar (tracks/<slug>.json) ----------
function cleanStr(v, max = 120) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function cleanUrl(v) {
  const s = cleanStr(v, 300);
  return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : '';
}
function readSidecar(raw, slug) {
  const m = raw ?? {};
  const notes = typeof m.notes === 'string' ? { it: m.notes, en: '' } : (m.notes ?? {});
  const added = /^\d{4}-\d{2}-\d{2}$/.test(m.added ?? '') ? m.added : null;
  if (raw && m.added && !added) warnings.push(`${slug}: "added" should look like 2026-09-30`);
  return {
    name: cleanStr(m.name),
    author: cleanStr(m.author),
    authorUrl: cleanUrl(m.authorUrl),
    addedBy: cleanStr(m.addedBy),
    added,
    tags: Array.isArray(m.tags) ? m.tags.map((t) => cleanStr(t, 30)).filter(Boolean).slice(0, 8) : [],
    notes: { it: cleanStr(notes.it, 1500), en: cleanStr(notes.en, 1500) },
  };
}

// ---------- one track ----------
async function buildTrack(file) {
  const slug = basename(file, '.gpx');
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    errors.push(`${file}: rename it using only lowercase letters, digits and dashes (e.g. "giro-del-lago.gpx")`);
    return null;
  }
  const path = join(TRACKS, file);
  const size = (await stat(path)).size;
  if (size > config.limits.maxFileMB * 1024 * 1024) {
    errors.push(`${file}: ${(size / 1048576).toFixed(1)} MB is over the ${config.limits.maxFileMB} MB limit`);
    return null;
  }
  const raw = await readFile(path, 'utf8');
  // Files in tracks/ are public in the repository, so they must already be clean:
  // no timestamps, no sensor/device data (heart rate, cadence…), no email addresses.
  const dirty = [...new Set([...raw.matchAll(/<(?:[\w.-]+:)?(time|extensions|email)\b/gi)].map((m) => m[1].toLowerCase()))];
  if (dirty.length) {
    const what = dirty.map((d) => ({ time: 'timestamps', extensions: 'sensor/device data', email: 'an email address' }[d])).join(', ');
    errors.push(`${file}: contains ${what}. Replace it with the cleaned copy: open the site's "Proponi una traccia" page, load this GPX and click "Scarica la copia pulita".`);
    return null;
  }
  let gpx;
  try {
    gpx = parseGpx(raw, { maxPoints: config.limits.maxPoints });
  } catch (e) {
    errors.push(`${file}: not a usable GPX (${e.code || e.message})`);
    return null;
  }
  let side = null;
  try {
    side = JSON.parse(await readFile(join(TRACKS, slug + '.json'), 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') { errors.push(`${slug}.json: invalid JSON (${e.message})`); return null; }
  }
  const meta = readSidecar(side, slug);
  // The submit page writes name, author, notes (<desc>) and tags (<keywords>) into the GPX itself,
  // so a single file is enough. A tracks/<slug>.json file, when present, overrides them.
  const name = meta.name || gpx.name || slug;
  const author = meta.author || gpx.author || '';
  if (!meta.notes.it && !meta.notes.en && gpx.desc) meta.notes = { it: cleanStr(gpx.desc, 1500), en: '' };
  if (!meta.tags.length && gpx.keywords.length) meta.tags = gpx.keywords.map((t) => cleanStr(t, 30));
  if (!meta.added) meta.added = gitAddedDate(path) || new Date().toISOString().slice(0, 10);
  if (!author) warnings.push(`${slug}: no author — add "author" to ${slug}.json`);

  const a = analyse(gpx.segments);
  const home = config.home;
  const fromHome = haversine({ lat: home.lat, lon: home.lon }, { lat: a.start[0], lon: a.start[1] }) / 1000;
  if (fromHome > home.radiusKm) warnings.push(`${slug}: starts ${fromHome.toFixed(0)} km from ${home.name}, outside the ${home.radiusKm} km area`);

  const detailLine = simplify(a.points, 4, 4000);
  const overviewLine = simplify(a.points, 25, 300);
  const prof = a.hasEle ? profile(a.points, 400) : null;
  const spark = a.hasEle ? profile(a.points, 60).es : null;
  const every = a.distance > 40000 ? 10 : 5;
  const kmMarks = [];
  for (let k = every, j = 0; k * 1000 < a.distance; k += every) {
    while (j < a.points.length - 1 && a.points[j].d < k * 1000) j++;
    kmMarks.push([k, r5(a.points[j].lat), r5(a.points[j].lon)]);
  }

  const stats = {
    distance: Math.round(a.distance),
    gain: Math.round(a.gain), loss: Math.round(a.loss),
    maxEle: a.maxEle == null ? null : Math.round(a.maxEle), maxEleAt: a.maxEleAt == null ? null : Math.round(a.maxEleAt),
    minEle: a.minEle == null ? null : Math.round(a.minEle), minEleAt: a.minEleAt == null ? null : Math.round(a.minEleAt),
    effortKm: r1(a.effortKm), loop: a.loop, loopGap: Math.round(a.loopGap), points: a.pointCount,
  };
  const common = { slug, name, author, authorUrl: meta.authorUrl, addedBy: meta.addedBy, added: meta.added, tags: meta.tags, stats, start: a.start.map(r5), bbox: a.bbox.map(r5) };

  const detail = {
    ...common,
    notes: meta.notes,
    climbs: a.climbs.map((c) => ({ from: Math.round(c.from), to: Math.round(c.to), eleFrom: Math.round(c.eleFrom), eleTo: Math.round(c.eleTo), gain: Math.round(c.gain), avg: r1(c.avg) })),
    climbMinGain: a.climbMinGain ?? null,
    gradient: a.gradient ? a.gradient.map((x) => Math.round(x * 1000) / 1000) : null,
    line: detailLine.map((p) => [r5(p.lat), r5(p.lon), p.ele == null ? null : Math.round(p.ele), Math.round(p.d)]),
    peak: a.maxEleLatLon ? a.maxEleLatLon.map(r5) : null,
    profile: prof,
    kmMarks, kmEvery: every,
    waypoints: gpx.waypoints.map((w) => ({ lat: r5(w.lat), lon: r5(w.lon), name: w.name })),
  };
  const entry = { ...common, line: overviewLine.map((p) => [r5(p.lat), r5(p.lon)]), spark };

  const cleanGpx = writeGpx({ name, author, desc: meta.notes.it || meta.notes.en, keywords: meta.tags, siteUrl: config.siteUrl, segments: gpx.segments, waypoints: gpx.waypoints });
  summary.push(`| ${escMd(name)} | ${(a.distance / 1000).toFixed(1)} km | +${Math.round(a.gain)} m | ${a.maxEle == null ? '–' : Math.round(a.maxEle) + ' m'} | ${escMd(author) || '⚠️ missing'} |`);
  return { slug, name, detail, entry, cleanGpx };
}

// Date the file was first committed (needs the full git history, see deploy.yml).
function gitAddedDate(path) {
  try {
    const out = execFileSync('git', ['log', '--diff-filter=A', '--follow', '--format=%as', '--', path], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const dates = out.trim().split('\n').filter(Boolean);
    return dates.length ? dates[dates.length - 1] : null;
  } catch { return null; }
}

function escMd(s) { return String(s ?? '').replace(/[|\\`*_[\]<>]/g, (c) => '\\' + c); }

// ---------- pages ----------
async function processHtml(text, vars) {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

async function copySrc() {
  await cp(SRC, OUT, {
    recursive: true,
    filter: (p) => !p.endsWith('.DS_Store'),
  });
  for (const f of await readdir(OUT, { recursive: true })) {
    if (extname(f) !== '.html' || f === 'track.html') continue; // track.html is rendered per track below
    const p = join(OUT, f);
    await writeFile(p, await processHtml(await readFile(p, 'utf8'), baseVars()));
  }
}

function baseVars() {
  const email = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(config.adminEmail || '') ? config.adminEmail : '';
  return { BASE, SITE_NAME: escHtml(config.siteName), SITE_URL: escHtml(config.siteUrl), ADMIN_EMAIL: escHtml(email) };
}

// ---------- main ----------
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await copySrc();

const files = (await readdir(TRACKS)).filter((f) => extname(f).toLowerCase() === '.gpx').sort();
for (const f of await readdir(TRACKS)) {
  if (!/\.(gpx|json)$/.test(f) && f !== '.gitkeep' && !f.startsWith('.')) warnings.push(`tracks/${f}: ignored (only .gpx and .json files are used)`);
  if (/\.GPX$/.test(f)) errors.push(`tracks/${f}: use a lowercase ".gpx" extension`);
}
const built = [];
for (const f of files) {
  const t = await buildTrack(f);
  if (t) built.push(t);
}

await mkdir(join(OUT, 'data', 'tracks'), { recursive: true });
await mkdir(join(OUT, 'tracks'), { recursive: true });
const template = await readFile(join(SRC, 'track.html'), 'utf8');
for (const t of built) {
  await writeFile(join(OUT, 'data', 'tracks', t.slug + '.json'), JSON.stringify(t.detail));
  await writeFile(join(OUT, 'tracks', t.slug + '.gpx'), t.cleanGpx);
  const s = t.detail.stats;
  const desc = `${t.name}: ${(s.distance / 1000).toFixed(1).replace('.', ',')} km, +${s.gain} m${t.detail.author ? ` — ${t.detail.author}` : ''}`;
  const html = await processHtml(template, {
    ...baseVars(),
    TITLE: escHtml(t.name),
    DESCRIPTION: escHtml(desc),
    SLUG: escHtml(t.slug),
    CANONICAL: escHtml(`${config.siteUrl.replace(/\/$/, '')}${BASE}tracce/${t.slug}/`),
  });
  await mkdir(join(OUT, 'tracce', t.slug), { recursive: true });
  await writeFile(join(OUT, 'tracce', t.slug, 'index.html'), html);
}
await rm(join(OUT, 'track.html'), { force: true });

const index = built
  .map((t) => t.entry)
  .sort((a, b) => (b.added ?? '').localeCompare(a.added ?? '') || a.name.localeCompare(b.name));
await writeFile(join(OUT, 'data', 'index.json'), JSON.stringify(index));
await writeFile(join(OUT, 'data', 'site.json'), JSON.stringify({
  siteName: config.siteName, siteUrl: config.siteUrl, basePath: BASE, repo: config.repo, branch: config.branch,
  adminEmail: config.adminEmail, home: config.home, limits: config.limits,
  mapMaxTracks: Number.isInteger(config.mapMaxTracks) && config.mapMaxTracks > 0 ? config.mapMaxTracks : 20,
}));

// ---------- report ----------
const report = [
  `### Tracks: ${built.length} ok${errors.length ? `, ${errors.length} problem(s)` : ''}`,
  '',
  '| Track | Distance | Gain | Highest | Author |',
  '|---|---|---|---|---|',
  ...summary,
  '',
  ...errors.map((e) => `- ❌ ${e}`),
  ...warnings.map((w) => `- ⚠️ ${w}`),
].join('\n');
console.log(report);
if (process.env.GITHUB_STEP_SUMMARY) await writeFile(process.env.GITHUB_STEP_SUMMARY, report + '\n', { flag: 'a' });
if (errors.length) {
  console.error(`\nBuild failed: ${errors.length} problem(s) above. The live site has not changed.`);
  process.exit(1);
}
console.log(CHECK ? '\nAll checks passed.' : `\nBuilt ${built.length} track(s) into dist/`);
