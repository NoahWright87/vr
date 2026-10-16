import type { Vec, Piece } from './types.ts';
import { pointInPiece, len, sub, cross } from './geometry.ts';

function inwardNormal(piece: Piece, a: Vec, b: Vec): Vec {
  const length = len(sub(b, a));
  let n = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  if (!pointInPiece({ x: mid.x + n.x * .0001, y: mid.y + n.y * .0001 }, piece, 1e-8)) n = { x: -n.x, y: -n.y };
  return n;
}

/** Render faces 1 mm inside their owner, preserving closed corner joints.
 * Full physical walls distinguish real corners from doorway and visibility cuts.
 * Collision geometry, footprints, and door positions are unchanged.
 */
export function insetWallFace(piece: Piece, physicalWalls: [Vec, Vec][], a: Vec, b: Vec, inset = .001): [Vec, Vec] {
  const length = len(sub(b, a));
  if (length < 1e-8) return [a, b];
  const n = inwardNormal(piece, a, b), direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  function offset(p: Vec): Vec {
    const shifted = { x: p.x + n.x * inset, y: p.y + n.y * inset };
    for (const [c, d] of physicalWalls) {
      if (Math.min(len(sub(p, c)), len(sub(p, d))) > 1e-5) continue;
      const adjacent = sub(d, c), denominator = cross(direction, adjacent);
      if (Math.abs(denominator) < 1e-8) continue;
      const otherNormal = inwardNormal(piece, c, d);
      const delta = { x: (otherNormal.x - n.x) * inset, y: (otherNormal.y - n.y) * inset };
      const distance = cross(delta, adjacent) / denominator;
      return { x: shifted.x + direction.x * distance, y: shifted.y + direction.y * distance };
    }
    return shifted;
  }
  return [offset(a), offset(b)];
}
