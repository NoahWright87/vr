import assert from 'node:assert/strict';
import test from 'node:test';

import { stepHandOffset, grantYaw, grantMove, energyFactor, DEFAULT_BUDGET } from '../common/comfort-budget.js';

const ZERO = { x: 0, y: 0, z: 0 };
const AWAY = { x: 0, y: 0, z: -0.1 }; // assist wants the hand 10 cm further forward
const len = (v) => Math.hypot(v.x, v.y, v.z);

test('a still hand gets no drift however much is requested', () => {
  const r = stepHandOffset(ZERO, AWAY, 0, 1, DEFAULT_BUDGET);
  assert.equal(r.granted, 0);
  assert.deepEqual(r.offset, ZERO);
  assert.ok(Math.abs(r.wanted - 0.1) < 1e-9);
});

test('a moving hand with low energy (a slow reach) gets no drift away', () => {
  const r = stepHandOffset(ZERO, AWAY, 0.05, 0.1, DEFAULT_BUDGET);
  assert.equal(r.granted, 0);
});

test('a fast punch earns drift in proportion to how far the hand moved', () => {
  // A frame of a 4 m/s jab at 72 Hz: about 5.5 cm of travel, full energy.
  const r = stepHandOffset(ZERO, AWAY, 0.055, 1, DEFAULT_BUDGET);
  assert.ok(Math.abs(r.granted - 0.055 * DEFAULT_BUDGET.handGain) < 1e-9, String(r.granted));
  // Over a few frames of the punch it reaches the full request.
  let off = ZERO;
  for (let i = 0; i < 6; i++) off = stepHandOffset(off, AWAY, 0.055, 1, DEFAULT_BUDGET).offset;
  assert.ok(Math.abs(len(off) - 0.1) < 1e-9);
});

test('returning to the real hand needs motion but not energy', () => {
  const start = { x: 0, y: 0, z: -0.08 };
  assert.equal(stepHandOffset(start, ZERO, 0, 0, DEFAULT_BUDGET).granted, 0);
  const r = stepHandOffset(start, ZERO, 0.02, 0, DEFAULT_BUDGET);
  assert.ok(r.granted > 0 && len(r.offset) < 0.08);
});

test('the offset never exceeds handMax', () => {
  const r = stepHandOffset(ZERO, { x: 0, y: 0, z: -1 }, 2, 1, DEFAULT_BUDGET);
  assert.ok(Math.abs(len(r.offset) - DEFAULT_BUDGET.handMax) < 1e-9);
});

test('master 0 turns every assist off', () => {
  const off = Object.assign({}, DEFAULT_BUDGET, { master: 0, yawGain: 0.3, moveGain: 1 });
  assert.equal(stepHandOffset(ZERO, AWAY, 0.1, 1, off).granted, 0);
  assert.equal(grantYaw(10, 20, off), 0);
  assert.equal(grantMove(1, 1, off), 0);
});

test('view yaw is paid for with head yaw, and is off by default', () => {
  assert.equal(grantYaw(15, 30, DEFAULT_BUDGET), 0);
  const on = Object.assign({}, DEFAULT_BUDGET, { yawGain: 0.2 });
  assert.equal(grantYaw(15, 0, on), 0);
  assert.equal(grantYaw(15, 30, on), 6);
  assert.equal(grantYaw(-15, -30, on), -6);
  assert.equal(grantYaw(2, 30, on), 2);
});

test('energy factor ramps from the floor to full', () => {
  assert.equal(energyFactor(0.1, 0.2), 0);
  assert.equal(energyFactor(1, 0.2), 1);
  assert.ok(Math.abs(energyFactor(0.6, 0.2) - 0.5) < 1e-9);
});
