// ============================================================
// AIM CONE — what you are aiming at, and how sure we are.
//
// Three cones out from wherever you aim from (your eyes, for the HUD's
// targeting; a gun barrel later — see TODO.md), each wider than the last:
//
//   ring 0  the inner ring: you are clearly aiming at this
//   ring 1  the middle ring: probably this
//   ring 2  the outer ring: in the neighbourhood
//
// They are tiers, not hit tests. Something that asks for help aiming (a
// throw, a bow) says how much each ring is worth — a throw might correct
// hard toward something in the inner ring and barely at all in the outer
// — and the HUD shows which target is locked with brackets rather than
// drawing the rings themselves.
//
// A target's own size counts: what is measured is the angle to the
// nearest edge of its bounding sphere, so a barn is easy to have "in the
// inner ring" and a bottle is not, and a far target gets harder to hold
// exactly as it should.
//
// No A-Frame here; tests/aim-cone.test.js covers it. The scene side is
// common/aim-targeting.js.
// ============================================================

var DEG = Math.PI / 180;

// Radii in degrees. A starting guess, adjustable from the visor's
// Targeting settings with the rings drawn while you change them.
export var DEFAULT_RINGS = [3, 7, 14];

// Ring weights for an assist that does not say otherwise.
export var DEFAULT_ASSIST = [1, 0.6, 0.15];

// How decisively a new target has to beat the locked one before the lock
// moves: its share of the two targets' combined closeness. 0.5 would
// switch the instant one edged ahead, which flickers between two targets
// side by side; 0.65 means you have to look noticeably toward the other.
export var DEFAULT_SWITCH_SHARE = 0.65;

// Every target inside the outermost ring, nearest the centre first.
//
// origin, forward: {x,y,z}; forward need not be normalised.
// targets: [{ id, x, y, z, radius }]
// options: { rings, maxDistance }
export function scoreCandidates(origin, forward, targets, options) {
  options = options || {};
  var rings = options.rings || DEFAULT_RINGS;
  var outer = rings[rings.length - 1];
  var maxDistance = options.maxDistance || Infinity;
  var fl = Math.sqrt(forward.x * forward.x + forward.y * forward.y + forward.z * forward.z) || 1;
  var fx = forward.x / fl;
  var fy = forward.y / fl;
  var fz = forward.z / fl;
  var out = [];
  for (var i = 0; i < targets.length; i++) {
    var t = targets[i];
    var dx = t.x - origin.x;
    var dy = t.y - origin.y;
    var dz = t.z - origin.z;
    var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < 1e-6 || distance > maxDistance) continue;
    var cos = (dx * fx + dy * fy + dz * fz) / distance;
    if (cos <= 0) continue; // behind you
    var centreAngle = Math.acos(Math.min(1, cos)) / DEG;
    var angularRadius = Math.asin(Math.min(1, (t.radius || 0) / distance)) / DEG;
    var angle = Math.max(0, centreAngle - angularRadius);
    if (angle > outer) continue;
    out.push({
      target: t,
      id: t.id,
      distance: distance,
      angle: angle,
      centreAngle: centreAngle,
      angularRadius: angularRadius,
      ring: ringFor(angle, rings),
      closeness: closeness(angle, outer),
    });
  }
  out.sort(function (a, b) { return (a.angle - b.angle) || (a.centreAngle - b.centreAngle) || (a.distance - b.distance); });
  return out;
}

export function ringFor(angle, rings) {
  rings = rings || DEFAULT_RINGS;
  for (var i = 0; i < rings.length; i++) if (angle <= rings[i]) return i;
  return -1;
}

// 1 dead centre, 0 at the outer ring's edge.
export function closeness(angle, outer) {
  return Math.max(0, Math.min(1, 1 - angle / outer));
}

// Which candidate holds the lock, given which one held it last time.
// The best candidate takes it only by a clear margin (switchShare); a
// locked target that has left the outer ring loses it at once.
export function chooseLock(previousId, candidates, switchShare) {
  if (!candidates.length) return null;
  var share = switchShare == null ? DEFAULT_SWITCH_SHARE : switchShare;
  var best = candidates[0];
  if (previousId == null || best.id === previousId) return best;
  var held = null;
  for (var i = 0; i < candidates.length; i++) {
    if (candidates[i].id === previousId) { held = candidates[i]; break; }
  }
  if (!held) return best;
  var total = best.closeness + held.closeness;
  if (total <= 0) return held;
  return best.closeness / total >= share ? best : held;
}

// How much an assist should pull toward this candidate, 0..1. With
// `smooth`, the strength eases between ring weights instead of stepping
// at each ring's edge — for continuous aim assist on a held gun; a throw,
// which reads it once at release, can take the steps.
export function assistStrength(candidate, weights, rings, smooth) {
  if (!candidate) return 0;
  weights = weights || DEFAULT_ASSIST;
  rings = rings || DEFAULT_RINGS;
  if (!smooth) return candidate.ring < 0 ? 0 : weights[candidate.ring] || 0;
  var angle = candidate.angle;
  if (angle <= 0) return weights[0];
  var lastEdge = 0;
  for (var i = 0; i < rings.length; i++) {
    var nextWeight = i + 1 < weights.length ? weights[i + 1] : 0;
    if (angle <= rings[i]) {
      // Hold this ring's weight across its inner half, then ease toward
      // the next ring's.
      var mid = (lastEdge + rings[i]) / 2;
      if (angle <= mid) return weights[i];
      var t = (angle - mid) / (rings[i] - mid);
      return weights[i] + (nextWeight - weights[i]) * t;
    }
    lastEdge = rings[i];
  }
  return 0;
}

// Head (or barrel) turning speed, degrees per second, from two forward
// vectors `dt` seconds apart. Re-aiming is skipped while this is high:
// someone whipping their head round is not trying to pick a target.
export function turnRate(previous, current, dt) {
  if (!previous || !dt) return 0;
  var a = Math.sqrt(previous.x * previous.x + previous.y * previous.y + previous.z * previous.z) || 1;
  var b = Math.sqrt(current.x * current.x + current.y * current.y + current.z * current.z) || 1;
  var cos = (previous.x * current.x + previous.y * current.y + previous.z * current.z) / (a * b);
  return Math.acos(Math.max(-1, Math.min(1, cos))) / DEG / dt;
}

// The launch velocity that carries a thrown thing from `from` to `to`
// under gravity at `speed` metres a second, on the flatter of the two
// arcs that reach it. When `speed` cannot reach at all, the slowest speed
// that can is used instead (a 45-degree-ish lob), so the answer is always
// a throw that lands. Returns {x, y, z}.
export function solveLaunch(from, to, speed, gravity) {
  var g = gravity == null ? 9.8 : gravity;
  var dx = to.x - from.x;
  var dz = to.z - from.z;
  var dy = to.y - from.y;
  var dh = Math.sqrt(dx * dx + dz * dz);
  if (dh < 1e-6 || g <= 0) {
    // Straight up or down, or no gravity: aim straight at it.
    var length = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return { x: dx / length * speed, y: dy / length * speed, z: dz / length * speed };
  }
  var s2 = speed * speed;
  var disc = s2 * s2 - g * (g * dh * dh + 2 * dy * s2);
  if (disc < 0) {
    // Out of reach: the least speed that gets there.
    s2 = g * (dy + Math.sqrt(dy * dy + dh * dh));
    speed = Math.sqrt(s2);
    disc = 0;
  }
  var angle = Math.atan((s2 - Math.sqrt(disc)) / (g * dh));
  var horizontal = speed * Math.cos(angle);
  return { x: dx / dh * horizontal, y: speed * Math.sin(angle), z: dz / dh * horizontal };
}

// Bend a throw toward a target by `strength` (0 leaves it alone, 1
// replaces it with the throw that lands on the target at the same speed).
export function assistThrow(from, velocity, to, strength, gravity) {
  if (!to || !(strength > 0)) return { x: velocity.x, y: velocity.y, z: velocity.z };
  var speed = Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
  var ideal = solveLaunch(from, to, Math.max(speed, 0.5), gravity);
  var t = Math.min(1, strength);
  return {
    x: velocity.x + (ideal.x - velocity.x) * t,
    y: velocity.y + (ideal.y - velocity.y) * t,
    z: velocity.z + (ideal.z - velocity.z) * t,
  };
}
