import type { Piece, Door, Vec } from './types.ts';
import { lerpV, pointInPiece, sub, cross, norm, len, add, mul, seamsBetween, raySeg, edgesOf, insideConvex, convexHull, clipConvex, centroid, distPointSeg } from './geometry.ts';

/**
 * THE RULE: a sightline continues through a piece from door A to door B only if
 * some straight segment from A to B stays inside the piece.
 *  - Two doors on the same wall line: never (a line crosses a line once).
 *  - Otherwise test it directly with sampled segments, so ANY shape works.
 * The test suite checks this against independent ray tracing.
 */
export function doorsSeeThrough(piece: Piece, d1: Door, d2: Door, samples = 16): boolean {
  const u = norm(sub(d1.p2, d1.p1));
  if (Math.abs(cross(u, sub(d2.p1, d1.p1))) < 1e-6 && Math.abs(cross(u, sub(d2.p2, d1.p1))) < 1e-6) return false;
  for (let i = 0; i <= samples; i++) {
    const a = lerpV(d1.p1, d1.p2, i / samples);
    for (let j = 0; j <= samples; j++) if (segmentInside(piece, a, lerpV(d2.p1, d2.p2, j / samples))) return true;
  }
  return false;
}
function segmentInside(piece: Piece, a: Vec, b: Vec): boolean {
  const steps = Math.max(8, Math.ceil(len(sub(b, a)) / 0.03));
  for (let k = 1; k < steps; k++) if (!pointInPiece(lerpV(a, b, k / steps), piece, 1e-7)) return false;
  return true;
}

export type Cache = Map<string, unknown>;
export function seeThroughFor(piece: Piece, doors: Door[], cache: Cache = new Map()): [string, string][] {
  const mine = doors.filter(d => d.a === piece.id || d.b === piece.id);
  const key = 'st|' + piece.id + '|' + mine.map(d => d.id).sort().join(',');
  if (cache.has(key)) return cache.get(key) as [string, string][];
  const out: [string, string][] = [];
  for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++)
    if (doorsSeeThrough(piece, mine[i], mine[j])) out.push([mine[i].id, mine[j].id]);
  cache.set(key, out);
  return out;
}

/**
 * The part of `piece` that can possibly be seen from OUTSIDE it through `door`.
 * The part the door opens into is fully visible (it's convex). Any other part is
 * visible only where straight lines from the door, passing through the piece, can
 * cross into it: we sweep those lines through each of its seams, follow them across
 * the part, and take the convex hull (padded, clipped to the part). Works around any
 * number of corners. Parts no line can reach are left out entirely.
 */
export function zoneThrough(piece: Piece, door: Door, samples = 12): Vec[][] {
  const onDoor = (part: Vec[]) => edgesOf(part).some(([a, b]) => distPointSeg(door.p1, a, b) < 1e-6 && distPointSeg(door.p2, a, b) < 1e-6);
  const front = piece.parts.map(onDoor);
  if (piece.parts.length === 1) return piece.parts;
  const out: Vec[][] = piece.parts.filter((_, i) => front[i]);
  piece.parts.forEach((C, i) => {
    if (front[i]) return;
    const seams = piece.parts.flatMap((o, j) => (j === i ? [] : seamsBetween(C, o)));
    const pts: Vec[] = [];
    // sample evenly, plus a hair inside each endpoint: the extreme lines that bound the
    // visible wedge pass through the endpoints, where exact-endpoint lines only graze
    const ts = [...Array.from({ length: samples + 1 }, (_, i) => i / samples), 0.002, 0.998];
    for (const [s0, s1] of seams) {
      const before = pts.length;
      for (const ta of ts) {
      const p = lerpV(door.p1, door.p2, ta);
      // seam points: evenly spaced, plus where lines from p just past every corner of the
      // piece cross this seam (the lines that graze inner corners bound what's visible)
      const qs = ts.map(tb => lerpV(s0, s1, tb));
      for (const part of piece.parts) for (const v of part) for (const e of [-1e-4, 1e-4]) {
        const d0 = sub(v, p); if (len(d0) < 1e-9) continue;
        const dir = norm({ x: d0.x - d0.y * e, y: d0.y + d0.x * e });
        const t = raySeg(p, dir, s0, s1);
        if (t !== null) qs.push(add(p, mul(dir, t)));
      }
      for (const q of qs) {
        if (len(sub(q, p)) < 1e-9 || !segmentInside(piece, p, q)) continue;
        const dir = norm(sub(q, p));
        // follow the line across C until it leaves C
        let tExit = Infinity;
        const start = add(q, mul(dir, 1e-7));
        if (!insideConvex(add(q, mul(dir, 1e-4)), C, 1e-9)) continue;  // grazing, doesn't enter C
        for (const [e0, e1] of edgesOf(C)) { const t = raySeg(start, dir, e0, e1); if (t !== null && t > 1e-6) tExit = Math.min(tExit, t); }
        if (tExit === Infinity) continue;
        pts.push(q, add(start, mul(dir, tExit)));
      }
      }
      if (pts.length > before) pts.push(s0, s1);         // if anything is seen past this seam, all of the seam is seen
    }
    if (pts.length < 2) return;
    const hull = convexHull(pts);
    const c = centroid(hull.length >= 3 ? hull : C);
    // pad outward by 5 cm, then keep it inside C
    const padded = (hull.length >= 3 ? hull : pts).map(v => { const d = sub(v, c), l = len(d); return l > 1e-9 ? add(v, mul(d, 0.05 / l)) : v; });
    const fat = convexHull(padded.flatMap(v => [v, add(v, { x: 0.05, y: 0 }), add(v, { x: -0.05, y: 0 }), add(v, { x: 0, y: 0.05 }), add(v, { x: 0, y: -0.05 })]));
    const z = clipConvex(fat, C);
    if (z.length >= 3) out.push(z);
  });
  return out;
}

function indexDoors(pieces: Piece[], doors: Door[]) {
  const doorsOf = new Map<string, Door[]>();
  for (const p of pieces) doorsOf.set(p.id, []);
  for (const d of doors) { doorsOf.get(d.a)?.push(d); doorsOf.get(d.b)?.push(d); }
  return doorsOf;
}
function passSets(seeThrough: Record<string, [string, string][]>) {
  const pass = new Map<string, Set<string>>();
  for (const [pid, pairs] of Object.entries(seeThrough)) {
    const s = new Set<string>();
    for (const [x, y] of pairs) { s.add(x + '>' + y); s.add(y + '>' + x); }
    pass.set(pid, s);
  }
  return pass;
}

/**
 * For each piece X: every piece visible from inside X, and the region of it that
 * can be seen (X itself: all of it). Chains through doors continue only through
 * see-through pairs (conservative: a chain counts even if no single line threads it).
 * Elevator portals are not sightlines.
 * THE GUARANTEE the generator enforces: for every X, these regions are pairwise disjoint.
 */
export function computeVisibleRegions(pieces: Piece[], doors: Door[], seeThrough: Record<string, [string, string][]>, cache: Cache = new Map()): Record<string, Record<string, Vec[][]>> {
  const byId = new Map(pieces.map(p => [p.id, p]));
  const doorsOf = indexDoors(pieces, doors), pass = passSets(seeThrough);
  const zone = (pid: string, d: Door) => {
    const k = 'z|' + pid + '|' + d.id;
    if (!cache.has(k)) cache.set(k, zoneThrough(byId.get(pid)!, d));
    return cache.get(k) as Vec[][];
  };
  const other = (d: Door, id: string) => (d.a === id ? d.b : d.a);
  const out: Record<string, Record<string, Vec[][]>> = {};
  for (const p of pieces) {
    const reg: Record<string, Vec[][]> = { [p.id]: p.parts };
    const add_ = (pid: string, rs: Vec[][]) => { if (pid !== p.id) reg[pid] = [...(reg[pid] ?? []), ...rs]; };
    const stack: [string, string][] = [];
    for (const d of doorsOf.get(p.id) ?? []) { const y = other(d, p.id); add_(y, zone(y, d)); stack.push([y, d.id]); }
    const visited = new Set<string>();
    while (stack.length) {
      const [cur, inDoor] = stack.pop()!;
      if (visited.has(cur + '@' + inDoor)) continue;
      visited.add(cur + '@' + inDoor);
      for (const d of doorsOf.get(cur) ?? []) {
        if (d.id === inDoor || !pass.get(cur)?.has(inDoor + '>' + d.id)) continue;
        const z = other(d, cur);
        add_(z, zone(z, d));
        stack.push([z, d.id]);
      }
    }
    out[p.id] = reg;
  }
  return out;
}
export function computeVisible(regions: Record<string, Record<string, Vec[][]>>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(regions).map(([k, v]) => [k, Object.keys(v)]));
}
