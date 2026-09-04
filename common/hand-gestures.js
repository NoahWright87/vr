// Pure hand-pose classification: no AFRAME/THREE/WebXR dependency, just
// angles, so it can be unit tested directly (see tests/hand-gestures.test.js)
// and reused by anything that can hand it a few joint-derived numbers --
// this repo's WebXR hand tracking today, but just as easily a future
// video-based or glove-based hand tracker with a different pose source.
//
// The gesture is a "finger gun": point your index finger and cock your
// thumb up like a hammer to aim (mirrors gripping a real Touch controller
// to point), then drop the thumb until it's roughly parallel with the
// index finger to fire (mirrors pulling the trigger).

export function angleBetweenDegrees(ax, ay, az, bx, by, bz) {
  var aLength = Math.hypot(ax, ay, az);
  var bLength = Math.hypot(bx, by, bz);
  if (!aLength || !bLength) return 0;
  var dot = (ax * bx + ay * by + az * bz) / (aLength * bLength);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

export var FINGER_GUN_DEFAULTS = {
  maxIndexCurlDegrees: 40,
  minThumbCockedDegrees: 45,
  maxHammerDroppedDegrees: 25,
};

// Is the index finger straight enough, and the thumb held far enough away
// from it, to read as a cocked finger gun? `indexCurlDegrees` is the angle
// between the finger's two segments (0 when perfectly straight, larger the
// more it's curled into a fist); `thumbIndexAngleDegrees` is the angle
// between the thumb's direction and the index finger's pointing direction
// (large -- close to a right angle -- when the thumb is cocked up and
// away, small when it's tucked alongside the index finger).
export function isFingerGunPose(indexCurlDegrees, thumbIndexAngleDegrees, config) {
  var cfg = config || {};
  var maxCurl = cfg.maxIndexCurlDegrees != null ? cfg.maxIndexCurlDegrees : FINGER_GUN_DEFAULTS.maxIndexCurlDegrees;
  var minThumb = cfg.minThumbCockedDegrees != null ? cfg.minThumbCockedDegrees : FINGER_GUN_DEFAULTS.minThumbCockedDegrees;
  return indexCurlDegrees <= maxCurl && thumbIndexAngleDegrees >= minThumb;
}

// Has the thumb dropped from "cocked" to roughly parallel with the index
// finger -- the "hammer falling" motion that fires. Only meaningful while
// isFingerGunPose is (or very recently was) true; a small hysteresis gap
// between minThumbCockedDegrees and maxHammerDroppedDegrees keeps a thumb
// hovering right at the boundary from rapidly flickering fired/not-fired.
export function isHammerDropped(thumbIndexAngleDegrees, config) {
  var cfg = config || {};
  var maxDropped = cfg.maxHammerDroppedDegrees != null ? cfg.maxHammerDroppedDegrees : FINGER_GUN_DEFAULTS.maxHammerDroppedDegrees;
  return thumbIndexAngleDegrees <= maxDropped;
}
