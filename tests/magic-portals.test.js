import test from 'node:test';
import assert from 'node:assert/strict';
import { PortalGesture, portalPoint, recognizeLoop, portalCrossing } from '../games/magic-hands/portal-gesture.js';
import { SpellSandbox } from '../games/magic-hands/spell-sandbox.js';
const head = { position: { x: 0, y: 1.6, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
const destination = { position: { x: 0, y: 1, z: -8 } };
function hand(x = 0, y = 0, z = 0) {
  const tip = { x, y, z };
  return { extension: { index: 1, middle: 1, ring: .4, pinky: .4 }, thumbAlignment: 0, pinch: 2,
    joints: { 'index-finger-tip': tip, 'middle-finger-tip': tip,
      'index-finger-phalanx-proximal': { x, y, z: z + .08 }, 'middle-finger-phalanx-proximal': { x, y, z: z + .08 } } };
}
const points = (direction = 1, rx = .17, ry = .17, fraction = 1, noise = 0) => Array.from({ length: 49 }, (_, i) => {
  const a = direction * i / 48 * Math.PI * 2 * fraction;
  return { x: rx * Math.cos(a) + Math.sin(i * 3) * noise, y: ry * Math.sin(a) + Math.cos(i * 5) * noise };
});
function setup(side = 'right') {
  const gesture = new PortalGesture(); let time = 0;
  const update = (h = hand(), target = destination, dt = 16, occupied = {}) => {
    time += dt; return gesture.update({ [side]: h }, head, time, { [side]: target }, occupied);
  };
  for (let i = 0; i < 65; i++) update();
  return { gesture, update, side };
}
test('portal point uses two straight fingers and ignores the thumb', () => {
  const h = hand(); assert.ok(portalPoint(h));
  h.thumbAlignment = 1; h.pinch = 0; assert.ok(portalPoint(h));
  h.extension.middle = .5; assert.equal(portalPoint(h), null);
  h.extension.middle = 1; h.extension.ring = 1; assert.equal(portalPoint(h), null);
});
test('portal point rejects fingers pointing in different directions', () => {
  const h = hand(); h.joints['middle-finger-tip'] = { x: .1, y: 0, z: .1 }; assert.equal(portalPoint(h), null);
});
for (const direction of [-1, 1]) test(`recognizes generous ${direction > 0 ? 'counterclockwise' : 'clockwise'} ellipse`, () => {
  assert.ok(recognizeLoop(points(direction, .18, .13, .96, .004)));
});
test('rejects tiny loops, thin ellipses, incomplete arcs and straight lines', () => {
  for (const p of [points(1, .08, .08), points(1, .25, .06), points(1, .17, .17, .65), Array.from({ length: 40 }, (_, i) => ({ x: i * .01, y: 0 }))]) assert.equal(recognizeLoop(p), null);
});
test('rejects backtracking scribbles and repeated circles', () => {
  const p = points(); assert.equal(recognizeLoop([...p, ...p.slice().reverse(), ...p]), null);
  assert.equal(recognizeLoop([...p, ...p]), null);
});
test('needs a whole second of steady aim at a valid destination', () => {
  const g = new PortalGesture();
  for (let time = 0; time < 1000; time += 16) g.update({ right: hand() }, head, time, { right: destination });
  assert.equal(g.state.phase, 'aim');
  g.update({ right: hand() }, head, 1008, { right: destination }); assert.equal(g.state.phase, 'ready');
});
test('moving the pointing fingers or destination restarts the hold', () => {
  const { update, gesture } = setup();
  gesture.reset(); for (let i = 0; i < 60; i++) update();
  update(hand(.06)); assert.equal(gesture.state.phase, 'aim');
  for (let i = 0; i < 30; i++) update(hand(.06)); assert.equal(gesture.state.phase, 'aim');
});
test('invalid destinations never become ready', () => {
  const { update, gesture } = setup(); gesture.reset();
  for (let i = 0; i < 150; i++) update(hand(), null); assert.equal(gesture.state.phase, 'aim');
  update(); assert.equal(gesture.state.phase, 'aim');
  for (let i = 0; i < 65; i++) update(); assert.equal(gesture.state.phase, 'ready');
});
for (const side of ['left', 'right']) test(`${side} hand locks the destination and completes a quick loop`, () => {
  const { update, gesture } = setup(side); assert.equal(gesture.state.phase, 'ready');
  let completed;
  for (const p of points()) {
    const result = update(hand(p.x - .17, p.y), { position: { x: 20, y: 0, z: -1 } }); completed ||= result.completed;
  }
  assert.ok(completed); assert.deepEqual(completed.destination, destination);
  assert.equal(gesture.state.phase, 'complete'); assert.equal(update().completed, null);
});
test('changing pose cancels the loop immediately and reserves the cancel frame', () => {
  const { update, gesture } = setup(); update(hand(-.1, .1)); const result = update(null);
  assert.equal(gesture.state, null); assert.equal(result.reserved.right, true); assert.equal(result.completed, null);
});
test('unfinished loop times out and requires a fresh pose', () => {
  const { update, gesture } = setup(); update(hand(-.1, .1));
  for (let i = 0; i < 230; i++) update(hand(-.1, .1)); assert.equal(gesture.state, null);
  update(); assert.equal(gesture.state, null); update(null); update(); assert.equal(gesture.state.phase, 'aim');
});
test('tracking gaps and out of plane movement cancel drawing', () => {
  for (const gap of [true, false]) {
    const { update, gesture } = setup(); update(hand(-.1, .1));
    update(gap ? hand() : hand(-.1, .1, .4), destination, gap ? 250 : 16); assert.equal(gesture.state, null);
  }
});
test('held fire and telekinesis exclude new portal intent', () => {
  const g = new PortalGesture(); const r = g.update({ right: hand() }, head, 0, { right: destination }, { right: true });
  assert.equal(r.state, null); assert.equal(r.reserved.right, false);
});
test('crossing supports walking and moving the portal over a stationary head', () => {
  assert.equal(portalCrossing({ x: 0, y: .5, z: .1 }, { x: 0, y: .5, z: -.1 }, 1), true);
  assert.equal(portalCrossing({ x: 1, y: 0, z: .1 }, { x: 1, y: 0, z: -.1 }, 1), false);
  assert.equal(portalCrossing({ x: 0, y: 0, z: -.1 }, { x: 0, y: 0, z: .1 }, 1), false);
  assert.equal(portalCrossing(null, { x: 0, y: 0, z: -.1 }, 1), false);
  assert.equal(portalCrossing({ x: 0, y: 0, z: .001 }, { x: 0, y: 0, z: -.001 }, 1), true);
});
test('external portal reservation clears competing preparation without stopping physics', () => {
  const engine = new SpellSandbox(); engine.hands.right.fistSince = 1;
  engine.bodies[0].awake = true;
  engine.update({}, head, 0, {}, { right: true }); engine.update({}, head, 16, {}, { right: true });
  assert.equal(engine.hands.right.fistSince, null); assert.ok(engine.bodies[0].position.y < .85);
});
test('teleport carries owned props and anchors, leaves loose props and clears motion', () => {
  const engine = new SpellSandbox(), held = engine.bodies[0], loose = engine.bodies[1]; held.owner = 'left';
  engine.hands.left = { mode: 'telekinesis', body: held, anchor: { x: 0, y: 1, z: 0 }, origin: { x: 1, y: 1, z: 0 }, motion: {} };
  const oldLoose = { ...loose.position }, oldHeld = { ...held.position };
  engine.teleport(p => ({ x: p.x + 8, y: p.y, z: p.z - 10 }));
  assert.deepEqual(loose.position, oldLoose); assert.equal(held.position.x, oldHeld.x + 8); assert.equal(held.owner, 'left');
  assert.equal(engine.hands.left.anchor.z, -10); assert.equal(engine.hands.left.motion, null);
});
