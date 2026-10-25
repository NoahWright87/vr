import assert from 'node:assert/strict';
import test from 'node:test';

import { createField, emitParticle, stepField, createTracers, addTracer, stepTracers } from '../common/action-effects.js';
import { scheduleHaptic, HAPTIC_PATTERNS } from '../common/action-feedback.js';

test('a full field drops new particles instead of stealing live ones', () => {
  const f = createField(2);
  assert.equal(emitParticle(f, { x: 0, y: 1, z: 0 }), 0);
  assert.equal(emitParticle(f, { x: 0, y: 1, z: 0 }), 1);
  assert.equal(emitParticle(f, { x: 0, y: 1, z: 0 }), -1);
  assert.equal(f.count, 2);
});

test('particles fall, land on the floor, settle, and are removed when their life ends', () => {
  const f = createField(4);
  emitParticle(f, { x: 0, y: 1, z: 0, vy: 0, life: 3, size: 0.1 });
  for (let i = 0; i < 120; i++) stepField(f, 1 / 60, { gravity: 9.8, floorY: 0, bounce: 0.3 });
  assert.equal(f.count, 1);
  assert.ok(Math.abs(f.py[0] - 0.05) < 1e-6, `rests on its half-size: ${f.py[0]}`);
  assert.equal(f.rest[0], 1);
  for (let i = 0; i < 70; i++) stepField(f, 1 / 60);
  assert.equal(f.count, 0);
});

test('removing a dead particle keeps the live ones contiguous and intact', () => {
  const f = createField(3);
  emitParticle(f, { x: 1, y: 5, z: 0, life: 0.05 });
  emitParticle(f, { x: 2, y: 5, z: 0, life: 10 });
  emitParticle(f, { x: 3, y: 5, z: 0, life: 10 });
  stepField(f, 0.1, { gravity: 0 });
  assert.equal(f.count, 2);
  assert.deepEqual([...f.px.slice(0, 2)].sort(), [2, 3]);
});

test('a hard landing bounces before it rests', () => {
  const f = createField(1);
  emitParticle(f, { x: 0, y: 0.5, z: 0, vy: -6, life: 5, size: 0 });
  stepField(f, 0.1, { gravity: 0, bounce: 0.5 });
  assert.ok(f.vy[0] > 0, 'moving back up');
  assert.equal(f.rest[0], 0);
});

test('tracers age out, and the oldest goes first when the buffer is full', () => {
  const t = createTracers(2);
  const c = { r: 1, g: 1, b: 1 };
  addTracer(t, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0.1, c);
  addTracer(t, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, 0.1, c);
  addTracer(t, { x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, 0.1, c);
  assert.deepEqual(t.items.map((i) => i.bx), [2, 3]);
  stepTracers(t, 0.2);
  assert.equal(t.items.length, 0);
});

test('haptic patterns schedule pulses after their gaps, scaled and capped', () => {
  const pulses = scheduleHaptic('hit-heavy', 1);
  assert.deepEqual(pulses, [
    { at: 0, intensity: 1, duration: 55 },
    { at: 80, intensity: 0.5, duration: 40 },
  ]);
  assert.equal(scheduleHaptic('hit-heavy', 2)[1].intensity, 1);
  assert.equal(scheduleHaptic('nope').length, 0);
  Object.keys(HAPTIC_PATTERNS).forEach((name) => assert.ok(scheduleHaptic(name).length > 0, name));
});
