// Pure per-arm "swing" phase tracking: no AFRAME/THREE dependency, just a
// forward/backward offset number per arm, so it's unit testable
// (tests/arm-swing.test.js) independent of how that offset gets measured --
// today a WebXR-tracked wrist or Touch controller position relative to an
// approximated shoulder (see arm-swing-locomotion.js), but the same
// reducer works for any source that can produce "how far forward or
// behind the body is this arm right now".
//
// This is a different shape of building block than common/hand-gestures.js:
// that one classifies a HAND SHAPE at a single instant (pinch, fist, ...);
// this one classifies a MOTION PATTERN over time (swinging), so it carries
// state across frames instead of being a single stateless classification.

export var ARM_SWING_DEFAULTS = {
  // Meters of forward/backward offset from the shoulder past which an arm
  // counts as having swung "back" (armed, ready for its next step) or
  // "forward" (far enough to actually take a step). A resting, un-swung
  // arm hanging at your side should read well inside this deadzone --
  // widen it if just standing still is ever misread as swinging.
  armThreshold: 0.16,
};

// state: { armed: boolean } -- true once this arm has swung back far
// enough to arm its next forward swing.
//
// `forwardOffset`/`otherArmForwardOffset` are both measured the same way:
// meters along the player's current forward direction, from an
// approximated shoulder position to the hand, for this arm and the
// opposite one respectively.
//
// Returns { armed, stepped }. `stepped` is true only on the exact call
// this arm's forward swing fires -- it was armed, it just crossed the
// forward threshold, AND the other arm is *currently* back. That
// bilateral-alternation gate is the one that matters most: real walking
// swings the two arms in opposite phase, so requiring it is what keeps a
// single raised, reaching, or gesturing arm from ever registering as a
// step on its own -- see the design discussion in the repo history for
// why this was chosen over a single-arm threshold.
export function updateArmSwingState(state, forwardOffset, otherArmForwardOffset, config) {
  var cfg = Object.assign({}, ARM_SWING_DEFAULTS, config || {});
  var armed = state.armed;
  var stepped = false;

  if (forwardOffset <= -cfg.armThreshold) {
    armed = true;
  } else if (armed && forwardOffset >= cfg.armThreshold) {
    stepped = otherArmForwardOffset <= -cfg.armThreshold;
    armed = false;
  }

  return { armed: armed, stepped: stepped };
}
