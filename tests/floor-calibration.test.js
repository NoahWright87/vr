import assert from 'node:assert/strict';
import test from 'node:test';

import {
  rayFloorHit,
  nearestHandle,
  quadExtent,
  quadSides,
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
