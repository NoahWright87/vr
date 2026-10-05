import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rayFloorHit,
  nearestHandle,
  quadExtent,
  quadSides,
  quadHeading,
  compareQuads,
  quadArea,
} from '../games/rainbow-hotel/js/floor-calibration.js';
import { rectCorners } from '../common/guardian-bounds.js';

test('a ray from the controller meets the floor where the maths says it does', () => {
  // Standing head height, pointing forward and down at 45 degrees: the
  // hit is as far ahead as the pointer is above the floor.
  const hit = rayFloorHit({ x: 0, y: 1.5, z: 0 }, { x: 0, y: -1, z: -1 }, 0);
  assert.ok(hit);
  assert.equal(hit.x.toFixed(4), '0.0000');
  assert.equal(hit.z.toFixed(4), '-1.5000');
  assert.ok(hit.distance > 2.12 && hit.distance < 2.13);
});

test('the floor plane is wherever the player is standing, not always zero', () => {
  // The rectangle is drawn on the rig's floor, so on the fourth storey
  // the ray has to meet the fourth storey.
  const hit = rayFloorHit({ x: 0, y: 12.5, z: 0 }, { x: 0, y: -1, z: -1 }, 11);
  assert.equal(hit.z.toFixed(4), '-1.5000');
});

test('pointing up, or along the floor, is not a hit behind your shoulder', () => {
  // The sign trap: solving for the intersection without checking which
  // way the ray goes hands back a point behind the player, and a corner
  // there would snap to the pointer the moment they looked at the sky.
  assert.equal(rayFloorHit({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 1, z: -1 }, 0), null);
  assert.equal(rayFloorHit({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: -1 }, 0), null);
  assert.equal(rayFloorHit({ x: 0, y: 1.5, z: 0 }, { x: 0, y: 0, z: 0 }, 0), null);
});

test('the nearest corner wins, and open floor picks nothing', () => {
  const corners = [{ x: -1, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 }];
  assert.equal(nearestHandle({ x: 0.9, z: 0.95 }, corners, 0.35), 2);
  assert.equal(nearestHandle({ x: -0.85, z: -1.1 }, corners, 0.35), 0);
  // Dead centre of the room is a long way from every corner. Without the
  // radius the highlight would jump to whichever corner happened to be
  // marginally closer, wherever you pointed.
  assert.equal(nearestHandle({ x: 0, z: 0 }, corners, 0.35), -1);
  assert.equal(nearestHandle(null, corners, 0.35), -1);
});

test('the reported span and area describe the quad that was dragged', () => {
  const corners = [{ x: -1.5, z: -1 }, { x: 1.5, z: -1 }, { x: 1.5, z: 1 }, { x: -1.5, z: 1 }];
  const extent = quadExtent(corners);
  assert.equal(extent.sizeX.toFixed(2), '3.00');
  assert.equal(extent.sizeZ.toFixed(2), '2.00');
  assert.equal(extent.centerX.toFixed(2), '0.00');
  assert.equal(quadArea(corners).toFixed(2), '6.00');

  // Four free corners can be dragged into a bow tie, which renders as
  // two triangles and reads as a floor. The area is what gives it away,
  // so it has to fall rather than stay at six.
  const crossed = [corners[0], corners[1], corners[3], corners[2]];
  assert.ok(quadArea(crossed) < quadArea(corners));
});

test('the handles start on the rectangle the automatic read produced', () => {
  // Which is the whole point of the comparison: if these four corners
  // have to be dragged a long way to reach the real boundary, the
  // distance they moved *is* the error in the bounded-floor read.
  const rect = { centerX: 0.4, centerZ: -0.25, sizeX: 3.6, sizeZ: 3, rotationY: 0 };
  const corners = rectCorners(rect);
  assert.equal(corners.length, 4);
  const extent = quadExtent(corners);
  assert.equal(extent.sizeX.toFixed(2), '3.60');
  assert.equal(extent.sizeZ.toFixed(2), '3.00');
  assert.equal(extent.centerX.toFixed(2), '0.40');
  assert.equal(extent.centerZ.toFixed(2), '-0.25');
  assert.equal(quadArea(corners).toFixed(2), '10.80');

  // Turned, the corners follow the rotation but the area does not change.
  const turned = rectCorners(Object.assign({}, rect, { rotationY: 18 }));
  assert.equal(quadArea(turned).toFixed(2), '10.80');
  assert.ok(quadExtent(turned).sizeX > 3.6, 'a turned rectangle has a wider axis-aligned span');
});

test('the readout measures the sides, not the bounding box', () => {
  // The trap this exists to avoid: a play space turned 18 degrees has a
  // bounding box half a metre bigger than itself in both directions, so
  // a readout quoting the box says "3.90 x 3.51" about a floor that is
  // really 3.60 x 3.00 -- and reads, wrongly, as a floor too big for the
  // room you are standing in.
  const rect = { centerX: 0, centerZ: 0, sizeX: 3.6, sizeZ: 3, rotationY: 18 };
  const corners = rectCorners(rect);
  const sides = quadSides(corners);
  assert.equal(sides.length, 4);
  assert.equal(((sides[0] + sides[2]) / 2).toFixed(2), '3.60');
  assert.equal(((sides[1] + sides[3]) / 2).toFixed(2), '3.00');
  // Opposite sides of a real rectangle are equal, so the skew the
  // readout quotes is zero until a corner is actually dragged out of
  // square.
  assert.equal(Math.abs(sides[0] - sides[2]).toFixed(4), '0.0000');
  assert.ok(quadExtent(corners).sizeX.toFixed(2) !== '3.60', 'the bounding box is the misleading number');

  const dragged = corners.slice();
  dragged[2] = { x: dragged[2].x + 0.4, z: dragged[2].z + 0.4 };
  const skewed = quadSides(dragged);
  assert.ok(Math.abs(skewed[1] - skewed[3]) > 0.1, 'dragging a corner shows up as skew');
  assert.equal(quadSides(corners.slice(0, 3)), null);
});

test('a shifted rectangle reads as an offset and nothing else', () => {
  // This is the signature of a stale origin: the boundary was measured
  // in a space that has since been recentred, so the rectangle is the
  // right shape at the wrong place. Nothing else must light up, or the
  // readout accuses the fitting code of a bug it does not have.
  const truth = rectCorners({ centerX: 0, centerZ: 0, sizeX: 3.6, sizeZ: 3, rotationY: 12 });
  const shifted = rectCorners({ centerX: 0.8, centerZ: -0.6, sizeX: 3.6, sizeZ: 3, rotationY: 12 });
  const gap = compareQuads(truth, shifted);
  assert.equal(gap.offset.toFixed(2), '1.00');
  assert.equal(gap.offsetX.toFixed(2), '-0.80');
  assert.equal(gap.offsetZ.toFixed(2), '0.60');
  assert.equal(gap.turn.toFixed(1), '0.0');
  assert.equal(gap.longBy.toFixed(2), '0.00');
  assert.equal(gap.shortBy.toFixed(2), '0.00');
});

test('a turned rectangle reads as a turn, and a resized one as a size', () => {
  const truth = rectCorners({ centerX: 0, centerZ: 0, sizeX: 3.6, sizeZ: 3, rotationY: 0 });
  const turned = compareQuads(truth, rectCorners({ centerX: 0, centerZ: 0, sizeX: 3.6, sizeZ: 3, rotationY: 20 }));
  assert.equal(turned.offset.toFixed(2), '0.00');
  assert.equal(Math.abs(turned.turn).toFixed(1), '20.0');

  const smaller = compareQuads(truth, rectCorners({ centerX: 0, centerZ: 0, sizeX: 3.2, sizeZ: 2.6, rotationY: 0 }));
  assert.equal(smaller.longBy.toFixed(2), '0.40');
  assert.equal(smaller.shortBy.toFixed(2), '0.40');
  assert.equal(smaller.offset.toFixed(2), '0.00');
});

test('two identical rectangles never read as a 90-degree disagreement', () => {
  // A quad has no canonical first side, so comparing sides in order --
  // or headings without folding -- makes the same rectangle disagree
  // with itself by 90 degrees depending on which corner it starts from.
  const rect = { centerX: 0.4, centerZ: -0.25, sizeX: 3.6, sizeZ: 3, rotationY: 0 };
  const corners = rectCorners(rect);
  const rotatedOrder = [corners[1], corners[2], corners[3], corners[0]];
  const gap = compareQuads(corners, rotatedOrder);
  assert.equal(gap.offset.toFixed(4), '0.0000');
  assert.equal(gap.turn.toFixed(1), '0.0');
  assert.equal(gap.longBy.toFixed(4), '0.0000');
  assert.equal(gap.shortBy.toFixed(4), '0.0000');
});

test('the heading of a quad is the direction of its longest side, folded', () => {
  const wide = rectCorners({ centerX: 0, centerZ: 0, sizeX: 4, sizeZ: 2, rotationY: 0 });
  const deep = rectCorners({ centerX: 0, centerZ: 0, sizeX: 2, sizeZ: 4, rotationY: 0 });
  // One is long along X and the other along Z, which is a real 90
  // degrees apart -- but folded into [-90, 90) it reads as 0 vs -90 or
  // +90, never as some arbitrary 270.
  assert.ok(Math.abs(quadHeading(wide)) < 0.001);
  assert.equal(Math.abs(quadHeading(deep)).toFixed(1), '90.0');
  assert.ok(quadHeading(wide) >= -90 && quadHeading(wide) < 90);
  assert.ok(quadHeading(deep) >= -90 && quadHeading(deep) < 90);
  assert.equal(compareQuads(wide, null), null);
});
