import type { Vec, Piece } from './types.ts';
import { edgesOf, distPointSeg, segIntersect, signedArea, insideConvex } from './geometry.ts';

/** General simple polygon containment; headset boundaries need not be convex. */
export function insideFootprint(p: Vec, polygon: Vec[]): boolean {
  let inside = false;
  for (const [a, b] of edgesOf(polygon)) {
    if (distPointSeg(p, a, b) < 1e-8) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function clearance(p: Vec, polygon: Vec[]): number {
  return (insideFootprint(p, polygon) ? 1 : -1) * Math.min(...edgesOf(polygon).map(([a, b]) => distPointSeg(p, a, b)));
}

/** Check whole edges, not just vertices: a chord can cut across a concave notch. */
export function pieceInFootprint(piece: Piece, polygon: Vec[], margin = 0): boolean {
  const boundaryEdges = edgesOf(polygon);
  for (const part of piece.parts) {
    if (!part.every(p => clearance(p, polygon) >= margin - 1e-7)) return false;
    for (const [a, b] of edgesOf(part)) {
      const cuts = [0, 1];
      for (const [c, d] of boundaryEdges) {
        const t = segIntersect(a, b, c, d);
        if (t !== null) cuts.push(t);
        const distance = Math.min(distPointSeg(a, c, d), distPointSeg(b, c, d), distPointSeg(c, a, b), distPointSeg(d, a, b));
        if (distance < margin - 1e-7) return false;
      }
      cuts.sort((x, y) => x - y);
      for (let i = 1; i < cuts.length; i++) {
        const t = (cuts[i - 1] + cuts[i]) / 2;
        if (!insideFootprint({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, polygon)) return false;
      }
    }
    // A notch entirely enclosed by a convex part also invalidates containment.
    if (polygon.some(p => insideConvex(p, part, -1e-7))) return false;
  }
  return true;
}

export function normalizeFootprint(points: Vec[]) {
  const polygon = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-6);
  if (polygon.length > 1 && Math.hypot(polygon[0].x - polygon.at(-1)!.x, polygon[0].y - polygon.at(-1)!.y) < 1e-6) polygon.pop();
  if (polygon.length < 3 || polygon.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || Math.abs(signedArea(polygon)) < 0.01) throw new Error('The headset supplied an invalid boundary.');
  const edges = edgesOf(polygon);
  for (let i = 0; i < edges.length; i++) for (let j = i + 2; j < edges.length; j++) {
    if (i === 0 && j === edges.length - 1) continue;
    if (segIntersect(...edges[i], ...edges[j]) !== null) throw new Error('The boundary crosses itself. Please redraw it.');
  }
  const origin = { x: Math.min(...polygon.map(p => p.x)), y: Math.min(...polygon.map(p => p.y)) };
  return { origin, polygon: polygon.map(p => ({ x: p.x - origin.x, y: p.y - origin.y })), width: Math.max(...polygon.map(p => p.x)) - origin.x, height: Math.max(...polygon.map(p => p.y)) - origin.y };
}
