import assert from 'node:assert/strict';
import test from 'node:test';

import { scoreCandidates, DEFAULT_PROFILES } from '../common/combat-targeting.js';

const v = (x, y, z) => ({ x, y, z });
const FORWARD = v(0, 0, -1);
const GUN = DEFAULT_PROFILES.gun;

function query(extra) {
  return Object.assign({ origin: v(0, 1.5, 0), direction: FORWARD }, extra);
}

test('targets outside the range or the cone are not candidates at all', () => {
  const scored = scoreCandidates([
    { id: 'ahead', point: v(0, 1.5, -5) },
    { id: 'too-far', point: v(0, 1.5, -40) },
    { id: 'behind', point: v(0, 1.5, 5) },
    { id: 'wide', point: v(5, 1.5, -1) }, // ~79° off
  ], query(), GUN);
  assert.deepEqual(scored.map((s) => s.id), ['ahead']);
});

test('a 180° cone accepts anything in range', () => {
  const scored = scoreCandidates([{ id: 'behind', point: v(0, 1.5, 5) }], query(), Object.assign({}, GUN, { coneDeg: 180 }));
  assert.equal(scored.length, 1);
});

test('closer to the aim line wins when nothing else differs', () => {
  const scored = scoreCandidates([
    { id: 'off', point: v(1.5, 1.5, -6) },
    { id: 'on', point: v(0.2, 1.5, -6) },
  ], query(), GUN);
  assert.equal(scored[0].id, 'on');
});

test('stickiness keeps the current target against a slightly better newcomer', () => {
  const candidates = [
    { id: 'current', point: v(0.5, 1.5, -6) },
    { id: 'newcomer', point: v(0.3, 1.5, -6) },
  ];
  assert.equal(scoreCandidates(candidates, query(), GUN)[0].id, 'newcomer');
  assert.equal(scoreCandidates(candidates, query({ current: 'current' }), GUN)[0].id, 'current');
});

test('a target claimed by the other hand is avoided, but not by the hand that claimed it', () => {
  const candidates = [
    { id: 'a', point: v(0, 1.5, -6), claimedBy: 'left' },
    { id: 'b', point: v(0.8, 1.5, -6) },
  ];
  assert.equal(scoreCandidates(candidates, query({ by: 'right' }), GUN)[0].id, 'b');
  assert.equal(scoreCandidates(candidates, query({ by: 'left' }), GUN)[0].id, 'a');
});

test('gaze and recent gaze pull toward what you looked at', () => {
  const candidates = [
    { id: 'aimed', point: v(0.3, 1.5, -6) },
    { id: 'looked', point: v(1.2, 1.5, -6), recent: 1 },
  ];
  const strike = Object.assign({}, DEFAULT_PROFILES.throw, { range: 20, coneDeg: 40 });
  // Looking at 'looked' (and having just looked at it) beats a slightly better aim.
  const q = query({ gazeOrigin: v(0, 1.6, 0), gazeDirection: (() => { const d = v(1.2, -0.1, -6); const l = Math.hypot(d.x, d.y, d.z); return v(d.x / l, d.y / l, d.z / l); })() });
  assert.equal(scoreCandidates(candidates, q, strike)[0].id, 'looked');
});

test('every score carries the terms that made it', () => {
  const [best] = scoreCandidates([{ id: 'a', point: v(0, 1.5, -5), threat: 1, priority: 1 }], query({ current: 'a' }), GUN);
  for (const key of ['aim', 'distance', 'gaze', 'recent', 'sticky', 'threat', 'priority', 'claimed']) assert.ok(key in best.terms, key);
  const sum = Object.values(best.terms).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - best.score) < 1e-9);
});

test('500 targets resolve in well under a millisecond on average', () => {
  const candidates = [];
  for (let i = 0; i < 500; i++) {
    const a = (i / 500) * Math.PI * 2;
    const r = 2 + (i % 20);
    candidates.push({ id: i, point: v(Math.sin(a) * r, 1 + (i % 3) * 0.3, -Math.cos(a) * r), recent: (i % 7) / 7, claimedBy: i % 11 ? null : 'left' });
  }
  const runs = 200;
  const start = performance.now();
  for (let i = 0; i < runs; i++) scoreCandidates(candidates, query({ by: 'right', current: 42 }), GUN);
  const each = (performance.now() - start) / runs;
  assert.ok(each < 1, `${each.toFixed(3)} ms per resolve`);
});
