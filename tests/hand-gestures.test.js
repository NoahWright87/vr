import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleBetweenDegrees,
  isFingerGunPose,
  isHammerDropped,
} from '../common/hand-gestures.js';

test('angleBetweenDegrees reads parallel, perpendicular, and opposite vectors', () => {
  assert.equal(angleBetweenDegrees(1, 0, 0, 1, 0, 0), 0);
  assert.equal(angleBetweenDegrees(1, 0, 0, 0, 1, 0), 90);
  assert.equal(angleBetweenDegrees(1, 0, 0, -1, 0, 0), 180);
});

test('angleBetweenDegrees treats a zero-length vector as no angle rather than NaN', () => {
  assert.equal(angleBetweenDegrees(0, 0, 0, 1, 0, 0), 0);
});

test('a straight index finger with the thumb cocked away from it reads as a finger gun', () => {
  assert.equal(isFingerGunPose(5, 80), true);
});

test('a curled index finger does not read as a finger gun even with the thumb cocked', () => {
  assert.equal(isFingerGunPose(90, 80), false);
});

test('a straight index finger with the thumb tucked alongside it is not cocked', () => {
  assert.equal(isFingerGunPose(5, 10), false);
});

test('the hammer is dropped once the thumb swings down near parallel with the index finger', () => {
  assert.equal(isHammerDropped(10), true);
  assert.equal(isHammerDropped(80), false);
});

test('custom thresholds are honored instead of the defaults', () => {
  assert.equal(isFingerGunPose(50, 60, { maxIndexCurlDegrees: 60, minThumbCockedDegrees: 60 }), true);
  assert.equal(isHammerDropped(30, { maxHammerDroppedDegrees: 35 }), true);
});
