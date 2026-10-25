// Ground truth for the occlusion guarantee, independent of the see-through rule and
// the zone sweep: march actual rays from points inside a piece, passing through door
// openings into the next piece, and record every point and piece a ray reaches.
import type { Level, Vec, Door } from '../core/types.ts';
import { pointInPiece, distPointSeg, centroid, lerpV } from '../core/geometry.ts';

const onDoor = (p: Vec, d: Door, tol: number) => distPointSeg(p, d.p1, d.p2) <= tol;

export function traceVisibleFrom(level: Level, pieceId: string, origin: Vec, rays = 720, step = 0.005, onHit?: (pid: string, p: Vec) => void): Set<string> {
  const byId = new Map(level.pieces.map(p => [p.id, p]));
  const doorsOf = new Map<string, Door[]>(level.pieces.map(p => [p.id, []]));
  for (const d of level.doors) { doorsOf.get(d.a)!.push(d); doorsOf.get(d.b)!.push(d); }
  const seen = new Set([pieceId]);
  const maxDist = Math.hypot(level.bounds.w, level.bounds.h) * 3;
  for (let i = 0; i < rays; i++) {
    const th = (i / rays) * Math.PI * 2 + 0.0123, dir = { x: Math.cos(th), y: Math.sin(th) };
    let cur = pieceId, t = 0;
    while (t < maxDist) {
      const pNext = { x: origin.x + dir.x * (t + step), y: origin.y + dir.y * (t + step) };
      if (pointInPiece(pNext, byId.get(cur)!, 1e-9)) { onHit?.(cur, pNext); t += step; continue; }
      const pMid = { x: origin.x + dir.x * (t + step / 2), y: origin.y + dir.y * (t + step / 2) };
      const door = doorsOf.get(cur)!.find(d => onDoor(pMid, d, step));
      if (!door) break;
      const nxt = door.a === cur ? door.b : door.a;
      if (!pointInPiece(pNext, byId.get(nxt)!, 1e-9)) break;
      cur = nxt; seen.add(cur); t += step;
    }
  }
  return seen;
}
export function traceHits(level: Level, pieceId: string, origin: Vec, rays = 720, step = 0.005): Map<string, Vec[]> {
  const hits = new Map<string, Vec[]>();
  traceVisibleFrom(level, pieceId, origin, rays, step, (pid, p) => { if (!hits.has(pid)) hits.set(pid, []); hits.get(pid)!.push(p); });
  return hits;
}
/** Distance along one ray until it hits a wall, following doorways (portal semantics). */
export function traceFirstWall(level: Level, pieceId: string, origin: Vec, dir: Vec, step = 0.004): number {
  const byId = new Map(level.pieces.map(p => [p.id, p]));
  const doorsOf = (id: string) => level.doors.filter(d => d.a === id || d.b === id);
  let cur = pieceId, t = 0;
  const maxDist = Math.hypot(level.bounds.w, level.bounds.h) * 3;
  while (t < maxDist) {
    const pNext = { x: origin.x + dir.x * (t + step), y: origin.y + dir.y * (t + step) };
    if (pointInPiece(pNext, byId.get(cur)!, 1e-9)) { t += step; continue; }
    const pMid = { x: origin.x + dir.x * (t + step / 2), y: origin.y + dir.y * (t + step / 2) };
    const door = doorsOf(cur).find(d => onDoor(pMid, d, step));
    if (!door) return t + step / 2;
    const nxt = door.a === cur ? door.b : door.a;
    if (!pointInPiece(pNext, byId.get(nxt)!, 1e-9)) return t + step / 2;
    cur = nxt; t += step;
  }
  return maxDist;
}
/** Viewpoints spread through every part of the piece, plus points just inside each door. */
export function viewpoints(level: Level, pieceId: string): Vec[] {
  const piece = level.pieces.find(p => p.id === pieceId)!;
  const pts: Vec[] = [];
  for (const part of piece.parts) { const c = centroid(part); pts.push(c, ...part.map(v => lerpV(c, v, 0.85))); }
  for (const d of level.doors) {
    if (d.a !== pieceId && d.b !== pieceId) continue;
    const sgn = d.a === pieceId ? -1 : 1;
    for (const f of [0.05, 0.5, 0.95]) pts.push({ x: d.p1.x + (d.p2.x - d.p1.x) * f + d.normal.x * sgn * 0.02, y: d.p1.y + (d.p2.y - d.p1.y) * f + d.normal.y * sgn * 0.02 });
  }
  return pts.filter(p => pointInPiece(p, piece));
}
