import assert from 'node:assert/strict';
import test from 'node:test';
import { TravelTrail, TRAIL_METRES } from '../games/expansive-spaces/travel-trail.js';
import { measureBounds, mapLayout } from '../games/expansive-spaces/play-space.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const lineLength = trail => trail.points.reduce((length, point, i, points) => length +
  (i && !point.start ? Math.hypot(point.x - points[i - 1].x, point.z - points[i - 1].z) : 0), 0);

test('trails retain the latest 20 metres, interpolating the oldest segment', () => {
  const trail = new TravelTrail();
  for (let i = 0; i <= 10; i++) trail.add({ x: i * 3, z: 0 });
  close(trail.length, TRAIL_METRES);
  close(lineLength(trail), TRAIL_METRES);
  close(trail.points[0].x, 10);
  assert.equal(trail.points.at(-1).x, 30);
  assert.equal(trail.points[0].start, true);
});

test('the cap counts curved path length rather than distance from the origin', () => {
  const trail = new TravelTrail(5);
  for (let i = 0; i < 10; i++) [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }].forEach(p => trail.add(p));
  close(trail.length, 5);
  close(lineLength(trail), 5);
});

test('physical and gained travel have independent distance budgets', () => {
  const real = new TravelTrail(), game = new TravelTrail();
  for (let i = 0; i <= 150; i++) {
    real.add({ x: i * .1, z: 0 });
    game.add({ x: i * .15, z: 0 });
  }
  close(real.length, 15);
  close(game.length, 20);
  close(game.points[0].x, 2.5);
  assert.equal(real.points[0].x, 0);
});

test('tracking gaps start new lines without drawing or charging for pose jumps', () => {
  const trail = new TravelTrail(3);
  trail.add({ x: 0, z: 0 }); trail.add({ x: 1, z: 0 });
  trail.add({ x: 100, z: 100 }, true); trail.add({ x: 102, z: 100 });
  close(trail.length, 3);
  close(lineLength(trail), 3);
  assert.equal(trail.points[2].start, true);
  trail.add({ x: 104, z: 100 });
  close(trail.length, 3);
  close(lineLength(trail), 3);
  assert.deepEqual(trail.points[0], { x: 101, z: 100, start: true });
});

test('stationary jitter is filtered and disconnected samples also have a memory cap', () => {
  const trail = new TravelTrail();
  trail.add({ x: 0, z: 0 });
  for (let i = 0; i < 10000; i++) trail.add({ x: .001 * (i % 10), z: 0 });
  assert.equal(trail.points.length, 1);
  assert.equal(trail.length, 0);
  for (let i = 0; i < 2000; i++) trail.add({ x: i, z: 0 }, true);
  assert.equal(trail.points.length, 1024);
  assert.equal(trail.length, 0);
});

test('the point budget preserves a valid first segment and accurate length', () => {
  const trail = new TravelTrail(20, 3);
  for (let i = 0; i <= 10; i++) trail.add({ x: i, z: 0 });
  assert.equal(trail.points.length, 3);
  assert.equal(trail.points[0].start, true);
  close(trail.length, 2); close(lineLength(trail), 2);
});

test('invalid samples are ignored and explicit reset starts a new comparison', () => {
  const trail = new TravelTrail();
  trail.add({ x: 0, z: 0 }); trail.add({ x: 1, z: 0 });
  trail.add({ x: NaN, z: 1 }); trail.add({ x: 2, z: Infinity });
  assert.equal(trail.points.length, 2); close(trail.length, 1);
  trail.clear(); assert.equal(trail.length, 0); assert.equal(trail.points.length, 0);
  trail.add({ x: 12, z: -5 });
  assert.deepEqual(trail.points, [{ x: 12, z: -5, start: true }]);
});

test('one metric map frame fits the physical boundary and divergent virtual history', () => {
  const boundary = [{ x: -2, z: -1.5 }, { x: 2, z: 1.5 }];
  const samples = [{ x: .2, z: -.3 }, { x: 12, z: -8 }, { x: -5, z: 2 }];
  const bounds = measureBounds([...boundary, ...samples]);
  const layout = mapLayout(bounds, 512, 384, 60);
  for (const sample of [...boundary, ...samples]) {
    const p = layout.project(sample);
    assert.ok(p.x >= 60 && p.x <= 452);
    assert.ok(p.y >= 60 && p.y <= 324);
  }
  const a = layout.project({ x: 0, z: 0 }), east = layout.project({ x: 1, z: 0 }), south = layout.project({ x: 0, z: 1 });
  close(east.x - a.x, south.y - a.y);
});
