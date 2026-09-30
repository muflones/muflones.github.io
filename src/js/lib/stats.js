// Track statistics shared by the build script (Node) and the submit page (browser),
// so the numbers people see in the preview are exactly the ones published.

export const SETTINGS = {
  eleThreshold: 3,      // m — ignore up/down wiggles smaller than this when summing climbing
  loopMaxGap: 200,      // m — start and finish closer than this = loop
  climbStep: 100,       // m — resolution used to find climbs
  gradientStep: 50,     // m — resolution used for the gradient breakdown
};

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Flatten segments into one list with cumulative distance `d` (m). Gaps between segments are not counted. */
export function flatten(segments) {
  const pts = [];
  let d = 0;
  segments.forEach((seg, si) => {
    seg.forEach((p, i) => {
      if (i > 0) d += haversine(seg[i - 1], p);
      pts.push({ lat: p.lat, lon: p.lon, ele: p.ele, d, seg: si });
    });
  });
  fillElevation(pts);
  return pts;
}

// Fill missing elevations by interpolating along distance.
function fillElevation(pts) {
  const known = pts.filter((p) => p.ele != null);
  if (known.length < pts.length * 0.5) { pts.forEach((p) => (p.ele = null)); return; }
  let k = 0;
  for (const p of pts) {
    if (p.ele != null) continue;
    while (k < known.length - 1 && known[k + 1].d < p.d) k++;
    const a = known[k], b = known[Math.min(k + 1, known.length - 1)];
    p.ele = b.d === a.d ? a.ele : a.ele + ((b.ele - a.ele) * (p.d - a.d)) / (b.d - a.d);
  }
}

/** Elevation sampled every `step` metres (linear interpolation). */
export function resample(pts, step) {
  const total = pts[pts.length - 1].d;
  const ds = [], es = [];
  let j = 0;
  for (let d = 0; d <= total; d += step) {
    while (j < pts.length - 2 && pts[j + 1].d < d) j++;
    const a = pts[j], b = pts[j + 1] ?? a;
    const t = b.d === a.d ? 0 : (d - a.d) / (b.d - a.d);
    ds.push(d);
    es.push(a.ele + (b.ele - a.ele) * Math.max(0, Math.min(1, t)));
  }
  return { ds, es };
}

function gainLoss(eles, threshold) {
  let gain = 0, loss = 0, ref = eles[0];
  for (const e of eles) {
    if (e - ref > threshold) { gain += e - ref; ref = e; }
    else if (ref - e > threshold) { loss += ref - e; ref = e; }
  }
  return { gain, loss };
}

function movingAverage(xs, w) {
  const h = Math.floor(w / 2), out = new Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    let s = 0, n = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(xs.length - 1, i + h); k++) { s += xs[k]; n++; }
    out[i] = s / n;
  }
  return out;
}

/** Find climbs: rises of at least `minGain` metres between a low point and the next high point. */
export function findClimbs(pts, minGain) {
  const { ds, es } = resample(pts, SETTINGS.climbStep);
  if (es.length < 3) return [];
  const sm = movingAverage(es, 7);
  const hyst = 120;
  const ext = [{ i: 0, kind: 'min' }];
  let up = true, cand = 0;
  for (let i = 1; i < sm.length; i++) {
    if (up) {
      if (sm[i] >= sm[cand]) cand = i;
      else if (sm[cand] - sm[i] > hyst) { ext.push({ i: cand, kind: 'max' }); up = false; cand = i; }
    } else {
      if (sm[i] <= sm[cand]) cand = i;
      else if (sm[i] - sm[cand] > hyst) { ext.push({ i: cand, kind: 'min' }); up = true; cand = i; }
    }
  }
  ext.push({ i: cand, kind: up ? 'max' : 'min' });
  const climbs = [];
  for (let k = 0; k < ext.length - 1; k++) {
    const a = ext[k], b = ext[k + 1];
    if (a.kind !== 'min' || b.kind !== 'max') continue;
    const gain = es[b.i] - es[a.i];
    const len = ds[b.i] - ds[a.i];
    if (gain >= minGain && len > 0) {
      climbs.push({ from: ds[a.i], to: ds[b.i], eleFrom: es[a.i], eleTo: es[b.i], gain, avg: (gain / len) * 100 });
    }
  }
  return climbs;
}

function gradientBreakdown(pts) {
  const { es } = resample(pts, SETTINGS.gradientStep);
  const bins = [0, 0, 0, 0]; // <5, 5–10, 10–20, >20 %
  for (let i = 1; i < es.length; i++) {
    const g = (Math.abs(es[i] - es[i - 1]) / SETTINGS.gradientStep) * 100;
    bins[g < 5 ? 0 : g < 10 ? 1 : g < 20 ? 2 : 3]++;
  }
  const n = Math.max(1, es.length - 1);
  return bins.map((b) => b / n);
}

/** Everything the site shows about a track. */
export function analyse(segments) {
  const pts = flatten(segments);
  const distance = pts[pts.length - 1].d;
  const hasEle = pts[0].ele != null;
  const start = pts[0], end = pts[pts.length - 1];
  const loopGap = haversine(start, end);
  const bbox = [90, 180, -90, -180];
  for (const p of pts) {
    bbox[0] = Math.min(bbox[0], p.lat); bbox[1] = Math.min(bbox[1], p.lon);
    bbox[2] = Math.max(bbox[2], p.lat); bbox[3] = Math.max(bbox[3], p.lon);
  }
  const out = {
    points: pts,
    distance,
    hasEle,
    loop: loopGap <= SETTINGS.loopMaxGap,
    loopGap,
    start: [start.lat, start.lon],
    bbox,
    pointCount: pts.length,
    gain: 0, loss: 0, maxEle: null, maxEleAt: null, minEle: null, minEleAt: null,
    climbs: [], gradient: null,
  };
  if (hasEle) {
    const { gain, loss } = gainLoss(pts.map((p) => p.ele), SETTINGS.eleThreshold);
    let hi = pts[0], lo = pts[0];
    for (const p of pts) { if (p.ele > hi.ele) hi = p; if (p.ele < lo.ele) lo = p; }
    const km = distance / 1000;
    const minGain = km > 60 ? 350 : km > 20 ? 200 : 100;
    Object.assign(out, {
      gain, loss,
      maxEle: hi.ele, maxEleAt: hi.d, maxEleLatLon: [hi.lat, hi.lon],
      minEle: lo.ele, minEleAt: lo.d,
      climbs: findClimbs(pts, minGain), climbMinGain: minGain,
      gradient: gradientBreakdown(pts),
    });
  }
  out.effortKm = distance / 1000 + out.gain / 100;
  return out;
}

/** Elevation profile: `n` samples evenly spread over the distance. */
export function profile(pts, n) {
  const total = pts[pts.length - 1].d;
  const { ds, es } = resample(pts, Math.max(1, total / n));
  return { ds: ds.map(Math.round), es: es.map((e) => Math.round(e)) };
}

/** Douglas–Peucker simplification; tolerance in metres. Returns the kept points. */
export function simplify(pts, tolerance, maxPoints = Infinity) {
  if (pts.length <= 2) return pts.slice();
  const lat0 = rad(pts[0].lat);
  const xy = pts.map((p) => [rad(p.lon) * Math.cos(lat0) * R, rad(p.lat) * R]);
  let tol = tolerance, kept;
  for (let round = 0; round < 12; round++) {
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = xy[a], [bx, by] = xy[b];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      let best = -1, bestD = 0;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = xy[i];
        let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const ex = ax + t * dx - px, ey = ay + t * dy - py;
        const d2 = ex * ex + ey * ey;
        if (d2 > bestD) { bestD = d2; best = i; }
      }
      if (best > 0 && bestD > tol * tol) { keep[best] = 1; stack.push([a, best], [best, b]); }
    }
    kept = pts.filter((_, i) => keep[i]);
    if (kept.length <= maxPoints) break;
    tol *= 1.6;
  }
  return kept;
}
