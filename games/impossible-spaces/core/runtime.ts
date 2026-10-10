import type { Level, Vec, Door, Piece } from './types.ts';
import { segIntersect, wallSegments, insideConvex, distPointSeg, edgesOf, centroid, clipSegToConvex, add, sub, mul, norm } from './geometry.ts';

/**
 * Engine-agnostic player/world state. A VR engine calls, each frame:
 *   movePlayer()       with the desired movement (or the real headset delta)
 *   updateElevators()  with dt
 *   renderWalls()      for what to draw (each visible piece clipped to its visible region)
 *
 * "Which piece am I in" changes ONLY by walking through a door segment. Never by
 * position containment: pieces overlap on purpose, so position alone is ambiguous.
 */
export interface ElevatorState { armed: boolean; charge: number }
export interface RuntimeState {
  activeId: string;
  pos: Vec;
  elevators: Record<string, ElevatorState>;
  /** True while the player is fully inside an armed elevator: the doors are shut. */
  doorsClosed: boolean;
}
export interface RuntimeOptions { radius: number; chargeTime: number }
export const DEFAULTS: RuntimeOptions = { radius: 0.16, chargeTime: 1.2 };

interface Index { piece: Map<string, Piece>; doorsOf: Map<string, Door[]>; portalOf: Map<string, string>; walls: Map<string, [Vec, Vec][]> }
const cache = new WeakMap<Level, Index>();
function idx(level: Level): Index {
  let i = cache.get(level);
  if (!i) {
    const doorsOf = new Map<string, Door[]>(level.pieces.map(p => [p.id, []]));
    for (const d of level.doors) { doorsOf.get(d.a)!.push(d); doorsOf.get(d.b)!.push(d); }
    const portalOf = new Map<string, string>();
    for (const p of level.portals) { portalOf.set(p.a, p.b); portalOf.set(p.b, p.a); }
    i = { piece: new Map(level.pieces.map(p => [p.id, p])), doorsOf, portalOf, walls: new Map(level.pieces.map(p => [p.id, wallSegments(p, level.doors)])) };
    cache.set(level, i);
  }
  return i;
}

export function createRuntime(level: Level): RuntimeState {
  const elevators: Record<string, ElevatorState> = {};
  for (const p of level.pieces) if (p.kind === 'elevator') elevators[p.id] = { armed: true, charge: 0 };
  return { activeId: level.startPieceId, pos: { ...level.startPos }, elevators, doorsClosed: false };
}

/** Quad around a door: `along` past each jamb, `depthIn` into piece `from`, `depthOut` into the other piece. */
function doorQuad(d: Door, from: string, along: number, depthIn: number, depthOut: number): Vec[] {
  const out = d.a === from ? d.normal : mul(d.normal, -1);
  const u = norm(sub(d.p2, d.p1));
  const a = sub(d.p1, mul(u, along)), b = add(d.p2, mul(u, along));
  return [add(a, mul(out, -depthIn)), add(b, mul(out, -depthIn)), add(b, mul(out, depthOut)), add(a, mul(out, depthOut))];
}
/** Walkable area right now: the active piece, plus a short "throat" through each of its doors. */
export function walkableAreas(level: Level, state: RuntimeState, opts = DEFAULTS): Vec[][] {
  const I = idx(level), dpt = opts.radius + 0.02;
  return [...I.piece.get(state.activeId)!.parts, ...I.doorsOf.get(state.activeId)!.map(d => doorQuad(d, state.activeId, 0, dpt, dpt))];
}
/** Colliding walls: the active piece's, plus the neighbor's walls right at each doorway (so the doorway feels the same from both sides). */
export function colliderWalls(level: Level, state: RuntimeState, opts = DEFAULTS): [Vec, Vec][] {
  const I = idx(level), m = opts.radius + 0.05;
  const out = [...I.walls.get(state.activeId)!];
  for (const d of I.doorsOf.get(state.activeId)!) {
    const other = d.a === state.activeId ? d.b : d.a, q = doorQuad(d, state.activeId, m, 0, m);
    for (const [a, b] of I.walls.get(other)!) { const c = clipSegToConvex(a, b, q); if (c) out.push(c); }
  }
  return out;
}
function fits(p: Vec, areas: Vec[][], walls: [Vec, Vec][], r: number): boolean {
  if (!areas.some(a => insideConvex(p, a, 1e-9))) return false;
  for (const [a, b] of walls) if (distPointSeg(p, a, b) < r - 1e-9) return false;
  return true;
}

/** Reference movement for the 2D viewer and tests. A VR engine uses real colliders built from colliderWalls(). */
export function movePlayer(level: Level, state: RuntimeState, dx: number, dy: number, opts = DEFAULTS): void {
  const prev = { ...state.pos };
  const areas = walkableAreas(level, state, opts), walls = colliderWalls(level, state, opts);
  const r = opts.radius;
  for (const [mx, my] of [[dx, dy], [dx, 0], [0, dy]]) {
    if (!mx && !my) continue;
    const p = { x: prev.x + mx, y: prev.y + my };
    if (fits(p, areas, walls, r)) { state.pos = p; break; }
  }
  crossDoors(level, state, prev);
}

/** Switch the active piece if the player's center just crossed one of its door segments. */
export function crossDoors(level: Level, state: RuntimeState, prev: Vec): void {
  const I = idx(level);
  for (const d of I.doorsOf.get(state.activeId)!) {
    if (segIntersect(prev, state.pos, d.p1, d.p2) === null) continue;
    const out = d.a === state.activeId ? d.normal : mul(d.normal, -1);
    const mid = mul(add(d.p1, d.p2), 0.5);
    const s0 = (prev.x - mid.x) * out.x + (prev.y - mid.y) * out.y;
    const s1 = (state.pos.x - mid.x) * out.x + (state.pos.y - mid.y) * out.y;
    if (s0 <= 0 && s1 > 0) { state.activeId = d.a === state.activeId ? d.b : d.a; return; }
  }
}

/**
 * Elevators (alcoves linked by a portal):
 *  - Fully inside an armed alcove: doors close, a charge timer runs.
 *  - Not fully inside: charge resets, doors open.
 *  - Charge completes: teleport into the paired alcove. Both ends disarm.
 *  - An alcove re-arms only once the player is fully outside it.
 * Only the active piece and alcoves next to it are checked, never an unrelated
 * alcove that happens to overlap the player's physical position.
 */
export function updateElevators(level: Level, state: RuntimeState, dt: number, opts = DEFAULTS): { teleported: boolean } {
  const I = idx(level), r = opts.radius, p = state.pos;
  const nearby = [state.activeId, ...I.doorsOf.get(state.activeId)!.map(d => (d.a === state.activeId ? d.b : d.a))];
  state.doorsClosed = false;
  for (const id of nearby) {
    const st = state.elevators[id];
    if (!st) continue;
    const poly = I.piece.get(id)!.parts[0];
    const inside = insideConvex(p, poly, 1e-9), clear = edgesOf(poly).every(([a, b]) => distPointSeg(p, a, b) >= r - 1e-9);
    const fullyIn = id === state.activeId && inside && clear, fullyOut = !inside && clear;
    if (fullyIn && st.armed) {
      state.doorsClosed = true;
      st.charge += dt / opts.chargeTime;
      if (st.charge >= 1) {
        const other = I.portalOf.get(id)!;
        // centre of the other alcove (a VR engine should also rotate by the alcoves' facing difference)
        state.pos = centroid(I.piece.get(other)!.parts[0]);
        state.activeId = other;
        st.armed = false; st.charge = 0;
        state.elevators[other].armed = false; state.elevators[other].charge = 0;
        state.doorsClosed = false;
        return { teleported: true };
      }
    } else {
      st.charge = 0;
      if (fullyOut) st.armed = true;
    }
  }
  return { teleported: false };
}

export function visiblePieceIds(level: Level, state: RuntimeState): string[] {
  return state.doorsClosed ? [state.activeId] : level.visible[state.activeId];
}
export function elevatorCharge(state: RuntimeState): number { return state.elevators[state.activeId]?.charge ?? 0; }

/**
 * What to draw: each visible piece's walls clipped to the part of it visible from the
 * active piece. A visible piece's hidden remainder may overlap other visible pieces by
 * design, so it must never be drawn or occlude anything.
 * (Equivalent in an engine: render each neighbor only through its doorway, portal-style.)
 */
export function renderWalls(level: Level, state: RuntimeState): { pieceId: string; walls: [Vec, Vec][]; regions: Vec[][] }[] {
  const I = idx(level);
  return visiblePieceIds(level, state).map(id => {
    const regions = state.doorsClosed ? I.piece.get(id)!.parts : level.visibleRegions[state.activeId][id];
    const walls = I.walls.get(id)!.flatMap(([a, b]) => regions.map(r => clipSegToConvex(a, b, r, 1e-6)).filter((x): x is [Vec, Vec] => !!x));
    return { pieceId: id, walls, regions };
  });
}
