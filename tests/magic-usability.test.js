import test from 'node:test';
import assert from 'node:assert/strict';
import { HandPersistence } from '../common/hand-persistence.js';
import { extractHand, JOINTS, FINGERS, dot } from '../common/hand-gestures.js';
import { SpellSandbox } from '../games/magic-hands/spell-sandbox.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const head = { position: v(0, 1.6), forward: v(0, 0, -1), up: v(0, 1) };
const hand = (kind = 'cup', z = -.35, pinch = 2, y = 1.25) => {
  const openness = kind === 'fist' ? .35 : kind === 'open' ? .98 : kind === 'point' ? .35 : .72;
  return { palm: v(0, y, z), tip: v(0, y, z - .08), normal: kind === 'cup' ? v(0, 1) : v(0, 0, -1), aim: v(0, 0, -1),
    extension: Object.fromEntries(FINGERS.map(f => [f, kind === 'point' && f === 'index' ? .98 : openness])),
    pinch, size: .06, joints: { wrist: v(0, y, z) } };
};
function pipeline(props = []) {
  const engine = new SpellSandbox(props), memory = new HandPersistence(); let time = -20; const events = [];
  return { engine, memory, events, step(raw, ms = 20, gaze = head, world = {}) {
    time += ms; const result = engine.update(memory.update({ right: raw }, time), gaze, time, world); events.push(...result.events); return result;
  } };
}
const repeat = (p, n, raw) => { for (let i = 0; i < n; i++) p.step(typeof raw === 'function' ? raw(i) : raw); };
test('missing hands persist independently for 1.5 seconds and reacquisition is explicit', () => {
  const m = new HandPersistence(); m.update({ left: hand(), right: hand() }, 0);
  let r = m.update({ left: hand() }, 800); assert.equal(r.right.tracked, false); assert.equal(r.left.tracked, true);
  r = m.update({ right: hand() }, 1100); assert.equal(r.right.reacquired, true); assert.equal(r.right.missingFor, 1100);
  assert.equal(m.update({}, 2601).right, null); m.reset(); assert.equal(m.update({}, 2700).left, null);
});
test('fire survives a rearward windup out of view and a cupped thrust fires once', () => {
  const p = pipeline(); repeat(p, 25, hand()); assert.equal(p.engine.hands.right.mode, 'fireball');
  repeat(p, 40, null); assert.equal(p.engine.hands.right.mode, 'fireball'); assert.equal(p.events.length, 0);
  p.step(hand('cup', -.2)); repeat(p, 12, i => hand('cup', -.2 - i * .025));
  assert.equal(p.events.filter(e => e.type === 'cast').length, 1); assert.equal(p.engine.hands.right.mode, 'idle');
});
test('a returning open throwing hand releases fire once; unseen input never fires', () => {
  const p = pipeline(); repeat(p, 25, hand()); repeat(p, 25, null);
  assert.equal(p.events.length, 0); p.step(hand('open', -.5));
  repeat(p, 10, hand('open', -.5)); assert.equal(p.events.filter(e => e.type === 'cast').length, 1);
});
test('three consecutive fireballs can be created and thrust without resetting or relaxing', () => {
  const p = pipeline();
  for (let shot = 0; shot < 3; shot++) { repeat(p, 25, hand()); repeat(p, 14, i => hand('cup', -.35 - i * .025)); }
  assert.equal(p.events.filter(e => e.type === 'cast').length, 3);
});
test('dismissing fire immediately permits another cupped hold', () => {
  const p = pipeline(); repeat(p, 25, hand()); const down = hand('open'); down.normal = v(0, -1);
  repeat(p, 20, down); assert.equal(p.engine.hands.right.mode, 'idle'); repeat(p, 20, hand());
  assert.equal(p.engine.hands.right.mode, 'fireball');
});
test('boulder persists through an unseen windup, then punches using fresh motion', () => {
  const p = pipeline(); repeat(p, 20, hand('fist', -.25)); repeat(p, 35, null);
  assert.equal(p.engine.hands.right.mode, 'boulder'); p.step(hand('fist', -.2));
  assert.equal(p.events.filter(e => e.type === 'cast').length, 0);
  repeat(p, 12, i => hand('fist', -.2 - i * .035)); assert.equal(p.events.filter(e => e.type === 'cast').length, 1);
});
test('expired tracking releases ownership into hover; brief loss does not drop props', () => {
  const p = pipeline([{ id: 'stone', position: v(0, 1.25, -.45), radius: .15 }]);
  p.step(hand('fist', -.35)); assert.equal(p.engine.bodies[0].owner, 'right');
  repeat(p, 40, null); assert.equal(p.engine.bodies[0].owner, 'right');
  repeat(p, 40, null); const b = p.engine.bodies[0]; assert.equal(b.owner, null); assert.equal(b.hover, true); assert.ok(b.position.y >= .70);
});
test('a yank followed by an open glove summons and holds the prop', () => {
  const p = pipeline([{ id: 'stone', position: v(0, 1.25, -2.5), radius: .15 }]);
  p.step(hand('point', -.6)); p.step(hand('point', -.6, .2));
  repeat(p, 8, i => hand(i < 4 ? 'point' : 'open', -.6 + i * .035, i < 4 ? .2 : 2));
  repeat(p, 60, hand('open', -.32)); const s = p.engine.hands.right;
  assert.equal(s.phase, 'held'); assert.equal(s.glove, true); assert.equal(s.body.owner, 'right'); assert.ok(s.body.position.z > -.6);
});
test('a fist already wearing a boulder can grab a nearby prop directly', () => {
  const p = pipeline([{ id: 'stone', position: v(.2, 1.25, -.8), radius: .15 }]);
  repeat(p, 20, hand('fist', -.2)); assert.equal(p.engine.hands.right.mode, 'boulder');
  repeat(p, 10, i => hand('fist', -.2 - i * .04)); assert.equal(p.engine.bodies[0].owner, 'right'); assert.equal(p.engine.hands.right.mode, 'telekinesis');
});
test('thrown props never penetrate the floor and return to a reachable hover', () => {
  const p = pipeline([{ id: 'stone', position: v(0, .05, -2), radius: .15 }]), body = p.engine.bodies[0];
  Object.assign(body, { awake: true, hover: false, velocity: v(0, -20) });
  for (let i = 0; i < 400; i++) { p.step(null); assert.ok(body.position.y >= body.radius); }
  assert.equal(body.hover, true); assert.ok(body.position.y > .70);
});
test('gaze influences a thrust even when the hand moves straight forward', () => {
  const p = pipeline(); repeat(p, 25, hand()); const gaze = { ...head, forward: v(.6, 0, -.8) };
  for (let i = 0; i < 8; i++) p.step(hand('cup', -.35 - i * .03), 20, gaze);
  assert.ok(p.engine.projectiles[0].velocity.x > 1); assert.ok(p.engine.projectiles[0].velocity.z < -2);
});
test('aim averages whole-hand and index axes instead of relying on the fingertip', () => {
  const joints = Object.fromEntries(JOINTS.map(name => [name, v()])); joints.wrist = v(0, -.085);
  FINGERS.forEach((f, i) => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].forEach((joint, n) => { joints[f + '-finger-' + joint] = v(i * .02 + (f === 'index' ? n * .018 : 0), n * .025); }));
  joints['thumb-phalanx-distal'] = v(-.04, .02); joints['thumb-tip'] = v(-.07, .02);
  const h = extractHand(joints, v(0, 0, -1)); assert.ok(h); assert.ok(dot(h.aim, h.fingerAim) > .8); assert.ok(dot(h.aim, h.handAim) > .8);
  assert.notDeepEqual(h.aim, h.fingerAim);
});
test('teleport transforms remembered hands along with held objects', () => {
  const m = new HandPersistence(); m.update({ right: hand() }, 0); m.update({}, 100);
  m.transform(p => v(p.x + 4, p.y, p.z - 10), d => ({ ...d }));
  const h = m.update({}, 120).right; assert.equal(h.palm.x, 4); assert.equal(h.palm.z, -10.35); assert.equal(h.tracked, false);
});
