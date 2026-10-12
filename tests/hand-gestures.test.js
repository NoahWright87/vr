import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureGate, SpellGestures, extractHand, fingerGunScore, shieldScore, farsightPose, JOINTS, FINGERS } from '../common/hand-gestures.js';

const p = (x = 0, y = 0, z = -.4) => ({ x, y, z });
const head = { position: p(0, 1.6, 0), forward: p(0, 0, -1), up: p(0, 1, 0) };
const gun = (thumb = 1.2) => ({ palm: p(.1, 1.4), size: .06, extension: { index: 1, middle: .4, ring: .45, pinky: .5 }, thumb, tip: p(.1, 1.4), aim: p(0, 0, -1), normal: p(0, 1, 0),
  joints: { 'index-finger-tip': p(.1, 1.4), 'thumb-tip': p(.1, 1.3) } });
const open = () => ({ ...gun(), extension: { index: 1, middle: 1, ring: 1, pinky: 1 } });
function circle(aperture = .16) {
  return Object.fromEntries(['left', 'right'].map(side => [side, { ...gun(), size: .06, palm: p(side === 'left' ? -.08 : .08, 1.5),
    joints: { 'index-finger-tip': p(side === 'left' ? -.006 : .006, 1.5 + aperture / 2), 'thumb-tip': p(side === 'left' ? -.006 : .006, 1.5 - aperture / 2) } }]));
}
function hold(engine, hands, from, to) { let r; for (let t = from; t <= to; t += 20) r = engine.update(hands, head, t); return r; }

test('noisy entry must settle continuously; release uses hysteresis and grace', () => {
  const gate = new GestureGate({ dwell: 100, grace: 80 });
  assert.equal(gate.update(.8, 0), false); gate.update(.6, 80);
  assert.equal(gate.update(.8, 100), false); assert.equal(gate.update(.8, 199), false);
  assert.equal(gate.update(.8, 200), true); assert.equal(gate.update(.5, 220), true);
  assert.equal(gate.update(.2, 240), true); assert.equal(gate.update(.8, 280), true);
  gate.update(.2, 300); assert.equal(gate.update(.2, 380), false);
});
test('gun and open palms are mutually exclusive; hands must be in front', () => {
  assert.equal(fingerGunScore(gun(), head), 1); assert.equal(shieldScore(gun(), head), 0);
  assert.equal(fingerGunScore(open(), head), 0); assert.equal(shieldScore(open(), head), 1);
  assert.equal(shieldScore({ ...open(), normal: p(0, -1, 0) }, head), 0);
  assert.equal(fingerGunScore({ ...gun(), palm: p(0, 1.4, .2) }, head), 0);
});
test('lightning needs ready thumb, deliberate falling edge, and release to reload on either hand', () => {
  for (const side of ['left', 'right']) {
    const engine = new SpellGestures();
    assert.equal(hold(engine, { [side]: gun(.4) }, 0, 500)[side], 'lightning');
    assert.deepEqual(engine.update({ [side]: gun(.4) }, head, 520).casts, []);
    hold(engine, { [side]: gun(1.2) }, 540, 680);
    assert.deepEqual(engine.update({ [side]: gun(.4) }, head, 700).casts, [side]);
    assert.deepEqual(hold(engine, { [side]: gun(.4) }, 720, 1100).casts, []);
    hold(engine, { [side]: gun(1.2) }, 1120, 1260);
    assert.deepEqual(engine.update({ [side]: gun(.4) }, head, 1280).casts, [side]);
  }
});
test('thumb jitter in the hysteresis band does not shoot; cooldown requires a new arm', () => {
  const engine = new SpellGestures(); hold(engine, { right: gun() }, 0, 300);
  assert.deepEqual(engine.update({ right: gun(.80) }, head, 320).casts, []);
  assert.deepEqual(engine.update({ right: gun(.70) }, head, 340).casts, ['right']);
  hold(engine, { right: gun() }, 360, 480);
  assert.deepEqual(engine.update({ right: gun(.4) }, head, 500).casts, []);
  assert.deepEqual(engine.update({ right: gun(.4) }, head, 660).casts, []);
});
test('tracking loss and stalled frames clear arming immediately; another hand can keep casting', () => {
  const engine = new SpellGestures(); hold(engine, { left: gun(), right: gun() }, 0, 300);
  engine.update({ right: gun() }, head, 320);
  assert.deepEqual(engine.update({ left: gun(.4), right: gun(.4) }, head, 340).casts, ['right']);
  hold(engine, { left: gun() }, 360, 700);
  assert.deepEqual(engine.update({ left: gun(.4) }, head, 1000).casts, []);
});
test('leaving pointing pose during grace clears firing readiness', () => {
  const engine = new SpellGestures(); hold(engine, { right: gun() }, 0, 300);
  engine.update({ right: open() }, head, 320);
  assert.deepEqual(engine.update({ right: gun(.4) }, head, 340).casts, []);
});
test('farsight aperture maps to bounded telescope zoom; imperfect fingertip seams are tolerated', () => {
  assert.equal(farsightPose(...Object.values(circle(.20)), head).zoom, 2);
  assert.ok(Math.abs(farsightPose(...Object.values(circle(.10)), head).zoom - 4) < 1e-8);
  assert.ok(Math.abs(farsightPose(...Object.values(circle(.025)), head).zoom - 16) < 1e-8);
  assert.equal(farsightPose(...Object.values(circle(.01)), head), null);
  const hands = circle(); hands.right.joints['index-finger-tip'].x = .035;
  assert.ok(farsightPose(hands.left, hands.right, head));
  hands.right.joints['index-finger-tip'].x = .13;
  assert.equal(farsightPose(hands.left, hands.right, head), null);
});
test('circle excludes open hands, clasped hands, reversed seams, sideways or distant aperture', () => {
  const cases = [h => { h.left.extension.middle = 1; }, h => { h.left.palm = h.right.palm; },
    h => { for (const hand of Object.values(h)) { const j = hand.joints; [j['index-finger-tip'], j['thumb-tip']] = [j['thumb-tip'], j['index-finger-tip']]; } },
    h => { h.right.palm = p(-.08, 1.5, -.65); },
    h => { for (const hand of Object.values(h)) { hand.palm.z = -2; Object.values(hand.joints).forEach(j => { j.z = -2; }); } }];
  for (const change of cases) { const h = circle(); change(h); assert.equal(farsightPose(h.left, h.right, head), null); }
});
test('two-hand circle reserves both hands before activation and clears pending lightning', () => {
  const engine = new SpellGestures(); hold(engine, { left: gun(), right: gun() }, 0, 300);
  const h = circle(); h.left.thumb = h.right.thumb = .4;
  let r = engine.update(h, head, 320);
  assert.deepEqual(r.casts, []); assert.equal(r.left, null); assert.equal(r.right, null); assert.equal(r.lens, null);
  r = hold(engine, h, 340, 580); assert.ok(r.lens); assert.deepEqual(r.casts, []);
  r = engine.update({ left: h.left }, head, 600); assert.equal(r.lens, null);
  assert.deepEqual(hold(engine, { right: gun(.4) }, 620, 1000).casts, []);
});
test('extension feature extraction accepts a whole scaled hand and rejects partial/invalid input', () => {
  const joints = Object.fromEntries(JOINTS.map(name => [name, p(0, 0, 0)]));
  joints.wrist = p(0, -.08, 0);
  FINGERS.forEach((f, i) => {
    joints[`${f}-finger-metacarpal`] = p(i * .02, -.04, 0);
    ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].forEach((j, n) => { joints[`${f}-finger-${j}`] = p(i * .02, n * .025, 0); });
  });
  joints['thumb-tip'] = p(-.07, .02, 0);
  const before = JSON.stringify(joints), hand = extractHand(joints, p(0, 1, 0));
  assert.ok(hand); assert.equal(hand.extension.index, 1); assert.equal(hand.size, .06);
  const scaled = Object.fromEntries(Object.entries(joints).map(([key, v]) => [key, p(v.x * 1.3, v.y * 1.3, v.z * 1.3)]));
  const large = extractHand(scaled, p(0, 1, 0));
  assert.ok(Math.abs(large.thumb - hand.thumb) < 1e-8); assert.equal(large.extension.index, hand.extension.index);
  assert.equal(JSON.stringify(joints), before);
  delete joints['thumb-tip']; assert.equal(extractHand(joints, p(0, 1, 0)), null);
  joints['thumb-tip'] = p(NaN, 0, 0); assert.equal(extractHand(joints, p(0, 1, 0)), null);
});
