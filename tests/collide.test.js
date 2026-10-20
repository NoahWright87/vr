import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closestOnSegment,
  closestSegmentSegment,
  raySphere,
  rayCapsule,
  sweptSphereCapsule,
  rayZone,
  zoneCenter,
  zoneSurfaceToward,
  distance,
} from '../common/collide.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const v = (x, y, z) => ({ x, y, z });

test('closest point on a segment clamps to its ends', () => {
  assert.deepEqual(closestOnSegment(v(0, 5, 0), v(0, 0, 0), v(0, 1, 0)).point, v(0, 1, 0));
  assert.deepEqual(closestOnSegment(v(3, 0.5, 0), v(0, 0, 0), v(0, 1, 0)).point, v(0, 0.5, 0));
  assert.equal(closestOnSegment(v(1, 1, 1), v(0, 0, 0), v(0, 0, 0)).t, 0);
});

test('closest points between crossing segments', () => {
  const r = closestSegmentSegment(v(-1, 0, 0), v(1, 0, 0), v(0, -1, 1), v(0, 1, 1));
  assert.ok(near(r.dist2, 1));
  assert.ok(near(r.s, 0.5) && near(r.t, 0.5));
  const parallel = closestSegmentSegment(v(0, 0, 0), v(1, 0, 0), v(0, 2, 0), v(1, 2, 0));
  assert.ok(near(parallel.dist2, 4));
});

test('a ray hits a sphere at its near surface, misses past it, and starts inside at 0', () => {
  assert.ok(near(raySphere(v(0, 0, 0), v(0, 0, -1), v(0, 0, -5), 1), 4));
  assert.equal(raySphere(v(0, 0, 0), v(0, 0, -1), v(0, 2, -5), 1), -1);
  assert.equal(raySphere(v(0, 0, 0), v(0, 0, 1), v(0, 0, -5), 1), -1);
  assert.equal(raySphere(v(0, 0, -5), v(0, 0, -1), v(0, 0, -5), 1), 0);
});

test('a ray hits a capsule on its side and on its caps', () => {
  // Vertical capsule at z = -5, y from 1 to 2, radius 0.25.
  const a = v(0, 1, -5), b = v(0, 2, -5);
  assert.ok(near(rayCapsule(v(0, 1.5, 0), v(0, 0, -1), a, b, 0.25), 4.75));
  // Straight down onto the top cap.
  assert.ok(near(rayCapsule(v(0, 5, -5), v(0, -1, 0), a, b, 0.25), 2.75));
  // Just over the top, past the cap.
  assert.equal(rayCapsule(v(0, 2.3, 0), v(0, 0, -1), a, b, 0.25), -1);
  // Glancing the side.
  assert.ok(rayCapsule(v(0.2, 1.5, 0), v(0, 0, -1), a, b, 0.25) > 0);
  assert.equal(rayCapsule(v(0.3, 1.5, 0), v(0, 0, -1), a, b, 0.25), -1);
});

test('a fast fist that passes through an arm in one frame still hits it', () => {
  // Arm: horizontal capsule along x at y=1.4, z=-0.5, radius 4 cm.
  const a = v(-0.2, 1.4, -0.5), b = v(0.2, 1.4, -0.5);
  // The fist moves 30 cm in one frame, from in front of the arm to past it.
  const hit = sweptSphereCapsule(v(0, 1.4, -0.3), v(0, 1.4, -0.6), 0.05, a, b, 0.04);
  assert.ok(hit, 'hit');
  // First touch is when the fist is 9 cm from the axis: 11 cm into the move.
  assert.ok(near(hit.t, 0.11 / 0.3, 1e-3), String(hit.t));
  assert.ok(near(hit.point.z, -0.46, 1e-3), JSON.stringify(hit.point));
  // A miss above it.
  assert.equal(sweptSphereCapsule(v(0, 1.6, -0.3), v(0, 1.6, -0.6), 0.05, a, b, 0.04), null);
});

test('zones: centre, the surface facing a point, and ray tests by type', () => {
  const capsule = { type: 'capsule', a: v(0, 1, 0), b: v(0, 2, 0), r: 0.2 };
  const sphere = { type: 'sphere', a: v(0, 2.3, 0), r: 0.1 };
  assert.deepEqual(zoneCenter(capsule), v(0, 1.5, 0));
  const s = zoneSurfaceToward(capsule, v(0, 1.2, -3));
  assert.ok(near(s.z, -0.2) && near(s.y, 1.2));
  assert.ok(near(distance(zoneSurfaceToward(sphere, v(0, 5, 0)), v(0, 2.4, 0)), 0));
  assert.ok(rayZone(v(0, 2.3, -3), v(0, 0, 1), sphere) > 0);
  assert.ok(rayZone(v(0, 1.5, -3), v(0, 0, 1), capsule) > 0);
});
