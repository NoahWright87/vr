export function chooseInteractionCandidate(candidates) {
  var eligible = (candidates || []).filter(function (candidate) {
    return candidate && candidate.eligible !== false;
  });
  if (!eligible.length) return null;

  return eligible.slice().sort(function (a, b) {
    if (Boolean(a.directHit) !== Boolean(b.directHit)) return a.directHit ? -1 : 1;
    var priorityDelta = (b.priority || 0) - (a.priority || 0);
    if (priorityDelta) return priorityDelta;
    var gazeDelta = (b.gazeDot || -1) - (a.gazeDot || -1);
    if (Math.abs(gazeDelta) > 0.000001) return gazeDelta;
    var distanceDelta = (a.distance || 0) - (b.distance || 0);
    if (Math.abs(distanceDelta) > 0.000001) return distanceDelta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  })[0];
}

export function isWithinSemanticReach(distance, maximumReach, allowance) {
  return distance <= maximumReach + (allowance || 0);
}

export function shouldShowInteractionHint(mode, selectedForMs, delayMs) {
  if (mode === 'never') return false;
  if (mode === 'always') return true;
  return selectedForMs >= delayMs;
}
