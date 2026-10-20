import { intersectionArea, moveFloor } from '../../common/floor-overlap.js';

const RAD = Math.PI / 180, EPS = 1e-7, ZERO = { x: 0, z: 0 };
const wrap = angle => Math.atan2(Math.sin(angle), Math.cos(angle));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function mappedHead(position, mapping) {
  const c = Math.cos(mapping.yaw), s = Math.sin(mapping.yaw);
  return { x: c * position.x + s * position.z + mapping.x, z: -s * position.x + c * position.z + mapping.z };
}
export function overlapFrame(position, context) {
  const physical = context?.physicalFloor, area = context?.area?.floor, mapping = context?.mapping;
  if (!physical || !area || !mapping || ![mapping.x, mapping.z, mapping.yaw].every(Number.isFinite)) return null;
  const floor = moveFloor(physical, mapping.yaw, mapping), pivot = mappedHead(position, mapping);
  const fraction = intersectionArea(floor, area) / physical.area;
  return { floor, pivot, area, fraction };
}

// Trial rotations use exactly the head pivot that LocomotionTransform uses.
// Search complete orientations, including 180-degree rotations: with an
// off-center pivot they change position/overlap even when axes look parallel.
export function chooseOverlapRotation(frame, clearance = () => 0, urgency = 0, preferredSide = 1) {
  const evaluate = delta => {
    const floor = moveFloor(frame.floor, delta, ZERO, frame.pivot);
    return { delta, fraction: intersectionArea(floor, frame.area) / frame.floor.area,
      clearance: urgency > .05 ? clearance(delta) : 0 };
  };
  let best = { delta: 0, fraction: frame.fraction, clearance: urgency > .05 ? clearance(0) : 0 };
  const consider = candidate => {
    const betterArea = candidate.fraction > best.fraction + EPS;
    const equalArea = Math.abs(candidate.fraction - best.fraction) <= EPS;
    const betterClearance = equalArea && candidate.clearance > best.clearance + .01;
    const stableSide = Math.sign(candidate.delta) === Math.sign(best.delta) || Math.abs(best.delta) - Math.abs(candidate.delta) > Math.PI / 2;
    const shorter = equalArea && stableSide && Math.abs(candidate.clearance - best.clearance) <= .01 && Math.abs(candidate.delta) < Math.abs(best.delta);
    if (betterArea || betterClearance || shorter) best = candidate;
  };
  // Fixed budget: 16 coarse orientations, then eight two-sided refinements.
  // Planning is throttled to 10 Hz and all polygon geometry is cached.
  // This finds useful fits with a bounded amount of work per planning pass.
  const step = Math.PI / 8;
  const coarse = Array.from({ length: 16 }, (_, i) => i ? evaluate(i * step) : best);
  for (const side of [preferredSide, -preferredSide]) {
    for (let i = 1; i < 16; i++) {
      const candidate = { ...coarse[(side * i + 16) % 16], delta: side * i * step };
      // Keep a committed route through local peaks, but never sacrifice
      // overlap at its starting point in order to reach another orientation.
      if (candidate.fraction < frame.fraction - EPS) break;
      consider(candidate);
    }
  }
  for (let spacing = step / 2, refinement = 0; refinement < 8; refinement++, spacing /= 2) {
    const center = best.delta;
    for (const side of [preferredSide, -preferredSide]) {
      const candidate = evaluate(center + side * spacing);
      if (candidate.fraction >= frame.fraction - EPS && [.25, .5, .75].every(t => evaluate(candidate.delta * t).fraction >= frame.fraction - EPS)) consider(candidate);
    }
  }
  return best;
}

export class OverlapPlanner {
  constructor() { this.reset(); }
  reset() { this.state = null; this.lastPlanTime = -Infinity; this.area = null; this.physical = null; this.frame = null; }
  sample(position, context, time, { heading, urgency, clearance, preferredSide = 1 } = {}) {
    const frame = this.frame = overlapFrame(position, context);
    if (!frame) { this.reset(); return { overlap: null, bestOverlap: null, correction: 0, minimumOverlap: 0, targetFootprint: null }; }
    const changedArea = this.area !== context.area.floor || this.physical !== context.physicalFloor;
    this.area = context.area.floor; this.physical = context.physicalFloor;
    let stalePivot = false;
    if (this.state) {
      const progress = wrap(context.mapping.yaw - this.state.lastYaw);
      this.state.remaining -= progress; this.state.lastYaw = context.mapping.yaw;
      stalePivot = distance(position, this.state.rawPivot) > .03 || distance(frame.pivot, this.state.pivot) > .03;
      if (changedArea || (stalePivot && time - this.lastPlanTime >= 100) ||
        Math.abs(this.state.remaining) < .01 * RAD || (!this.state.improvesArea && Math.abs(wrap(heading - this.state.heading)) > 10 * RAD)) this.state = null;
    }
    if (frame.fraction >= 1 - EPS && urgency <= .05) this.state = null;
    else if (!this.state && (changedArea || time - this.lastPlanTime >= 100)) {
      const best = chooseOverlapRotation(frame, clearance, urgency, preferredSide);
      this.lastPlanTime = time;
      if (Math.abs(best.delta) > .01 * RAD) this.state = { remaining: best.delta, lastYaw: context.mapping.yaw,
        pivot: frame.pivot, rawPivot: { ...position }, heading, startOverlap: frame.fraction,
        bestOverlap: best.fraction, improvesArea: best.fraction > frame.fraction + EPS };
      stalePivot = false;
    }
    let correction = this.state?.remaining || 0;
    let target = correction ? moveFloor(frame.floor, correction, ZERO, frame.pivot) : frame.floor;
    let targetFraction = correction ? intersectionArea(target, frame.area) / frame.floor.area : frame.fraction;
    if (targetFraction < frame.fraction - EPS) {
      this.state = null; correction = 0; target = frame.floor; targetFraction = frame.fraction;
    }
    return { overlap: frame.fraction, bestOverlap: targetFraction, correction,
      minimumOverlap: stalePivot ? frame.fraction : Math.min(frame.fraction, this.state?.startOverlap ?? frame.fraction),
      targetFootprint: target.points };
  }
  limitYaw(requested, minimumOverlap) {
    if (!this.frame || !requested) return 0;
    const frame = this.frame;
    // Check the actual combined nudge, including intermediate angles. A
    // stale goal, smoothing tail or simultaneous walking/turning cannot push
    // the footprint below the committed plan's starting overlap.
    const allowed = delta => [ .25, .5, .75, 1 ].every(t => {
      const floor = moveFloor(frame.floor, delta * t, ZERO, frame.pivot);
      return intersectionArea(floor, frame.area) / frame.floor.area >= minimumOverlap - EPS;
    });
    if (allowed(requested)) return requested;
    let low = 0, high = 1;
    for (let i = 0; i < 16; i++) { const mid = (low + high) / 2; if (allowed(requested * mid)) low = mid; else high = mid; }
    return Math.abs(requested * low) > 1e-7 ? requested * low : 0;
  }
}
