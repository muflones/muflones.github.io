// Submit page: the member loads a GPX to preview it in the browser (nothing is uploaded),
// then emails it to the admin address from config.json. A cleaned copy can be downloaded
// to attach instead of the original.
import { boot, t, el, fmtKm, fmtNum, fmtSize, loadJSON, makeMap, trackLine, divMarker, onLangChange, COLORS } from './common.js';
import { parseGpx, writeGpx } from './lib/gpx.js';
import { analyse, profile, simplify } from './lib/stats.js';
import { interactiveProfile } from './profile.js';

boot();

const $ = (id) => document.getElementById(id);
const state = { site: null, file: null, gpx: null, a: null };
let M = null, lineLayer = null;

const limitMB = () => state.site?.limits?.maxFileMB ?? 10;
const maxPoints = () => state.site?.limits?.maxPoints ?? 200000;
const adminEmail = () => {
  const e = state.site?.adminEmail || '';
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e) && !/example\.(com|org)$/i.test(e) ? e : '';
};

function setStep(n) {
  ['st1', 'st2', 'st3'].forEach((id, i) => {
    const li = $(id);
    li.classList.toggle('done', i + 1 < n);
    if (i + 1 === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
}

function showError(msg) {
  $('alert').replaceChildren(...(msg ? [el('p', { class: 'alert alert-error', text: msg })] : []));
}

// ---------- reading the file (only in this browser) ----------
async function handleFile(file) {
  showError(null);
  if (!file) return;
  if (file.size > limitMB() * 1024 * 1024) return showError(t('errTooBig', { mb: limitMB() }));
  let gpx;
  try {
    gpx = parseGpx(await file.text(), { maxPoints: maxPoints() });
  } catch (e) {
    return showError(e.code === 'no-points' ? t('errNoPoints') : e.code === 'too-many-points' ? t('errTooMany', { n: fmtNum(maxPoints()) }) : t('errNotGpx'));
  }
  state.file = file;
  state.gpx = gpx;
  state.a = analyse(gpx.segments);
  $('dropzone').hidden = true;
  $('details').hidden = false;
  setStep(2);
  renderFile();
  renderSend();
  renderPreview();
  $('send-h').focus();
}

const trackName = () => state.gpx?.name || state.file?.name.replace(/\.gpx$/i, '') || 'traccia';

function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'traccia';
}

function renderFile() {
  if (!state.file) return;
  $('file-name').textContent = state.file.name;
  $('file-info').textContent = t('fileInfo', { size: fmtSize(state.file.size), n: fmtNum(state.a.pointCount) });
}

// ---------- sending: just an email to the admin ----------
function renderSend() {
  const email = adminEmail();
  $('admin-ok').hidden = !email;
  $('admin-missing').hidden = !!email;
  $('admin-email').textContent = email;
  if (email && state.a) {
    const vars = { name: trackName(), author: state.gpx.author || '', km: fmtKm(state.a.distance), gain: fmtNum(state.a.gain), file: slugify(trackName()) + '.gpx' };
    $('mailto').setAttribute('href', `mailto:${email}?subject=${encodeURIComponent(t('mailSubject', vars))}&body=${encodeURIComponent(t('mailBody', vars))}`);
  }
  $('mailto').onclick = () => setStep(3);
  if (state.site) $('gh-link').setAttribute('href', `https://github.com/${state.site.repo}/upload/${state.site.branch}/tracks`);
}

$('copy-email').addEventListener('click', async () => {
  setStep(3);
  const label = $('copy-email').querySelector('span');
  try {
    await navigator.clipboard.writeText(adminEmail());
    label.textContent = t('emailCopied');
    setTimeout(() => (label.textContent = t('copyEmail')), 2000);
  } catch {
    const r = document.createRange();
    r.selectNodeContents($('admin-email'));
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  }
});

// Cleaned copy: points and elevation only, same code as the site build, correct file name.
$('clean').addEventListener('click', () => {
  if (!state.gpx) return;
  setStep(3);
  const name = trackName();
  const text = writeGpx({
    name, author: state.gpx.author, desc: state.gpx.desc, keywords: state.gpx.keywords,
    siteUrl: state.site?.siteUrl, segments: state.gpx.segments, waypoints: state.gpx.waypoints,
  });
  const url = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = slugify(name) + '.gpx';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ---------- preview ----------
function stat(label, value, unit) {
  return el('div', { class: 'field', style: { gap: '2px' } },
    el('span', { class: 'label-caps', style: { fontSize: '11px' }, text: label }),
    el('span', { class: 'stat-value' }, value, unit ? el('small', { text: ' ' + unit }) : null));
}

function renderPreview() {
  const a = state.a;
  if (!a) return;
  $('pv-empty').hidden = true;
  $('pv').hidden = false;
  $('pv-stats').replaceChildren(
    stat(t('sDistance'), fmtKm(a.distance), 'km'),
    stat(t('pGain'), a.hasEle ? '±' + fmtNum(a.gain) : '–', a.hasEle ? 'm' : ''),
    stat(t('pRange'), a.hasEle ? `${fmtNum(a.minEle)}–${fmtNum(a.maxEle)}` : '–', ''),
    stat(t('sEffort'), fmtNum(a.effortKm, 1), ''),
  );
  const L = window.L;
  if (!M) M = makeMap($('map'));
  lineLayer?.remove();
  const latlngs = simplify(a.points, 4, 4000).map((p) => [p.lat, p.lon]);
  const every = a.distance > 40000 ? 10 : 5;
  const marks = [];
  for (let k = every, j = 0; k * 1000 < a.distance; k += every) {
    while (j < a.points.length - 1 && a.points[j].d < k * 1000) j++;
    marks.push(divMarker([a.points[j].lat, a.points[j].lon], 'km-pin', String(k), { size: [22, 22], anchor: [11, 11] }));
  }
  lineLayer = L.layerGroup([trackLine(latlngs, COLORS.blue), ...marks, divMarker(a.start, 'flag-pin', '', { size: [18, 18], anchor: [9, 9] })]).addTo(M.map);
  setTimeout(() => { M.map.invalidateSize(); M.map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] }); }, 0);
  $('pv-profile').hidden = !a.hasEle;
  if (a.hasEle) interactiveProfile($('pv-profile'), profile(a.points, 300), { color: COLORS.blue, climbs: a.climbs });
}

// ---------- file input & drag and drop ----------
const input = $('file');
input.addEventListener('change', () => handleFile(input.files[0]));
$('replace').addEventListener('click', () => { input.value = ''; input.click(); });
const dz = $('dropzone');
dz.setAttribute('tabindex', '0');
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (!$('details').hidden) handleFile(e.dataTransfer.files[0]); });

onLangChange(() => { renderFile(); renderSend(); renderPreview(); });

(async function start() {
  try { state.site = await loadJSON('data/site.json'); } catch { state.site = null; }
  renderSend();
})();
