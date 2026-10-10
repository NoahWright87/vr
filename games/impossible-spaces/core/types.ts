// All coordinates are meters on the floor plane. In 2D: +x right, +y "down".
// In a VR engine map (x, y) -> (x, z) on the floor; the physical play-space
// rectangle is [0, bounds.w] x [0, bounds.h].

export interface Vec { x: number; y: number }

export type PieceKind = 'room' | 'hall' | 'elevator';

export interface Piece {
  id: string;
  kind: PieceKind;
  /** Template name, e.g. 'room-u', 'hall-x', 'alcove'. */
  template: string;
  /** Union of CONVEX polygons that share edges and never overlap each other. Edges are multiples of 45°. */
  parts: Vec[][];
  /** Indexes of small corner-joint parts (45° bends, Y splits); everything else is at least minWidth across. */
  joints?: number[];
}

/** A doorway: an opening in the shared wall between two pieces. */
export interface Door {
  id: string;
  a: string;            // piece id
  b: string;            // piece id
  p1: Vec;              // segment endpoints, lying on the shared wall line
  p2: Vec;
  normal: Vec;          // unit normal pointing from a into b
}

/** An elevator: two alcoves, anywhere in the level, linked by teleport. Not a sightline. */
export interface Portal { id: string; a: string; b: string }

export interface GenParams {
  /** Physical boundary in generator coordinates, possibly concave. */
  footprint?: Vec[];
  boundaryMargin?: number;
  /** Anchor the first room around the actual headset; never move the player. */
  startAt?: Vec;
  /** Paired cabins occupy exactly the same physical floor, with a manual ride. */
  stationaryElevators?: boolean;
  boundsW: number;
  boundsH: number;
  /** Comfort floor: hall width, door width, elevator alcove size (meters). */
  minWidth: number;
  /** Target mix of templates, as weights (the viewer keeps them summing to 100). Missing = 0. */
  mix: Record<string, number>;
  /** Total pieces to generate (rooms + halls + elevator alcoves). */
  pieceCount: number;
  /** Room area range, as % of total floor area (1..99). */
  minSizePct: number;
  maxSizePct: number;
  /** 0..1. Chance a room opens extra exits. */
  branchChance: number;
  seed: number;
}

export interface Level {
  version: 1;
  params: GenParams;
  bounds: { w: number; h: number };
  pieces: Piece[];
  doors: Door[];
  portals: Portal[];
  /** For each piece: pairs of its door ids that have a straight sightline between them through the piece. */
  seeThrough: Record<string, [string, string][]>;
  /** For each piece: every piece visible from anywhere inside it (including itself). Render exactly these. */
  visible: Record<string, string[]>;
  /** For each piece X: for each visible piece Y, the part of Y that can be seen from X.
   *  THE GUARANTEE: for every X, these regions are pairwise disjoint. Hidden parts may overlap freely. */
  visibleRegions: Record<string, Record<string, Vec[][]>>;
  startPieceId: string;
  startPos: Vec;
  /** Set if generation stopped before reaching pieceCount. The level is still valid, just shorter. */
  warning?: string;
}
