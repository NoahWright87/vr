import { measureBounds, sanitizeWorldScale } from './play-space.js';
import { prepareFloor } from '../../common/floor-overlap.js';

const polygon = vertices => vertices.map(([x, z]) => ({ x, z }));
const rectangle = (x0, z0, x1, z1) => polygon([[x0, z0], [x1, z0], [x1, z1], [x0, z1]]);

// Ordinary adjacent rooms: no overlapping floors, portals or hidden transforms.
// Metres at the default 1.5x world scale; only the starting anchor uses the
// physical boundary. A long guardian must not turn every room into a long hall.
const ROOMS = [
  { id: 'foyer', name: 'Foyer', point: [0, 0], points: rectangle(-3, -3, 3, 3) },
  { id: 'long-gallery', name: 'Long gallery', point: [0, -9], points: rectangle(-1.5, -15, 1.5, -3) },
  { id: 'crossroads', name: 'X junction', point: [0, -21], points: polygon([
    [-1.5, -27], [1.5, -27], [1.5, -22.5], [6, -22.5], [6, -19.5], [1.5, -19.5],
    [1.5, -15], [-1.5, -15], [-1.5, -19.5], [-6, -19.5], [-6, -22.5], [-1.5, -22.5],
  ]) },
  { id: 'east-gallery', name: 'East gallery', point: [12, -21], points: rectangle(6, -22.5, 18, -19.5) },
  { id: 'square-chamber', name: 'Square chamber', point: [23, -21], points: rectangle(18, -26, 28, -16) },
  { id: 'elbow-room', name: 'L chamber', point: [-2, -33], points: polygon([
    [-5, -37], [8, -37], [8, -32], [1.5, -32], [1.5, -27], [-5, -27],
  ]) },
  { id: 'tee-junction', name: 'T junction', point: [-12, -21], points: polygon([
    [-18, -22.5], [-6, -22.5], [-6, -19.5], [-10.5, -19.5],
    [-10.5, -9], [-13.5, -9], [-13.5, -19.5], [-18, -19.5],
  ]) },
  { id: 'west-chamber', name: 'West chamber', point: [-23, -21], points: rectangle(-28, -26, -18, -16) },
  { id: 'return-bend', name: 'Return bend', point: [-12, -5], points: polygon([
    [-13.5, -9], [-10.5, -9], [-10.5, -1.5], [-3, -1.5], [-3, 1.5], [-13.5, 1.5],
  ]) },
];

export const ROOM_DESTINATIONS = ROOMS.map(room => ({ id: 'space-' + room.id, name: room.name }));

const EPS = 1e-7;
const near = (a, b) => Math.abs(a - b) < EPS;
const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });

export function createRoomLayout(boundary, worldScale) {
  const scale = sanitizeWorldScale(worldScale) / 1.5;
  const map = p => ({ x: boundary.centerX + p.x * scale, z: boundary.centerZ + p.z * scale });
  const rooms = ROOMS.map((room, index) => {
    const points = room.points.map(map);
    return { ...room, id: 'space-' + room.id, number: index + 1, points, floor: prepareFloor(points),
      bounds: measureBounds(points), labelPoint: map({ x: room.point[0], z: room.point[1] }), doors: [] };
  });
  const doors = [];
  // This small, fixed layout has axis-aligned shared edges. Discover door pairs
  // once at build time, then cut the same opening out of BOTH adjoining walls.
  const edges = rooms.flatMap(room => room.points.map((a, i) => ({ room, a, b: room.points[(i + 1) % room.points.length], cuts: [] })));
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = edges[i], b = edges[j];
    if (a.room === b.room) continue;
    const vertical = near(a.a.x, a.b.x) && near(b.a.x, b.b.x) && near(a.a.x, b.a.x);
    const horizontal = near(a.a.z, a.b.z) && near(b.a.z, b.b.z) && near(a.a.z, b.a.z);
    if (!vertical && !horizontal) continue;
    const axis = vertical ? 'z' : 'x';
    const low = Math.max(Math.min(a.a[axis], a.b[axis]), Math.min(b.a[axis], b.b[axis]));
    const high = Math.min(Math.max(a.a[axis], a.b[axis]), Math.max(b.a[axis], b.b[axis]));
    if (high - low < 1.4 * scale) continue;
    const width = Math.min(1.8 * scale, high - low - .3 * scale), center = (low + high) / 2;
    const point = vertical ? { x: a.a.x, z: center } : { x: center, z: a.a.z };
    const door = { rooms: [a.room.id, b.room.id], center: point, width, vertical };
    doors.push(door); a.room.doors.push(door); b.room.doors.push(door);
    for (const edge of [a, b]) {
      const t0 = (center - width / 2 - edge.a[axis]) / (edge.b[axis] - edge.a[axis]);
      const t1 = (center + width / 2 - edge.a[axis]) / (edge.b[axis] - edge.a[axis]);
      edge.cuts.push([Math.min(t0, t1), Math.max(t0, t1)]);
    }
  }
  const walls = [], lintels = [];
  for (const edge of edges) {
    let t = 0;
    for (const [start, end] of edge.cuts.sort((a, b) => a[0] - b[0])) {
      if (start > t + EPS) walls.push({ a: lerp(edge.a, edge.b, t), b: lerp(edge.a, edge.b, start), roomId: edge.room.id });
      lintels.push({ a: lerp(edge.a, edge.b, start), b: lerp(edge.a, edge.b, end) });
      t = end;
    }
    if (t < 1 - EPS) walls.push({ a: lerp(edge.a, edge.b, t), b: edge.b, roomId: edge.room.id });
  }
  return { rooms, doors, walls, lintels, scale, bounds: measureBounds(rooms.flatMap(room => room.points)) };
}
