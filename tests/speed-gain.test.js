import assert from 'node:assert/strict';
import test from 'node:test';
import { SpeedGainTracker, gainAtSpeed, sanitizeGainSettings } from '../games/expansive-spaces/speed-gain.js';

function travel(speed, dt = 1 / 90, seconds = 2, settings = { maxGain: 1.2, speedForMax: 2 }) {
  const tracker = new SpeedGainTracker(settings);
  tracker.sample({ x: 0, z: 0 }, 0);
  let extra = 0, last;
  const frames = Math.round(seconds / dt);
  for (let i = 1; i <= frames; i++) {
    last = tracker.sample({ x: speed * i * dt, z: 0 }, i * dt * 1000);
    extra += last.extraX;
  }
  return { tracker, last, extra };
}

test('slow walking is exactly 1x and gain ramps to the configured maximum', () => {
  const settings = { maxGain: 1.2, speedForMax: 2 };
  assert.equal(gainAtSpeed(0, settings), 1);
  assert.equal(gainAtSpeed(.6, settings), 1);
  assert.equal(gainAtSpeed(1.3, settings), 1.1);
  assert.equal(gainAtSpeed(2, settings), 1.2);
  assert.equal(gainAtSpeed(5, settings), 1.2);
  assert.equal(travel(.4).extra, 0);
  assert.ok(Math.abs(travel(2).last.gain - 1.2) < 1e-6);
});

test('the two settings independently determine the ceiling and activation speed', () => {
  const faster = travel(1.2, 1 / 90, 2, { maxGain: 1.5, speedForMax: 1.2 });
  const slower = travel(1.2, 1 / 90, 2, { maxGain: 1.5, speedForMax: 3 });
  assert.ok(faster.last.gain > 1.499);
  assert.ok(slower.last.gain < 1.1);
  assert.equal(travel(3, 1 / 90, 2, { maxGain: 1, speedForMax: 1.2 }).extra, 0);
});

test('only horizontal displacement in the direction of travel is amplified', () => {
  const tracker = new SpeedGainTracker();
  tracker.sample({ x: 0, y: 1.6, z: 0 }, 0);
  for (let i = 1; i <= 50; i++) {
    const still = tracker.sample({ x: 0, y: i % 2, z: 0 }, i * 10);
    assert.equal(still.gain, 1);
    assert.equal(still.extraX, 0);
    assert.equal(still.extraZ, 0);
  }
  let last;
  for (let i = 1; i <= 100; i++) last = tracker.sample({ x: -.015 * i, y: 1.6, z: .02 * i }, 500 + i * 10);
  assert.ok(last.extraX < 0);
  assert.ok(last.extraZ > 0);
  assert.ok(Math.abs(last.extraX / last.extraZ + .75) < 1e-8);
});

test('stopping never coasts and slow steps after a sprint immediately return to 1x', () => {
  const { tracker } = travel(3);
  const slow = tracker.sample({ x: 6.004, z: 0 }, 2010);
  assert.equal(slow.gain, 1);
  assert.equal(slow.extraX, 0);
  const stopped = tracker.sample({ x: 6.004, z: 0 }, 2020);
  assert.equal(stopped.gain, 1);
  assert.equal(stopped.extraX, 0);
});

test('tracking gaps, recentering, invalid poses and time discontinuities add no travel', () => {
  const { tracker } = travel(3);
  assert.equal(tracker.sample({ x: 50, z: 0 }, 2010).extraX, 0);
  assert.equal(tracker.sample({ x: 51, z: 0 }, 3010).extraX, 0);
  assert.equal(tracker.sample({ x: 52, z: 0 }, 3010).extraX, 0);
  assert.equal(tracker.sample({ x: 53, z: 0 }, 3000).extraX, 0);
  tracker.reset();
  assert.equal(tracker.sample({ x: 100, z: 0 }, 4000).extraX, 0);
  assert.equal(tracker.sample({ x: NaN, z: 0 }, 4010).extraX, 0);
  assert.equal(tracker.sample({ x: 100, z: 0 }, 4020).extraX, 0);
});

test('settings changes affect subsequent steps without rescaling prior travel', () => {
  const { tracker } = travel(3);
  tracker.setSettings({ maxGain: 1 });
  const result = tracker.sample({ x: 6.03, z: 0 }, 2010);
  assert.equal(result.extraX, 0);
  assert.equal(result.gain, 1);
});

test('speed smoothing and integrated travel remain consistent across headset refresh rates', () => {
  const runs = [60, 72, 90, 120].map(hz => travel(2.5, 1 / hz));
  for (const run of runs) {
    assert.ok(Math.abs(run.last.gain - 1.2) < 1e-6);
    assert.ok(Math.abs(run.extra - runs[0].extra) < .005);
  }
});

test('settings reject nonfinite values and preserve a usable ramp interval', () => {
  assert.deepEqual(sanitizeGainSettings({ maxGain: Infinity, speedForMax: NaN }), { maxGain: 1.2, speedForMax: 2 });
  assert.deepEqual(sanitizeGainSettings({ maxGain: .5, speedForMax: 0 }), { maxGain: 1, speedForMax: .8 });
  assert.deepEqual(sanitizeGainSettings({ maxGain: 10, speedForMax: 100 }), { maxGain: 2, speedForMax: 4 });
});
