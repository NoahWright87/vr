import test from 'node:test';
import assert from 'node:assert/strict';
import {
  angleBetweenDegrees,
  classifyHandGesture,
  gestureDrivesGrip,
  gestureDrivesTrigger,
  GESTURES,
} from '../common/hand-gestures.js';

test('angleBetweenDegrees reads parallel, perpendicular, and opposite vectors', () => {
  assert.equal(angleBetweenDegrees(1, 0, 0, 1, 0, 0), 0);
  assert.equal(angleBetweenDegrees(1, 0, 0, 0, 1, 0), 90);
  assert.equal(angleBetweenDegrees(1, 0, 0, -1, 0, 0), 180);
});

test('angleBetweenDegrees treats a zero-length vector as no angle rather than NaN', () => {
  assert.equal(angleBetweenDegrees(0, 0, 0, 1, 0, 0), 0);
});

function measurements(overrides) {
  return Object.assign({
    curl: { thumb: 70, index: 70, middle: 70, ring: 70, pinky: 70 },
    thumbIndexDistance: 0.1,
    thumbIndexAngleDegrees: 90,
    thumbWorldUpAngleDegrees: 90,
  }, overrides);
}

test('a relaxed fist with no distinguishing thumb position is not any canonical gesture', () => {
  assert.equal(classifyHandGesture(measurements()), GESTURES.NONE);
});

test('thumb and index touching, other fingers curled, reads as a pinch', () => {
  var m = measurements({ thumbIndexDistance: 0.01 });
  assert.equal(classifyHandGesture(m), GESTURES.PINCH);
});

test('thumb and index touching, other fingers extended, reads as okay instead of a pinch', () => {
  var m = measurements({ thumbIndexDistance: 0.01, curl: { thumb: 70, index: 70, middle: 10, ring: 10, pinky: 10 } });
  assert.equal(classifyHandGesture(m), GESTURES.OK);
});

test('a straight index finger with the rest of the hand curled is a cocked finger gun', () => {
  var m = measurements({
    curl: { thumb: 70, index: 5, middle: 70, ring: 70, pinky: 70 },
    thumbIndexAngleDegrees: 80,
  });
  assert.equal(classifyHandGesture(m), GESTURES.FINGER_GUN);
});

test('a curled index finger does not read as a finger gun even with the rest of the shape right', () => {
  var m = measurements({
    curl: { thumb: 70, index: 90, middle: 70, ring: 70, pinky: 70 },
    thumbIndexAngleDegrees: 80,
  });
  assert.equal(classifyHandGesture(m), GESTURES.NONE);
});

test('the finger gun fires once the thumb drops to roughly parallel with the index finger', () => {
  var m = measurements({
    curl: { thumb: 70, index: 5, middle: 70, ring: 70, pinky: 70 },
    thumbIndexAngleDegrees: 10,
  });
  assert.equal(classifyHandGesture(m), GESTURES.FINGER_GUN_FIRED);
});

test('a fist with the thumb extended and pointing up is a thumbs-up', () => {
  var m = measurements({
    curl: { thumb: 5, index: 70, middle: 70, ring: 70, pinky: 70 },
    thumbWorldUpAngleDegrees: 5,
  });
  assert.equal(classifyHandGesture(m), GESTURES.THUMBS_UP);
});

test('a fist with the thumb extended and pointing down is a thumbs-down', () => {
  var m = measurements({
    curl: { thumb: 5, index: 70, middle: 70, ring: 70, pinky: 70 },
    thumbWorldUpAngleDegrees: 175,
  });
  assert.equal(classifyHandGesture(m), GESTURES.THUMBS_DOWN);
});

test('a fist with the thumb extended sideways is neither thumbs-up nor thumbs-down', () => {
  var m = measurements({
    curl: { thumb: 5, index: 70, middle: 70, ring: 70, pinky: 70 },
    thumbWorldUpAngleDegrees: 90,
  });
  assert.equal(classifyHandGesture(m), GESTURES.NONE);
});

test('custom thresholds are honored instead of the defaults', () => {
  var m = measurements({ thumbIndexDistance: 0.05 });
  assert.equal(classifyHandGesture(m, { pinchMaxDistance: 0.06 }), GESTURES.PINCH);
});

test('pinch and both finger-gun states drive the shared grip signal; okay and thumbs do not', () => {
  assert.equal(gestureDrivesGrip(GESTURES.PINCH), true);
  assert.equal(gestureDrivesGrip(GESTURES.FINGER_GUN), true);
  assert.equal(gestureDrivesGrip(GESTURES.FINGER_GUN_FIRED), true);
  assert.equal(gestureDrivesGrip(GESTURES.OK), false);
  assert.equal(gestureDrivesGrip(GESTURES.THUMBS_UP), false);
  assert.equal(gestureDrivesGrip(GESTURES.NONE), false);
});

test('only a fired finger gun drives the shared trigger signal', () => {
  assert.equal(gestureDrivesTrigger(GESTURES.FINGER_GUN_FIRED), true);
  assert.equal(gestureDrivesTrigger(GESTURES.FINGER_GUN), false);
  assert.equal(gestureDrivesTrigger(GESTURES.PINCH), false);
});
