import test from 'node:test';
import assert from 'node:assert/strict';
import { SpellSandbox, sweepSphere, sweepBox } from '../games/magic-hands/spell-sandbox.js';
import { SpellGestures } from '../common/hand-gestures.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const head = { position: v(0, 1.6), forward: v(0, 0, -1), up: v(0, 1) };
function hand(kind = 'point', position = v(0, 1.4, -.4), pinch = 2, normal = v(0, 0, -1)) {
  const extension = kind === 'fist' ? { index: .35, middle: .35, ring: .35, pinky: .35 } : kind === 'cup' ?
    { index: .72, middle: .72, ring: .72, pinky: .72 } : kind === 'open' ? { index: .98, middle: .98, ring: .98, pinky: .98 } :
    { index: .98, middle: .35, ring: .35, pinky: .35 };
  return { palm: position, tip: { ...position, z: position.z - .08 }, aim: v(0, 0, -1), normal, pinch, extension, thumbAlignment: .2, size: .06, side: 'right' };
}
const prop = (position = v(0, 1.4, -2)) => ({ id: 'stone', position, radius: .15, shape: 'stone', color: '#aaa' });
function run(engine, from, to, sample, world = {}) {
  const events = []; let result;
  for (let t = from; t <= to; t += 20) { result = engine.update(sample(t), head, t, world); events.push(...result.events); }
  return { ...result, allEvents: events };
}
function gather(engine) {
  run(engine, 0, 100, () => ({ right: hand('cup', v(0, 1.1, -.35), 2, v(0, 1)) }));
  run(engine, 120, 360, t => ({ right: hand('cup', v(0, 1.1 + (t - 100) * .0005, -.35), 2, v(0, 1)) }));
  run(engine, 380, 560, () => ({ right: hand('cup', v(0, 1.23, -.35), 2, v(0, 1)) }));
  assert.equal(engine.hands.right.mode, 'fireball');
}
test('swept collisions find thin targets and inflated scenery between frames', () => {
  assert.ok(Math.abs(sweepSphere(v(), v(0, 0, -10), v(0, 0, -5), .2) - .48) < 1e-8);
  assert.equal(sweepSphere(v(), v(0, 0, -10), v(2, 0, -5), .2), null);
  assert.equal(sweepSphere(v(), v(), v(), 1), 0);
  const box = { min: v(-1, -1, -5), max: v(1, 1, -4.9) };
  assert.ok(Math.abs(sweepBox(v(), v(0, 0, -10), box, .1) - .48) < 1e-8);
  assert.equal(sweepBox(v(2), v(2, 0, -10), box), null);
});
test('fist equips a boulder; only an extending punch damages, and retraction rearms', () => {
  const engine = new SpellSandbox([]), world = { targets: [{ id: 'dummy', center: v(0, 1.4, -.72), radius: .12 }] };
  let r = run(engine, 0, 300, () => ({ right: hand('fist', v(0, 1.4, -.25)) }), world);
  assert.equal(r.hands.right.mode, 'boulder'); assert.equal(r.allEvents.length, 0);
  r = run(engine, 320, 500, t => ({ right: hand('fist', v(0, 1.4, -.25 - (t - 300) * .002)) }), world);
  assert.equal(r.allEvents.filter(e => e.type === 'cast').length, 1);
  assert.equal(r.allEvents.filter(e => e.type === 'hit' && e.spell === 'boulder').length, 1);
  r = run(engine, 520, 800, () => ({ right: hand('fist', v(0, 1.4, -.65)) }), world);
  assert.equal(r.allEvents.filter(e => e.type === 'hit').length, 0);
  run(engine, 820, 1020, t => ({ right: hand('fist', v(0, 1.4, -.65 + (t - 800) * .0018)) }), world);
  r = run(engine, 1040, 1240, t => ({ right: hand('fist', v(0, 1.4, -.25 - (t - 1020) * .0018)) }), world);
  assert.equal(r.allEvents.filter(e => e.type === 'hit').length, 1);
});
test('walking with a fist or small shakes does not count as punching', () => {
  const engine = new SpellSandbox([]); run(engine, 0, 300, () => ({ right: hand('fist') }));
  const events = [];
  for (let t = 320; t <= 600; t += 20) {
    const z = -(t - 300) * .001;
    const movingHead = { ...head, position: v(0, 1.6, z) };
    events.push(...engine.update({ right: hand('fist', v(0, 1.4, -.4 + z)) }, movingHead, t).events);
  }
  assert.equal(events.filter(e => e.type === 'cast').length, 0);
});
test('a cupped palm-up hold or short scoop conjures fire; an open palm does not', () => {
  const engine = new SpellSandbox([]);
  run(engine, 0, 1000, () => ({ right: hand('open', v(0, 1.2, -.35), 2, v(0, 1)) }));
  assert.equal(engine.hands.right.mode, 'idle'); engine.reset(); gather(engine);
  run(engine, 580, 900, () => ({ right: hand('fist', v(0, 1.23, -.35)) }));
  assert.equal(engine.hands.right.mode, 'fireball');
});
test('fire releases on a throw stroke, immediately frees that hand, and deals swept damage', () => {
  const engine = new SpellSandbox([]), base = new SpellGestures(); gather(engine);
  const world = { targets: [{ id: 'dummy', center: v(0, 1.3, -2.5), radius: .35 }] };
  const r = run(engine, 580, 760, t => ({ right: hand('open', v(0, 1.23, -.35 - (t - 560) * .0025)) }), world);
  assert.equal(r.allEvents.filter(e => e.type === 'cast' && e.spell === 'fireball').length, 1);
  assert.equal(r.hands.right.mode, 'idle');
  const out = hand('open', v(.16, 1.38, -.75));
  for (let t = 780; t <= 1000; t += 20) assert.equal(base.update({ right: out }, head, t, { right: true }).right, null);
  const flight = run(engine, 780, 1400, () => ({}), world);
  assert.equal(flight.allEvents.filter(e => e.type === 'hit' && e.target === 'dummy').length, 1);
});
test('turning the open palm down at rest dismisses held fire without throwing', () => {
  const engine = new SpellSandbox([]); gather(engine);
  const r = run(engine, 580, 1100, () => ({ right: hand('open', v(0, 1.23, -.35), 2, v(0, -1)) }));
  assert.equal(r.allEvents.filter(e => e.type === 'cast').length, 0); assert.equal(engine.projectiles.length, 0);
  assert.equal(engine.hands.right.mode, 'idle');
});
test('point highlights a prop; fresh pinch acquires it and hand movement lifts it', () => {
  const engine = new SpellSandbox([prop()]);
  let r = engine.update({ right: hand() }, head, 0); assert.equal(r.hands.right.focus, 'stone');
  r = engine.update({ right: hand('point', v(0, 1.4, -.4), .2) }, head, 20);
  assert.equal(r.hands.right.mode, 'telekinesis'); assert.equal(engine.bodies[0].owner, 'right');
  run(engine, 40, 300, t => ({ right: hand('point', v(0, 1.4 + t * .0007, -.4), .2) }));
  assert.ok(engine.bodies[0].position.y > 1.65);
  run(engine, 320, 700, () => ({ right: hand('open', v(0, 1.61, -.4), 2) }));
  assert.equal(engine.bodies[0].owner, null); assert.equal(engine.bodies[0].thrownUntil, 0);
});
test('pinch must first be released; occluded props cannot be remotely acquired', () => {
  const engine = new SpellSandbox([prop()]);
  run(engine, 0, 300, () => ({ right: hand('point', v(0, 1.4, -.4), .2) })); assert.equal(engine.bodies[0].owner, null);
  const wall = { min: v(-1, 0, -1.2), max: v(1, 3, -1) };
  run(engine, 320, 400, () => ({ right: hand() }), { obstacles: [wall] });
  run(engine, 420, 500, () => ({ right: hand('point', v(0, 1.4, -.4), .2) }), { obstacles: [wall] });
  assert.equal(engine.bodies[0].owner, null);
});
test('pinching can bend the index away from its ray without losing the highlighted target', () => {
  const engine = new SpellSandbox([prop()]); engine.update({ right: hand() }, head, 0);
  const pinched = hand('point', v(0, 1.4, -.4), .2); pinched.extension.index = .50; pinched.aim = v(1, 0, 0);
  engine.update({ right: pinched }, head, 100);
  assert.equal(engine.bodies[0].owner, 'right');
  engine.reset(); engine.update({ right: hand() }, head, 0);
  const away = hand('open'); away.aim = v(1, 0, 0);
  run(engine, 20, 400, () => ({ right: away }));
  engine.update({ right: pinched }, head, 420); assert.equal(engine.bodies[0].owner, null);
});
test('pulling then closing summons the prop into a grasp; opening at rest drops it', () => {
  const engine = new SpellSandbox([prop()]); engine.update({ right: hand('point', v(0, 1.4, -.6)) }, head, 0);
  engine.update({ right: hand('point', v(0, 1.4, -.6), .2) }, head, 20);
  run(engine, 40, 240, t => ({ right: hand(t < 160 ? 'point' : 'fist', v(0, 1.4, -.6 + (t - 20) * .0014), t < 160 ? .2 : 2) }));
  run(engine, 260, 900, () => ({ right: hand('fist', v(0, 1.4, -.3), 2) }));
  assert.equal(engine.hands.right.phase, 'held'); assert.ok(engine.bodies[0].position.z > -.5);
  run(engine, 920, 1200, () => ({ right: hand('open', v(0, 1.4, -.3), 2) }));
  assert.equal(engine.bodies[0].owner, null);
});
test('an outward open-palm push throws the selected prop and does not switch to shield', () => {
  const engine = new SpellSandbox([prop()]); engine.update({ right: hand() }, head, 0);
  engine.update({ right: hand('point', v(0, 1.4, -.4), .2) }, head, 20);
  const r = run(engine, 40, 200, t => ({ right: hand('open', v(0, 1.4, -.4 - (t - 20) * .002), 2) }));
  assert.equal(r.allEvents.filter(e => e.type === 'cast' && e.spell === 'telekinesis').length, 1);
  assert.equal(engine.bodies[0].owner, null); assert.ok(engine.bodies[0].velocity.z < -2);
  assert.equal(r.reserved.right, true);
});
test('physical object grabs take priority over boulders; two hands cannot own one prop', () => {
  const engine = new SpellSandbox([prop(v(0, 1.4, -.45))]);
  const r = run(engine, 0, 300, () => ({ left: hand('fist'), right: hand('fist') }));
  assert.equal(engine.bodies[0].owner, 'left'); assert.equal(r.hands.left.mode, 'telekinesis');
  assert.equal(r.hands.right.body, undefined);
});
test('tracking loss releases ownership; recenter gaps cancel held fire and pending motion', () => {
  const engine = new SpellSandbox([prop()]); engine.update({ right: hand() }, head, 0);
  engine.update({ right: hand('point', v(0, 1.4, -.4), .2) }, head, 20);
  engine.update({}, head, 40); assert.equal(engine.bodies[0].owner, null);
  engine.reset(); gather(engine); engine.update({ right: hand('open', v(0, 1.4, -.9)) }, head, 3000);
  assert.equal(engine.projectiles.length, 0); assert.equal(engine.hands.right.mode, 'idle');
});
test('fast fireballs cannot tunnel through walls or damage enemies through the impact wall', () => {
  const engine = new SpellSandbox([]);
  engine.projectiles.push({ id: 1, position: v(0, 1, 0), previous: v(0, 1), velocity: v(0, 0, -13), radius: .1, born: 0, hand: 'right' });
  const world = { targets: [{ id: 'hidden', center: v(0, 1, -.8), radius: .1 }], obstacles: [{ min: v(-1, 0, -.5), max: v(1, 3, -.4) }] };
  engine.update({}, head, 0, world); const r = engine.update({}, head, 100, world);
  assert.equal(engine.projectiles.length, 0); assert.equal(r.events.filter(e => e.type === 'hit').length, 0);
});
test('thrown props score once at impact; gentle drops cannot deal damage', () => {
  const engine = new SpellSandbox([prop(v(0, 1.4, 0))]);
  Object.assign(engine.bodies[0], { velocity: v(0, 0, -10), awake: true, thrownUntil: 4000 });
  const world = { targets: [{ id: 'dummy', center: v(0, 1.35, -.8), radius: .15 }] };
  engine.update({}, head, 0, world); const r = run(engine, 20, 300, () => ({}), world);
  assert.equal(r.allEvents.filter(e => e.type === 'hit').length, 1);
  assert.equal(engine.bodies[0].thrownUntil, 0);
  engine.reset(); engine.bodies[0].awake = true;
  const dropWorld = { targets: [{ id: 'below', center: v(0, .8, 0), radius: .2 }] };
  engine.update({}, head, 0, dropWorld);
  const dropped = run(engine, 20, 600, () => ({}), dropWorld);
  assert.equal(dropped.allEvents.filter(e => e.type === 'hit').length, 0);
});
test('both hands can independently gather and throw fire without turning into fists or shields', () => {
  const engine = new SpellSandbox([]);
  const sample = (y, kind = 'cup', z = -.35) => Object.fromEntries(['left', 'right'].map(side => [side,
    hand(kind, v(side === 'left' ? -.2 : .2, y, z), 2, kind === 'cup' ? v(0, 1) : v(0, 0, -1))]));
  run(engine, 0, 100, () => sample(1.1));
  run(engine, 120, 360, t => sample(1.1 + (t - 100) * .0005));
  run(engine, 380, 560, () => sample(1.23));
  assert.equal(engine.hands.left.mode, 'fireball'); assert.equal(engine.hands.right.mode, 'fireball');
  const r = run(engine, 580, 760, t => sample(1.23, 'open', -.35 - (t - 560) * .002));
  assert.deepEqual(r.allEvents.filter(e => e.type === 'cast').map(e => e.hand).sort(), ['left', 'right']);
  assert.equal(r.reserved.left, true); assert.equal(r.reserved.right, true);
});
test('a forward thrust releases cupped fire without a precise finger-opening event', () => {
  const engine = new SpellSandbox([]); gather(engine);
  let r = run(engine, 580, 700, t => ({ right: hand('cup', v(0, 1.23, -.35 - (t - 560) * .001)) }));
  assert.equal(r.allEvents.filter(e => e.type === 'cast').length, 1);
  r = run(engine, 720, 840, t => ({ right: hand('open', v(0, 1.23, -.49 - (t - 700) * .002)) }));
  assert.equal(r.allEvents.filter(e => e.type === 'cast').length, 0);
});
test('ownership suppresses the original spells even when opening the hand matches their shape', () => {
  const base = new SpellGestures();
  const extended = hand('open', v(.16, 1.38, -.75));
  for (let t = 0; t <= 600; t += 20) {
    const r = base.update({ right: extended }, head, t, { right: true });
    assert.equal(r.right, null); assert.deepEqual(r.casts, []);
  }
  let r;
  for (let t = 620; t <= 900; t += 20) r = base.update({ right: extended }, head, t);
  assert.equal(r.right, 'shield');
});
test('tracking jumps preserve a held prop without applying the jump as throw velocity', () => {
  const engine = new SpellSandbox([prop()]); engine.update({ right: hand() }, head, 0);
  engine.update({ right: hand('point', v(0, 1.4, -.4), .2) }, head, 20);
  const r = engine.update({ right: hand('open', v(0, 1.4, -1), 2) }, head, 40);
  assert.equal(engine.bodies[0].owner, 'right'); assert.equal(engine.bodies[0].thrownUntil, 0);
  assert.equal(r.events.filter(e => e.type === 'cast').length, 0);
});
