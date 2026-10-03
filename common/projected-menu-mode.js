export function chooseProjectedMenuMode(previousMode, dotUp, dotCam, options) {
  var faceupThreshold = options.faceupThreshold;
  var facecamThreshold = options.facecamThreshold;
  var hysteresis = options.hysteresis;

  if (previousMode === 'laser') {
    if (dotUp > faceupThreshold - hysteresis) return 'laser';
  } else if (previousMode === 'poke') {
    if (dotUp > faceupThreshold + hysteresis) return 'laser';
    if (dotCam > facecamThreshold - hysteresis) return 'poke';
  }

  if (dotUp > faceupThreshold) return 'laser';
  if (dotCam > facecamThreshold) return 'poke';
  return null;
}

export function chooseAutomaticMenuIntent(interactionMode, pose, options) {
  if (pose.distance > options.closeDistance) return 'close';

  if (interactionMode !== 'auto') return 'open';

  // The face-up pose is the larger pointing screen. Crossing into it must
  // not itself change whether the menu is open; it only changes its layout.
  if (pose.dotUp > options.faceupThreshold) return 'hold';
  if (pose.dotCam > options.facecamThreshold) return 'open';
  return 'close';
}
