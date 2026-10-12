import assert from 'node:assert/strict';
import test from 'node:test';

import { createMotionSense, updateMotionSense } from '../common/motion-sense.js';
import { createStrikeDetector, updateStrikes, strikeForce, committedAxis } from '../common/intent.js';

const FRAME = 1000 / 72;
const Q = (yaw = 0) => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const HEAD = { x: 0, y: 1.6, z: 0 };
const REST_L = { x: -0.22, y: 1.0, z: -0.1 };
const GUARD_R = { x: 0.2, y: 1.35, z: -0.12 }; // fist up by the chin

function bodyPoint(p, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
}

// Runs a list of right-hand positions (one per frame) and returns every
// strike event.
function run(rightPositions, opts = {}) {
  const motion = createMotionSense({ facingMs: 0 });
  const detector = createStrikeDetector();
  const events = [];
  let t = 0;
  // Settle at guard first.
  for (let i = 0; i < 40; i++, t += FRAME) {
    updateMotionSense(motion, { t, head: { position: HEAD, quaternion: Q() }, left: { position: REST_L, quaternion: Q() }, right: { position: GUARD_R, quaternion: Q() } });
    updateStrikes(detector, motion);
  }
  rightPositions.forEach((p, i) => {
    const yaw = opts.yaw ? opts.yaw(i) : 0;
    const head = opts.head ? opts.head(i) : HEAD;
    updateMotionSense(motion, {
      t, head: { position: yaw ? bodyPoint(head, yaw) : head, quaternion: Q(yaw) },
      left: { position: yaw ? bodyPoint(REST_L, yaw) : REST_L, quaternion: Q(yaw) },
      right: { position: yaw ? bodyPoint(p, yaw) : p, quaternion: Q(yaw) },
    });
    events.push(...updateStrikes(detector, motion).map((e) => ({ ...e, frame: i })));
    t += FRAME;
  });
  return { events, detector };
}

// Linear motion from a to b over ms, then hold at b for holdMs.
function path(a, b, ms, holdMs = 200) {
  const out = [];
  const n = Math.max(1, Math.round(ms / FRAME));
  for (let i = 1; i <= n; i++) {
    const k = i / n;
    out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k });
  }
  for (let i = 0; i < Math.round(holdMs / FRAME); i++) out.push(b);
  return out;
}

const PUNCHED = { x: 0.15, y: 1.38, z: -0.62 };

test('a fast jab commits mid-extension and lands at full reach', () => {
  const { events } = run(path(GUARD_R, PUNCHED, 140));
  const phases = events.map((e) => e.axis + ':' + e.phase);
  assert.deepEqual(phases, ['forward:commit', 'forward:land']);
  const [commit, land] = events;
  assert.ok(commit.frame < land.frame, 'commit before land');
  assert.equal(commit.hand, 'right');
  assert.ok(commit.direction.z < -0.8, 'moving forward: ' + JSON.stringify(commit.direction));
  // Travel counts from where it armed (40% out), not from the guard.
  assert.ok(land.speed > 3 && land.travel > 0.3, JSON.stringify(land));
});

test('a slow reach to the same place never commits', () => {
  const { events } = run(path(GUARD_R, PUNCHED, 900));
  assert.deepEqual(events, []);
});

test('standing still at guard throws nothing', () => {
  const { events } = run(path(GUARD_R, GUARD_R, 16, 2000));
  assert.deepEqual(events, []);
});

test('turning the body with an arm held out throws nothing', () => {
  // Arm already out, then a fast 120° turn in half a second.
  const arm = path(PUNCHED, PUNCHED, 16, 700);
  const frames = arm.length;
  const { events } = run(arm, { yaw: (i) => Math.min(1, i / 36) * (2 * Math.PI / 3) });
  // The initial move out to the punched pose happens at frame 0 (a jump,
  // rejected as a tracking glitch) so nothing commits; the turn must not either.
  assert.equal(events.filter((e) => e.phase === 'commit').length, 0, JSON.stringify(events));
  assert.ok(frames > 36);
});

test('an uppercut commits on the up axis, not forward', () => {
  const top = { x: 0.15, y: 1.75, z: -0.3 };
  const low = { x: 0.18, y: 1.05, z: -0.2 };
  // Drop to a low guard, pause, then drive up fast.
  const frames = path(GUARD_R, low, 300, 200).concat(path(low, top, 150));
  const { events } = run(frames);
  const commits = events.filter((e) => e.phase === 'commit');
  assert.equal(commits.length, 1, JSON.stringify(events));
  assert.equal(commits[0].axis, 'up');
});

test('retracting before full reach cancels a committed strike', () => {
  const half = { x: 0.16, y: 1.37, z: -0.45 };
  const frames = path(GUARD_R, half, 60, 0).concat(path(half, GUARD_R, 60));
  // The hand goes fast but turns around before landing or stopping.
  const { events } = run(frames);
  const phases = events.map((e) => e.phase);
  assert.ok(phases.includes('commit'), JSON.stringify(phases));
  assert.ok(phases[phases.length - 1] === 'cancel' || phases[phases.length - 1] === 'land', JSON.stringify(phases));
});

test('two jabs in a row are two strikes; it re-arms only after coming back in', () => {
  const one = path(GUARD_R, PUNCHED, 140, 100).concat(path(PUNCHED, GUARD_R, 200, 100));
  const { events } = run(one.concat(one));
  assert.equal(events.filter((e) => e.phase === 'land').length, 2);
});

test('committedAxis reports a strike in flight', () => {
  const frames = path(GUARD_R, PUNCHED, 140, 0);
  const motion = createMotionSense({ facingMs: 0 });
  const detector = createStrikeDetector();
  let t = 0;
  let seen = null;
  const all = Array(30).fill(GUARD_R).concat(frames);
  for (const p of all) {
    updateMotionSense(motion, { t, head: { position: HEAD, quaternion: Q() }, left: { position: REST_L, quaternion: Q() }, right: { position: p, quaternion: Q() } });
    updateStrikes(detector, motion);
    seen = seen || committedAxis(detector, 'right');
    t += FRAME;
  }
  assert.equal(seen, 'forward');
});

test('strike force grows with speed, travel and stepping in, within bounds', () => {
  const lazy = strikeForce({ speed: 1.5, travel: 0.2, headTravel: 0 });
  const solid = strikeForce({ speed: 4, travel: 0.5, headTravel: 0.05 });
  const lunge = strikeForce({ speed: 6, travel: 0.6, headTravel: 0.4 });
  assert.ok(lazy < solid && solid < lunge);
  assert.ok(lazy >= 0.3 && lunge <= 2.5);
});

import { createThrowDetector, updateThrows } from '../common/intent.js';

function runThrows(rightPositions) {
  const motion = createMotionSense({ facingMs: 0 });
  const detector = createThrowDetector();
  const events = [];
  let t = 0;
  for (const p of Array(30).fill(GUARD_R).concat(rightPositions)) {
    updateMotionSense(motion, { t, head: { position: HEAD, quaternion: Q() }, left: { position: REST_L, quaternion: Q() }, right: { position: p, quaternion: Q() } });
    events.push(...updateThrows(detector, motion), ...updateStrikes(createStrikeDetector(), motion).filter(() => false));
    t += FRAME;
  }
  return events;
}

const COCKED = { x: 0.22, y: 1.68, z: 0.12 }; // hand up by the ear, behind
const RELEASE = { x: 0.15, y: 1.6, z: -0.45 };

test('an overhand whip releases a throw once, with its rise', () => {
  const frames = path(GUARD_R, COCKED, 400, 150).concat(path(COCKED, RELEASE, 130, 200));
  const events = runThrows(frames);
  assert.equal(events.length, 1, JSON.stringify(events));
  assert.equal(events[0].hand, 'right');
  assert.ok(events[0].speed > 2.2 && events[0].rise < 0.3, JSON.stringify(events[0]));
});

test('a jab, an uppercut and a slow reach to the visor throw nothing', () => {
  assert.deepEqual(runThrows(path(GUARD_R, PUNCHED, 140)), []);
  const low = { x: 0.18, y: 1.05, z: -0.2 };
  assert.deepEqual(runThrows(path(GUARD_R, low, 300, 200).concat(path(low, { x: 0.15, y: 1.8, z: -0.3 }, 150))), []);
  const temple = { x: 0.2, y: 1.62, z: 0.02 };
  assert.deepEqual(runThrows(path(GUARD_R, temple, 900, 400).concat(path(temple, { x: 0.18, y: 1.6, z: -0.15 }, 600))), []);
});

test('a second throw needs the hand to drop first', () => {
  const one = path(GUARD_R, COCKED, 400, 150).concat(path(COCKED, RELEASE, 130, 100));
  const again = path(RELEASE, COCKED, 300, 100).concat(path(COCKED, RELEASE, 130, 100));
  assert.equal(runThrows(one.concat(again)).length, 1);
  const reset = path(RELEASE, GUARD_R, 300, 100);
  assert.equal(runThrows(one.concat(reset, one)).length, 2);
});

test('a forward whip above the eyes is not a punch', () => {
  const frames = path(GUARD_R, COCKED, 400, 150).concat(path(COCKED, RELEASE, 130, 200));
  const { events } = run(frames);
  assert.equal(events.filter((e) => e.phase === 'commit').length, 0, JSON.stringify(events));
});
