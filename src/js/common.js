// Shared helpers: language, formatting, safe DOM building, data loading, map setup.
import { STRINGS } from './i18n.js';

export const BASE = document.querySelector('meta[name="base-path"]')?.content || '/';

// ---------- language ----------
const LANGS = ['it', 'en'];
function storedLang() {
  try { return localStorage.getItem('lang'); } catch { return null; }
}
export let lang = (() => {
  const q = new URLSearchParams(location.search).get('lang');
  if (LANGS.includes(q)) return q;
  const s = storedLang();
  return LANGS.includes(s) ? s : 'it';
})();

const listeners = [];
export function onLangChange(fn) { listeners.push(fn); }

export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  lang = next;
  try { localStorage.setItem('lang', next); } catch { /* private mode: fine */ }
  applyStatic();
  listeners.forEach((fn) => fn(lang));
}

export function t(key, vars = {}) {
  const s = STRINGS[lang][key] ?? STRINGS.it[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Translate everything marked with data-i18n* in the page. */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  root.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
  root.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  root.querySelectorAll('.lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
}

function wireLangSwitch() {
  document.querySelectorAll('.lang button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
}

// ---------- formatting ----------
const locale = () => (lang === 'it' ? 'it-IT' : 'en-GB');
export const fmtNum = (n, digits = 0) =>
  n == null ? '–' : new Intl.NumberFormat(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
export const fmtKm = (m, digits = 1) => fmtNum(m / 1000, digits);
export const fmtDate = (iso) => {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
};
export const fmtSize = (bytes) => (bytes < 1024 * 1024 ? `${fmtNum(bytes / 1024, 0)} KB` : `${fmtNum(bytes / 1048576, 1)} MB`);

// ---------- safe DOM ----------
// Text is always set with textContent, never innerHTML, so names from GPX files can't inject markup.
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'href') node.setAttribute('href', safeHref(v));
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function safeHref(v) {
  const s = String(v);
  if (s.startsWith('/') || s.startsWith('#') || s.startsWith('./') || s.startsWith('mailto:') || /^https:\/\//i.test(s)) return s;
  return '#';
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return node;
}

export function icon(name, size = 16) {
  const paths = {
    download: ['M12 4v12', 'M6 10l6 6 6-6', 'M4 20h16'],
    upload: ['M12 16V4', 'M6 10l6-6 6 6', 'M4 20h16'],
    link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
    x: ['M6 6l12 12', 'M18 6L6 18'],
    fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
    check: ['M5 12l5 5 9-10'],
  };
  return svg('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
    (paths[name] || []).map((d) => svg('path', { d })));
}

// ---------- data ----------
export async function loadJSON(path) {
  const res = await fetch(BASE + path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json();
}

export const trackUrl = (slug) => `${BASE}tracce/${encodeURIComponent(slug)}/`;
export const gpxUrl = (slug) => `${BASE}tracks/${encodeURIComponent(slug)}.gpx`;

// ---------- map ----------
export const COLORS = { accent: '#C2410C', blue: '#1F4E79', ink: '#1B1E1A', halo: '#FFFFFF' };

export function makeMap(node, { interactive = true } = {}) {
  const L = window.L;
  const map = L.map(node, { zoomControl: false, attributionControl: true, scrollWheelZoom: interactive, zoomSnap: 0.25, zoomDelta: 0.5 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  const layers = {
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      subdomains: 'abc', maxZoom: 17,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    }),
    streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }),
  };
  layers.topo.addTo(map);
  const zoom = L.control.zoom({ position: 'topright', zoomInTitle: t('zoomIn'), zoomOutTitle: t('zoomOut') }).addTo(map);
  onLangChange(() => {
    const c = zoom.getContainer();
    c.querySelector('.leaflet-control-zoom-in')?.setAttribute('title', t('zoomIn'));
    c.querySelector('.leaflet-control-zoom-in')?.setAttribute('aria-label', t('zoomIn'));
    c.querySelector('.leaflet-control-zoom-out')?.setAttribute('title', t('zoomOut'));
    c.querySelector('.leaflet-control-zoom-out')?.setAttribute('aria-label', t('zoomOut'));
  });
  return { map, layers };
}

/** Wire a .map-style button group (data-layer="topo|streets") to the map's tile layers. */
export function wireStyleSwitch(group, { map, layers }) {
  if (!group) return;
  group.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    Object.entries(layers).forEach(([k, layer]) => (k === b.dataset.layer ? layer.addTo(map) : layer.remove()));
    group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
}

/** Orange line with a white halo so it reads on any map. */
export function trackLine(latlngs, color = COLORS.accent, weight = 3.5) {
  const L = window.L;
  return L.layerGroup([
    L.polyline(latlngs, { color: COLORS.halo, weight: weight + 3.5, opacity: 0.85, interactive: false }),
    L.polyline(latlngs, { color, weight, opacity: 1, lineJoin: 'round', interactive: false }),
  ]);
}

export function divMarker(latlng, className, text, opts = {}) {
  const L = window.L;
  const node = el('div', { class: className, text: text ?? '' });
  return L.marker(latlng, { icon: L.divIcon({ html: node, className: '', iconSize: opts.size ?? null, iconAnchor: opts.anchor ?? null }), keyboard: !!opts.keyboard, title: opts.title ?? '', interactive: opts.interactive ?? false, riseOnHover: true, zIndexOffset: opts.z ?? 0 });
}

// ---------- boot ----------
export function boot() {
  applyStatic();
  wireLangSwitch();
}
