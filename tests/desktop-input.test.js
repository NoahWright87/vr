import test from 'node:test';
import assert from 'node:assert/strict';
import { chargedActionStrength } from '../common/desktop-action-utils.js';

test('charged desktop actions start useful and ramp linearly to full strength', () => {
  assert.equal(chargedActionStrength(0, 1000, 0.35), 0.35);
  assert.equal(chargedActionStrength(500, 1000, 0.35), 0.675);
  assert.equal(chargedActionStrength(1000, 1000, 0.35), 1);
});

test('charged desktop actions clamp bad and overlong hold durations', () => {
  assert.equal(chargedActionStrength(-100, 900, 0.4), 0.4);
  assert.equal(chargedActionStrength(5000, 900, 0.4), 1);
});
