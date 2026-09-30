// Submit page: read a GPX in the browser, preview it with the same code the site uses,
// then hand over a cleaned file — by email to the admin, or as a GitHub pull request.
import { boot, t, el, fmtKm, fmtNum, fmtSize, loadJSON, makeMap, wireStyleSwitch, trackLine, divMarker, onLangChange, applyStatic, lang, COLORS } from './common.js';
import { parseGpx, writeGpx } from './lib/gpx.js';
import { analyse, profile, simplify } from './lib/stats.js';
import { interactiveProfile } from './profile.js';

boot();

const $ = (id) => document.getElementById(id);
const state = { site: null, file: null, gpx: null, a: null, tags: [] };
let M = null, lineLayer = null, prof = null;

const LIMIT_MB = () => state.site?.limits?.maxFileMB ?? 10;
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

function showAlert(kind, title, lines = []) {
  const box = $('alert');
  if (!kind) { box.replaceChildren(); return; }
  box.replaceChildren(el('div', { class: `alert alert-${kind}` },
    title ? el('strong', { text: title }) : null,
    lines.length === 1 ? el('p', { text: lines[0] }) : lines.length ? el('ol', {}, lines.map((l) => el('li', { text: l }))) : null));
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- reading the file ----------
async function handleFile(file) {
  showAlert(null);
  if (!file) return;
  if (file.size > LIMIT_MB() * 1024 * 1024) return showAlert('error', null, [t('errTooBig', { mb: LIMIT_MB() })]);
  let gpx;
  try {
    gpx = parseGpx(await file.text(), { maxPoints: state.site?.limits?.maxPoints ?? 200000 });
  } catch (e) {
    const msg = e.code === 'no-points' ? t('errNoPoints') : e.code === 'too-many-points' ? t('errTooMany', { n: fmtNum(state.site?.limits?.maxPoints ?? 200000) }) : t('errNotGpx');
    return showAlert('error', null, [msg]);
  }
  state.file = file;
  state.gpx = gpx;
  state.a = analyse(gpx.segments);
  state.tags = gpx.keywords.slice(0, 8);

  $('file-name').textContent = file.name;
  $('file-info').textContent = t('fileInfo', { size: fmtSize(file.size), n: fmtNum(state.a.pointCount) });
  $('name').value = gpx.name || file.name.replace(/\.gpx$/i, '');
  $('author').value = gpx.author || '';
  $('notes').value = gpx.desc || '';
  document.querySelector(`input[name="shape"][value="${state.a.loop ? 'loop' : 'p2p'}"]`).checked = true;
  renderShapeHelp();
  renderTags();
  $('dropzone').hidden = true;
  $('details').hidden = false;
  setStep(2);
  renderPreview();
  $('name').focus();
}

function renderShapeHelp() {
  if (state.a) $('shape-loop-help').textContent = t('shapeLoopHelp', { m: fmtNum(state.a.loopGap) });
}

// ---------- tags ----------
function renderTags() {
  const box = $('tags');
  const input = $('tag-input');
  box.replaceChildren(...state.tags.map((tag, i) => el('span', { class: 'tag' }, tag,
    el('button', { type: 'button', 'aria-label': t('removeTag', { tag }), onclick: () => { state.tags.splice(i, 1); renderTags(); input.focus(); } },
      el('span', { 'aria-hidden': 'true', text: '×' })))), input);
}
$('tag-input').addEventListener('keydown', (e) => {
  const v = e.target.value.replace(/[,<>]/g, '').trim();
  if ((e.key === 'Enter' || e.key === ',') && v) {
    e.preventDefault();
    if (!state.tags.some((x) => x.toLowerCase() === v.toLowerCase()) && state.tags.length < 8) state.tags.push(v.slice(0, 30));
    e.target.value = '';
    renderTags();
    $('tag-input').focus();
  } else if (e.key === 'Enter') {
    e.preventDefault();
  } else if (e.key === 'Backspace' && !e.target.value && state.tags.length) {
    state.tags.pop();
    renderTags();
    $('tag-input').focus();
  }
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
  if (!M) {
    M = makeMap($('map'));
    wireStyleSwitch(null, M);
  }
  lineLayer?.remove();
  const line = simplify(a.points, 4, 4000);
  const latlngs = line.map((p) => [p.lat, p.lon]);
  const every = a.distance > 40000 ? 10 : 5;
  const marks = [];
  for (let k = every, j = 0; k * 1000 < a.distance; k += every) {
    while (j < a.points.length - 1 && a.points[j].d < k * 1000) j++;
    marks.push(divMarker([a.points[j].lat, a.points[j].lon], 'km-pin', String(k), { size: [22, 22], anchor: [11, 11] }));
  }
  lineLayer = L.layerGroup([trackLine(latlngs, COLORS.blue), ...marks, divMarker(a.start, 'flag-pin', '', { size: [18, 18], anchor: [9, 9] })]).addTo(M.map);
  setTimeout(() => { M.map.invalidateSize(); M.map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] }); }, 0);

  if (a.hasEle) {
    $('pv-profile').hidden = false;
    prof = interactiveProfile($('pv-profile'), profile(a.points, 300), { color: COLORS.blue, climbs: a.climbs });
  } else {
    $('pv-profile').hidden = true;
  }
}

// ---------- sending ----------
function slugify(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'traccia';
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  const a = el('a', { href: '#', download: filename });
  a.href = url; // blob: URL, set directly
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function renderSendLabel() {
  const route = document.querySelector('input[name="route"]:checked')?.value;
  $('send').textContent = route === 'github' ? t('sendGithub') : t('sendAdmin');
  $('admin-extra').hidden = route !== 'admin';
}
document.querySelectorAll('input[name="route"]').forEach((r) => r.addEventListener('change', renderSendLabel));

$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (!state.gpx) return;
  const name = $('name').value.trim();
  const author = $('author').value.trim();
  const problems = [];
  if (!name) problems.push(t('errName'));
  if (!author) problems.push(t('errAuthor'));
  if (!$('consent').checked) problems.push(t('errConsent'));
  if (problems.length) {
    showAlert('error', null, problems);
    (!name ? $('name') : !author ? $('author') : $('consent')).focus();
    return;
  }
  const slug = slugify(name);
  const file = slug + '.gpx';
  const gpxText = writeGpx({
    name, author,
    desc: $('notes').value.trim(),
    keywords: state.tags,
    siteUrl: state.site?.siteUrl,
    segments: state.gpx.segments,
    waypoints: state.gpx.waypoints,
  });
  download(file, gpxText);
  setStep(3);

  const route = document.querySelector('input[name="route"]:checked').value;
  if (route === 'github') {
    const { repo, branch } = state.site;
    showAlert('ok', t('doneGithubTitle'), [t('doneGithub', { file })]);
    window.open(`https://github.com/${repo}/upload/${branch}/tracks`, '_blank', 'noopener');
    return;
  }
  const email = adminEmail();
  if (!email) {
    showAlert('ok', t('doneAdminTitle'), [t('doneAdminNoMail', { file, email: '—' }), t('adminMissing')]);
    return;
  }
  const vars = { name, author, file, km: fmtKm(state.a.distance), gain: fmtNum(state.a.gain), who: $('who').value.trim() || '—' };
  const href = `mailto:${email}?subject=${encodeURIComponent(t('mailSubject', vars))}&body=${encodeURIComponent(t('mailBody', vars))}`;
  showAlert('ok', t('doneAdminTitle'), [t('doneAdmin', { file }), t('doneAdminNoMail', { file, email })]);
  setTimeout(() => { location.href = href; }, 400);
});

// ---------- file input & drag and drop ----------
const input = $('file');
input.addEventListener('change', () => handleFile(input.files[0]));
$('replace').addEventListener('click', () => { input.value = ''; input.click(); });
const dz = $('dropzone');
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
dz.setAttribute('tabindex', '0');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
dz.addEventListener('drop', (e) => handleFile(e.dataTransfer.files[0]));
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => { e.preventDefault(); if (!$('details').hidden) handleFile(e.dataTransfer.files[0]); });

onLangChange(() => {
  applyStatic();
  renderSendLabel();
  renderShapeHelp();
  renderTags();
  if (state.file) $('file-info').textContent = t('fileInfo', { size: fmtSize(state.file.size), n: fmtNum(state.a.pointCount) });
  renderPreview();
});

(async function start() {
  renderSendLabel();
  try { state.site = await loadJSON('data/site.json'); } catch { state.site = null; }
})();
