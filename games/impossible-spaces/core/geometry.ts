import type { Vec, Piece, Door } from './types.ts';

// ---------------------------------------------------------------------------
// Pieces are unions of CONVEX polygons ("parts") that share edges and never
// overlap each other. All edges sit on the 45° lattice (multiples of 45°).
// Orientation (CW/CCW) doesn't matter anywhere; every test below is orientation-free.
// ---------------------------------------------------------------------------

export const EPS = 1e-6;
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const norm = (a: Vec): Vec => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const rot = (a: Vec, th: number): Vec => ({ x: a.x * Math.cos(th) - a.y * Math.sin(th), y: a.x * Math.sin(th) + a.y * Math.cos(th) });
export function lerpV(a: Vec, b: Vec, t: number): Vec { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
export function doorCenter(d: Door): Vec { return lerpV(d.p1, d.p2, 0.5); }
export function doorWidth(d: Door): number { return len(sub(d.p2, d.p1)); }

export function signedArea(poly: Vec[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}
export function centroid(poly: Vec[]): Vec {
  let cx = 0, cy = 0, a2 = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], c = a.x * b.y - b.x * a.y;
    a2 += c; cx += (a.x + b.x) * c; cy += (a.y + b.y) * c;
  }
  return { x: cx / (3 * a2), y: cy / (3 * a2) };
}
export function edgesOf(poly: Vec[]): [Vec, Vec][] { return poly.map((a, i) => [a, poly[(i + 1) % poly.length]]); }

// Per-polygon precomputed data (polygons are never mutated after creation).
interface PolyData { ax: Float64Array; ay: Float64Array; nx: Float64Array; ny: Float64Array; x0: number; y0: number; x1: number; y1: number }
const polyCache = new WeakMap<Vec[], PolyData>();
function polyData(poly: Vec[]): PolyData {
  let d = polyCache.get(poly);
  if (d) return d;
  const n = poly.length, sg = Math.sign(signedArea(poly)) || 1;
  d = { ax: new Float64Array(n), ay: new Float64Array(n), nx: new Float64Array(n), ny: new Float64Array(n), x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], ex = b.x - a.x, ey = b.y - a.y, l = Math.hypot(ex, ey) || 1;
    d.ax[i] = a.x; d.ay[i] = a.y; d.nx[i] = (-ey / l) * sg; d.ny[i] = (ex / l) * sg;   // inward unit normal
    d.x0 = Math.min(d.x0, a.x); d.y0 = Math.min(d.y0, a.y); d.x1 = Math.max(d.x1, a.x); d.y1 = Math.max(d.y1, a.y);
  }
  polyCache.set(poly, d);
  return d;
}
/** Point inside (or within tol of the boundary of) a convex polygon. */
export function insideConvex(p: Vec, poly: Vec[], tol = EPS): boolean {
  const d = polyData(poly);
  if (p.x < d.x0 - tol || p.x > d.x1 + tol || p.y < d.y0 - tol || p.y > d.y1 + tol) return false;
  for (let i = 0; i < d.ax.length; i++) if ((p.x - d.ax[i]) * d.nx[i] + (p.y - d.ay[i]) * d.ny[i] < -tol) return false;
  return true;
}
export function pointInPiece(p: Vec, piece: Piece, tol = EPS): boolean { return piece.parts.some(q => insideConvex(p, q, tol)); }

/** Positive-area overlap of two convex polygons (separating axis theorem). Touching is not overlap. */
export function convexOverlap(a: Vec[], b: Vec[], eps = 1e-4): boolean {
  for (const poly of [a, b]) for (const [p, q] of edgesOf(poly)) {
    const ax = norm({ x: -(q.y - p.y), y: q.x - p.x });
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const v of a) { const t = dot(v, ax); a0 = Math.min(a0, t); a1 = Math.max(a1, t); }
    for (const v of b) { const t = dot(v, ax); b0 = Math.min(b0, t); b1 = Math.max(b1, t); }
    if (a1 <= b0 + eps || b1 <= a0 + eps) return false;
  }
  return true;
}
export interface BBox { x0: number; y0: number; x1: number; y1: number }
export function bboxOf(polys: Vec[][]): BBox {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const p of polys) for (const v of p) { b.x0 = Math.min(b.x0, v.x); b.y0 = Math.min(b.y0, v.y); b.x1 = Math.max(b.x1, v.x); b.y1 = Math.max(b.y1, v.y); }
  return b;
}
export function polysOverlap(a: Vec[][], b: Vec[][]): boolean {
  const A = bboxOf(a), B = bboxOf(b);
  if (A.x1 <= B.x0 + 1e-4 || B.x1 <= A.x0 + 1e-4 || A.y1 <= B.y0 + 1e-4 || B.y1 <= A.y0 + 1e-4) return false;
  for (const p of a) for (const q of b) if (convexOverlap(p, q)) return true;
  return false;
}
export function piecesOverlap(a: Piece, b: Piece): boolean { return polysOverlap(a.parts, b.parts); }
export function pieceInBounds(p: Piece, W: number, H: number): boolean {
  return p.parts.every(q => q.every(v => v.x >= -EPS && v.y >= -EPS && v.x <= W + EPS && v.y <= H + EPS));
}
/** Width of a convex polygon: the narrowest gap between two parallel supporting lines. */
export function convexWidth(poly: Vec[]): number {
  let best = Infinity;
  for (const [a, b] of edgesOf(poly)) {
    const n = norm({ x: -(b.y - a.y), y: b.x - a.x });
    let m = 0;
    for (const v of poly) m = Math.max(m, Math.abs(dot(sub(v, a), n)));
    best = Math.min(best, m);
  }
  return best;
}
export function distPointSeg(p: Vec, a: Vec, b: Vec): number {
  const e = sub(b, a), l2 = dot(e, e);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), e) / l2)) : 0;
  return len(sub(p, add(a, mul(e, t))));
}

/** Segment-segment intersection parameter along (p->q), or null. */
export function segIntersect(p: Vec, q: Vec, a: Vec, b: Vec): number | null {
  const r = sub(q, p), s = sub(b, a);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(a, p), s) / den, u = cross(sub(a, p), r) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}
/** Ray (origin + t*dir) vs segment, returns t >= 0 or null. */
export function raySeg(o: Vec, dir: Vec, a: Vec, b: Vec): number | null {
  const s = sub(b, a), den = cross(dir, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(a, o), s) / den, u = cross(sub(a, o), dir) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
}

/** Clip a segment to a convex polygon (boundary inclusive). */
export function clipSegToConvex(a: Vec, b: Vec, poly: Vec[], tol = 1e-6): [Vec, Vec] | null {
  const s = Math.sign(signedArea(poly)), d = sub(b, a);
  let t0 = 0, t1 = 1;
  for (const [p, q] of edgesOf(poly)) {
    const e = sub(q, p), el = len(e);
    // inside: cross(e, x - p) * s >= -tol*el
    const f0 = cross(e, sub(a, p)) * s + tol * el, fd = cross(e, d) * s;
    if (Math.abs(fd) < 1e-15) { if (f0 < 0) return null; continue; }
    const t = -f0 / fd;
    if (fd > 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  if ((t1 - t0) * len(d) < 1e-6) return null;
  return [lerpV(a, b, t0), lerpV(a, b, t1)];
}
/** Sutherland–Hodgman: clip `subject` (convex) by convex `clip`. */
export function clipConvex(subject: Vec[], clip: Vec[]): Vec[] {
  const s = Math.sign(signedArea(clip));
  let out = subject;
  for (const [p, q] of edgesOf(clip)) {
    const e = sub(q, p), inp = out; out = [];
    const f = (v: Vec) => cross(e, sub(v, p)) * s;
    for (let i = 0; i < inp.length; i++) {
      const A = inp[i], B = inp[(i + 1) % inp.length], fa = f(A), fb = f(B);
      if (fa >= 0) out.push(A);
      if ((fa >= 0) !== (fb >= 0)) out.push(lerpV(A, B, fa / (fa - fb)));
    }
    if (!out.length) return [];
  }
  return out;
}
export function convexHull(pts: Vec[]): Vec[] {
  // snap first: coordinates that differ only by float noise must tie, or a near-vertical
  // run sorts by noise instead of by y and the true extreme point gets popped
  const snap = (v: number) => Math.round(v * 1e9) / 1e9;
  const p = pts.map(v => ({ x: snap(v.x), y: snap(v.y) })).sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const lower: Vec[] = [], upper: Vec[] = [];
  for (const v of p) { while (lower.length >= 2 && cross(sub(lower[lower.length - 1], lower[lower.length - 2]), sub(v, lower[lower.length - 2])) <= 1e-12) lower.pop(); lower.push(v); }
  for (const v of [...p].reverse()) { while (upper.length >= 2 && cross(sub(upper[upper.length - 1], upper[upper.length - 2]), sub(v, upper[upper.length - 2])) <= 1e-12) upper.pop(); upper.push(v); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
/** Portion of segment (a,b) that lies on the line through (c,d) AND within (c,d) — as params along (a,b), or null. */
function collinearOverlap(a: Vec, b: Vec, c: Vec, d: Vec): [number, number] | null {
  const e = sub(b, a), L = len(e), u = mul(e, 1 / L);
  if (Math.abs(cross(u, sub(c, a))) > 1e-6 || Math.abs(cross(u, sub(d, a))) > 1e-6) return null;
  const tc = dot(sub(c, a), u), td = dot(sub(d, a), u);
  const lo = Math.max(0, Math.min(tc, td)), hi = Math.min(L, Math.max(tc, td));
  return hi - lo > 1e-6 ? [lo, hi] : null;
}
/** Shared edges (seams) between two parts of a piece. */
export function seamsBetween(p: Vec[], q: Vec[]): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  for (const [a, b] of edgesOf(p)) for (const [c, d] of edgesOf(q)) {
    const o = collinearOverlap(a, b, c, d);
    if (o) { const u = norm(sub(b, a)); out.push([add(a, mul(u, o[0])), add(a, mul(u, o[1]))]); }
  }
  return out;
}

/** Wall segments of a piece: part edges, minus seams shared with other parts, minus door openings. */
export function wallSegments(piece: Piece, doors: Door[]): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  const myDoors = doors.filter(d => d.a === piece.id || d.b === piece.id);
  piece.parts.forEach((part, i) => {
    for (const [a, b] of edgesOf(part)) {
      const L = len(sub(b, a)), u = mul(sub(b, a), 1 / L);
      const holes: [number, number][] = [];
      piece.parts.forEach((o, j) => { if (j !== i) for (const [c, d] of edgesOf(o)) { const h = collinearOverlap(a, b, c, d); if (h) holes.push(h); } });
      for (const d of myDoors) { const h = collinearOverlap(a, b, d.p1, d.p2); if (h) holes.push(h); }
      holes.sort((p, q) => p[0] - q[0]);
      let cur = 0;
      for (const [h0, h1] of holes) {
        if (h0 > cur + 1e-6) out.push([add(a, mul(u, cur)), add(a, mul(u, h0))]);
        cur = Math.max(cur, h1);
      }
      if (L > cur + 1e-6) out.push([add(a, mul(u, cur)), b]);
    }
  });
  return out;
}

export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
