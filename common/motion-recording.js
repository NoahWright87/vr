// Pure logic for the gesture recorder (see common/gesture-recorder.js) --
// no AFRAME/THREE dependency, same split as arm-swing.js/hand-gestures.js,
// so it's unit-testable and reusable if a future page wants its own
// take on recording raw motion.

// Sampling at ~25Hz (not the ~90Hz WebXR delivers every tick) is plenty of
// resolution for voluntary arm/hand motion -- it tops out around 8-10Hz --
// and it also acts as a cheap smoothing pass over frame-to-frame joint
// jitter, which is exactly what a template/threshold fit from recorded
// clips wants. stillnessSpeedThreshold/stillnessGapMs are first guesses,
// not tuned constants -- figuring out real values from real recordings is
// the whole point of this tool.
export var MOTION_RECORDING_DEFAULTS = {
  sampleIntervalMs: 40,
  stillnessSpeedThreshold: 0.15,
  stillnessGapMs: 400,
  minClipDurationMs: 150,
};

export function createRecordingSegmenterState() {
  return { inClip: false, stillnessMs: 0 };
}

// One tick of the auto-segmentation state machine: a clip starts the
// instant either hand's speed crosses the stillness threshold, and ends
// once it's stayed below that threshold continuously for stillnessGapMs --
// a brief dip that doesn't reach the gap (pausing mid-motion, easing
// through a transition) resets the stillness clock instead of splitting
// the clip. Pure function of (state, speed, deltaMs, config) -> next
// state, mirroring updateArmSwingState's shape in arm-swing.js.
export function updateRecordingSegmenter(state, speed, deltaMs, config) {
  var moving = speed >= config.stillnessSpeedThreshold;
  var next = {
    inClip: state.inClip,
    stillnessMs: moving ? 0 : state.stillnessMs + Math.max(0, deltaMs || 0),
    justStarted: false,
    justEnded: false,
  };
  if (moving) {
    if (!state.inClip) {
      next.inClip = true;
      next.justStarted = true;
    }
  } else if (state.inClip && next.stillnessMs >= config.stillnessGapMs) {
    next.inClip = false;
    next.justEnded = true;
  }
  return next;
}
