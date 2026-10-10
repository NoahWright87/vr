import test from 'node:test';
import assert from 'node:assert/strict';

import { centroidOf, reachAlong, layoutSides, defaultRoom, SIDES } from '../common/play-space.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test('the default room is a 3 m square around the start', () => {
  const room = defaultRoom();
  assert.equal(room.length, 4);
  const c = centroidOf(room);
  assert.ok(near(c.x, 0) && near(c.z, 0));
});

test('the centre is area-weighted, not dragged by a run of extra points', () => {
  // A 4 x 2 rectangle whose right-hand edge is described with many points.
  const room = [{ x: 0, z: 0 }, { x: 4, z: 0 }];
  for (let i = 1; i < 10; i++) room.push({ x: 4, z: (i / 10) * 2 });
  room.push({ x: 4, z: 2 }, { x: 0, z: 2 });
  const c = centroidOf(room);
  assert.ok(near(c.x, 2, 1e-9) && near(c.z, 1, 1e-9), JSON.stringify(c));
});

test('reach is measured along the ray to the real edge', () => {
  const room = defaultRoom(2);
  assert.ok(near(reachAlong(room, { x: 0, z: 0 }, SIDES.front), 2));
  assert.ok(near(reachAlong(room, { x: 0.5, z: 0 }, SIDES.right), 1.5));
  assert.equal(reachAlong(room, { x: 9, z: 9 }, SIDES.right), Infinity, 'outside, heading away');
});

test('an L-shaped room keeps a station out of the missing corner', () => {
  // A 4 x 4 square with its front-right quadrant cut away.
  const room = [
    { x: -2, z: -2 }, { x: 0, z: -2 }, { x: 0, z: 0 },
    { x: 2, z: 0 }, { x: 2, z: 2 }, { x: -2, z: 2 },
  ];
  const layout = layoutSides(room, { inset: 0.3 });
  const { center, sides } = layout;
  // The station to the right stays inside the polygon: it never passes
  // x = 0 while still in front of z = 0.
  const r = sides.right;
  assert.ok(!(r.x > 0 && r.z < 0), 'right station sits in the cut-away corner: ' + JSON.stringify(r));
  assert.ok(near(r.distance, r.reach - 0.3));
  assert.ok(center.x < 0 && center.z > 0, 'centre pulled toward the bulk of the room');
});

test('stations face the middle of the room', () => {
  const { center, sides } = layoutSides(defaultRoom(), { inset: 0.5 });
  for (const name of Object.keys(SIDES)) {
    const s = sides[name];
    // +Z rotated by yaw should point from the station to the centre.
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    const tx = center.x - s.x;
    const tz = center.z - s.z;
    const len = Math.hypot(tx, tz);
    assert.ok(near(fx, tx / len, 1e-9) && near(fz, tz / len, 1e-9), name);
  }
  assert.ok(near(sides.front.z, -1), 'front is −Z, inset from the 1.5 m edge');
  assert.ok(near(sides.right.x, 1));
});

test('a tiny room still leaves the stations a step away', () => {
  const { sides } = layoutSides(defaultRoom(0.5), { inset: 0.45, minReach: 0.7 });
  for (const name of Object.keys(SIDES)) assert.ok(near(sides[name].distance, 0.7), name);
});

test('too few points falls back to the default room', () => {
  const { sides } = layoutSides([{ x: 0, z: 0 }], { inset: 0.5 });
  assert.ok(near(sides.back.z, 1));
});
