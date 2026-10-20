import assert from 'node:assert/strict';
import test from 'node:test';
import { MotionEffectsTracker, coast, sanitizeMotionSettings } from '../games/expansive-spaces/motion-effects.js';

const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
function arms({ seconds = 3, hz = 90, speed = 2.5, amplitude = .25, pattern = 'opposed', enabled = true } = {}) {
  const tracker = new MotionEffectsTracker({ armEnabled: enabled, armSpeed: 1.5, maxArmGain: 3 });
  let extra = 0, peak = 1;
  for (let i = 0; i <= seconds * hz; i++) {
    const t = i / hz, z = -speed * t, swing = amplitude * Math.sin(t * Math.PI * 4);
    const result = tracker.sample({ x: 0, y: 1.6, z }, t * 1000, { baseGain: 1.2, hands: {
      left: { x: -.25, z: z + swing }, right: { x: .25, z: z + (pattern === 'one' ? 0 : pattern === 'same' ? swing : -swing) },
    } });
    extra -= result.extraZ; peak = Math.max(peak, result.effectiveGain);
  }
  return { tracker, extra, peak };
}
function runAndDip(depth, settings = {}) {
  const tracker = new MotionEffectsTracker({ slideEnabled: true, slideBoost: 3, slidePercentLoss: 0, ...settings });
  for (let i = 0; i <= 100; i++) tracker.sample({ x: 0, y: 1.6, z: -.02 * i }, i * 10, { baseGain: 1.2 });
  let result;
  const frames = 40;
  for (let i = 1; i <= frames; i++) result = tracker.sample({ x: 0, y: 1.6 - depth * i / frames, z: -2 }, 1000 + i * 10, { baseGain: 1.2 });
  return { tracker, result };
}

test('new movement effects default off and preserve ordinary walking gain', () => {
  const settings = sanitizeMotionSettings();
  assert.ok(!settings.armEnabled && !settings.slideEnabled && !settings.jumpEnabled);
  const tracker = new MotionEffectsTracker();
  tracker.sample({ x: 0, y: 1.6, z: 0 }, 0);
  const result = tracker.sample({ x: 0, y: 1.6, z: -.03 }, 10, { baseGain: 1.2 });
  close(result.extraZ, -.006); assert.equal(result.worldZ, 0); assert.equal(result.effectiveGain, 1.2);
});
test('opposed two-arm strokes multiply walking gain, with an independent ceiling', () => {
  const result = arms();
  assert.ok(result.peak > 3.59 && result.peak <= 3.6);
  assert.ok(result.extra > arms({ enabled: false }).extra * 3);
});
test('both simultaneous and alternating strokes work; one arm, tiny shakes and stationary pumping do not boost', () => {
  assert.ok(arms({ pattern: 'same' }).peak > 3.59);
  for (const options of [{ pattern: 'one' }, { amplitude: .01 }, { amplitude: 0 }, { speed: 0 }]) {
    close(arms(options).peak, 1.2);
  }
  const { tracker } = arms();
  const sample = tracker.sample({ x: 0, y: 1.6, z: -7.53 }, 3010, { baseGain: 1.2, hands: { left: { x: -.25, z: -7.4 } } });
  assert.equal(sample.armGain, 1); assert.equal(tracker.armTracked, false);
});
test('deeper crouches produce more slide momentum from recent amplified velocity', () => {
  const shallow = runAndDip(.3), deep = runAndDip(1.35);
  assert.ok(shallow.result.momentumSpeed > .5);
  assert.ok(deep.result.momentumSpeed > shallow.result.momentumSpeed * 5);
  assert.ok(deep.result.worldZ < 0); assert.equal(deep.result.worldX, 0);
  assert.equal(runAndDip(1.35, { slideEnabled: false }).result.momentumSpeed, 0);
});
test('ducking without prior travel does not launch a slide', () => {
  const tracker = new MotionEffectsTracker({ slideEnabled: true });
  for (let i = 0; i <= 40; i++) {
    const result = tracker.sample({ x: 0, y: 1.6 - i * .02, z: 0 }, i * 10);
    assert.equal(result.momentumSpeed, 0);
  }
});
test('flat and percentage loss have exact frame-rate-independent distance and speed', () => {
  for (const [mode, loss] of [['flat', .5], ['percent', .5], ['percent', 0]]) {
    const once = coast(6, 2, mode, loss);
    for (const hz of [60, 90, 120]) {
      let speed = 6, distance = 0;
      for (let i = 0; i < hz * 2; i++) { const r = coast(speed, 1 / hz, mode, loss); speed = r.speed; distance += r.distance; }
      close(speed, once.speed); close(distance, once.distance);
    }
  }
  close(coast(6, 1, 'percent', .5).speed, 3);
  assert.deepEqual(coast(6, 0, 'percent', .5), { speed: 6, distance: 0 });
  assert.deepEqual(coast(1, 10, 'flat', 2), { speed: 0, distance: .25 });
});
test('standing, disabling, the watch and tracking interruptions stop momentum', () => {
  for (const mode of ['stand', 'disable', 'watch', 'gap', 'jump']) {
    const { tracker } = runAndDip(.8);
    if (mode === 'disable') tracker.setSettings({ slideEnabled: false });
    const r = tracker.sample({ x: 0, y: mode === 'stand' ? 1.6 : .8, z: mode === 'jump' ? 20 : -2 },
      mode === 'gap' ? 2500 : 1410, { paused: mode === 'watch' });
    assert.equal(r.momentumSpeed, 0, mode);
    assert.equal(r.worldZ, 0, mode);
  }
});
test('jump gain is independent of crouch gain and stops when the head returns', () => {
  function jump(boost, slideBoost) {
    const tracker = new MotionEffectsTracker({ jumpEnabled: true, jumpBoost: boost, jumpPercentLoss: 0, slideBoost });
    for (let i = 0; i <= 100; i++) tracker.sample({ x: 0, y: 1.6, z: -.02 * i }, i * 10);
    let result;
    for (let i = 1; i <= 20; i++) result = tracker.sample({ x: 0, y: 1.6 + i * .01, z: -2 }, 1000 + i * 10);
    const speed = result.momentumSpeed;
    for (let i = 1; i <= 20; i++) result = tracker.sample({ x: 0, y: 1.8 - i * .01, z: -2 }, 1200 + i * 10);
    assert.equal(result.momentumSpeed, 0); return speed;
  }
  close(jump(1.5, 1), 3); close(jump(1.5, 10), 3); close(jump(5, 1), 10);
});
test('calibration and world-space slide direction are preserved without changing head height', () => {
  const tracker = new MotionEffectsTracker({ slideEnabled: true, slidePercentLoss: 0 });
  assert.equal(tracker.calibrate(.2), false); assert.equal(tracker.calibrate(1.8), true);
  for (let i = 0; i <= 100; i++) tracker.sample({ x: 0, y: 1.8, z: -.02 * i }, i * 10, { yaw: Math.PI / 2 });
  let result;
  for (let i = 1; i <= 30; i++) result = tracker.sample({ x: 0, y: 1.8 - i * .02, z: -2 }, 1000 + i * 10, { yaw: 0 });
  assert.ok(result.worldX < 0); close(result.worldZ, 0);
  assert.equal(tracker.standingHeight, 1.8);
  tracker.reset(); assert.equal(tracker.standingHeight, 1.8);
});

function hop({ gain = 5, rise = .28, hz = 90, forward = false } = {}) {
  const tracker = new MotionEffectsTracker({ jumpEnabled: true, jumpVerticalGain: gain, jumpBoost: 4, jumpPercentLoss: 0 });
  const outputs = [];
  for (let i = 0; i <= hz; i++) tracker.sample({ x: 0, y: 1.6, z: forward ? -2 * i / hz : 0 }, i * 1000 / hz);
  for (let i = 1; i <= hz; i++) {
    const y = 1.6 + rise * Math.sin(Math.PI * i / hz);
    const result = tracker.sample({ x: 0, y, z: forward ? -2 : 0 }, 1000 + i * 1000 / hz);
    outputs.push({ ...result, y });
  }
  return { tracker, outputs };
}

test('vertical jump gain amplifies a hop in place independently of forward momentum', () => {
  const { tracker, outputs } = hop({ gain: 5 });
  const peak = outputs.reduce((best, p) => p.y + p.heightOffset > best.y + best.heightOffset ? p : best);
  // 28 cm real rise: first 8 cm is unmodified, the remaining 20 cm is 5x.
  close(peak.y + peak.heightOffset - 1.6, 1.08, .001);
  assert.ok(outputs.every(p => p.worldX === 0 && p.worldZ === 0 && p.momentumSpeed === 0));
  close(outputs.at(-1).heightOffset, 0);
  close(tracker.standingHeight, 1.6);
});

test('height gain of one is a tracked-height baseline and small dips never lift', () => {
  assert.ok(hop({ gain: 1 }).outputs.every(p => p.heightOffset === 0));
  assert.ok(hop({ gain: 10, rise: .07 }).outputs.every(p => p.heightOffset === 0));
  const { tracker } = runAndDip(.8, { jumpEnabled: true, jumpVerticalGain: 10 });
  assert.equal(tracker.jumpLift, 0);
});

test('larger real hops yield larger virtual heights; height and forward settings remain independent', () => {
  const low = hop({ gain: 3, rise: .2 }), high = hop({ gain: 3, rise: .4 });
  assert.ok(Math.max(...high.outputs.map(p => p.heightOffset)) > Math.max(...low.outputs.map(p => p.heightOffset)) * 2);
  const a = hop({ gain: 1, forward: true }), b = hop({ gain: 8, forward: true });
  a.outputs.forEach((p, i) => { close(p.worldZ, b.outputs[i].worldZ); close(p.momentumSpeed, b.outputs[i].momentumSpeed); });
  assert.ok(b.outputs.some(p => p.heightOffset > 1 && p.momentumSpeed > 0));
});

test('threshold activation and landing produce no positional step or residual lift', () => {
  const tracker = new MotionEffectsTracker({ jumpEnabled: true, jumpVerticalGain: 10 });
  tracker.calibrate(1.6);
  tracker.sample({ x: 0, y: 1.67, z: 0 }, 0);
  const entry = tracker.sample({ x: 0, y: 1.6801, z: 0 }, 20);
  assert.ok(entry.heightOffset >= 0 && entry.heightOffset < .00001);
  tracker.sample({ x: 0, y: 1.8, z: 0 }, 80);
  const exit = tracker.sample({ x: 0, y: 1.6801, z: 0 }, 140);
  assert.ok(exit.heightOffset < .00001);
  assert.equal(tracker.sample({ x: 0, y: 1.6, z: 0 }, 200).heightOffset, 0);
});

test('watch, disabling, calibration, reset and lost tracking clear vertical gain', () => {
  for (const mode of ['watch', 'disable', 'calibrate', 'reset', 'gap', 'invalid', 'pose-jump']) {
    const tracker = new MotionEffectsTracker({ jumpEnabled: true, jumpVerticalGain: 5 });
    tracker.sample({ x: 0, y: 1.6, z: 0 }, 0);
    tracker.sample({ x: 0, y: 1.9, z: 0 }, 100);
    assert.ok(tracker.jumpLift > .5);
    if (mode === 'disable') tracker.setSettings({ jumpEnabled: false });
    if (mode === 'calibrate') tracker.calibrate(1.9);
    if (mode === 'reset') tracker.reset();
    const r = tracker.sample({ x: 0, y: mode === 'invalid' ? NaN : mode === 'pose-jump' ? 2.5 : 1.9, z: 0 },
      mode === 'gap' ? 1000 : 120, { paused: mode === 'watch' });
    assert.equal(r.heightOffset, 0, mode);
    assert.equal(tracker.jumpLift, 0, mode);
  }
});

test('the same physical hop has the same vertical peak at different headset rates', () => {
  for (const hz of [60, 72, 90, 120]) {
    close(Math.max(...hop({ hz }).outputs.map(p => p.y + p.heightOffset)), 2.68, .002);
  }
  assert.equal(sanitizeMotionSettings({ jumpVerticalGain: Infinity }).jumpVerticalGain, 3);
  assert.equal(sanitizeMotionSettings({ jumpVerticalGain: -2 }).jumpVerticalGain, 1);
  assert.equal(sanitizeMotionSettings({ jumpVerticalGain: 100 }).jumpVerticalGain, 10);
});
