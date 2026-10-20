// Renderer-independent integration: VR and future simulated walkers use this path.
import { SpeedGainTracker } from '../expansive-spaces/speed-gain.js';
import { RedirectionTracker, LocomotionTransform, rotateXZ } from '../expansive-spaces/redirection.js';
import { mappedHead } from '../expansive-spaces/overlap-planner.js';
import { prepareFloor, containsPoint } from '../../common/floor-overlap.js';
import { followPhysicalPose } from '../impossible-spaces/core/vr-runtime.ts';
import type { Level, Vec } from '../impossible-spaces/core/types.ts';
import type { RuntimeState } from '../impossible-spaces/core/runtime.ts';

export function expandBoundary(points: Vec[], scale: number): Vec[] {
  if (!Number.isFinite(scale) || scale < 1 || scale > 2) throw new Error('World scale must be between 1 and 2.');
  const cx = (Math.min(...points.map(p => p.x)) + Math.max(...points.map(p => p.x))) / 2;
  const cy = (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2;
  return points.map(p => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale }));
}

export class ExpandedWalker {
  level: Level;
  boundary: any[];
  floor: any;
  areas: Map<string, any>;
  gain = new SpeedGainTracker();
  redirection = new RedirectionTracker({ steeringEnabled: true, turnEnabled: true });
  transform = new LocomotionTransform();
  previous: any = null;
  outside = false;
  blocked = false;
  stats = { physicalMetres: 0, virtualMetres: 0, boundaryExits: 0, wallBlocks: 0, rejectedGain: 0, recoveries: 0 };

  constructor(level: Level, boundary: Vec[]) {
    this.level = level;
    this.boundary = boundary.map(p => ({ x: p.x, z: p.y }));
    this.floor = prepareFloor(this.boundary);
    // Pieces can have multiple convex parts. Keep their union for overlap scoring;
    // using a bounding rectangle would invent floor through corners and walls.
    this.areas = new Map(level.pieces.map(piece => {
      const floors = piece.parts.map(poly => prepareFloor(poly.map(p => ({ x: p.x, z: p.y }))));
      return [piece.id, { id: piece.id, floor: { points: floors.flatMap(f => f.points),
        parts: floors.flatMap(f => f.parts), area: floors.reduce((sum, f) => sum + f.area, 0) } }];
    }));
  }

  resetSamples() { this.previous = null; this.gain.reset(); this.redirection.reset(); }

  reanchor(raw: Vec, state: RuntimeState): boolean {
    const position = { x: raw.x, z: raw.y };
    if (!containsPoint(position, this.boundary)) return false;
    // Explicit recovery only: preserve the current room and last valid virtual
    // position, and map the current physical pose there. Never choose a room by
    // containment, because the impossible rooms deliberately overlap.
    const rotated = rotateXZ(position, this.transform.yaw);
    this.transform.x = state.pos.x - rotated.x;
    this.transform.z = state.pos.y - rotated.z;
    this.resetSamples(); this.blocked = false; this.outside = false;
    this.stats.recoveries++;
    return true;
  }

  sample(raw: Vec, yaw: number, time: number, state: RuntimeState, paused = false, locked = false) {
    const position = { x: raw.x, z: raw.y };
    const previousVirtual = { ...state.pos };
    const outside = !containsPoint(position, this.boundary);
    if (outside && !this.outside) this.stats.boundaryExits++;
    this.outside = outside;
    const distance = this.previous ? Math.hypot(raw.x - this.previous.x, raw.y - this.previous.y) : 0;
    if (distance <= .75) this.stats.physicalMetres += distance;
    this.previous = { ...raw };
    const motion = this.gain.sample(position, time);
    const freeze = paused || locked || outside || this.blocked || distance > .75;
    const extra = freeze ? { x: 0, z: 0 } : { x: motion.extraX, z: motion.extraZ };
    const shifted = rotateXZ(extra, this.transform.yaw);
    const mapping = { x: this.transform.x + shifted.x, z: this.transform.z + shifted.z, yaw: this.transform.yaw };
    const rotation = this.redirection.sample(position, yaw, time, { paused: freeze,
      context: { boundary: this.boundary, physicalFloor: this.floor, area: this.areas.get(state.activeId), mapping } });
    // Keep the last in-bounds game position while the player returns to the
    // real area. Do not advance into hidden rooms outside the physical trace.
    if (outside) return { valid: false, outside, ...motion };
    const old = { x: this.transform.x, z: this.transform.z, yaw: this.transform.yaw };
    this.transform.apply(position, extra.x, extra.z, rotation.yawDelta);
    const follow = () => {
      const target = mappedHead(position, this.transform);
      return followPhysicalPose(this.level, state, { x: target.x, y: target.z }, locked);
    };
    let valid = follow();
    if (!valid) {
      // Reject artificial motion before accepting it. If raw walking itself
      // crosses a wall, retain the last valid state and show recovery in VR.
      Object.assign(this.transform, old);
      if (extra.x || extra.z || rotation.yawDelta) this.stats.rejectedGain++;
      valid = follow();
    }
    if (!valid && !this.blocked) this.stats.wallBlocks++;
    this.blocked = !valid;
    this.stats.virtualMetres += Math.hypot(state.pos.x - previousVirtual.x, state.pos.y - previousVirtual.y);
    return { valid, outside, ...motion };
  }
}
