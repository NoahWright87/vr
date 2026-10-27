import assert from 'node:assert/strict';
import test from 'node:test';

import { STICK_DRIFT, DEFAULT_STICK_DRIFT, getStickDrift, getStickDriftName, setStickDrift } from '../common/stick-drift.js';

test('the default dead zone only counts a stick that is really pushed', () => {
  assert.equal(getStickDriftName(), DEFAULT_STICK_DRIFT);
  const zones = getStickDrift();
  // Well past what a worn stick rests at (0.1-0.3).
  assert.ok(zones.move >= 0.45);
  assert.ok(zones.release > 0.3);
  assert.ok(zones.step > zones.release);
});

test('every preset keeps a menu step above its release, and sizes grow in order', () => {
  const names = Object.keys(STICK_DRIFT);
  for (const name of names) assert.ok(STICK_DRIFT[name].step > STICK_DRIFT[name].release, name);
  for (let i = 1; i < names.length; i++) assert.ok(STICK_DRIFT[names[i]].move > STICK_DRIFT[names[i - 1]].move);
});

test('the setting changes for every reader at once, and old names still work', () => {
  setStickDrift('large');
  assert.equal(getStickDrift(), STICK_DRIFT.large);
  setStickDrift('low');
  assert.equal(getStickDriftName(), 'small');
  setStickDrift('nonsense');
  assert.equal(getStickDriftName(), DEFAULT_STICK_DRIFT);
});
