import assert from 'node:assert/strict';
import test from 'node:test';
import { measureBounds, isInsideBoundary, mapLayout } from '../games/expansive-spaces/play-space.js';

const rectangle = [{ x: -2, z: -1 }, { x: 3, z: -1 }, { x: 3, z: 2 }, { x: -2, z: 2 }];

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
