import assert from 'node:assert/strict';
import test from 'node:test';

import { launchAngle, solveAtAngle, solveAtSpeed, aimThrow, leadTarget, positionAt, DEFAULT_THROW } from '../common/throw-solve.js';

const v = (x, y, z) => ({ x, y, z });
const G = 9.8;
const DEG = Math.PI / 180;

// Fly a launch until it comes back down through the target's height
// (or past it horizontally) and return how far from the target it is.
function missBy(from, vel, to, g = G) {
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const vh = Math.hypot(vel.x, vel.z);
  const t = d / vh;
  const p = positionAt(from, vel, t, g);
  return Math.hypot(p.x - to.x, p.y - to.y, p.z - to.z);
}

test('the swing picks the arc: rising lobs, falling goes flat', () => {
  assert.ok(Math.abs(launchAngle(1) - DEFAULT_THROW.steepDeg * DEG) < 1e-9);
  assert.ok(Math.abs(launchAngle(-1) - DEFAULT_THROW.flatDeg * DEG) < 1e-9);
  assert.ok(launchAngle(0.3) > launchAngle(-0.2));
});

test('solveAtAngle lands within a centimetre at 3-12 m, up or down', () => {
  const from = v(0.2, 1.8, 0);
  for (const to of [v(0, 1.2, -3), v(1, 1.0, -6), v(-2, 0.5, -12), v(0, 2.2, -5)]) {
    const vel = solveAtAngle(from, to, 25 * DEG, G);
    assert.ok(vel, JSON.stringify(to));
    assert.ok(missBy(from, vel, to) < 0.01, JSON.stringify(to));
  }
  // Too high for a flat angle: no solution.
  assert.equal(solveAtAngle(from, v(0, 6, -2), 10 * DEG, G), null);
});

test('solveAtSpeed takes the flat arc, and falls short honestly when out of range', () => {
  const from = v(0, 1.8, 0);
  const to = v(0, 1.0, -8);
  const vel = solveAtSpeed(from, to, 12, G);
  assert.equal(vel.reaches, true);
  assert.ok(missBy(from, vel, to) < 0.01);
  assert.ok(vel.y / 12 < Math.sin(30 * DEG), 'the flat solution');
  const weak = solveAtSpeed(from, v(0, 1, -40), 8, G);
  assert.equal(weak.reaches, false);
});

test('aimThrow uses the swing angle when the arm can, else the flattest arc it can make', () => {
  const from = v(0.2, 1.9, 0);
  const near = aimThrow(from, v(0, 1.1, -5), { rise: 0, handSpeed: 4 });
  assert.equal(near.reaches, true);
  assert.ok(missBy(from, near.velocity, v(0, 1.1, -5)) < 0.01);
  // A weak flick at something far: capped speed, still aimed, falls short.
  const far = aimThrow(from, v(0, 1.1, -30), { rise: 0, handSpeed: 1, maxSpeed: 14 });
  assert.equal(far.reaches, false);
  assert.ok(far.speed <= 14 * 0.25 + 1e-9);
});

test('leading a moving target hits where it will be', () => {
  const from = v(0, 1.8, 0);
  const pos = v(-1, 1.1, -6);
  const vel = v(1.2, 0, 0); // walking across at 1.2 m/s
  const shot = leadTarget(from, pos, vel, { rise: 0, handSpeed: 4 });
  const t = Math.hypot(shot.aim.x - from.x, shot.aim.z - from.z) / Math.hypot(shot.velocity.x, shot.velocity.z);
  const target = v(pos.x + vel.x * t, pos.y, pos.z + vel.z * t);
  assert.ok(missBy(from, shot.velocity, target) < 0.05, JSON.stringify(shot.aim));
  assert.ok(shot.aim.x > pos.x, 'aimed ahead of it');
});

import { planGuided, guidedPosition } from '../common/throw-solve.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('a guided throw ends exactly on the target, wherever it went', () => {
  const from = v(0.2, 1.8, 0);
  const plan = planGuided(from, v(0, 1.1, -8), v(0, 0, 0), { rise: 0, handSpeed: 4 });
  // It didn't move.
  assert.ok(dist(guidedPosition(plan, plan.T, v(0, 1.1, -8)), v(0, 1.1, -8)) < 1e-9);
  // It ducked and slid a metre sideways mid-flight.
  assert.ok(dist(guidedPosition(plan, plan.T, v(1, 0.6, -8)), v(1, 0.6, -8)) < 1e-9);
});

test('a guided throw starts at the hand and leaves along the solved arc', () => {
  const from = v(0.2, 1.8, 0);
  const plan = planGuided(from, v(0, 1.1, -8), v(0, 0, 0), { rise: 0, handSpeed: 4 });
  assert.ok(dist(guidedPosition(plan, 0, v(3, 1, -8)), from) < 1e-9);
  // Early on, the correction is still tiny.
  const early = guidedPosition(plan, plan.T * 0.05, v(3, 1, -8));
  const ballistic = positionAt(plan.from, plan.velocity, plan.T * 0.05, plan.g);
  assert.ok(dist(early, ballistic) < 0.03, String(dist(early, ballistic)));
});

test('a weak throw at something out of range still arrives, guided', () => {
  const from = v(0, 1.8, 0);
  const target = v(0, 1.1, -40);
  const plan = planGuided(from, target, v(0, 0, 0), { rise: 0, handSpeed: 1, maxSpeed: 10 });
  assert.equal(plan.reaches, false);
  assert.ok(dist(guidedPosition(plan, plan.T, target), target) < 1e-9);
});
