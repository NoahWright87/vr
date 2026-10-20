import assert from 'node:assert/strict';
import test from 'node:test';

import { detectSwat, detectMeet, registerCounter, chooseCounter, listCounters, DEFAULT_COUNTERS } from '../common/counters.js';

const v = (x, y, z) => ({ x, y, z });
const S = DEFAULT_COUNTERS;
// A punch coming at you along +Z (from an attacker at -Z).
const LINE = v(0, 0, 1);

test('a hand sweeping sideways across a punch is a swat, pushing the way it swept', () => {
  const right = detectSwat(v(2, 0, 0.2), LINE, S);
  assert.ok(right && right.score > 0.5, JSON.stringify(right));
  // Perpendicular to +Z, toward +X.
  assert.ok(right.push.x > 0.99 && Math.abs(right.push.z) < 1e-9, JSON.stringify(right.push));
  const left = detectSwat(v(-2, 0, 0), LINE, S);
  assert.ok(left.push.x < -0.99);
});

test('too slow, or mostly along the punch, is not a swat', () => {
  assert.equal(detectSwat(v(0.5, 0, 0), LINE, S), null);
  assert.equal(detectSwat(v(0.5, 0, -2), LINE, S), null);
});

test('vertical motion does not count toward a swat', () => {
  assert.equal(detectSwat(v(0.3, -3, 0), LINE, S), null);
});

test('a hand driving back along the punch meets it head-on', () => {
  const m = detectMeet(v(0, 0, -2.5), 2.5, LINE, S);
  assert.ok(m && m.score > 0.5, JSON.stringify(m));
  assert.equal(detectMeet(v(0, 0, 2.5), 2.5, LINE, S), null, 'moving with it is not meeting it');
  assert.equal(detectMeet(v(0, 0, -1), 1, LINE, S), null, 'too slow');
});

test('the registry picks the best-scoring move, and new moves slot in', () => {
  const before = listCounters().length;
  registerCounter({ id: 'test-duck', detect: (ctx) => (ctx.body.duck ? { score: 0.99 } : null), perform: () => ({}) });
  const ctx = (vel, duck) => ({ hand: { velocity: vel, speed: Math.hypot(vel.x, vel.y, vel.z) }, line: { dir: LINE }, body: { duck } });
  assert.equal(chooseCounter(ctx(v(2.4, 0, 0), false), S).counter.id, 'swat');
  assert.equal(chooseCounter(ctx(v(0, 0, -3), false), S).counter.id, 'meet');
  assert.equal(chooseCounter(ctx(v(1.8, 0, 0), true), S).counter.id, 'test-duck');
  assert.equal(chooseCounter(ctx(v(0, 0, 0), false), S), null);
  // Re-registering an id replaces it rather than adding another.
  registerCounter({ id: 'test-duck', detect: () => null, perform: () => ({}) });
  assert.equal(listCounters().length, before + 1);
});
