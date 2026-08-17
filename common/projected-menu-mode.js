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
