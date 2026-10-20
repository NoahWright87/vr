// ============================================================
// AUTOFIRE CORE — the pure parts of common/autofire.js: turning a gun
// toward a target within a cap, the fire-rate cooldown, and the aim
// cones. Tested by tests/autofire.test.js.
// ============================================================

// The angle (radians) between two unit vectors.
export function angleBetween(a, b) {
  var c = a.x * b.x + a.y * b.y + a.z * b.z;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

// Rotate unit vector `from` toward unit vector `to` by at most
// `maxAngle` radians (spherical interpolation). Returns a new vector.
export function turnToward(from, to, maxAngle) {
  var angle = angleBetween(from, to);
  if (angle <= maxAngle || angle < 1e-6) return { x: to.x, y: to.y, z: to.z };
  var t = maxAngle / angle;
  var s = Math.sin(angle);
  var a = Math.sin((1 - t) * angle) / s;
  var b = Math.sin(t * angle) / s;
  var out = { x: from.x * a + to.x * b, y: from.y * a + to.y * b, z: from.z * a + to.z * b };
  var l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z) || 1;
  out.x /= l; out.y /= l; out.z /= l;
  return out;
}

// How many shots are due this frame at `rate` per second, carrying the
// remainder in `state.cooldown` (ms until the next one).
export function shotsDue(state, dtMs, rate) {
  var interval = 1000 / Math.max(rate, 0.01);
  state.cooldown -= dtMs;
  var n = 0;
  while (state.cooldown <= 0 && n < 4) { // never more than 4 in a frame, even after a hitch
    n++;
    state.cooldown += interval;
  }
  if (state.cooldown < 0) state.cooldown = 0;
  return n;
}

export var AIM_CONES = { wide: 70, soft: 35, tight: 15 };
