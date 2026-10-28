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

// Whether a touch-opened menu in auto mode should close: the hand that
// opened it has been further than `options.distance` from what it touched
// for `options.delay` ms. A short delay rather than none, so a hand that
// wobbles past the edge while you read is not punished; and the clock
// restarts whenever the hand comes back. Returns the new `awaySince` (null
// while the hand is near) and whether to close now.
export function chooseAutoClose(awaySince, distance, now, options) {
  if (!(distance > options.distance)) return { awaySince: null, close: false };
  var since = awaySince === null || awaySince === undefined ? now : awaySince;
  return { awaySince: since, close: now - since >= options.delay };
}

// Whether a menu closes when the hand that opened it goes away: the
// player's preference ('stay', 'close'), or the menu's own default when the
// player has left it to each menu ('menu').
export function resolveAutoClose(menuDefault, preference) {
  if (preference === 'close') return true;
  if (preference === 'stay') return false;
  return Boolean(menuDefault);
}
