import assert from 'node:assert/strict';
import test from 'node:test';
import { ScopePoseFilter, sanitizeScopeSettings } from '../games/expansive-spaces/scope-filter.js';
const identity = { x: 0, y: 0, z: 0, w: 1 }, point = { x: 0, y: 1.6, z: 0 };
const yaw = angle => ({ x: 0, y: Math.sin(angle / 2), z: 0, w: Math.cos(angle / 2) });
test('scope stabilization filters only the supplied secondary pose, without mutating tracking input', () => {
  const filter = new ScopePoseFilter(), settings = sanitizeScopeSettings();
  filter.sample(point, identity, 0, settings);
  const moved = { ...point, x: .1 }, rotated = yaw(.1), original = JSON.stringify([moved, rotated]);
  const result = filter.sample(moved, rotated, 10, settings);
  assert.ok(result.position.x > 0 && result.position.x < .01);
  assert.ok(result.quaternion.y > 0 && result.quaternion.y < .005);
  assert.equal(JSON.stringify([moved, rotated]), original);
});
test('raw mode and zero damping reproduce the latest position and orientation', () => {
  for (const options of [{ stabilize: false }, { rotationLag: 0, positionLag: 0 }]) {
    const f = new ScopePoseFilter(), settings = sanitizeScopeSettings(options);
    f.sample(point, identity, 0, settings);
    const r = f.sample({ ...point, x: .1 }, yaw(.2), 10, settings);
    assert.equal(r.position.x, .1); assert.ok(Math.abs(r.quaternion.y - yaw(.2).y) < 1e-8);
  }
});
test('quaternion interpolation handles equivalent signs and the +/-180 degree crossing', () => {
  const f = new ScopePoseFilter(), s = sanitizeScopeSettings();
  f.sample(point, yaw(3.13), 0, s);
  const r = f.sample(point, yaw(-3.13), 10, s);
  assert.ok(Math.abs(r.quaternion.y) > .99);
  assert.ok(Math.abs(Math.hypot(...Object.values(r.quaternion)) - 1) < 1e-8);
});
test('tracking loss and gaps reanchor rather than smoothing from stale positions', () => {
  const f = new ScopePoseFilter(), s = sanitizeScopeSettings();
  f.sample(point, identity, 0, s);
  assert.equal(f.sample({ ...point, x: NaN }, identity, 10, s), null);
  assert.equal(f.sample({ ...point, x: 3 }, identity, 20, s).position.x, 3);
  assert.equal(f.sample({ ...point, x: 4 }, identity, 1000, s).position.x, 4);
});
