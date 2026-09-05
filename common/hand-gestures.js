// Pure hand-pose classification: no AFRAME/THREE/WebXR dependency, just
// angles and a distance, so it can be unit tested directly (see
// tests/hand-gestures.test.js) and reused by anything that can hand it a
// few joint-derived numbers -- this repo's WebXR hand tracking today, but
// just as easily a future video-based or glove-based hand tracker with a
// different pose source.
//
// This is meant to grow into a small shared catalog of "canonical" hand
// gestures -- the hand-tracking equivalent of a gamepad's fixed button
// layout -- so a game maps its own actions onto a gesture NAME (`pinch`,
// `finger-gun`, ...) the same way it'd map them onto a button index,
// without needing to know how that gesture was actually recognized.

export function angleBetweenDegrees(ax, ay, az, bx, by, bz) {
  var aLength = Math.hypot(ax, ay, az);
  var bLength = Math.hypot(bx, by, bz);
  if (!aLength || !bLength) return 0;
  var dot = (ax * bx + ay * by + az * bz) / (aLength * bLength);
  return (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
}

export var GESTURES = {
  NONE: 'none',
  PINCH: 'pinch',
  OK: 'ok',
  FIST: 'fist',
  FINGER_GUN: 'finger-gun',
  FINGER_GUN_FIRED: 'finger-gun-fired',
  THUMBS_UP: 'thumbs-up',
  THUMBS_DOWN: 'thumbs-down',
};

// A human (and a little playful) label for each canonical gesture, for
// anything that wants to display what was recognized -- see
// hand-gesture-label in hand-tracking.js.
export var GESTURE_LABELS = {
  none: 'Relaxed',
  pinch: 'Pinch',
  ok: 'Okay 👌',
  fist: 'Fist ✊',
  'finger-gun': 'Finger Gun',
  'finger-gun-fired': 'Finger Gun 🔥',
  'thumbs-up': 'Thumbs Up 👍',
  'thumbs-down': 'Thumbs Down 👎',
};

export var HAND_GESTURE_DEFAULTS = {
  // A finger reading at or below this angle (between its two tracked
  // segments) counts as "extended"; at or above the higher curledMin
  // threshold it counts as "curled". The gap between the two is
  // hysteresis, so a finger resting right at the boundary doesn't
  // flicker between the two every frame.
  curledMaxDegrees: 40,
  curledMinDegrees: 55,
  // Thumb-tip-to-index-tip distance (meters) at or below which the two
  // are considered "touching", the shared shape behind both pinch and OK.
  pinchMaxDistance: 0.025,
  // Thumb-to-index-finger angle at or below which the thumb reads as
  // having dropped to fire a cocked finger gun.
  maxHammerDroppedDegrees: 25,
  // How close to straight up/down (from world +Y) the thumb needs to
  // point to read as a thumbs-up/thumbs-down, rather than some other
  // fist-with-thumb-out pose.
  thumbAlignMaxDegrees: 40,
};

function isExtended(curlDegrees, config) {
  return curlDegrees <= config.curledMaxDegrees;
}

function isCurled(curlDegrees, config) {
  return curlDegrees >= config.curledMinDegrees;
}

// `measurements`:
//   curl: { thumb, index, middle, ring, pinky } -- degrees, each finger's
//     own two-segment bend angle (0 straight, larger the more it's curled)
//   thumbIndexDistance -- meters between the thumb tip and index tip
//   thumbIndexAngleDegrees -- angle between the thumb's direction and the
//     index finger's pointing direction
//   thumbWorldUpAngleDegrees -- angle between the thumb's direction and
//     world +Y (0 = straight up, 180 = straight down)
export function classifyHandGesture(measurements, config) {
  var cfg = Object.assign({}, HAND_GESTURE_DEFAULTS, config || {});
  var curl = measurements.curl;

  var indexExtended = isExtended(curl.index, cfg);
  var indexCurled = isCurled(curl.index, cfg);
  var othersCurled = isCurled(curl.middle, cfg) && isCurled(curl.ring, cfg) && isCurled(curl.pinky, cfg);
  var othersExtended = isExtended(curl.middle, cfg) && isExtended(curl.ring, cfg) && isExtended(curl.pinky, cfg);
  var thumbExtended = isExtended(curl.thumb, cfg);
  var thumbCurled = isCurled(curl.thumb, cfg);

  var touching = measurements.thumbIndexDistance <= cfg.pinchMaxDistance;
  if (touching && othersExtended) return GESTURES.OK;
  if (touching) return GESTURES.PINCH;

  if (indexExtended && othersCurled) {
    return measurements.thumbIndexAngleDegrees <= cfg.maxHammerDroppedDegrees
      ? GESTURES.FINGER_GUN_FIRED
      : GESTURES.FINGER_GUN;
  }

  if (indexCurled && othersCurled) {
    if (thumbExtended) {
      if (measurements.thumbWorldUpAngleDegrees <= cfg.thumbAlignMaxDegrees) return GESTURES.THUMBS_UP;
      if (measurements.thumbWorldUpAngleDegrees >= 180 - cfg.thumbAlignMaxDegrees) return GESTURES.THUMBS_DOWN;
    } else if (thumbCurled) {
      return GESTURES.FIST;
    }
  }

  return GESTURES.NONE;
}

// Which canonical gestures should drive the shared grip/trigger action
// vocabulary (see hand-tracking.js) -- the ones that mean "hold" and
// "activate". Kept as simple data rather than baked into the component so
// a consumer can see, in one place, exactly which recognized shapes turn
// into which button-shaped signal.
export function gestureDrivesGrip(gesture) {
  return (
    gesture === GESTURES.PINCH ||
    gesture === GESTURES.FIST ||
    gesture === GESTURES.FINGER_GUN ||
    gesture === GESTURES.FINGER_GUN_FIRED
  );
}

export function gestureDrivesTrigger(gesture) {
  return gesture === GESTURES.FINGER_GUN_FIRED;
}
