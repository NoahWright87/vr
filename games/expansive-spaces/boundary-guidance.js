import { isInsideBoundary } from './play-space.js';

const PI = Math.PI;
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const cross = (a, b) => a.x * b.z - a.z * b.x;
const direction = yaw => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

// A room's long axis is equivalent after a half turn. Do not try to undo
// a useful 180-degree turn just to recover the original compass heading.
export function axisError(angle, preferredSide = 1) {
  const error = Math.atan2(Math.sin(2 * angle), Math.cos(2 * angle)) / 2;
  return Math.abs(Math.abs(error) - PI / 2) < .001 ? preferredSide * PI / 2 : error;
}

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

// All geometry and headings are in the raw tracking reference space. The
// caller supplies current-area axes, so a later room change needs no reset
// of the accumulated player transform or this boundary planner.
export function planGuidance(position, heading, speed, context, settings, preferredSide = 1) {
  const empty = { valid: false, urgency: 0, wallDistance: null, wallError: 0, correction: 0,
    alignmentError: 0, desiredHeading: heading, hit: null, reason: 'Boundary unavailable' };
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
  const relativeAxis = context.virtualAxisYaw - context.physicalAxisYaw;
  const alignmentError = Number.isFinite(relativeAxis) && Number.isFinite(context.correctionYaw) ?
    axisError(relativeAxis - context.correctionYaw, preferredSide) : 0;
  const alignmentWeight = Math.max(0, Math.min(1, context.axisWeight ?? 1)) * settings.alignmentStrength;
  let desiredHeading = heading, best = -Infinity;
  if (urgency > 0) {
    // Compare real free paths on either side of the obstacle, rather than
    // always pulling toward a fixed center. The inward-normal term rejects
    // paths which skim the same wall. A tie keeps the previous turn side.
    for (let step = 1; step <= 6; step++) for (const side of [preferredSide, -preferredSide]) {
      const angle = side * step * PI / 6, candidate = wrap(heading + angle), forward = direction(candidate);
      const inward = forward.x * wall.normal.x + forward.z * wall.normal.z;
      if (inward < .15) continue;
      const exit = rayBoundary(position, candidate, polygon);
      if (!exit) continue;
      // Compare clearance across a small cone so a long diagonal through a
      // corner cannot beat a corridor with usable lateral room.
      const left = rayBoundary(position, candidate - PI / 18, polygon);
      const right = rayBoundary(position, candidate + PI / 18, polygon);
      const clearance = Math.min(exit.distance, left?.distance ?? 0, right?.distance ?? 0);
      const score = Math.log1p(clearance) + .35 * inward - .15 * Math.abs(angle) / PI;
      if (score > best + .025) { best = score; desiredHeading = candidate; }
    }
  }
  const error = wrap(desiredHeading - heading);
  // Virtual correction has the opposite sign from the desired real bend:
  // the player compensates to continue along the same virtual direction.
  const wallError = -error;
  const correction = Math.max(-PI, Math.min(PI, wallError * urgency +
    alignmentError * alignmentWeight * (1 - urgency)));
  return { valid: true, urgency, wallDistance: wall.distance, wallError, correction,
    alignmentError, desiredHeading, hit: wall.point, reason: urgency > .05 ? 'Avoid approaching wall' : 'Align room axes' };
}
