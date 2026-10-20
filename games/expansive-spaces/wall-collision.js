const EPS = 1e-9, SKIN = .0001;
export const PLAYER_RADIUS = .18;

// The static layout has axis-aligned walls. Sweep a small square player
// footprint against expanded wall boxes instead of raycasting render meshes
// or registering walls with the menu's interaction-collider system.
export class WallCollision {
  constructor(walls, radius = PLAYER_RADIUS) {
    const margin = radius + .06, seen = new Set();
    this.boxes = [];
    for (const { a, b } of walls) {
      const box = { minX: Math.min(a.x, b.x) - margin, maxX: Math.max(a.x, b.x) + margin,
        minZ: Math.min(a.z, b.z) - margin, maxZ: Math.max(a.z, b.z) + margin };
      const key = [box.minX, box.maxX, box.minZ, box.maxZ].join(',');
      if (!seen.has(key)) { seen.add(key); this.boxes.push(box); }
    }
  }

  move(start, end) {
    let x = start.x, z = start.z, dx = end.x - x, dz = end.z - z;
    const normals = [];
    // Recover tiny penetrations or a spawn/resized wall under the player.
    // This bounded pass also lets the next sweep start outside every slab.
    for (let pass = 0; pass < 4; pass++) {
      let pushed = false;
      for (const b of this.boxes) {
        if (x <= b.minX || x >= b.maxX || z <= b.minZ || z >= b.maxZ) continue;
        const exits = [x - b.minX, b.maxX - x, z - b.minZ, b.maxZ - z];
        const side = exits.indexOf(Math.min(...exits)), axis = side < 2 ? 'x' : 'z', sign = side % 2 ? 1 : -1;
        if (axis === 'x') x += sign * (exits[side] + SKIN); else z += sign * (exits[side] + SKIN);
        normals.push({ x: axis === 'x' ? sign : 0, z: axis === 'z' ? sign : 0 }); pushed = true;
      }
      if (!pushed) break;
    }
    // Four contacts suffice for a 2D wall slide/corner. The distance can be
    // arbitrarily large: continuous slab tests cannot skip a thin wall.
    for (let pass = 0; pass < 4 && Math.hypot(dx, dz) > EPS; pass++) {
      let first = null;
      const pathMinX = Math.min(x, x + dx), pathMaxX = Math.max(x, x + dx);
      const pathMinZ = Math.min(z, z + dz), pathMaxZ = Math.max(z, z + dz);
      for (const b of this.boxes) {
        if (pathMaxX < b.minX || pathMinX > b.maxX || pathMaxZ < b.minZ || pathMinZ > b.maxZ) continue;
        let enter = -Infinity, exit = Infinity, nx = 0, nz = 0, misses = false;
        for (const [p, d, min, max, axis] of [[x, dx, b.minX, b.maxX, 'x'], [z, dz, b.minZ, b.maxZ, 'z']]) {
          if (Math.abs(d) < EPS) { if (p < min || p > max) misses = true; continue; }
          const near = (d > 0 ? min - p : max - p) / d, far = (d > 0 ? max - p : min - p) / d;
          if (near > enter) { enter = near; nx = axis === 'x' ? -Math.sign(d) : 0; nz = axis === 'z' ? -Math.sign(d) : 0; }
          exit = Math.min(exit, far);
        }
        if (!misses && enter >= -EPS && enter <= 1 && exit >= Math.max(0, enter) && (!first || enter < first.time))
          first = { time: Math.max(0, enter), x: nx, z: nz };
      }
      if (!first) { x += dx; z += dz; break; }
      x += dx * first.time + first.x * SKIN; z += dz * first.time + first.z * SKIN;
      dx *= 1 - first.time; dz *= 1 - first.time;
      const into = dx * first.x + dz * first.z;
      if (into < 0) { dx -= into * first.x; dz -= into * first.z; }
      normals.push({ x: first.x, z: first.z });
    }
    return { x, z, normals };
  }
}
