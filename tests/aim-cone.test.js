import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RINGS, scoreCandidates, ringFor, chooseLock, assistStrength, turnRate,
} from '../common/aim-cone.js';

const ORIGIN = { x: 0, y: 0, z: 0 };
const AHEAD = { x: 0, y: 0, z: -1 };
// A target `deg` degrees to the right of straight ahead, `distance` away.
function at(id, deg, distance = 10, radius = 0) {
  const a = deg * Math.PI / 180;
  return { id, x: Math.sin(a) * distance, y: 0, z: -Math.cos(a) * distance, radius };
}

test('candidates are sorted nearest the centre first and binned into rings', () => {
  const found = scoreCandidates(ORIGIN, AHEAD, [at('far', 10), at('mid', 5), at('near', 1)]);
  assert.deepEqual(found.map((c) => c.id), ['near', 'mid', 'far']);
  assert.deepEqual(found.map((c) => c.ring), [0, 1, 2]);
});

test('anything outside the outer ring, behind you or out of range is left out', () => {
  const outer = DEFAULT_RINGS[DEFAULT_RINGS.length - 1];
  const found = scoreCandidates(ORIGIN, AHEAD, [at('wide', outer + 1), at('behind', 180), at('far', 1, 200)], { maxDistance: 100 });
  assert.equal(found.length, 0);
});

test('a big target counts from its nearest edge, so it is easier to hold', () => {
  const [small] = scoreCandidates(ORIGIN, AHEAD, [at('bottle', 5, 10, 0.05)]);
  const [big] = scoreCandidates(ORIGIN, AHEAD, [at('barn', 5, 10, 1)]);
  assert.ok(big.angle < small.angle);
  assert.equal(big.ring, 0);
  assert.equal(small.ring, 1);
});

test('the lock only moves to a new target by a clear margin', () => {
  // The held target at 4 degrees; a challenger slightly nearer the centre
  // does not take it, one much nearer does.
  const slightly = scoreCandidates(ORIGIN, AHEAD, [at('held', 4), at('other', 3.5)]);
  assert.equal(chooseLock('held', slightly).id, 'held');
  const clearly = scoreCandidates(ORIGIN, AHEAD, [at('held', 11), at('other', 1)]);
  assert.equal(chooseLock('held', clearly).id, 'other');
});

test('a locked target that leaves the cone loses the lock at once', () => {
  const found = scoreCandidates(ORIGIN, AHEAD, [at('other', 12)]);
  assert.equal(chooseLock('gone', found).id, 'other');
  assert.equal(chooseLock('gone', []), null);
});

test('with nothing locked the best candidate takes it', () => {
  const found = scoreCandidates(ORIGIN, AHEAD, [at('a', 6), at('b', 2)]);
  assert.equal(chooseLock(null, found).id, 'b');
});

test('stepped assist uses each ring\'s weight; smooth eases between them', () => {
  const weights = [1, 0.5, 0.1];
  const [inner] = scoreCandidates(ORIGIN, AHEAD, [at('t', 1)]);
  const [middle] = scoreCandidates(ORIGIN, AHEAD, [at('t', 5)]);
  assert.equal(assistStrength(inner, weights), 1);
  assert.equal(assistStrength(middle, weights), 0.5);
  assert.equal(assistStrength(null, weights), 0);
  // Smooth: dead centre is full; the inner ring's edge has eased to the
  // middle ring's weight; past the outer ring is nothing.
  const rings = DEFAULT_RINGS;
  assert.equal(assistStrength({ angle: 0 }, weights, rings, true), 1);
  assert.ok(Math.abs(assistStrength({ angle: rings[0] }, weights, rings, true) - 0.5) < 1e-9);
  assert.equal(assistStrength({ angle: rings[2] + 1 }, weights, rings, true), 0);
  let last = 2;
  for (let angle = 0; angle <= rings[2]; angle += 0.25) {
    const value = assistStrength({ angle }, weights, rings, true);
    assert.ok(value <= last + 1e-12, `never rises with angle (at ${angle})`);
    last = value;
  }
});

test('ringFor and turnRate', () => {
  assert.equal(ringFor(0, [2, 4, 8]), 0);
  assert.equal(ringFor(4, [2, 4, 8]), 1);
  assert.equal(ringFor(9, [2, 4, 8]), -1);
  const a = { x: 0, y: 0, z: -1 };
  const b = { x: Math.sin(Math.PI / 18), y: 0, z: -Math.cos(Math.PI / 18) }; // 10 degrees
  assert.ok(Math.abs(turnRate(a, b, 0.1) - 100) < 1e-6);
  assert.equal(turnRate(null, b, 0.1), 0);
});

test('a solved launch lands on the target', async () => {
  const { solveLaunch } = await import('../common/aim-cone.js');
  const g = 9.8;
  const from = { x: 0, y: 1.5, z: 0 };
  for (const [to, speed] of [[{ x: 3, y: 1, z: -6 }, 9], [{ x: 0, y: 4, z: -3 }, 10], [{ x: -8, y: 0, z: -8 }, 2]]) {
    const v = solveLaunch(from, to, speed, g);
    // Fly it: when it has covered the horizontal distance, it is at the target's height.
    const dh = Math.hypot(to.x - from.x, to.z - from.z);
    const vh = Math.hypot(v.x, v.z);
    const t = dh / vh;
    const y = from.y + v.y * t - 0.5 * g * t * t;
    assert.ok(Math.abs(y - to.y) < 1e-6, `lands at height ${to.y}, got ${y}`);
    assert.ok(Math.abs(v.x / vh - (to.x - from.x) / dh) < 1e-9, 'heads toward it');
  }
});

test('throw assist leaves a throw alone at 0 and lands it at 1', async () => {
  const { assistThrow } = await import('../common/aim-cone.js');
  const v = { x: 1, y: 2, z: -5 };
  assert.deepEqual(assistThrow({ x: 0, y: 0, z: 0 }, v, { x: 4, y: 0, z: -4 }, 0), v);
  const full = assistThrow({ x: 0, y: 0, z: 0 }, v, { x: 4, y: 0, z: -4 }, 1);
  assert.ok(full.x > 0 && full.z < 0);
  assert.ok(Math.abs(full.x + full.z) < 1e-9, 'aims along the diagonal');
});
