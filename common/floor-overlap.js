// Exact floor-polygon intersections, independent of A-Frame / renderer state.
// An area is one simple polygon (concave is supported), in tracking metres.
const EPS = 1e-9;
const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);

export function sameFloorTransform(a, b) {
  // Ignore sub-millimetre tracking jitter and irrelevant vertical motion.
  // Only these six matrix entries affect a floor's projected X/Z footprint.
  return [0, 2, 8, 10, 12, 14].every(i => Math.abs(a.elements[i] - b.elements[i]) <= 1e-5);
}

export function signedArea(points) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length]; return sum + p.x * q.z - q.x * p.z;
  }, 0) / 2;
}
export function containsPoint(point, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j], b = points[i];
    if (Math.abs(cross(a, b, point)) < EPS && point.x >= Math.min(a.x, b.x) - EPS &&
      point.x <= Math.max(a.x, b.x) + EPS && point.z >= Math.min(a.z, b.z) - EPS && point.z <= Math.max(a.z, b.z) + EPS) return true;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function prepareFloor(points) {
  if (!Array.isArray(points) || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.z))) return null;
  const clean = [];
  for (const p of points) if (!clean.length || Math.hypot(p.x - clean.at(-1).x, p.z - clean.at(-1).z) > EPS) clean.push({ x: p.x, z: p.z });
  if (clean.length > 1 && Math.hypot(clean[0].x - clean.at(-1).x, clean[0].z - clean.at(-1).z) < EPS) clean.pop();
  let removed = true;
  while (removed && clean.length > 3) {
    removed = false;
    for (let i = 0; i < clean.length; i++) if (Math.abs(cross(clean[(i + clean.length - 1) % clean.length], clean[i], clean[(i + 1) % clean.length])) < EPS) {
      clean.splice(i, 1); removed = true; break;
    }
  }
  if (clean.length < 3 || Math.abs(signedArea(clean)) < EPS) return null;
  if (signedArea(clean) < 0) clean.reverse();
  const convex = clean.every((p, i) => cross(p, clean[(i + 1) % clean.length], clean[(i + 2) % clean.length]) >= -EPS);
  const parts = [];
  if (convex) parts.push(clean);
  else {
    const remaining = [...clean];
    while (remaining.length > 3) {
      let found = false;
      for (let i = 0; i < remaining.length; i++) {
        const a = remaining[(i + remaining.length - 1) % remaining.length], b = remaining[i], c = remaining[(i + 1) % remaining.length];
        if (cross(a, b, c) <= EPS) continue;
        if (remaining.some(p => p !== a && p !== b && p !== c && cross(a, b, p) >= -EPS && cross(b, c, p) >= -EPS && cross(c, a, p) >= -EPS)) continue;
        parts.push([a, b, c]); remaining.splice(i, 1); found = true; break;
      }
      if (!found) return null; // Degenerate / self-intersecting input: no guidance.
    }
    parts.push(remaining);
  }
  return { points: clean, parts, area: signedArea(clean) };
}

function clip(subject, boundary) {
  let output = subject;
  for (let i = 0; i < boundary.length && output.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length], input = output;
    output = [];
    let previous = input.at(-1), previousSide = cross(a, b, previous);
    for (const current of input) {
      const side = cross(a, b, current);
      if ((side >= -EPS) !== (previousSide >= -EPS)) {
        const t = previousSide / (previousSide - side);
        output.push({ x: previous.x + (current.x - previous.x) * t, z: previous.z + (current.z - previous.z) * t });
      }
      if (side >= -EPS) output.push(current);
      previous = current; previousSide = side;
    }
  }
  return output;
}

export function intersectionArea(a, b) {
  let area = 0;
  for (const subject of a.parts) for (const boundary of b.parts) area += Math.abs(signedArea(clip(subject, boundary)));
  return Math.min(a.area, b.area, Math.max(0, area));
}

export function moveFloor(floor, yaw, translation, pivot = { x: 0, z: 0 }) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const move = p => ({ x: pivot.x + c * (p.x - pivot.x) + s * (p.z - pivot.z) + translation.x,
    z: pivot.z - s * (p.x - pivot.x) + c * (p.z - pivot.z) + translation.z });
  return { points: floor.points.map(move), parts: floor.parts.map(part => part.map(move)), area: floor.area };
}
