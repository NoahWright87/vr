import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMotionSense,
  updateMotionSense,
  describeMotion,
  flatForward,
} from '../common/motion-sense.js';

const FRAME = 1000 / 72;

function yawQuat(yaw) {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

// A pose in the body's own frame: x right, y up, z back (so -z is
// forward), rotated by `yaw` about a torso at the origin.
function bodyPoint(local, yaw) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: local.x * c + local.z * s, y: local.y, z: -local.x * s + local.z * c };
}

function frame(t, { yaw = 0, head = { x: 0, y: 1.6, z: 0 }, left, right, headYaw }) {
  const headQ = yawQuat(headYaw === undefined ? yaw : headYaw);
  const pose = (p) => p && { position: p, quaternion: headQ, tracked: true };
  return { t, head: { position: head, quaternion: headQ, tracked: true }, left: pose(left), right: pose(right) };
}

// Hands resting low by the hips, in body space.
const REST_L = { x: -0.22, y: 1.0, z: -0.1 };
const REST_R = { x: 0.22, y: 1.0, z: -0.1 };

function run(state, frames) {
  frames.forEach((f) => updateMotionSense(state, f));
  return state;
}

test('flatForward points down -Z with no rotation and turns with yaw', () => {
  const f = flatForward(yawQuat(0));
  assert.ok(Math.abs(f.x) < 1e-9 && Math.abs(f.z + 1) < 1e-9);
  const left = flatForward(yawQuat(Math.PI / 2)); // turned left
  assert.ok(Math.abs(left.x + 1) < 1e-9);
  // Looking straight up has no meaningful facing.
  assert.equal(flatForward({ x: Math.sin(Math.PI / 4), y: 0, z: 0, w: Math.cos(Math.PI / 4) }), null);
});

test('standing still with tracking jitter earns no energy', () => {
  const state = createMotionSense();
  let seed = 7;
  const jitter = () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.004; };
  const frames = [];
  for (let i = 0; i < 72 * 3; i++) {
    const j = (p) => ({ x: p.x + jitter(), y: p.y + jitter(), z: p.z + jitter() });
    frames.push(frame(i * FRAME, { head: j({ x: 0, y: 1.6, z: 0 }), left: j(REST_L), right: j(REST_R) }));
  }
  run(state, frames);
  assert.ok(state.energy < 0.03, `energy ${state.energy}`);
  assert.equal(state.left.presented, false);
  assert.equal(state.right.presented, false);
});

test('looking around without moving earns no energy but reports the turn rate', () => {
  const state = createMotionSense();
  const frames = [];
  let maxRate = 0;
  for (let i = 0; i < 72 * 2; i++) {
    // Sweep the head ±60° at about 120°/s; hands stay where they are.
    const headYaw = Math.sin((i / 72) * Math.PI) * (Math.PI / 3);
    frames.push(frame(i * FRAME, { headYaw, left: REST_L, right: REST_R }));
  }
  frames.forEach((f) => { updateMotionSense(state, f); maxRate = Math.max(maxRate, Math.abs(state.yawRate)); });
  assert.ok(state.energy < 0.03, `energy ${state.energy}`);
  assert.ok(maxRate > 150, `turn rate ${maxRate}`);
});

test('turning the body with an arm held out does not change its extension', () => {
  const state = createMotionSense({ facingMs: 0 });
  const out = { x: 0.15, y: 1.25, z: -0.55 }; // right arm held forward
  const readings = [];
  for (let i = 0; i < 72; i++) {
    const yaw = (i / 72) * (Math.PI / 2); // a 90° turn over a second
    const head = bodyPoint({ x: 0, y: 1.6, z: 0 }, yaw);
    updateMotionSense(state, frame(i * FRAME, { yaw, head, left: bodyPoint(REST_L, yaw), right: bodyPoint(out, yaw) }));
    readings.push(state.right.extension.forward);
  }
  const spread = Math.max(...readings) - Math.min(...readings);
  assert.ok(spread < 0.01, `forward extension varied by ${spread}`);
  assert.equal(state.right.presented, true);
});

test('a jab drives energy up within its first 100 ms and presents the hand', () => {
  const state = createMotionSense();
  // Settle at rest first.
  const frames = [];
  let t = 0;
  for (let i = 0; i < 36; i++, t += FRAME) frames.push(frame(t, { left: REST_L, right: { x: 0.2, y: 1.3, z: -0.15 } }));
  run(state, frames);
  assert.ok(state.energy < 0.05);

  // 0.45 m forward in 130 ms (about 3.5 m/s).
  let energyAt100 = null;
  const steps = Math.round(130 / FRAME);
  for (let i = 1; i <= steps; i++, t += FRAME) {
    const z = -0.15 - 0.45 * (i / steps);
    updateMotionSense(state, frame(t, { left: REST_L, right: { x: 0.2, y: 1.3, z } }));
    if (energyAt100 === null && i * FRAME >= 100) energyAt100 = state.energy;
  }
  assert.ok(energyAt100 > 0.5, `energy at 100 ms ${energyAt100}`);
  assert.equal(state.right.presented, true);
  assert.ok(state.right.extension.forward > 0.9);
});

test('energy releases slowly after motion stops', () => {
  const state = createMotionSense();
  let t = 0;
  // A second of fast shadowboxing: right hand oscillating 0.4 m at 2 Hz.
  for (let i = 0; i < 72; i++, t += FRAME) {
    const z = -0.2 - 0.2 * (1 - Math.cos((i / 72) * 4 * Math.PI));
    updateMotionSense(state, frame(t, { left: REST_L, right: { x: 0.2, y: 1.3, z } }));
  }
  const peak = state.energy;
  assert.ok(peak > 0.3, `peak ${peak}`);
  // 200 ms of stillness: still well up (between punches).
  for (let i = 0; i < 14; i++, t += FRAME) updateMotionSense(state, frame(t, { left: REST_L, right: { x: 0.2, y: 1.3, z: -0.2 } }));
  assert.ok(state.energy > peak * 0.6, `after 200 ms ${state.energy}`);
  // Three seconds of stillness: gone.
  for (let i = 0; i < 72 * 3; i++, t += FRAME) updateMotionSense(state, frame(t, { left: REST_L, right: { x: 0.2, y: 1.3, z: -0.2 } }));
  assert.ok(state.energy < 0.05, `after 3 s ${state.energy}`);
});

test('a tracking jump is rejected rather than read as a very fast hand', () => {
  const state = createMotionSense();
  let t = 0;
  for (let i = 0; i < 20; i++, t += FRAME) updateMotionSense(state, frame(t, { left: REST_L, right: REST_R }));
  // The right hand teleports a metre in one frame (lost and re-found).
  updateMotionSense(state, frame(t, { left: REST_L, right: { x: 1.2, y: 1.0, z: -0.1 } }));
  assert.equal(state.right.glitches, 1);
  assert.ok(state.right.speed < 0.5, `speed ${state.right.speed}`);
  assert.ok(state.energy < 0.05);
  // And it carries on from the new place without a second spike.
  t += FRAME;
  updateMotionSense(state, frame(t, { left: REST_L, right: { x: 1.2, y: 1.0, z: -0.1 } }));
  assert.ok(state.right.speed < 0.5);
});

test('walking counts through the head, and hands carried along are not fast hands', () => {
  const state = createMotionSense();
  let t = 0;
  for (let i = 0; i < 72; i++, t += FRAME) {
    const dz = -1.2 * (t / 1000); // walking forward at 1.2 m/s
    const shift = (p) => ({ x: p.x, y: p.y, z: p.z + dz });
    updateMotionSense(state, frame(t, { head: shift({ x: 0, y: 1.6, z: 0 }), left: shift(REST_L), right: shift(REST_R) }));
  }
  assert.ok(state.right.relativeSpeed < 0.05, `relative ${state.right.relativeSpeed}`);
  assert.ok(state.drive.head > 0.5, `head drive ${state.drive.head}`);
  assert.ok(state.energy > 0.5);
});

test('a long frame gap restarts velocity and energy instead of spanning it', () => {
  const state = createMotionSense();
  updateMotionSense(state, frame(0, { left: REST_L, right: REST_R }));
  updateMotionSense(state, frame(1000, { left: REST_L, right: { x: 0.2, y: 1.3, z: -0.6 } }));
  assert.equal(state.right.speed, 0);
  assert.equal(state.energy, 0);
});

test('an untracked hand reads as absent, and restarts cleanly when it returns', () => {
  const state = createMotionSense();
  let t = 0;
  for (let i = 0; i < 10; i++, t += FRAME) updateMotionSense(state, frame(t, { left: REST_L, right: REST_R }));
  updateMotionSense(state, { ...frame(t, { left: REST_L, right: REST_R }), right: { position: REST_R, tracked: false } });
  assert.equal(state.right.tracked, false);
  t += FRAME;
  // Comes back somewhere else: no velocity spike.
  updateMotionSense(state, frame(t, { left: REST_L, right: { x: 0.4, y: 1.3, z: -0.4 } }));
  assert.equal(state.right.tracked, true);
  assert.equal(state.right.speed, 0);
});

test('history keeps only the configured window, as copies', () => {
  const state = createMotionSense({ historySeconds: 1 });
  const head = { x: 0, y: 1.6, z: 0 };
  let t = 0;
  for (let i = 0; i < 72 * 3; i++, t += FRAME) updateMotionSense(state, frame(t, { head, left: REST_L, right: REST_R }));
  const span = state.history[state.history.length - 1].t - state.history[0].t;
  assert.ok(span <= 1000 && span > 950, `span ${span}`);
  head.x = 99; // mutating the caller's object must not rewrite history
  assert.equal(state.history[state.history.length - 1].head.position.x, 0);
});

test('describeMotion summarises energy and both hands on a few lines', () => {
  const state = createMotionSense();
  updateMotionSense(state, frame(0, { left: REST_L, right: { x: 0.15, y: 1.25, z: -0.6 } }));
  updateMotionSense(state, frame(FRAME, { left: REST_L, right: { x: 0.15, y: 1.25, z: -0.6 } }));
  const text = describeMotion(state);
  assert.match(text, /^ENERGY \[/);
  assert.match(text, /R: .*PRESENTED/);
  assert.ok(text.split('\n').length === 4);
});
