import { dot, sub, unit, length } from '../../common/hand-gestures.js';

export const LIGHTNING_AIM = { coneDegrees: 8, arcDegrees: 14, arcMiss: .65, range: 70 };

// Rank by angular distance to the actual finger aim, then by range. World
// visibility is supplied by the renderer so hidden/occluded targets cannot win.
export function selectLightningTarget(origin, aim, targets, options = LIGHTNING_AIM) {
  const direction = unit(aim);
  const matches = [];
  for (const target of targets) {
    if (target.visible === false) continue;
    const offset = sub(target.center, origin), range = length(offset), along = dot(offset, direction);
    if (along <= 0 || range > options.range || range < .001) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, along / range))) * 180 / Math.PI;
    const miss = Math.max(0, Math.sqrt(Math.max(0, range * range - along * along)) - (target.radius || 0));
    const cone = angle <= options.coneDegrees;
    if (!cone && !(angle <= options.arcDegrees && miss <= options.arcMiss)) continue;
    matches.push({ target, angle, range, kind: cone ? 'assist' : 'arc' });
  }
  matches.sort((a, b) => a.angle - b.angle || a.range - b.range);
  return matches[0] || null;
}
