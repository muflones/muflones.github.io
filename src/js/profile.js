// Elevation profile charts: a small sparkline and the full interactive profile.
import { svg, el, t, fmtNum, fmtKm } from './common.js';

/** Small profile for cards: `es` = evenly spaced elevations. */
export function sparkline(es, color = '#C2410C', { w = 360, h = 44 } = {}) {
  const box = svg('svg', { class: 'spark', viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  if (!es || es.length < 2) return box;
  const lo = Math.min(...es), hi = Math.max(...es), span = Math.max(1, hi - lo);
  const x = (i) => (i / (es.length - 1)) * w;
  const y = (e) => 2 + (1 - (e - lo) / span) * (h - 4);
  const line = es.map((e, i) => `${x(i).toFixed(1)},${y(e).toFixed(1)}`).join(' L');
  box.append(
    svg('path', { d: `M0,${h} L${line} L${w},${h} Z`, fill: color, 'fill-opacity': 0.16 }),
    svg('path', { d: `M${line}`, fill: 'none', stroke: color, 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }),
  );
  return box;
}

function niceStep(span, target) {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n < 1.5 ? 1 : n < 3.5 ? 2.5 : n < 7.5 ? 5 : 10) * pow;
}

/**
 * Interactive profile.
 * @param container element with class "profile"
 * @param data { ds:[m], es:[m] }
 * @param opts { color, climbs:[{from,to}], onHover(distance|null), highlight:{from,to}|null }
 * @returns { redraw(), setHighlight(range|null), setCursor(distance|null) }
 */
export function interactiveProfile(container, data, opts = {}) {
  const color = opts.color || '#C2410C';
  const { ds, es } = data;
  const total = ds[ds.length - 1];
  let highlight = opts.highlight ?? null;
  let cursorIndex = null;
  let geom = null;

  const tip = el('div', { class: 'profile-tip', hidden: true });
  container.replaceChildren();
  const chart = svg('svg', { role: 'img', tabindex: 0, focusable: 'true' });
  container.append(chart, tip);

  function draw() {
    const W = Math.max(280, container.clientWidth);
    const H = Math.max(120, container.clientHeight);
    const pad = { l: 52, r: 18, t: 14, b: 28 };
    const lo = Math.min(...es), hi = Math.max(...es);
    const yStep = niceStep(Math.max(100, hi - lo), 4);
    const y0 = Math.floor(lo / yStep) * yStep, y1 = Math.ceil(hi / yStep) * yStep;
    const X = (d) => pad.l + (d / total) * (W - pad.l - pad.r);
    const Y = (e) => pad.t + (1 - (e - y0) / (y1 - y0 || 1)) * (H - pad.t - pad.b);
    geom = { W, H, pad, X, Y };

    chart.setAttribute('viewBox', `0 0 ${W} ${H}`);
    chart.setAttribute('aria-label', t('profileAria', { min: fmtNum(lo), max: fmtNum(hi), km: fmtKm(total) }));
    chart.replaceChildren();
    const grid = svg('g');
    for (let e = y0; e <= y1 + 0.1; e += yStep) {
      grid.append(
        svg('line', { x1: pad.l, x2: W - pad.r, y1: Y(e), y2: Y(e), stroke: '#DDD7C9' }),
        svg('text', { x: pad.l - 8, y: Y(e) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#585D55', 'font-family': 'IBM Plex Mono, monospace' }, fmtNum(e)),
      );
    }
    const kmStep = niceStep(total / 1000, W < 600 ? 4 : 10);
    for (let k = 0; k <= total / 1000 + 1e-6; k += kmStep) {
      grid.append(
        svg('line', { x1: X(k * 1000), x2: X(k * 1000), y1: H - pad.b, y2: H - pad.b + 4, stroke: '#1B1E1A' }),
        svg('text', { x: X(k * 1000), y: H - pad.b + 17, 'text-anchor': 'middle', 'font-size': 11, fill: '#585D55', 'font-family': 'IBM Plex Mono, monospace' }, `${fmtNum(k, kmStep < 1 ? 1 : 0)} km`),
      );
    }
    chart.append(grid);

    for (const c of opts.climbs || []) {
      chart.append(svg('rect', { x: X(c.from), y: pad.t, width: Math.max(1, X(c.to) - X(c.from)), height: H - pad.t - pad.b, fill: color, 'fill-opacity': 0.07 }));
    }
    if (highlight) {
      chart.append(svg('rect', { x: X(highlight.from), y: pad.t, width: Math.max(1, X(highlight.to) - X(highlight.from)), height: H - pad.t - pad.b, fill: color, 'fill-opacity': 0.18 }));
    }
    const pts = ds.map((d, i) => `${X(d).toFixed(1)},${Y(es[i]).toFixed(1)}`).join(' L');
    chart.append(
      svg('path', { d: `M${X(0)},${Y(y0)} L${pts} L${X(total)},${Y(y0)} Z`, fill: color, 'fill-opacity': 0.16 }),
      svg('path', { d: `M${pts}`, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      svg('line', { x1: pad.l, x2: W - pad.r, y1: H - pad.b, y2: H - pad.b, stroke: '#1B1E1A' }),
    );
    const cursor = svg('g', { class: 'cursor', visibility: 'hidden' },
      svg('line', { y1: pad.t - 4, y2: H - pad.b, stroke: '#1B1E1A', 'stroke-width': 1.5 }),
      svg('circle', { r: 5, fill: '#fff', stroke: '#1B1E1A', 'stroke-width': 2.5 }));
    chart.append(cursor);
    geom.cursor = cursor;
    if (cursorIndex != null) showCursor(cursorIndex, false);
  }

  function gradeAt(i) {
    let j = i;
    while (j > 0 && ds[i] - ds[j] < 500) j--;
    const run = ds[i] - ds[j];
    return run > 0 ? ((es[i] - es[j]) / run) * 100 : 0;
  }

  function showCursor(i, notify = true) {
    cursorIndex = i;
    const { X, Y, cursor, W } = geom;
    if (i == null) {
      cursor.setAttribute('visibility', 'hidden');
      tip.hidden = true;
      if (notify) opts.onHover?.(null);
      return;
    }
    const x = X(ds[i]), y = Y(es[i]);
    cursor.setAttribute('visibility', 'visible');
    cursor.querySelector('line').setAttribute('x1', x);
    cursor.querySelector('line').setAttribute('x2', x);
    cursor.querySelector('circle').setAttribute('cx', x);
    cursor.querySelector('circle').setAttribute('cy', y);
    const g = gradeAt(i);
    tip.replaceChildren(
      el('b', { text: `km ${fmtKm(ds[i])} · ${fmtNum(es[i])} m` }),
      el('span', { text: t('tipGrade', { g: (g >= 0 ? '+' : '') + fmtNum(g, 0) }) }),
    );
    tip.hidden = false;
    const tw = tip.offsetWidth || 180;
    tip.style.left = `${x + 14 + tw > W ? x - 14 - tw : x + 14}px`;
    if (notify) opts.onHover?.(ds[i]);
  }

  function indexAtX(clientX) {
    const r = chart.getBoundingClientRect();
    const { pad, W } = geom;
    const px = ((clientX - r.left) / r.width) * W;
    const d = Math.max(0, Math.min(total, ((px - pad.l) / (W - pad.l - pad.r)) * total));
    let lo = 0, hi = ds.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ds[mid] < d) lo = mid; else hi = mid; }
    return d - ds[lo] < ds[hi] - d ? lo : hi;
  }

  chart.addEventListener('pointermove', (e) => showCursor(indexAtX(e.clientX)));
  chart.addEventListener('pointerdown', (e) => showCursor(indexAtX(e.clientX)));
  chart.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') showCursor(null); });
  chart.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'ArrowRight') { showCursor(Math.min(ds.length - 1, (cursorIndex ?? -1) + step)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { showCursor(Math.max(0, (cursorIndex ?? ds.length) - step)); e.preventDefault(); }
    else if (e.key === 'Escape') showCursor(null);
  });
  chart.addEventListener('blur', () => showCursor(null));

  new ResizeObserver(() => draw()).observe(container);
  draw();

  return {
    redraw: draw,
    setHighlight(range) { highlight = range; draw(); },
    setCursor(d) {
      if (d == null) return showCursor(null, false);
      let best = 0;
      for (let i = 1; i < ds.length; i++) if (Math.abs(ds[i] - d) < Math.abs(ds[best] - d)) best = i;
      showCursor(best, false);
    },
  };
}
