import { isInsideBoundary } from './play-space.js';

const PI = Math.PI;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const cross = (a, b) => a.x * b.z - a.z * b.x;
const direction = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

export function rayBoundary(position, heading, polygon) {
  const forward = direction(heading);
  let nearest = null;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) area += cross(polygon[i], polygon[(i + 1) % polygon.length]);
  const winding = area >= 0 ? 1 : -1;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const edge = { x: b.x - a.x, z: b.z - a.z }, length = Math.hypot(edge.x, edge.z);
    if (length < 1e-7) continue;
    const normal = { x: -edge.z / length * winding, z: edge.x / length * winding };
    // Only the wall we're approaching, including at corners. A nearby wall
    // we're leaving must not compete with the actual obstacle ahead.
    if (forward.x * normal.x + forward.z * normal.z >= -1e-6) continue;
    const denominator = cross(forward, edge);
    if (Math.abs(denominator) < 1e-8) continue;
    const offset = { x: a.x - position.x, z: a.z - position.z };
    const distance = cross(offset, edge) / denominator, along = cross(offset, forward) / denominator;
    if (distance < -1e-7 || along < -1e-7 || along > 1 + 1e-7) continue;
    if (!nearest || distance < nearest.distance) nearest = { distance: Math.max(0, distance), normal, edge: i,
      point: { x: position.x + forward.x * distance, z: position.z + forward.z * distance } };
  }
  return nearest;
}

// Edge clearance is only a secondary preference. The overlap planner owns
// the rotation goal; an attractive real path cannot sacrifice usable floor.
export function planGuidance(position, heading, speed, context, settings, planner, time, preferredSide = 1) {
  const empty = { valid: false, urgency: 0, wallDistance: null, wallError: 0, correction: 0,
    overlap: null, bestOverlap: null, minimumOverlap: 0, desiredHeading: heading, hit: null, reason: 'Boundary unavailable' };
  const polygon = context?.boundary;
  if (!polygon || polygon.length < 3 || !Number.isFinite(heading)) return empty;
  if (!isInsideBoundary(position, polygon)) return { ...empty, reason: 'Outside boundary' };
  const wall = rayBoundary(position, heading, polygon);
  if (!wall) return empty;
  const horizon = settings.wallMargin + Math.max(.6, speed) * settings.lookAhead;
  // A stationary glance is not evidence that the player will walk toward
  // that wall. Use stationary turns for alignment, rather than chasing gaze.
  const approach = speed > .15 ? Math.max(0, Math.min(1,
    (horizon - wall.distance) / Math.max(.1, horizon - settings.wallMargin))) : 0;
  const urgency = approach * approach * (3 - 2 * approach);
  const clearance = delta => {
    const candidate = wrap(heading - delta);
    return Math.min(...[-PI / 18, 0, PI / 18].map(offset => rayBoundary(position, candidate + offset, polygon)?.distance ?? 0));
  };
  const goal = planner.sample(position, context, time, { heading, urgency, clearance, preferredSide });
  if (goal.overlap === null) return { ...empty, reason: 'No active walkable area' };
  return { valid: true, urgency, wallDistance: wall.distance, wallError: goal.correction, ...goal,
    desiredHeading: wrap(heading - goal.correction), hit: wall.point, areaId: context.area.id, areaFootprint: context.area.floor.points,
    reason: Math.abs(goal.correction) > .001 ? 'Maximize floor overlap' : goal.overlap > .999 ? 'Full floor overlap' : 'No improving turn available' };
}
