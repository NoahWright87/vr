import assert from 'node:assert/strict';
import test from 'node:test';
import { RedirectionTracker, LocomotionTransform, rotateXZ, wrapYaw,
  boundaryTarget, sanitizeRedirectionSettings } from '../games/expansive-spaces/redirection.js';
import { isInsideBoundary } from '../games/expansive-spaces/play-space.js';

const RAD = Math.PI / 180;
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function run({ speed = 0, turnRate = 0, settings = {}, dt = 1 / 90, seconds = 2, target = null } = {}) {
  const tracker = new RedirectionTracker(settings);
  tracker.sample({ x: 0, z: 0 }, 0, 0);
  let yaw = 0, last;
  for (let i = 1; i <= Math.round(seconds / dt); i++) {
    last = tracker.sample({ x: 0, z: -speed * i * dt }, wrapYaw(turnRate * RAD * i * dt), i * dt * 1000, { target });
    yaw += last.yawDelta;
  }
  return { tracker, yaw, last };
}

test('both effects default off, even during fast walking and turning', () => {
  assert.equal(run({ speed: 3, turnRate: 300 }).yaw, 0);
  assert.equal(sanitizeRedirectionSettings().steeringEnabled, false);
  assert.equal(sanitizeRedirectionSettings().turnEnabled, false);
});

test('slow turns stay 1:1; fast turns ramp to the selected multiplier in either direction', () => {
  const settings = { turnEnabled: true, maxTurnGain: 200 / 180, turnSpeed: 180 };
  assert.equal(run({ turnRate: 30, settings }).yaw, 0);
  const positive = run({ turnRate: 360, settings, seconds: .5 });
  const negative = run({ turnRate: -360, settings, seconds: .5 });
  close(positive.yaw, -negative.yaw);
  // Acceleration smoothing makes the total slightly under the 20 degree ceiling.
  assert.ok(positive.yaw / RAD > 18 && positive.yaw / RAD < 20);
  close(positive.last.turnGain, 200 / 180);
  const attenuated = run({ turnRate: 240, settings: { ...settings, maxTurnGain: .8 } });
  assert.ok(attenuated.yaw < 0);
  close(attenuated.last.turnGain, .8);
});

test('full-turn-speed setting changes the ramp independently of max gain', () => {
  const fast = run({ turnRate: 120, settings: { turnEnabled: true, maxTurnGain: 1.3, turnSpeed: 90 } });
  const slow = run({ turnRate: 120, settings: { turnEnabled: true, maxTurnGain: 1.3, turnSpeed: 300 } });
  close(fast.last.turnGain, 1.3);
  assert.ok(slow.last.turnGain < 1.1);
});

test('yaw crossing +/-180 degrees does not create a false full revolution', () => {
  const tracker = new RedirectionTracker({ turnEnabled: true, maxTurnGain: 1.2, turnSpeed: 60 });
  tracker.sample({ x: 0, z: 0 }, 179 * RAD, 0);
  const result = tracker.sample({ x: 0, z: 0 }, -179 * RAD, 10);
  assert.ok(result.yawDelta >= 0 && result.yawDelta < .4 * RAD);
});

test('walking steering ramps with physical speed and respects its independent rate cap', () => {
  const settings = { steeringEnabled: true, steeringMode: 'left', maxCurvature: 5, steeringSpeed: 2, maxSteeringRate: 6 };
  assert.equal(run({ speed: .6, settings }).yaw, 0);
  const fast = run({ speed: 3, settings });
  close(fast.last.steeringRate, -6, .01);
  const right = run({ speed: 3, settings: { ...settings, steeringMode: 'right' } });
  close(right.yaw, -fast.yaw);
  const slowerRamp = run({ speed: 1.2, settings: { ...settings, steeringSpeed: 3 } });
  assert.ok(Math.abs(slowerRamp.last.steeringRate) < 1);
});

test('center steering compensates opposite to the desired physical bend, using travel direction', () => {
  const settings = { steeringEnabled: true, steeringMode: 'center' };
  const left = run({ speed: 2, turnRate: 0, settings, target: { x: -3, z: -5 } });
  const right = run({ speed: 2, turnRate: 0, settings, target: { x: 3, z: -5 } });
  assert.ok(left.yaw < 0 && right.yaw > 0);
  close(left.yaw, -right.yaw);
  assert.equal(run({ speed: 2, settings }).yaw, 0, 'no boundary target means no automatic steering');
});

test('stopping, slow movement and watch pause do not coast or bank rotation', () => {
  const { tracker } = run({ speed: 3, turnRate: 300, settings: { steeringEnabled: true, steeringMode: 'right', turnEnabled: true } });
  let result = tracker.sample({ x: 0, z: -6 }, wrapYaw(600 * RAD), 2010);
  assert.equal(result.yawDelta, 0);
  result = tracker.sample({ x: 0, z: -6.03 }, wrapYaw(603 * RAD), 2020, { paused: true });
  assert.equal(result.yawDelta, 0);
  result = tracker.sample({ x: 0, z: -6.03 }, wrapYaw(603 * RAD), 2030);
  assert.equal(result.yawDelta, 0);
  result = tracker.sample({ x: 0, z: -6.034 }, wrapYaw(603.2 * RAD), 2040);
  assert.equal(result.yawDelta, 0);
});

test('gaps, pose jumps, invalid yaw and reference resets cannot amplify discontinuities', () => {
  const { tracker } = run({ speed: 2, turnRate: 180, settings: { steeringEnabled: true, turnEnabled: true } });
  assert.equal(tracker.sample({ x: 20, z: 0 }, 1, 2010).yawDelta, 0);
  assert.equal(tracker.sample({ x: 20, z: 0 }, 2, 3010).yawDelta, 0);
  assert.equal(tracker.sample({ x: 20, z: 0 }, 3, 3010).yawDelta, 0);
  tracker.reset();
  assert.equal(tracker.sample({ x: 20, z: 0 }, 0, 4000).yawDelta, 0);
  assert.equal(tracker.sample({ x: 20, z: 0 }, null, 4010).yawDelta, 0);
  assert.equal(tracker.sample({ x: 20, z: 0 }, 2, 4020).yawDelta, 0);
  assert.equal(tracker.sample({ x: NaN, z: 0 }, 2, 4030).yawDelta, 0);
  assert.equal(tracker.sample({ x: 20, z: 0 }, 1, 4040).yawDelta, 0);
});

test('the toggles disable each effect independently without undoing prior rotation', () => {
  const { tracker } = run({ speed: 3, turnRate: 180, settings: { steeringEnabled: true, steeringMode: 'right', turnEnabled: true } });
  tracker.setSettings({ steeringEnabled: false });
  const turnOnly = tracker.sample({ x: 0, z: -6.03 }, wrapYaw(361.8 * RAD), 2010);
  assert.equal(turnOnly.steeringRate, 0);
  assert.ok(turnOnly.yawDelta > 0);
  tracker.setSettings({ turnEnabled: false });
  assert.equal(tracker.sample({ x: 0, z: -6.06 }, wrapYaw(363.6 * RAD), 2020).yawDelta, 0);
});

test('rotation pivots around an off-origin head and preserves metric hand reach', () => {
  const t = new LocomotionTransform(), head = { x: 3, z: -2 }, hand = { x: 3.4, z: -2 };
  t.apply(head, 0, 0, Math.PI / 2);
  const h = rotateXZ(head, t.yaw), arm = rotateXZ(hand, t.yaw);
  close(h.x + t.x, head.x); close(h.z + t.z, head.z);
  close(Math.hypot(arm.x - h.x, arm.z - h.z), .4);
  const raw = t.physicalPoint({ x: arm.x + t.x, z: arm.z + t.z });
  close(raw.x, hand.x); close(raw.z, hand.z);
});

test('movement gain combines with yaw in virtual travel direction without scaling steering', () => {
  const t = new LocomotionTransform();
  t.apply({ x: 0, z: 0 }, 0, 0, Math.PI / 2);
  t.apply({ x: 0, z: -1 }, 0, -.2, .1);
  const mapped = rotateXZ({ x: 0, z: -1 }, t.yaw);
  close(mapped.x + t.x, -1.2); close(mapped.z + t.z, 0);
  close(t.yaw, Math.PI / 2 + .1);
  const before = { ...t };
  t.apply({ x: 0, z: -1 }, 0, 0, 0);
  close(t.x, before.x); close(t.z, before.z); close(t.yaw, before.yaw);
  t.reset(); assert.deepEqual({ ...t }, { x: 0, z: 0, yaw: 0 });
});

test('sampling is consistent across headset frame rates', () => {
  const results = [60, 72, 90, 120].map(hz => run({ speed: 2.5, turnRate: 180,
    settings: { steeringEnabled: true, steeringMode: 'right', turnEnabled: true }, dt: 1 / hz }));
  for (const result of results) close(result.yaw, results[0].yaw, .003);
});

test('automatic steering targets stay inside concave boundaries', () => {
  const polygon = [{ x: 0, z: 0 }, { x: 3, z: 0 }, { x: 3, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 3 }, { x: 0, z: 3 }];
  assert.ok(isInsideBoundary(boundaryTarget(polygon), polygon));
  assert.equal(boundaryTarget([]), null);
});

test('saved settings reject malformed booleans, modes and nonfinite numbers', () => {
  const settings = sanitizeRedirectionSettings({ steeringEnabled: 'false', turnEnabled: 'true', steeringMode: 'garbage',
    maxCurvature: Infinity, steeringSpeed: 0, maxSteeringRate: 100, maxTurnGain: -1, turnSpeed: NaN });
  assert.deepEqual(settings, { steeringEnabled: false, turnEnabled: true, steeringMode: 'center', maxCurvature: 5,
    steeringSpeed: .8, maxSteeringRate: 30, maxTurnGain: .8, turnSpeed: 180 });
});
