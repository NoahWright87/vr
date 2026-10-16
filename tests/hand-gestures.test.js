import test from 'node:test';
import assert from 'node:assert/strict';
import { GestureGate, SpellGestures, extractHand, fingerGunScore, shieldScore, farsightPose, JOINTS, FINGERS } from '../common/hand-gestures.js';
const p = (x = 0, y = 0, z = -.4) => ({ x, y, z });
const head = { position: p(0, 1.6, 0), forward: p(0, 0, -1), up: p(0, 1, 0) };
const gun = (thumbAlignment = .15) => ({ palm: p(.1, 1.4), size: .06, extension: { index: 1, middle: .4, ring: .45, pinky: .5 },
  thumbAlignment, tip: p(.1, 1.4), aim: p(0, 0, -1), normal: p(0, 1, 0),
  joints: { wrist: p(.1, 1.35), 'index-finger-tip': p(.1, 1.4), 'thumb-tip': p(.1, 1.3) } });
const open = (z = -.60) => ({ ...gun(), palm: p(.16, 1.38, z), normal: p(0, 0, -1), side: 'right', extension: { index: 1, middle: 1, ring: 1, pinky: 1 } });
function circle(aperture = .18, depth = .4) {
  return Object.fromEntries(['left', 'right'].map(side => [side, { ...gun(), side, palm: p(side === 'left' ? -.065 : .065, 1.6, -depth),
    joints: { wrist: p(side === 'left' ? -.025 : .025, 1.6 - aperture / 2, -depth),
      'index-finger-tip': p(side === 'left' ? -.006 : .006, 1.6 + aperture / 2, -depth), 'thumb-tip': p(side === 'left' ? -.2 : .2, 1.5, -depth) } }]));
}
function hold(engine, hands, from, to) { let r; for (let t = from; t <= to; t += 10) r = engine.update(hands, head, t); return r; }
test('noisy entry must settle continuously; release uses hysteresis and grace', () => {
  const gate = new GestureGate({ dwell: 100, grace: 80 });
  assert.equal(gate.update(.8, 0), false); gate.update(.6, 80);
  assert.equal(gate.update(.8, 100), false); assert.equal(gate.update(.8, 199), false);
  assert.equal(gate.update(.8, 200), true); assert.equal(gate.update(.5, 220), true);
  assert.equal(gate.update(.2, 240), true); assert.equal(gate.update(.8, 280), true);
  gate.update(.2, 300); assert.equal(gate.update(.2, 380), false);
});
test('gun and open palm are distinct; only extended outward-facing palms produce shields', () => {
  assert.equal(fingerGunScore(gun(), head), 1); assert.equal(shieldScore(gun(), head), 0);
  assert.equal(fingerGunScore(open(), head), 0); assert.equal(shieldScore(open(), head), 1);
  assert.equal(shieldScore(open(-.25), head), 0);
  assert.equal(shieldScore({ ...open(), normal: p(0, 1, 0) }, head), 0);
  assert.equal(shieldScore({ ...open(), normal: p(0, 0, 1) }, head), 0);
  assert.equal(fingerGunScore({ ...gun(), palm: p(0, 1.4, .2) }, head), 0);
});
test('shield needs 80% reach on either side and dismisses immediately on retraction', () => {
  const engine = new SpellGestures();
  for (const side of ['left', 'right']) {
    const hand = { ...open(-.49), side, palm: p(side === 'left' ? -.16 : .16, 1.38, -.49) };
    assert.equal(shieldScore(hand, head), 1);
    assert.equal(hold(engine, { [side]: hand }, 0, 300)[side], 'shield');
    const retracted = { ...hand, palm: { ...hand.palm, z: -.45 } };
    assert.equal(engine.update({ [side]: retracted }, head, 310)[side], null);
    assert.equal(hold(engine, { [side]: retracted }, 320, 800)[side], null); engine.reset();
  }
});
test('holding the thumb bent fires continuously without lifting or precise thumb location', () => {
  for (const side of ['left', 'right']) {
    const engine = new SpellGestures(), casts = [];
    for (let t = 0; t <= 1000; t += 10) if (engine.update({ [side]: gun(.9) }, head, t).casts.length) casts.push(t);
    assert.ok(casts.length >= 5);
    assert.ok(casts.every((t, i) => !i || t - casts[i - 1] >= 150));
    for (let t = 1010; t <= 1200; t += 10) assert.deepEqual(engine.update({ [side]: gun(.15) }, head, t).casts, []);
  }
});
test('both hands have independent automatic fire cadence', () => {
  const engine = new SpellGestures(); hold(engine, { left: gun(), right: gun() }, 0, 300);
  assert.deepEqual(hold(engine, { left: gun(.9), right: gun() }, 310, 330).casts, ['left']);
  assert.deepEqual(hold(engine, { left: gun(), right: gun(.9) }, 340, 360).casts, ['right']);
  const counts = { left: 0, right: 0 };
  for (let t = 370; t <= 1300; t += 10) for (const side of engine.update({ left: gun(.9), right: gun(.9) }, head, t).casts) counts[side]++;
  assert.ok(counts.left >= 5 && counts.right >= 5);
});
test('a parallel spike does not fire; holding the thumb down repeats and raising it stops', () => {
  const engine = new SpellGestures(); hold(engine, { right: gun() }, 0, 300);
  assert.deepEqual(engine.update({ right: gun(.60) }, head, 310).casts, []);
  assert.deepEqual(engine.update({ right: gun(.90) }, head, 320).casts, []);
  assert.deepEqual(engine.update({ right: gun(.60) }, head, 330).casts, []);
  assert.deepEqual(hold(engine, { right: gun(.80) }, 340, 360).casts, ['right']);
  let count = 0;
  for (let t = 370; t <= 850; t += 10) count += engine.update({ right: gun(.9) }, head, t).casts.length;
  assert.equal(count, 3);
});
test('remembered hands cannot fire; reacquisition requires a fresh pose dwell', () => {
  const engine = new SpellGestures(); hold(engine, { right: gun(.9) }, 0, 300);
  for (let t = 310; t < 1000; t += 10) assert.deepEqual(engine.update({ right: { ...gun(.9), tracked: false } }, head, t).casts, []);
  assert.deepEqual(engine.update({ right: { ...gun(.9), reacquired: true } }, head, 1000).casts, []);
  assert.deepEqual(hold(engine, { right: gun(.9) }, 1010, 1100).casts, []);
  let count = 0;
  for (let t = 1110; t <= 1600; t += 10) count += engine.update({ right: gun(.9) }, head, t).casts.length;
  assert.ok(count >= 2);
});
test('farsight zoom follows face distance, not opening size; near is 10x and far is 2x', () => {
  const pose = (aperture, depth) => farsightPose(...Object.values(circle(aperture, depth)), head);
  assert.equal(pose(.18, .12).zoom, 10); assert.equal(pose(.18, .65).zoom, 2);
  assert.equal(pose(.10, .4).zoom, pose(.28, .4).zoom);
  assert.ok(pose(.18, .25).zoom > pose(.18, .50).zoom);
  assert.equal(pose(.18, .08).zoom, 10); assert.equal(pose(.18, .9).zoom, 2);
});
test('farsight accepts open spare fingers, other fingertip pairs and diamonds without thumb contact', () => {
  const h = circle(); h.left.extension = h.right.extension = open().extension;
  h.left.joints['middle-finger-tip'] = h.left.joints['index-finger-tip']; delete h.left.joints['index-finger-tip'];
  assert.ok(farsightPose(h.left, h.right, head)); assert.ok(farsightPose(...Object.values(circle(.28)), head));
});
test('farsight rejects disconnected heels/tips, no opening, sideways and behind-head shapes', () => {
  const changes = [h => { h.left.joints.wrist.x = -.25; }, h => { h.right.joints['index-finger-tip'].x = .25; },
    h => { for (const hand of Object.values(h)) hand.joints['index-finger-tip'].y = hand.joints.wrist.y; },
    h => { h.right.palm = p(-.065, 1.6, -.6); },
    h => { for (const hand of Object.values(h)) Object.values(hand.joints).forEach(j => { j.z = .4; }); }];
  for (const change of changes) { const h = circle(); change(h); assert.equal(farsightPose(h.left, h.right, head), null); }
});
test('farsight reserves both hands during loose formation and dwell, ahead of lightning', () => {
  const engine = new SpellGestures(); hold(engine, { left: gun(), right: gun() }, 0, 300);
  const h = circle(); h.left.thumbAlignment = h.right.thumbAlignment = .9;
  h.right.joints.wrist.x = .08;
  assert.equal(farsightPose(h.left, h.right, head), null);
  let r = hold(engine, h, 310, 340); assert.deepEqual(r.casts, []); assert.equal(r.left, null); assert.equal(r.lens, null);
  h.right.joints.wrist.x = .025;
  r = hold(engine, h, 350, 540); assert.ok(r.lens); assert.deepEqual(r.casts, []);
  assert.equal(engine.update({ left: h.left }, head, 550).lens, null);
  assert.deepEqual(hold(engine, { right: gun(.9) }, 560, 900).casts, []);
});
test('distal thumb angle is independent of thumb location and hand scale', () => {
  const joints = Object.fromEntries(JOINTS.map(name => [name, p(0, 0, 0)])); joints.wrist = p(0, -.08, 0);
  FINGERS.forEach((f, i) => {
    joints[`${f}-finger-metacarpal`] = p(i * .02, -.04, 0);
    ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].forEach((j, n) => { joints[`${f}-finger-${j}`] = p(i * .02, n * .025, 0); });
  });
  joints['thumb-phalanx-distal'] = p(-.04, .04, 0); joints['thumb-tip'] = p(-.07, .04, 0);
  assert.equal(extractHand(joints, p(0, 1, 0)).thumbAlignment, 0);
  joints['thumb-phalanx-distal'] = p(-.15, .20, 0); joints['thumb-tip'] = p(-.15, .235, 0);
  const down = extractHand(joints, p(0, 1, 0)); assert.ok(down.thumbAlignment > .99);
  const scaled = Object.fromEntries(Object.entries(joints).map(([key, v]) => [key, p(v.x * 1.3, v.y * 1.3, v.z * 1.3)]));
  assert.equal(extractHand(scaled, p(0, 1, 0)).thumbAlignment, down.thumbAlignment);
  delete joints['thumb-tip']; assert.equal(extractHand(joints, p(0, 1, 0)), null);
  joints['thumb-tip'] = p(NaN, 0, 0); assert.equal(extractHand(joints, p(0, 1, 0)), null);
});
