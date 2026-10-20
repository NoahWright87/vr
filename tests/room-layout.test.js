import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomLayout } from '../games/expansive-spaces/room-layout.js';
import { containsPoint, intersectionArea, prepareFloor } from '../common/floor-overlap.js';
import { OverlapPlanner } from '../games/expansive-spaces/overlap-planner.js';

const layout = createRoomLayout({ centerX: 0, centerZ: 0 }, 1.5);
const room = id => layout.rooms.find(area => area.id === 'space-' + id);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('ordinary rooms form one connected graph with a return loop and T/X branches', () => {
  const visited = new Set([layout.rooms[0].id]);
  for (let pass = 0; pass < layout.rooms.length; pass++) for (const door of layout.doors) {
    if (door.rooms.some(id => visited.has(id))) door.rooms.forEach(id => visited.add(id));
  }
  assert.equal(visited.size, layout.rooms.length);
  assert.equal(layout.rooms.length, 9);
  assert.equal(layout.doors.length, 9); // One loop; no teleporting shortcuts.
  assert.equal(room('crossroads').doors.length, 4);
  assert.equal(room('tee-junction').doors.length, 3);
});

test('authored floor polygons do not overlap and all room markers are inside their own floors', () => {
  for (const [i, area] of layout.rooms.entries()) {
    assert.ok(area.floor);
    assert.ok(containsPoint(area.labelPoint, area.points));
    for (const other of layout.rooms.slice(i + 1)) close(intersectionArea(area.floor, other.floor), 0);
  }
  close(room('square-chamber').floor.area, 100);
  close(room('crossroads').floor.area, 63);
  close(room('tee-junction').floor.area, 67.5);
  assert.ok(!containsPoint({ x: 5, z: -29 }, room('elbow-room').points));
  assert.ok(!containsPoint({ x: 4, z: -17 }, room('crossroads').points));
});

test('each doorway joins exactly two floors and both wall edges leave the opening clear', () => {
  for (const door of layout.doors) {
    assert.equal(layout.rooms.filter(area => containsPoint(door.center, area.points)).length, 2);
    for (const offset of [-.7, 0, .7]) {
      const p = { ...door.center };
      p[door.vertical ? 'z' : 'x'] += offset;
      for (const wall of layout.walls) {
        const onVertical = Math.abs(wall.a.x - wall.b.x) < 1e-7 && Math.abs(p.x - wall.a.x) < 1e-7 &&
          p.z >= Math.min(wall.a.z, wall.b.z) && p.z <= Math.max(wall.a.z, wall.b.z);
        const onHorizontal = Math.abs(wall.a.z - wall.b.z) < 1e-7 && Math.abs(p.z - wall.a.z) < 1e-7 &&
          p.x >= Math.min(wall.a.x, wall.b.x) && p.x <= Math.max(wall.a.x, wall.b.x);
        assert.ok(!onVertical && !onHorizontal, `Blocked opening: ${door.rooms}`);
      }
    }
  }
});

test('world scale resizes every room and doorway uniformly without copying the guardian aspect ratio', () => {
  const narrow = createRoomLayout({ centerX: 3, centerZ: -2, width: 2, depth: 10 }, 1.5);
  const wide = createRoomLayout({ centerX: 3, centerZ: -2, width: 20, depth: 3 }, 1.5);
  assert.deepEqual(narrow, wide);
  const small = createRoomLayout({ centerX: 3, centerZ: -2 }, 1);
  const large = createRoomLayout({ centerX: 3, centerZ: -2 }, 2);
  for (let i = 0; i < small.rooms.length; i++) {
    close(large.rooms[i].floor.area, small.rooms[i].floor.area * 4);
    close(large.rooms[i].bounds.width, small.rooms[i].bounds.width * 2);
  }
  close(large.doors[0].width, small.doors[0].width * 2);
  close(narrow.rooms[0].bounds.centerX, 3); close(narrow.rooms[0].bounds.centerZ, -2);
});

test('the same overlap planner retargets from a long north hall to an east hall and concave junction', () => {
  const boundary = [{ x: -1, z: -5 }, { x: 1, z: -5 }, { x: 1, z: 5 }, { x: -1, z: 5 }];
  const physicalFloor = prepareFloor(boundary), planner = new OverlapPlanner();
  const sample = (area, time) => planner.sample({ x: 0, z: 0 }, {
    boundary, physicalFloor, area: { id: area.id, floor: area.floor },
    mapping: { yaw: 0, ...area.labelPoint },
  }, time, { heading: 0, urgency: 0 });
  const north = sample(room('long-gallery'), 0);
  close(north.overlap, 1); close(north.correction, 0);
  const east = sample(room('east-gallery'), 1); // Area changes invalidate the 10 Hz cache immediately.
  close(east.overlap, .3); close(east.bestOverlap, 1);
  assert.ok(Math.abs(east.correction) > Math.PI / 3);
  const cross = sample(room('crossroads'), 2);
  close(cross.overlap, 1); close(cross.correction, 0);
  const square = sample(room('square-chamber'), 3);
  close(square.overlap, 1); close(square.correction, 0);
});
