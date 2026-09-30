// Home page: list of tracks + overview map centred on the club's home area.
import { boot, t, el, fmtKm, fmtNum, fmtDate, loadJSON, trackUrl, gpxUrl, makeMap, wireStyleSwitch, trackLine, divMarker, onLangChange, icon, COLORS } from './common.js';
import { sparkline } from './profile.js';

boot();

const state = { site: null, tracks: [], filter: 'all', query: '', selected: null };
const cardsEl = document.getElementById('cards');
const selectedEl = document.getElementById('selected');
const mapBox = document.getElementById('home-map');
const narrow = window.matchMedia('(max-width: 900px)');
let M = null;            // { map, layers }
let selLayer = null;     // selected track line
let linesLayer = null;   // all other tracks on the map
let startLayer = null;   // start markers
let homeBounds = null;

// One colour per track (the selected one is always drawn in the accent orange).
const PALETTE = ['#1F4E79', '#6D28D9', '#0F766E', '#BE185D', '#4D7C0F', '#334155', '#0369A1', '#9F1239'];
const colorOf = (slug) => PALETTE[Math.max(0, state.tracks.findIndex((x) => x.slug === slug)) % PALETTE.length];
const mapCap = () => state.site?.mapMaxTracks ?? 20;

const FILTERS = {
  all: () => true,
  short: (tr) => tr.stats.distance < 25000,
  mid: (tr) => tr.stats.distance >= 25000 && tr.stats.distance <= 60000,
  ultra: (tr) => tr.stats.distance > 60000 || tr.tags.some((x) => x.toLowerCase() === 'ultra'),
};

function visible() {
  const q = state.query.trim().toLowerCase();
  return state.tracks.filter((tr) => FILTERS[state.filter](tr) &&
    (!q || [tr.name, tr.author, ...tr.tags].some((s) => (s || '').toLowerCase().includes(q))));
}

// Tracks drawn on the map: what the list shows, most recent first, up to the cap — plus the selected one.
function onMap() {
  const list = visible();
  const shown = list.slice(0, mapCap());
  const sel = state.tracks.find((x) => x.slug === state.selected);
  if (sel && !shown.includes(sel)) shown.push(sel);
  return { shown, total: list.length };
}

function renderMapNote() {
  const note = document.getElementById('map-note');
  const { total } = onMap();
  note.hidden = total <= mapCap();
  note.textContent = t('mapCapNote', { cap: mapCap(), n: total });
}

// ---------- list ----------
function renderCount() {
  const n = state.tracks.length;
  const date = fmtDate(state.tracks[0]?.added);
  document.getElementById('home-count').textContent =
    n === 0 ? t('homeCountNone') : n === 1 ? t('homeCountOne', { date }) : t('homeCount', { n, date });
}

function card(tr) {
  const s = tr.stats;
  const isSel = state.selected === tr.slug;
  const color = isSel ? COLORS.accent : colorOf(tr.slug);
  const meta = [tr.author ? t('byAuthor', { author: tr.author }) : null, tr.added ? t('addedOn', { date: fmtDate(tr.added) }) : null].filter(Boolean).join(' · ');
  const body = [
    el('span', { class: 'card-top' },
      el('span', { class: 'card-name' }, el('span', { class: 'swatch', style: { background: color } }), tr.name),
      el('span', { class: 'card-meta', text: s.loop ? t('loop') : t('p2p') })),
    tr.spark ? sparkline(tr.spark, color) : null,
    el('span', { class: 'card-stats' },
      el('span', {}, el('strong', { text: fmtKm(s.distance) }), ' ', el('span', { class: 'muted', text: 'km' })),
      el('span', {}, el('strong', { text: '+' + fmtNum(s.gain) }), ' ', el('span', { class: 'muted', text: 'm' })),
      el('span', {}, el('strong', { text: fmtNum(s.maxEle) }), ' ', el('span', { class: 'muted', text: t('maxShort') }))),
    el('span', { class: 'card-meta', text: meta }),
  ];
  // On phones the map is below the list, so a tap opens the track page directly.
  const node = narrow.matches
    ? el('a', { class: 'card', href: trackUrl(tr.slug) }, body)
    : el('button', { type: 'button', class: 'card', 'aria-pressed': String(isSel), onclick: () => select(tr.slug, { fit: true }) }, body);
  return el('li', {}, node);
}

function renderList() {
  const list = visible();
  cardsEl.replaceChildren(...(list.length ? list.map(card) : [el('li', { class: 'empty', text: state.tracks.length ? t('noResults') : t('homeCountNone') })]));
}

// ---------- map ----------
function circleBounds(h) {
  const dLat = h.radiusKm / 111.32;
  const dLon = h.radiusKm / (111.32 * Math.cos((h.lat * Math.PI) / 180));
  return window.L.latLngBounds([h.lat - dLat, h.lon - dLon], [h.lat + dLat, h.lon + dLon]);
}

function initMap() {
  const L = window.L;
  const h = state.site.home;
  M = makeMap(document.getElementById('map'));
  wireStyleSwitch(document.querySelector('.map-style'), M);
  homeBounds = circleBounds(h);
  M.map.fitBounds(homeBounds, { padding: [20, 20] });
  L.circle([h.lat, h.lon], { radius: h.radiusKm * 1000, color: COLORS.ink, weight: 1.5, opacity: 0.55, dashArray: '7 5', fill: false, interactive: false }).addTo(M.map);
  divMarker([h.lat, h.lon], 'home-pin', '', { size: [14, 14], anchor: [7, 7] }).addTo(M.map);
  L.marker([h.lat, h.lon], { icon: L.divIcon({ html: el('span', { class: 'home-label', text: h.name }), className: '', iconSize: null, iconAnchor: [-12, 12] }), interactive: false, keyboard: false }).addTo(M.map);

  const reset = el('button', { type: 'button', class: 'map-panel map-reset', 'aria-label': t('resetView', { place: h.name }), title: t('resetView', { place: h.name }), onclick: () => M.map.fitBounds(homeBounds, { padding: [20, 20] }) }, icon('fit', 18));
  reset.style.top = '112px';
  mapBox.append(reset);
  onLangChange(() => { reset.setAttribute('aria-label', t('resetView', { place: h.name })); reset.title = t('resetView', { place: h.name }); });
}

// Group tracks whose starts are within ~300 m, so the overview shows one numbered marker per start.
function groupStarts(list) {
  const groups = [];
  for (const tr of list) {
    const g = groups.find((x) => M.map.distance(x.at, tr.start) < 300);
    if (g) g.tracks.push(tr); else groups.push({ at: tr.start, tracks: [tr] });
  }
  return groups;
}

function drawStarts() {
  const L = window.L;
  startLayer?.remove();
  startLayer = L.layerGroup();
  for (const g of groupStarts(onMap().shown)) {
    const hasSel = g.tracks.some((x) => x.slug === state.selected);
    const label = g.tracks.length > 1 ? t('startsHere', { n: g.tracks.length }) : t('startsHereOne', { name: g.tracks[0].name });
    // A shared start gets a numbered pin; a single start is a small dot in the track's colour.
    const m = g.tracks.length > 1
      ? divMarker(g.at, 'start-pin' + (hasSel ? ' is-selected' : ''), String(g.tracks.length), { size: [36, 36], anchor: [18, 18], interactive: true, keyboard: true, title: label, z: 500 })
      : window.L.marker(g.at, {
        icon: window.L.divIcon({ html: el('div', { class: 'start-dot', style: { background: hasSel ? COLORS.accent : colorOf(g.tracks[0].slug) } }), className: '', iconSize: [18, 18], iconAnchor: [9, 9] }),
        keyboard: true, title: label, riseOnHover: true, zIndexOffset: hasSel ? 600 : 400,
      });
    if (g.tracks.length === 1) {
      m.on('click', () => select(g.tracks[0].slug));
    } else {
      const list = el('ul', { class: 'popup-list' }, g.tracks.map((tr) =>
        el('li', {}, el('a', { href: '#', onclick: (e) => { e.preventDefault(); M.map.closePopup(); select(tr.slug, { fit: true }); } }, `${tr.name} · ${fmtKm(tr.stats.distance)} km`))));
      m.bindPopup(el('div', {}, el('strong', { text: label }), list));
    }
    m.addTo(startLayer);
  }
  startLayer.addTo(M.map);
}

function drawLines() {
  const L = window.L;
  linesLayer?.remove();
  const layers = [];
  for (const tr of onMap().shown) {
    if (tr.slug === state.selected) continue;
    layers.push(L.polyline(tr.line, { color: '#FFFFFF', weight: 5, opacity: 0.6, interactive: false }));
    layers.push(L.polyline(tr.line, { color: colorOf(tr.slug), weight: 2.5, opacity: 0.9, lineJoin: 'round' })
      .on('click', () => select(tr.slug))
      .bindTooltip(el('span', { text: `${tr.name} · ${fmtKm(tr.stats.distance)} km` }), { sticky: true }));
  }
  linesLayer = L.layerGroup(layers).addTo(M.map);
  selLayer?.eachLayer((l) => l.bringToFront());
}

function drawSelected(fit) {
  selLayer?.remove();
  selLayer = null;
  const tr = state.tracks.find((x) => x.slug === state.selected);
  mapBox.classList.toggle('has-selection', !!tr);
  if (!tr) { selectedEl.hidden = true; return; }
  selLayer = trackLine(tr.line).addTo(M.map);
  if (fit) M.map.fitBounds([[tr.bbox[0], tr.bbox[1]], [tr.bbox[2], tr.bbox[3]]], { padding: [40, 40], paddingBottomRight: [40, 200] });
  renderPanel(tr);
}

function renderPanel(tr) {
  const s = tr.stats;
  selectedEl.replaceChildren(...[
    el('div', { class: 'sel-info' },
      el('span', { class: 'label-caps', style: { color: COLORS.accent }, text: t('selected') }),
      el('span', { class: 'display sel-name', text: tr.name }),
      el('span', { class: 'sel-stats' }, el('span', { text: `${fmtKm(s.distance)} km` }), el('span', { text: `+${fmtNum(s.gain)} m` }), el('span', { text: `−${fmtNum(s.loss)} m` }))),
    tr.spark ? el('div', { class: 'sel-prof' },
      sparkline(tr.spark, COLORS.accent, { w: 400, h: 64 }),
      el('div', { class: 'sel-range' }, el('span', { text: '0 km' }), el('span', { text: `${fmtNum(s.minEle)} – ${fmtNum(s.maxEle)} m` }), el('span', { text: `${fmtKm(s.distance, 0)} km` }))) : null,
    el('div', { class: 'sel-actions' },
      el('a', { class: 'btn btn-primary', href: trackUrl(tr.slug), text: t('openTrack') }),
      el('a', { class: 'btn', href: gpxUrl(tr.slug), download: tr.slug + '.gpx', text: t('download') })),
    el('button', { type: 'button', class: 'sel-close', 'aria-label': t('deselect'), onclick: () => select(null) }, icon('x', 18)),
  ].filter(Boolean));
  selectedEl.hidden = false;
}

function select(slug, { fit = false } = {}) {
  state.selected = slug;
  renderList();
  cardsEl.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest' });
  drawLines();
  drawSelected(fit);
  drawStarts();
}

function refresh() {
  renderCount();
  renderList();
  renderMapNote();
  if (M) { drawLines(); drawSelected(false); drawStarts(); }
}

// ---------- controls ----------
document.getElementById('q').addEventListener('input', (e) => { state.query = e.target.value; refresh(); });
document.querySelectorAll('.filters button').forEach((b) => b.addEventListener('click', () => {
  state.filter = b.dataset.filter;
  document.querySelectorAll('.filters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  refresh();
}));
narrow.addEventListener('change', renderList);
onLangChange(() => {
  refresh();
  document.getElementById('legend-area').textContent = t('legendArea', { km: state.site.home.radiusKm, place: state.site.home.name });
});

// ---------- start ----------
(async function start() {
  try {
    [state.site, state.tracks] = await Promise.all([loadJSON('data/site.json'), loadJSON('data/index.json')]);
  } catch (e) {
    cardsEl.replaceChildren(el('li', { class: 'alert alert-error', text: t('loadError') }));
    return;
  }
  document.getElementById('legend-area').textContent = t('legendArea', { km: state.site.home.radiusKm, place: state.site.home.name });
  const init = () => {
    initMap();
    state.selected = narrow.matches ? null : state.tracks[0]?.slug ?? null;
    refresh();
  };
  if (window.L) init(); else window.addEventListener('load', init, { once: true });
})();
