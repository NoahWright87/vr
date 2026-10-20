import assert from 'node:assert/strict';
import test from 'node:test';
import { WallCollision, PLAYER_RADIUS } from '../games/expansive-spaces/wall-collision.js';
import { createRoomLayout } from '../games/expansive-spaces/room-layout.js';
import { MotionEffectsTracker } from '../games/expansive-spaces/motion-effects.js';

const layout = createRoomLayout({ centerX: 0, centerZ: 0 }, 1.5);
const walls = new WallCollision(layout.walls);
const limit = 3 - PLAYER_RADIUS - .06;
const close = (a, b, epsilon = .001) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('a sweep stops at a thin wall even if one update crosses the entire building', () => {
  for (const distance of [4, 100, 1e6]) {
    const hit = walls.move({ x: 0, z: 0 }, { x: distance, z: 0 });
    close(hit.x, limit); close(hit.z, 0);
    assert.deepEqual(hit.normals, [{ x: -1, z: 0 }]);
  }
});

test('all nine doorways remain traversable with player clearance in both directions', () => {
  for (const door of layout.doors) for (const direction of [-1, 1]) {
    const a = { ...door.center }, b = { ...door.center }, axis = door.vertical ? 'x' : 'z';
    a[axis] -= .6 * direction; b[axis] += .6 * direction;
    const moved = walls.move(a, b);
    close(moved.x, b.x); close(moved.z, b.z); assert.equal(moved.normals.length, 0, door.rooms.join(' / '));
  }
});

test('door jambs and the window wall block movement beside the opening', () => {
  const blocked = walls.move({ x: 2, z: 0 }, { x: 2, z: -10 });
  close(blocked.z, -limit);
  assert.ok(walls.move({ x: 0, z: 0 }, { x: 10, z: 0 }).x < 3);
});

test('glancing motion slides along a wall, corners stop both axes and backing away works immediately', () => {
  const slide = walls.move({ x: 0, z: 0 }, { x: 10, z: 1 });
  close(slide.x, limit); close(slide.z, 1);
  const corner = walls.move({ x: 0, z: 0 }, { x: 10, z: 10 });
  close(corner.x, limit); close(corner.z, limit);
  const back = walls.move(corner, { x: corner.x - .3, z: corner.z - .2 });
  close(back.x, corner.x - .3); close(back.z, corner.z - .2); assert.equal(back.normals.length, 0);
});

test('a high-speed sweep can cross several real doorways but still stops at the far room wall', () => {
  const moved = walls.move({ x: 0, z: 0 }, { x: 0, z: -1000 });
  close(moved.z, -37 + PLAYER_RADIUS + .06); close(moved.x, 0);
});

test('concave room notches block diagonals and tiny initial penetrations recover', () => {
  const moved = walls.move({ x: 0, z: -30 }, { x: 6, z: -30 });
  close(moved.x, 1.5 - PLAYER_RADIUS - .06);
  const recovered = walls.move({ x: limit + .01, z: 0 }, { x: limit + .01, z: 0 });
  close(recovered.x, limit); assert.ok(recovered.normals.length);
});

test('collision removes only inward slide/jump momentum and invalidates blocked launch history', () => {
  const tracker = new MotionEffectsTracker();
  tracker.slide = { x: .6, z: .8, speed: 10, seedSpeed: 5 };
  tracker.jump = { x: 1, z: 0, speed: 30, seedSpeed: 10 };
  tracker.impulses = [{ x: 6, z: 8, speed: 10, time: 0 }, { x: 20, z: 0, speed: 20, time: 0 }];
  tracker.jumpLift = 2; tracker.verticalJump = true;
  tracker.clipMomentum([{ x: -1, z: 0 }]);
  close(tracker.slide.speed, 8); close(tracker.slide.x, 0); close(tracker.slide.z, 1);
  close(tracker.slide.seedSpeed, 4); close(tracker.jump.speed, 0); close(tracker.jump.seedSpeed, 0);
  assert.equal(tracker.impulses.length, 1); close(tracker.impulses[0].speed, 8);
  close(tracker.jumpLift, 2); assert.equal(tracker.verticalJump, true);
});
