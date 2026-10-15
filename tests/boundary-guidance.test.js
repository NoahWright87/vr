import assert from 'node:assert/strict';
import test from 'node:test';
import { axisError, planGuidance, rayBoundary } from '../games/expansive-spaces/boundary-guidance.js';
import { sanitizeRedirectionSettings, rotateXZ } from '../games/expansive-spaces/redirection.js';

const RAD = Math.PI / 180;
const boundary = [{ x: -1, z: -5 }, { x: 1, z: -5 }, { x: 1, z: 5 }, { x: -1, z: 5 }];
const settings = sanitizeRedirectionSettings();
const context = { boundary, physicalAxisYaw: 0, virtualAxisYaw: 0, correctionYaw: 0, axisWeight: 1 };
const plan = (position, heading, speed = 1, ctx = context) => planGuidance(position, heading, speed, ctx, settings);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('the obstacle ahead wins over a closer wall behind or alongside the player', () => {
  const position = { x: .9, z: 0 };
  close(rayBoundary(position, 0, boundary).distance, 5);
  close(rayBoundary(position, Math.PI / 2, boundary).distance, 1.9);
  close(rayBoundary(position, -Math.PI / 2, boundary).distance, .1);
  assert.equal(plan(position, 0).urgency, 0);
});

test('either side wall produces a physical path away from that wall into open space', () => {
  const right = plan({ x: .8, z: 0 }, -Math.PI / 2);
  const left = plan({ x: -.8, z: 0 }, Math.PI / 2);
  assert.ok(right.valid && left.valid && right.urgency > .99 && left.urgency > .99);
  assert.ok(Math.abs(right.wallError) > .1 && Math.abs(left.wallError) > .1);
  for (const guide of [right, left]) {
    const position = guide === right ? { x: .8, z: 0 } : { x: -.8, z: 0 };
    assert.ok(rayBoundary(position, guide.desiredHeading, boundary).distance > guide.wallDistance * 5);
    assert.ok(-Math.sin(guide.desiredHeading) * (guide === right ? -1 : 1) > 0);
  }
});

test('speed changes when a wall enters the look-ahead horizon, without using virtual gain', () => {
  const position = { x: 0, z: 2 };
  const slow = plan(position, Math.PI, .7), fast = plan(position, Math.PI, 3);
  assert.equal(slow.urgency, 0); assert.ok(fast.urgency > .3);
  const earlier = planGuidance(position, Math.PI, .7, context, { ...settings, lookAhead: 3, wallMargin: 1 });
  assert.ok(earlier.urgency > slow.urgency);
});

test('wall danger overrides competing room alignment', () => {
  const danger = plan({ x: .95, z: 0 }, -Math.PI / 2, 1, { ...context, correctionYaw: -Math.PI / 3 });
  assert.ok(danger.alignmentError > 0, 'room alignment would rotate the other way');
  assert.ok(danger.correction < 0, 'the approaching right wall wins');
});

test('long room axes align modulo 180 degrees and do not impose a compass heading', () => {
  const position = { x: 0, z: 0 };
  close(plan(position, 0, 1, { ...context, correctionYaw: Math.PI }).correction, 0);
  const offAxis = plan(position, 0, 1, { ...context, correctionYaw: 40 * RAD });
  close(offAxis.correction, -40 * RAD);
  close(plan(position, 0, 1, { ...context, virtualAxisYaw: Math.PI / 2, correctionYaw: 40 * RAD }).correction, 50 * RAD);
  close(plan(position, 0, 1, { ...context, axisWeight: 0, correctionYaw: 40 * RAD }).correction, 0);
  close(axisError(90 * RAD, -1), -90 * RAD);
});

test('changing the active room changes the alignment goal without moving the physical polygon', () => {
  const position = { x: 0, z: 0 };
  assert.equal(plan(position, 0).correction, 0);
  const changed = plan(position, 0, 1, { ...context, virtualAxisYaw: Math.PI / 2 });
  assert.ok(Math.abs(changed.correction) > 1.5);
  assert.equal(changed.wallDistance, 5);
});

test('translated and rotated reference spaces preserve the physical guidance decision', () => {
  const yaw = .8, offset = { x: 20, z: -7 }, position = { x: .8, z: 1 };
  const transform = p => { const r = rotateXZ(p, yaw); return { x: r.x + offset.x, z: r.z + offset.z }; };
  const original = plan(position, -Math.PI / 2, 1, { ...context, correctionYaw: .4 });
  const changed = plan(transform(position), -Math.PI / 2 + yaw, 1, { ...context,
    boundary: boundary.map(transform), physicalAxisYaw: yaw, virtualAxisYaw: yaw, correctionYaw: .4 });
  close(original.wallDistance, changed.wallDistance);
  close(original.correction, changed.correction);
  close(Math.sin(original.desiredHeading + yaw), Math.sin(changed.desiredHeading));
});

test('concave polygons and either winding use the first actual wall intersection', () => {
  const polygon = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 3 }, { x: 0, z: 3 }];
  const position = { x: .5, z: 2 };
  for (const shape of [polygon, [...polygon].reverse()]) {
    close(rayBoundary(position, -Math.PI / 2, shape).distance, .5);
    const result = plan(position, -Math.PI / 2, 1, { ...context, boundary: shape });
    assert.ok(result.valid && result.correction < 0);
  }
});

test('missing tracking geometry and positions outside the polygon cannot request rotation', () => {
  assert.equal(plan({ x: 2, z: 0 }, 0).valid, false);
  assert.equal(plan({ x: 0, z: 0 }, 0, 1, null).correction, 0);
  assert.equal(plan({ x: 0, z: 0 }, null).valid, false);
});

test('stationary glances do not invent a collision course toward the looked-at wall', () => {
  const result = plan({ x: .8, z: 0 }, -Math.PI / 2, 0);
  assert.equal(result.urgency, 0);
  assert.equal(result.correction, 0);
});
