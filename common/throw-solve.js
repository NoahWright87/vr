// ============================================================
// THROW SOLVE — ballistics for throws that land where you meant.
//
// Lifted from Pistols at Dawn (games/pistols-at-dawn/js/core.js:
// computeOverhandVelocity, solveArcAtSpeed), as plain functions over
// {x,y,z} with no globals, plus leading a moving target. Tested by
// tests/throw-solve.test.js.
//
//   launchAngle(rise)                  where in the swing you let go
//                                      picks the arc: still rising →
//                                      lob (50°), coming down → flat (12°)
//   solveAtAngle(from, to, angle, g)   the speed that lands at `to`
//   solveAtSpeed(from, to, speed, g)   the angle that lands at `to`
//   aimThrow(from, to, opts)           both together: try the swing's
//                                      angle, fall back to the flattest
//                                      arc your speed can make, and
//                                      honestly fall short if it can't
//   leadTarget(from, pos, vel, ...)    aim where a moving target will be
// ============================================================

export var DEFAULT_THROW = {
  steepDeg: 50, // launch angle at the bottom of the upswing
  flatDeg: 12, // launch angle at the top of the arc
  gravity: 9.8,
  maxSpeed: 14, // m/s ceiling for a thrown knife
  speedReference: 4, // m/s of hand speed that counts as a full-strength throw
};

var DEG = Math.PI / 180;

// rise = vertical hand speed / total hand speed at release (+1 still
// going up, -1 already coming down). Pistols' mapping.
export function launchAngle(rise, settings) {
  var s = settings || DEFAULT_THROW;
  var steepness = Math.min(Math.max((rise + 0.35) / 1.1, 0), 1);
  return (s.flatDeg + (s.steepDeg - s.flatDeg) * steepness) * DEG;
}

function flat(from, to) {
  var dx = to.x - from.x, dz = to.z - from.z;
  var d = Math.sqrt(dx * dx + dz * dz);
  return { d: d, x: d > 1e-9 ? dx / d : 0, z: d > 1e-9 ? dz / d : 0, h: to.y - from.y };
}

function velocity(f, angle, speed) {
  return { x: f.x * Math.cos(angle) * speed, y: Math.sin(angle) * speed, z: f.z * Math.cos(angle) * speed };
}

// The launch speed that lands at `to` from `from` at `angle`, or
// Infinity when no speed can (the target is too high for this angle):
//   v² = g·d² / (2·cos²θ·(d·tanθ − h))
export function speedForAngle(from, to, angle, g) {
  var f = flat(from, to);
  var denominator = 2 * Math.cos(angle) * Math.cos(angle) * (f.d * Math.tan(angle) - f.h);
  if (denominator <= 1e-6) return Infinity;
  return Math.sqrt((g * f.d * f.d) / denominator);
}

export function solveAtAngle(from, to, angle, g) {
  var speed = speedForAngle(from, to, angle, g);
  if (!isFinite(speed)) return null;
  return velocity(flat(from, to), angle, speed);
}

// The flatter of the two angles that land at `to` at `speed`:
//   tanθ = (v² − √(v⁴ − g(g·d² + 2·h·v²))) / (g·d)
// Out of range: 45°, the furthest it can go, and it falls short.
export function solveAtSpeed(from, to, speed, g) {
  var f = flat(from, to);
  if (f.d < 1e-6) return { x: 0, y: speed, z: 0, reaches: false };
  var v2 = speed * speed;
  var disc = v2 * v2 - g * (g * f.d * f.d + 2 * f.h * v2);
  var reaches = disc >= 0;
  var angle = reaches ? Math.atan((v2 - Math.sqrt(disc)) / (g * f.d)) : Math.PI / 4;
  var out = velocity(f, angle, speed);
  out.reaches = reaches;
  return out;
}

// The whole aim. opts: { rise, handSpeed, gravity, maxSpeed } →
// { velocity, angle, speed, reaches }.
export function aimThrow(from, to, opts, settings) {
  var s = Object.assign({}, DEFAULT_THROW, settings || {});
  var g = opts.gravity !== undefined ? opts.gravity : s.gravity;
  var cap = (opts.maxSpeed || s.maxSpeed) * Math.min((opts.handSpeed || s.speedReference) / s.speedReference, 1.15);
  var angle = launchAngle(opts.rise || 0, s);
  var speed = speedForAngle(from, to, angle, g);
  if (isFinite(speed) && speed <= cap) {
    return { velocity: velocity(flat(from, to), angle, speed), angle: angle, speed: speed, reaches: true };
  }
  // The swing's angle can't do it within your arm: the flattest arc your
  // arm can make, or, out of range, as far as it goes.
  var v = solveAtSpeed(from, to, cap, g);
  return { velocity: { x: v.x, y: v.y, z: v.z }, angle: Math.asin(Math.max(-1, Math.min(1, v.y / cap))), speed: cap, reaches: v.reaches };
}

// Time of flight for horizontal distance d at a launch velocity.
function flightTime(from, to, vel) {
  var f = flat(from, to);
  var vh = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
  return vh > 1e-6 ? f.d / vh : 0;
}

// Aim at where a moving target will be: solve, see how long the flight
// takes, move the target on by that long, solve again (twice converges
// for anything a person can throw at).
export function leadTarget(from, pos, vel, opts, settings) {
  var aim = { x: pos.x, y: pos.y, z: pos.z };
  var shot = aimThrow(from, aim, opts, settings);
  for (var i = 0; i < 2; i++) {
    var t = flightTime(from, aim, shot.velocity);
    aim = { x: pos.x + vel.x * t, y: pos.y + vel.y * t, z: pos.z + vel.z * t };
    shot = aimThrow(from, aim, opts, settings);
  }
  shot.aim = aim;
  return shot;
}

// Where a launched thing is after t seconds (no drag).
export function positionAt(from, vel, t, g) {
  return { x: from.x + vel.x * t, y: from.y + vel.y * t - 0.5 * g * t * t, z: from.z + vel.z * t };
}
