// ============================================================
// BRAWLER CORE — the pure parts of common/brawlers.js. Tested by
// tests/brawler-core.test.js.
//
//   solveTwoBone   an arm: shoulder, upper arm, forearm, fist. Given
//                  where the fist should be, where the elbow goes (bent
//                  toward a pole direction) — so the same arm holds a
//                  V guard and straightens into a punch.
//   spreadAngles   brawlers circling you push apart around the ring, so
//                  they surround you instead of queueing.
//   collideDiscs   two bodies on the floor bump: they're pushed apart,
//                  and if one was flying (knocked back) it hands on
//                  velocity and both take impact damage.
// ============================================================

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function len(a) { return Math.sqrt(dot(a, a)); }
function norm(a) { var l = len(a) || 1; return scale(a, 1 / l); }

// shoulder, target: {x,y,z}; l1 upper arm, l2 forearm; pole: the way
// the elbow should point (it needn't be perpendicular to the arm).
// Returns { elbow, fist, reach } — `fist` is `target` if it's reachable,
// otherwise the nearest point the arm can reach along the same line.
export function solveTwoBone(shoulder, target, l1, l2, pole) {
  var to = sub(target, shoulder);
  var d = len(to);
  var dir = d > 1e-9 ? scale(to, 1 / d) : { x: 0, y: 0, z: 1 };
  var min = Math.abs(l1 - l2) + 1e-4;
  var max = l1 + l2 - 1e-4;
  var reach = Math.min(Math.max(d, min), max);
  var fist = add(shoulder, scale(dir, reach));
  // Angle at the shoulder between the arm line and the upper arm (law of cosines).
  var cosA = (l1 * l1 + reach * reach - l2 * l2) / (2 * l1 * reach);
  var a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  // Bend toward the part of the pole perpendicular to the arm line.
  var p = pole || { x: 0, y: -1, z: 0 };
  var bend = sub(p, scale(dir, dot(p, dir)));
  if (len(bend) < 1e-6) bend = Math.abs(dir.y) < 0.9 ? { x: 0, y: -1, z: 0 } : { x: 1, y: 0, z: 0 };
  bend = norm(sub(bend, scale(dir, dot(bend, dir))));
  var elbow = add(shoulder, add(scale(dir, l1 * Math.cos(a)), scale(bend, l1 * Math.sin(a))));
  return { elbow: elbow, fist: fist, reach: reach, reached: Math.abs(reach - d) < 1e-3 };
}

function wrap(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

// angles: each brawler's angle around the player. Returns a nudge per
// angle (radians to add this step) pushing neighbours closer than
// `minGap` apart, `strength` of the overlap per step.
export function spreadAngles(angles, minGap, strength) {
  var out = angles.map(function () { return 0; });
  for (var i = 0; i < angles.length; i++) {
    for (var j = 0; j < angles.length; j++) {
      if (i === j) continue;
      var d = wrap(angles[i] - angles[j]);
      var gap = Math.abs(d);
      if (gap >= minGap) continue;
      var push = (minGap - gap) * strength * (d === 0 ? (i < j ? -1 : 1) : Math.sign(d));
      out[i] += push / 2;
    }
  }
  return out;
}

// a, b: { x, z, vx, vz, r } on the floor. Separates overlapping discs in
// place. If they were closing faster than `hardSpeed` (someone was
// knocked into someone), the faster one hands on `transfer` of its
// velocity along the contact line and the result reports the impact
// speed (for damage). Returns null with no contact.
export function collideDiscs(a, b, hardSpeed, transfer) {
  var dx = b.x - a.x, dz = b.z - a.z;
  var d = Math.sqrt(dx * dx + dz * dz);
  var reach = a.r + b.r;
  if (d >= reach) return null;
  var nx = d > 1e-6 ? dx / d : 1, nz = d > 1e-6 ? dz / d : 0;
  var overlap = reach - d;
  a.x -= nx * overlap / 2; a.z -= nz * overlap / 2;
  b.x += nx * overlap / 2; b.z += nz * overlap / 2;
  // Closing speed along the line from a to b.
  var closing = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
  if (closing <= hardSpeed) return { impact: 0 };
  var t = transfer === undefined ? 0.7 : transfer;
  var j = closing * t;
  b.vx += nx * j; b.vz += nz * j;
  a.vx -= nx * j; a.vz -= nz * j;
  return { impact: closing };
}
