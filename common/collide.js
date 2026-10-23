// ============================================================
// COLLIDE — shape queries over plain {x,y,z} vectors.
//
// Hits in the action systems are against simple zones (spheres and
// capsules), never meshes: cheaper than raycasting three.js geometry,
// independent of what a target looks like, and the same maths for a
// bullet (ray), a fist (swept sphere) and a strike path (capsule vs
// capsule). See docs/actions/physics.todo.md for why this stays
// hand-rolled for now; the API is the seam a physics library could sit
// behind later.
//
// Tested by tests/collide.test.js.
// ============================================================

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function add(a, b) { return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }; }
function scale(a, s) { return { x: a.x * s, y: a.y * s, z: a.z * s }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function clamp01(t) { return t < 0 ? 0 : t > 1 ? 1 : t; }

export function distance(a, b) {
  var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Closest point to p on segment ab: { t (0..1 along ab), point }.
export function closestOnSegment(p, a, b) {
  var ab = sub(b, a);
  var len2 = dot(ab, ab);
  var t = len2 > 1e-12 ? clamp01(dot(sub(p, a), ab) / len2) : 0;
  return { t: t, point: add(a, scale(ab, t)) };
}

// Closest points between segments p1q1 and p2q2 (Ericson, Real-Time
// Collision Detection, 5.1.9): { s, t, c1, c2, dist2 }.
export function closestSegmentSegment(p1, q1, p2, q2) {
  var d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  var a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  var s, t;
  var EPS = 1e-12;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    var c = dot(d1, r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      var b = dot(d1, d2);
      var denom = a * e - b * b;
      s = denom > EPS ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
    }
  }
  var c1 = add(p1, scale(d1, s));
  var c2 = add(p2, scale(d2, t));
  var d = sub(c1, c2);
  return { s: s, t: t, c1: c1, c2: c2, dist2: dot(d, d) };
}

// Ray (unit direction) against a sphere: distance along the ray to the
// first hit, or -1. A ray starting inside hits at 0.
export function raySphere(origin, dir, center, r) {
  var m = sub(origin, center);
  var b = dot(m, dir);
  var c = dot(m, m) - r * r;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  var disc = b * b - c;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}

// Ray against a capsule (segment ab, radius r): distance or -1.
export function rayCapsule(origin, dir, a, b, r) {
  // Inside already?
  if (distSq(origin, closestOnSegment(origin, a, b).point) <= r * r) return 0;
  var best = -1;
  // The cylinder part: solve in the plane perpendicular to the axis.
  var ab = sub(b, a);
  var abLen2 = dot(ab, ab);
  if (abLen2 > 1e-12) {
    var ao = sub(origin, a);
    var abDir = dot(ab, dir), abAo = dot(ab, ao);
    var A = abLen2 - abDir * abDir;
    var B = abLen2 * dot(ao, dir) - abAo * abDir;
    var C = abLen2 * dot(ao, ao) - abAo * abAo - r * r * abLen2;
    if (Math.abs(A) > 1e-12) {
      var disc = B * B - A * C;
      if (disc >= 0) {
        var tc = (-B - Math.sqrt(disc)) / A;
        if (tc >= 0) {
          var y = abAo + tc * abDir;
          if (y >= 0 && y <= abLen2) best = tc;
        }
      }
    }
  }
  // The end caps.
  [a, b].forEach(function (end) {
    var ts = raySphere(origin, dir, end, r);
    if (ts >= 0 && (best < 0 || ts < best)) best = ts;
  });
  return best;
}

function distSq(a, b) { var d = sub(a, b); return dot(d, d); }

// A moving sphere (from p0 to p1, radius pr) against a capsule (ab, r):
// how a fist that moved 8 cm this frame still hits a 4 cm arm. Returns
// { t (0..1 along the move), point (on the capsule's axis side) } or null.
export function sweptSphereCapsule(p0, p1, pr, a, b, r) {
  var hit = closestSegmentSegment(p0, p1, a, b);
  var reach = pr + r;
  if (hit.dist2 > reach * reach) return null;
  // Back off along the move to the first touch: binary search on the
  // segment's parameter for the first point within reach.
  var lo = 0, hi = hit.s;
  var move = sub(p1, p0);
  for (var i = 0; i < 12; i++) {
    var mid = (lo + hi) / 2;
    var p = add(p0, scale(move, mid));
    var q = closestOnSegment(p, a, b).point;
    if (distSq(p, q) <= reach * reach) hi = mid; else lo = mid;
  }
  var at = add(p0, scale(move, hi));
  var onAxis = closestOnSegment(at, a, b).point;
  // The contact point is on the capsule's surface, toward the sphere.
  var toward = sub(at, onAxis);
  var l = Math.sqrt(dot(toward, toward)) || 1;
  return { t: hi, point: add(onAxis, scale(toward, r / l)) };
}

// A zone is { type: 'sphere', a, r } or { type: 'capsule', a, b, r }.
export function rayZone(origin, dir, zone) {
  return zone.type === 'capsule'
    ? rayCapsule(origin, dir, zone.a, zone.b, zone.r)
    : raySphere(origin, dir, zone.a, zone.r);
}

export function sweptSphereZone(p0, p1, pr, zone) {
  return sweptSphereCapsule(p0, p1, pr, zone.a, zone.type === 'capsule' ? zone.b : zone.a, zone.r);
}

// The zone's centre: where an aimed shot goes.
export function zoneCenter(zone) {
  if (zone.type !== 'capsule') return { x: zone.a.x, y: zone.a.y, z: zone.a.z };
  return { x: (zone.a.x + zone.b.x) / 2, y: (zone.a.y + zone.b.y) / 2, z: (zone.a.z + zone.b.z) / 2 };
}

// The point on a zone's surface facing `from`: where a hit visibly
// lands (sparks go here, not at the zone's centre).
export function zoneSurfaceToward(zone, from) {
  var axis = zone.type === 'capsule' ? closestOnSegment(from, zone.a, zone.b).point : zone.a;
  var d = sub(from, axis);
  var l = Math.sqrt(dot(d, d));
  if (l < 1e-9) return { x: axis.x, y: axis.y, z: axis.z };
  return add(axis, scale(d, zone.r / l));
}
