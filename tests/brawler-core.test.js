import assert from 'node:assert/strict';
import test from 'node:test';

import { solveTwoBone, spreadAngles, collideDiscs } from '../common/brawler-core.js';

const v = (x, y, z) => ({ x, y, z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('the arm keeps its lengths and the fist lands on a reachable target', () => {
  const s = v(0.3, 1.2, 0);
  const t = v(0.12, 1.32, 0.3);
  const r = solveTwoBone(s, t, 0.3, 0.3, v(1, -1, 0));
  assert.ok(Math.abs(dist(s, r.elbow) - 0.3) < 1e-6);
  assert.ok(Math.abs(dist(r.elbow, r.fist) - 0.3) < 1e-6);
  assert.ok(dist(r.fist, t) < 1e-6);
  assert.equal(r.reached, true);
});

test('a guard bends the elbow toward the pole: out and down, a V', () => {
  const s = v(0.3, 1.2, 0);
  const r = solveTwoBone(s, v(0.12, 1.32, 0.3), 0.3, 0.3, v(1, -1, 0));
  assert.ok(r.elbow.x > 0.3 || r.elbow.y < 1.2, JSON.stringify(r.elbow));
  assert.ok(r.elbow.y < 1.32, 'elbow below the fist');
});

test('an out-of-reach target straightens the arm along the same line', () => {
  const s = v(0, 1.2, 0);
  const r = solveTwoBone(s, v(0, 1.2, 2), 0.3, 0.3, v(0, -1, 0));
  assert.equal(r.reached, false);
  assert.ok(Math.abs(r.fist.z - 0.6) < 1e-3 && Math.abs(r.fist.y - 1.2) < 1e-9);
  assert.ok(Math.abs(r.elbow.z - 0.3) < 0.02, 'nearly straight');
});

test('brawlers too close together around the ring are pushed apart', () => {
  const nudge = spreadAngles([0, 0.1, 2], 0.8, 0.5);
  assert.ok(nudge[0] < 0 && nudge[1] > 0, JSON.stringify(nudge));
  assert.equal(nudge[2], 0);
  // Across the ±π seam too.
  const seam = spreadAngles([Math.PI - 0.05, -Math.PI + 0.05], 0.8, 0.5);
  assert.ok(seam[0] < 0 && seam[1] > 0, JSON.stringify(seam));
});

test('bodies standing in each other are separated, gently', () => {
  const a = { x: 0, z: 0, vx: 0, vz: 0, r: 0.3 };
  const b = { x: 0.4, z: 0, vx: 0, vz: 0, r: 0.3 };
  const hit = collideDiscs(a, b, 1, 0.7);
  assert.equal(hit.impact, 0);
  assert.ok(Math.abs((b.x - a.x) - 0.6) < 1e-9);
});

test('one shoved into another hands on its velocity and reports the impact', () => {
  const a = { x: 0, z: 0, vx: 4, vz: 0, r: 0.3 };
  const b = { x: 0.55, z: 0, vx: 0, vz: 0, r: 0.3 };
  const hit = collideDiscs(a, b, 1, 0.7);
  assert.ok(Math.abs(hit.impact - 4) < 1e-9);
  assert.ok(b.vx > 2.5 && a.vx < 1.5, JSON.stringify({ a, b }));
  assert.equal(collideDiscs({ x: 0, z: 0, vx: 0, vz: 0, r: 0.3 }, { x: 2, z: 0, vx: 0, vz: 0, r: 0.3 }, 1), null);
});
