import assert from 'node:assert/strict';
import test from 'node:test';
import { measureBounds, isInsideBoundary, mapLayout, scaledRoomBounds, sanitizeWorldScale } from '../games/expansive-spaces/play-space.js';

const rectangle = [{ x: -2, z: -1 }, { x: 3, z: -1 }, { x: 3, z: 2 }, { x: -2, z: 2 }];

test('world scale grows each horizontal dimension around an off-center boundary', () => {
  const physical = measureBounds(rectangle), original = { ...physical };
  const scaled = scaledRoomBounds(physical, 1.5);
  assert.deepEqual(scaled, { minX: -3.25, maxX: 4.25, minZ: -1.75, maxZ: 2.75,
    width: 7.5, depth: 4.5, centerX: .5, centerZ: .5 });
  assert.deepEqual(physical, original);
  assert.deepEqual(scaledRoomBounds(physical, 1), physical);
  const doubled = scaledRoomBounds(physical, 2);
  assert.equal(doubled.width, 10); assert.equal(doubled.depth, 6);
  assert.equal(doubled.centerX, physical.centerX); assert.equal(doubled.centerZ, physical.centerZ);
});

test('saved world scales default to 50 percent larger and reject unusable values', () => {
  for (const value of [undefined, null, NaN, Infinity, 'invalid']) assert.equal(sanitizeWorldScale(value), 1.5);
  assert.equal(sanitizeWorldScale('1.75'), 1.75);
  assert.equal(sanitizeWorldScale(0), 1);
  assert.equal(sanitizeWorldScale(100), 2);
});

test('room extents preserve an off-centre bounded-floor origin', () => {
  assert.deepEqual(measureBounds(rectangle), {
    minX: -2, maxX: 3, minZ: -1, maxZ: 2, width: 5, depth: 3, centerX: .5, centerZ: .5,
  });
  assert.equal(measureBounds([]), null);
  assert.equal(measureBounds([{ x: 0, z: 0 }, { x: 0, z: 1 }, { x: 0, z: 2 }]), null);
  assert.equal(measureBounds([...rectangle, { x: NaN, z: 0 }]), null);
});

test('an irregular guardian can exclude positions inside its rectangular room', () => {
  const polygon = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 1 },
    { x: 1, z: 1 }, { x: 1, z: 3 }, { x: 0, z: 3 }];
  assert.equal(isInsideBoundary({ x: .5, z: 2 }, polygon), true);
  assert.equal(isInsideBoundary({ x: 2, z: 2 }, polygon), false);
  assert.equal(isInsideBoundary({ x: 1, z: 2 }, polygon), true);
  assert.equal(isInsideBoundary({ x: -1, z: 0 }, polygon), false);
});

test('top-down maps preserve metric aspect ratio, centre and heading axes', () => {
  const layout = mapLayout(measureBounds(rectangle));
  const centre = layout.project({ x: .5, z: .5 });
  assert.deepEqual(centre, { x: 256, y: 192 });
  const east = layout.project({ x: 1.5, z: .5 });
  const south = layout.project({ x: .5, z: 1.5 });
  assert.equal(east.x - centre.x, south.y - centre.y);
  assert.ok(layout.project({ x: .5, z: -1 }).y < centre.y);
  const portrait = mapLayout(measureBounds(rectangle.map(p => ({ x: p.z, z: p.x }))));
  assert.equal(portrait.scale, (384 - 88) / 5);
});
