import test from 'node:test';
import assert from 'node:assert/strict';
import { updateArmSwingState } from '../common/arm-swing.js';

test('an unarmed arm swinging forward does not step, even past the threshold', () => {
  var state = { armed: false };
  var result = updateArmSwingState(state, 0.2, -0.2);
  assert.equal(result.stepped, false);
});

test('swinging back arms the next forward swing, which steps once the other arm is confirmed back', () => {
  var state = { armed: false };
  state = updateArmSwingState(state, -0.2, 0.2); // swings back; arms
  assert.equal(state.armed, true);
  var result = updateArmSwingState(state, 0.2, -0.2); // swings forward, other arm back
  assert.equal(result.stepped, true);
  assert.equal(result.armed, false);
});

test('an idle arm resting well inside the deadzone never arms', () => {
  var state = { armed: false };
  var result = updateArmSwingState(state, -0.05, 0.05);
  assert.equal(result.armed, false);
  assert.equal(result.stepped, false);
});

test('swinging forward while the other arm is also forward does not step, and still disarms', () => {
  var state = { armed: true };
  var result = updateArmSwingState(state, 0.2, 0.2);
  assert.equal(result.stepped, false);
  assert.equal(result.armed, false);
});

test('a swing only steps once -- it has to swing back again before the next one counts', () => {
  var state = { armed: false };
  state = updateArmSwingState(state, -0.2, 0.2);
  state = updateArmSwingState(state, 0.2, -0.2);
  assert.equal(state.stepped, true);
  // Still forward, other arm still back, but this arm never re-armed.
  var result = updateArmSwingState(state, 0.2, -0.2);
  assert.equal(result.stepped, false);
});

test('re-arms and steps again after swinging back a second time', () => {
  var state = { armed: false };
  state = updateArmSwingState(state, -0.2, 0.2);
  state = updateArmSwingState(state, 0.2, -0.2);
  assert.equal(state.stepped, true);
  state = updateArmSwingState(state, -0.2, 0.2);
  assert.equal(state.armed, true);
  var result = updateArmSwingState(state, 0.2, -0.2);
  assert.equal(result.stepped, true);
});

test('custom thresholds are honored instead of the defaults', () => {
  var state = { armed: false };
  state = updateArmSwingState(state, -0.3, 0.3, { armThreshold: 0.25 });
  assert.equal(state.armed, true);
  var notFarEnough = updateArmSwingState(state, 0.2, -0.3, { armThreshold: 0.25 });
  assert.equal(notFarEnough.stepped, false);
  var farEnough = updateArmSwingState(state, 0.3, -0.3, { armThreshold: 0.25 });
  assert.equal(farEnough.stepped, true);
});
