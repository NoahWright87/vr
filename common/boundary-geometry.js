// Diagnostic geometry only. The reported headset polygon remains authoritative.
const EPS = 1e-8;
const edges = polygon => polygon.map((a, i) => [a, polygon[(i + 1) % polygon.length]]);
const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const onSegment = (p, a, b) => Math.abs(cross(a, b, p)) <= EPS * Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)) &&
  p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS &&
  p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;

export function polygonArea(polygon) {
  return Math.abs(polygon.reduce((sum, a, i) => {
    const b = polygon[(i + 1) % polygon.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) / 2;
}

export function insidePolygon(p, polygon) {
  let inside = false;
  for (const [a, b] of edges(polygon)) {
    if (onSegment(p, a, b)) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < a.x + (b.x - a.x) * (p.y - a.y) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

// A boundary segment entering the open rectangle invalidates the whole cell,
// including a notch narrower than the grid. Checking corners alone is insufficient.
function entersRectangle(a, b, box) {
  let lo = 0, hi = 1;
  for (const [key, min, max] of [['x', box.x0 + EPS, box.x1 - EPS], ['y', box.y0 + EPS, box.y1 - EPS]]) {
    if (min >= max) return false;
    const delta = b[key] - a[key];
    if (Math.abs(delta) < 1e-15) {
      if (a[key] < min || a[key] > max) return false;
    } else {
      const t0 = (min - a[key]) / delta, t1 = (max - a[key]) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
      if (lo > hi) return false;
    }
  }
  return true;
}

function rectangleInside(box, polygon, boundaryEdges, cornersInside) {
  if (!cornersInside) return false;
  return !boundaryEdges.some(([a, b]) => entersRectangle(a, b, box));
}

function validPolygon(points) {
  if (!Array.isArray(points) || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const polygon = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > EPS);
  if (polygon.length > 1 && Math.hypot(polygon[0].x - polygon.at(-1).x, polygon[0].y - polygon.at(-1).y) < EPS) polygon.pop();
  if (polygon.length < 3 || polygonArea(polygon) < EPS) return null;
  const boundaryEdges = edges(polygon);
  for (let i = 0; i < boundaryEdges.length; i++) for (let j = i + 2; j < boundaryEdges.length; j++) {
    if (i === 0 && j === boundaryEdges.length - 1) continue;
    const [a, b] = boundaryEdges[i], [c, d] = boundaryEdges[j];
    if (onSegment(a, c, d) || onSegment(b, c, d) || onSegment(c, a, b) || onSegment(d, a, b) ||
      (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0)) return null;
  }
  return polygon;
}

/** A conservative inscribed rectangle, sampled at several boundary-edge angles.
 * Every grid cell is checked in full, so concave notches cannot be bridged.
 * This is an approximate fit, not a claim of the globally largest rectangle.
 */
export function fitBoundaryRectangle(points, { resolution = 64, maxOrientations = 8 } = {}) {
  const polygon = validPolygon(points);
  if (!polygon) return null;
  const quarterTurn = Math.PI / 2, angles = [0];
  const ordered = edges(polygon).sort(([a, b], [c, d]) => Math.hypot(d.x - c.x, d.y - c.y) - Math.hypot(b.x - a.x, b.y - a.y));
  for (const [a, b] of ordered) {
    const angle = ((Math.atan2(b.y - a.y, b.x - a.x) % quarterTurn) + quarterTurn) % quarterTurn;
    if (angles.every(t => Math.min(Math.abs(t - angle), quarterTurn - Math.abs(t - angle)) > 1e-6)) angles.push(angle);
    if (angles.length >= maxOrientations) break;
  }
  let best = null;
  for (const angle of angles) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const rotated = polygon.map(p => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c }));
    const boundaryEdges = edges(rotated);
    const minX = Math.min(...rotated.map(p => p.x)), maxX = Math.max(...rotated.map(p => p.x));
    const minY = Math.min(...rotated.map(p => p.y)), maxY = Math.max(...rotated.map(p => p.y));
    const w = maxX - minX, h = maxY - minY, longest = Math.max(w, h);
    const cols = Math.max(8, Math.ceil(resolution * w / longest)), rows = Math.max(8, Math.ceil(resolution * h / longest));
    const dx = w / cols, dy = h / rows;
    const corners = Array.from({ length: rows + 1 }, (_, y) => Array.from({ length: cols + 1 }, (_, x) =>
      insidePolygon({ x: minX + x * dx, y: minY + y * dy }, rotated)));
    const heights = Array(cols).fill(0);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const box = { x0: minX + x * dx, x1: minX + (x + 1) * dx, y0: minY + y * dy, y1: minY + (y + 1) * dy };
        heights[x] = rectangleInside(box, rotated, boundaryEdges, corners[y][x] && corners[y][x + 1] && corners[y + 1][x] && corners[y + 1][x + 1]) ? heights[x] + 1 : 0;
      }
      const stack = [];
      for (let x = 0; x <= cols; x++) {
        const height = x === cols ? 0 : heights[x];
        let start = x;
        while (stack.length && stack.at(-1).height > height) {
          const entry = stack.pop(); start = entry.start;
          const width = (x - start) * dx, depth = entry.height * dy, area = width * depth;
          if (!best || area > best.area + EPS) {
            const x0 = minX + start * dx, x1 = minX + x * dx, y1 = minY + (y + 1) * dy, y0 = y1 - depth;
            best = { width, depth, area, polygonArea: polygonArea(polygon), points: [
              {x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}
            ].map(p => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c })) };
          }
        }
        if (height > 0 && (!stack.length || stack.at(-1).height < height)) stack.push({ start, height });
      }
    }
  }
  return best;
}
