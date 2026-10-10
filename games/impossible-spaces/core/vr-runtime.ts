import type { Level, Vec } from './types.ts';
import type { RuntimeState } from './runtime.ts';
import { DEFAULTS, movePlayer, colliderWalls } from './runtime.ts';
import { insideConvex, edgesOf, distPointSeg } from './geometry.ts';

export interface Ride { phase: 'idle' | 'closing' | 'closed' | 'opening'; elapsed: number; from: string; to: string; switched: boolean }
export const createRide = (): Ride => ({ phase: 'idle', elapsed: 0, from: '', to: '', switched: false });
export function fullyInsideCabin(level: Level, state: RuntimeState): boolean {
  const piece = level.pieces.find(p => p.id === state.activeId);
  return piece?.kind === 'elevator' && piece.parts.some(poly => insideConvex(state.pos, poly) && edgesOf(poly).every(([a, b]) => distPointSeg(state.pos, a, b) >= DEFAULTS.radius + 0.04)) || false;
}
export function beginRide(level: Level, state: RuntimeState, ride: Ride): boolean {
  if (ride.phase !== 'idle' || !fullyInsideCabin(level, state)) return false;
  const portal = level.portals.find(p => p.a === state.activeId || p.b === state.activeId);
  if (!portal) return false;
  Object.assign(ride, { phase: 'closing', elapsed: 0, from: state.activeId, to: portal.a === state.activeId ? portal.b : portal.a, switched: false });
  return true;
}
/** The outside graph changes only after the doors are completely shut. Never change pos. */
export function advanceRide(level: Level, state: RuntimeState, ride: Ride, dt: number): void {
  if (ride.phase === 'idle') return;
  if (ride.phase !== 'opening' && !fullyInsideCabin(level, state)) {
    ride.phase = 'opening'; ride.elapsed = 0; state.doorsClosed = false;
    return;
  }
  ride.elapsed += Math.min(dt, 0.05);
  if (ride.phase === 'closing' && ride.elapsed >= 0.65) {
    ride.phase = 'closed'; ride.elapsed = 0; state.doorsClosed = true;
  } else if (ride.phase === 'closed' && ride.elapsed >= 0.8) {
    state.activeId = ride.to; ride.switched = true;
    ride.phase = 'opening'; ride.elapsed = 0; state.doorsClosed = false;
  } else if (ride.phase === 'opening' && ride.elapsed >= 0.65) {
    ride.phase = 'idle'; ride.elapsed = 0;
  }
}
export function doorClosure(ride: Ride): number {
  if (ride.phase === 'closed') return 1;
  if (ride.phase === 'closing') return Math.min(1, ride.elapsed / 0.65);
  if (ride.phase === 'opening') return Math.max(0, 1 - ride.elapsed / 0.65);
  return 0;
}

/** Validate real motion without sliding the tracked head or shifting the rig. */
export function followPhysicalPose(level: Level, state: RuntimeState, target: Vec, locked = false): boolean {
  const old = { ...state.pos }, oldId = state.activeId;
  const dx = target.x - old.x, dy = target.y - old.y, distance = Math.hypot(dx, dy);
  if (distance > 0.75) return false; // Tracking discontinuity: require return/rebuild, not a synthetic walk.
  if (locked && (!fullyInsideCabin(level, { ...state, pos: target }) || state.activeId !== oldId)) return false;
  const n = Math.max(1, Math.ceil(distance / 0.015));
  for (let i = 1; i <= n; i++) {
    const expected = { x: old.x + dx * i / n, y: old.y + dy * i / n };
    movePlayer(level, state, expected.x - state.pos.x, expected.y - state.pos.y);
    if (Math.hypot(state.pos.x - expected.x, state.pos.y - expected.y) > 1e-6) {
      state.pos = old; state.activeId = oldId; return false;
    }
  }
  return true;
}
export function nearWall(level: Level, state: RuntimeState): boolean {
  return colliderWalls(level, state).some(([a, b]) => distPointSeg(state.pos, a, b) < 0.24);
}
