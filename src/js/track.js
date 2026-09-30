// Track page: stats, map, climbs, gradient and the interactive elevation profile.
import { boot, t, el, fmtKm, fmtNum, fmtDate, loadJSON, makeMap, wireStyleSwitch, trackLine, divMarker, onLangChange, lang, COLORS } from './common.js';
import { interactiveProfile } from './profile.js';

boot();

const slug = document.querySelector('meta[name="track-slug"]')?.content;
const $ = (id) => document.getElementById(id);
let tr = null, M = null, prof = null, hoverMarker = null, climbLayer = null, activeClimb = null;

function renderHeader() {
  const s = tr.stats;
  const shape = s.loop ? t('loop') : t('p2p');
  const tags = tr.tags.filter((x) => x.toLowerCase() !== shape.toLowerCase());
  $('t-meta').replaceChildren(
    ...tags.map((x, i) => el('span', { class: 'chip' + (i === 0 ? ' chip-dark' : ''), text: x })),
    el('span', { class: 'chip', text: shape }),
    el('span', { text: [s.loop ? t('loopGap', { m: fmtNum(s.loopGap) }) : t('p2pGap', { km: fmtKm(s.loopGap) }), t('gpsPoints', { n: fmtNum(s.points) })].join(' · ') }),
  );
  const credit = [];
  if (tr.author) {
    const who = tr.authorUrl ? el('a', { href: tr.authorUrl, rel: 'noopener nofollow', target: '_blank' }, el('strong', { text: tr.author })) : el('strong', { text: tr.author });
    const [before, after] = t('credit', { author: '\u0000' }).split('\u0000');
    credit.push(before, who, after);
  }
  const when = tr.addedBy ? t('proposedBy', { name: tr.addedBy, date: fmtDate(tr.added) }) : tr.added ? t('addedOnly', { date: fmtDate(tr.added) }) : '';
  if (when) credit.push(credit.length ? ' · ' : '', when);
  $('t-credit').replaceChildren(...credit);
}

function stat(label, value, unit, note, cls = '') {
  return el('div', { class: 'stat ' + cls },
    el('span', { class: 'label-caps', text: label }),
    el('span', { class: 'stat-value' }, value, unit ? el('small', { text: ' ' + unit }) : null),
    note ? el('span', { class: 'stat-note', text: note }) : null);
}

function renderStats() {
  const s = tr.stats;
  const hasEle = s.maxEle != null;
  $('t-stats').replaceChildren(...[
    stat(t('sDistance'), fmtKm(s.distance), 'km'),
    hasEle ? stat(t('sGain'), '+' + fmtNum(s.gain), 'm', null, 'stat-accent') : null,
    hasEle ? stat(t('sLoss'), '−' + fmtNum(s.loss), 'm') : null,
    hasEle ? stat(t('sMax'), fmtNum(s.maxEle), 'm', t('atKm', { km: fmtKm(s.maxEleAt) })) : null,
    hasEle ? stat(t('sMin'), fmtNum(s.minEle), 'm', t('atKm', { km: fmtKm(s.minEleAt) })) : null,
    stat(t('sEffort'), fmtNum(s.effortKm, 1), '', t('effortNote'), 'stat-dark'),
  ].filter(Boolean));
}

function renderClimbs() {
  const box = $('t-climbs');
  const n = tr.climbs.length, m = fmtNum(tr.climbMinGain ?? 0);
  $('t-climbs-count').textContent = n === 0 ? t('climbsNone', { m }) : n === 1 ? t('climbsCountOne', { m }) : t('climbsCount', { n, m });
  if (!tr.climbs.length) { box.replaceChildren(); }
  else {
    const maxGain = Math.max(...tr.climbs.map((c) => c.gain));
    box.replaceChildren(
      el('div', { class: 'climbs-head', 'aria-hidden': 'true' }, el('span', { text: '#' }), el('span', { text: t('colKm') }), el('span', { text: t('colGain') }), el('span', { class: 'num-r', text: t('colAvg') })),
      el('ol', { class: 'climbs' }, tr.climbs.map((c, i) => el('li', {},
        el('button', {
          type: 'button', class: 'climb', 'aria-pressed': String(activeClimb === i),
          'aria-label': t('climbAria', { n: i + 1, from: fmtKm(c.from), to: fmtKm(c.to), gain: fmtNum(c.gain), avg: fmtNum(c.avg, 1) + '%' }),
          onclick: () => toggleClimb(i),
        },
          el('span', { class: 'climb-n', text: String(i + 1) }),
          el('span', { text: `${fmtKm(c.from)} – ${fmtKm(c.to)}` }),
          el('span', { class: 'climb-bar' }, el('i', { style: { width: `${Math.max(8, (c.gain / maxGain) * 55)}%` } }), '+' + fmtNum(c.gain)),
          el('span', { class: 'num-r', text: fmtNum(c.avg, 1) + '%' })))))
    );
  }
  const g = tr.gradient;
  const gradBox = $('t-gradient');
  if (!g) { gradBox.hidden = true; return; }
  const colors = ['#F0D3C2', '#E09A76', '#C2410C', '#6B2410'];
  const pct = g.map((x) => Math.round(x * 100));
  gradBox.replaceChildren(
    el('div', { class: 'box-head' }, el('h3', { class: 'label-caps', text: t('gradTitle') }), el('span', { class: 'help', text: t('gradNote') })),
    el('div', { class: 'gradient-bar', 'aria-hidden': 'true' }, g.map((x, i) => el('span', { style: { width: `${x * 100}%`, background: colors[i] } }))),
    el('div', { class: 'gradient-legend' }, pct.map((p, i) => el('span', {}, el('strong', { text: p + '%' }), el('span', { class: 'muted', text: t('g' + i) })))),
  );
}

function renderNotes() {
  const text = tr.notes?.[lang] || tr.notes?.it || tr.notes?.en || '';
  $('t-notes-box').hidden = !text;
  $('t-notes').textContent = text;
}

function renderLegend() {
  $('t-legend').replaceChildren(
    el('span', {}, el('i', { class: 'km-pin', style: { width: '18px', height: '18px', lineHeight: '15px', fontSize: '8px' }, text: String(tr.kmEvery) }), el('span', { text: t('everyKm', { n: tr.kmEvery }) })),
    el('span', {}, el('i', { class: 'flag-pin', style: { width: '14px', height: '14px' } }), el('span', { text: tr.stats.loop ? t('startFinish') : t('start') })),
  );
}

// ---------- map ----------
function pointAt(d) {
  const line = tr.line;
  let lo = 0, hi = line.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (line[mid][3] < d) lo = mid; else hi = mid; }
  return line[lo];
}

function initMap() {
  const L = window.L;
  M = makeMap($('map'));
  wireStyleSwitch(document.querySelector('.map-style'), M);
  const latlngs = tr.line.map((p) => [p[0], p[1]]);
  trackLine(latlngs).addTo(M.map);
  M.map.fitBounds(L.latLngBounds(latlngs), { padding: [36, 36] });
  for (const [k, lat, lon] of tr.kmMarks) divMarker([lat, lon], 'km-pin', String(k), { size: [22, 22], anchor: [11, 11] }).addTo(M.map);
  const last = tr.line[tr.line.length - 1];
  if (!tr.stats.loop) divMarker([last[0], last[1]], 'flag-pin', '', { size: [18, 18], anchor: [9, 9], title: t('finish') }).addTo(M.map);
  divMarker(tr.start, 'flag-pin', '', { size: [18, 18], anchor: [9, 9], title: t('start'), z: 400 }).addTo(M.map);
  if (tr.peak) divMarker(tr.peak, 'peak-pin', `▲ ${fmtNum(tr.stats.maxEle)} m`, { anchor: [-8, 12] }).addTo(M.map);
  for (const w of tr.waypoints) {
    L.marker([w.lat, w.lon], { icon: L.divIcon({ html: el('div', { class: 'wpt-pin' }), className: '', iconSize: [14, 14], iconAnchor: [7, 7] }), title: w.name })
      .bindTooltip(el('span', { text: w.name || '•' }), { direction: 'top', offset: [0, -8] }).addTo(M.map);
  }
  hoverMarker = L.circleMarker([0, 0], { radius: 7, color: COLORS.ink, weight: 2.5, fillColor: '#fff', fillOpacity: 1, interactive: false });
}

function onProfileHover(d) {
  if (d == null) { hoverMarker.remove(); return; }
  const p = pointAt(d);
  hoverMarker.setLatLng([p[0], p[1]]);
  if (!M.map.hasLayer(hoverMarker)) hoverMarker.addTo(M.map);
}

function toggleClimb(i) {
  activeClimb = activeClimb === i ? null : i;
  climbLayer?.remove();
  climbLayer = null;
  const c = activeClimb == null ? null : tr.climbs[activeClimb];
  if (c) {
    const seg = tr.line.filter((p) => p[3] >= c.from && p[3] <= c.to).map((p) => [p[0], p[1]]);
    if (seg.length > 1) {
      climbLayer = trackLine(seg, COLORS.ink, 5).addTo(M.map);
      M.map.fitBounds(window.L.latLngBounds(seg), { padding: [60, 60], maxZoom: 15 });
    }
  }
  prof?.setHighlight(c ? { from: c.from, to: c.to } : null);
  renderClimbs();
  document.querySelectorAll('.climb')[i]?.focus();
}

function initProfile() {
  if (!tr.profile) {
    $('t-profile-box').replaceChildren(el('p', { class: 'muted', style: { padding: '0 24px' }, text: t('noEle') }));
    return;
  }
  prof = interactiveProfile($('t-profile'), tr.profile, { climbs: tr.climbs, onHover: onProfileHover });
}

function renderAll() {
  renderHeader();
  renderStats();
  renderClimbs();
  renderNotes();
  renderLegend();
  prof?.redraw();
}

// ---------- copy link ----------
$('t-copy').addEventListener('click', async () => {
  const label = $('t-copy').querySelector('span');
  try {
    await navigator.clipboard.writeText(location.origin + location.pathname);
    label.textContent = t('copied');
    setTimeout(() => (label.textContent = t('copyLink')), 2000);
  } catch {
    window.prompt(t('copyLink'), location.origin + location.pathname);
  }
});

onLangChange(renderAll);

(async function start() {
  try {
    tr = await loadJSON(`data/tracks/${encodeURIComponent(slug)}.json`);
  } catch {
    document.querySelector('main').replaceChildren(el('p', { class: 'alert alert-error', text: t('trackMissing') }));
    return;
  }
  document.querySelector('main').removeAttribute('aria-busy');
  if (!tr.climbs.length && !tr.gradient) $('t-climbs-box').hidden = true;
  renderAll();
  const init = () => { initMap(); initProfile(); };
  if (window.L) init(); else window.addEventListener('load', init, { once: true });
})();
