import test from 'node:test';
import assert from 'node:assert/strict';
import { PortalGesture, doorPose, doorAim, doorGrasp, portalCrossing, portalAperture } from '../games/magic-hands/portal-gesture.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const head = { position: v(0, 1.6), forward: v(0, 0, -1), up: v(0, 1) };
const destination = { position: v(0, 1, -24), normal: v(0, 0, 1), radius: 1 };
const hands = (spread = .065, depth = .32) => Object.fromEntries(['left', 'right'].map(side => [side, {
  palm: v(side === 'left' ? -spread : spread, 1.3, -depth), normal: v(side === 'left' ? -1 : 1), pinch: 2,
  extension: { index: .98, middle: .98, ring: .98, pinky: .98 }, tracked: true,
}]));
function ready() {
  const g = new PortalGesture(); for (let t = 0; t <= 240; t += 20) g.update(hands(), head, t, destination);
  assert.equal(g.state.phase, 'ready'); return g;
}
test('backs together and palms outward prepare a door; two fingers and shields do not', () => {
  assert.ok(doorPose(hands(), head)); assert.equal(doorPose(hands(.35, .7), head), null);
  const h = hands(); for (const hand of Object.values(h)) hand.extension.ring = hand.extension.pinky = .4;
  assert.equal(doorPose(h, head), null); assert.equal(doorPose({ left: h.left }, head), null);
});
test('forward-angled palms and spare-finger noise remain accessible', () => {
  const h = hands(); for (const hand of Object.values(h)) { hand.normal = v(0, 0, -1); hand.extension.pinky = .55; }
  assert.ok(doorPose(h, head));
});
test('gaze dominates portal aim while palm direction contributes', () => {
  const h = hands(); h.left.normal = v(.6, 0, -.8); h.right.normal = v(.6, 0, -.8);
  const aim = doorAim(h, head); assert.ok(aim.x > .1 && aim.x < .3); assert.ok(aim.z < -.9);
  assert.deepEqual(doorAim(hands(), head), head.forward);
});
test('long-range destination jitter does not restart preparation', () => {
  const g = new PortalGesture();
  for (let t = 0; t <= 300; t += 20) g.update(hands(), head, t, { ...destination, position: v(Math.sin(t) * 1.5, 1, -24) });
  assert.equal(g.state.phase, 'ready');
});
test('a short forward push and spread opens without tracing or holding still', () => {
  const g = ready(); const result = g.update(hands(.22, .49), head, 260, destination);
  assert.ok(result.completed); assert.equal(result.state.phase, 'complete'); assert.equal(result.reserved.left, true);
  assert.equal(g.update(hands(.3, .55), head, 280, destination).completed, null);
});
test('spreading alone, pushing alone, or closing fingers cannot cast', () => {
  for (const h of [hands(.3, .32), hands(.065, .6)]) { const g = ready(); assert.equal(g.update(h, head, 260, destination).completed, null); }
  const g = ready(), closed = hands(); Object.values(closed).forEach(h => { Object.keys(h.extension).forEach(f => { h.extension[f] = .4; }); });
  assert.equal(g.update(closed, head, 260, destination).state, null);
});
test('destination locks when opening starts', () => {
  const g = ready(); g.update(hands(.12, .37), head, 260, destination);
  const elsewhere = { ...destination, position: v(15, 1, -5) };
  const result = g.update(hands(.25, .53), head, 280, elsewhere); assert.deepEqual(result.completed.destination, destination);
});
test('brief hand occlusion pauses opening rather than destroying it', () => {
  const g = ready(); g.update(hands(.12, .37), head, 260, destination);
  const hidden = hands(); hidden.right.tracked = false;
  for (let t = 280; t <= 700; t += 20) assert.equal(g.update(hidden, head, t, destination).completed, null);
  assert.ok(g.update(hands(.25, .52), head, 720, destination).completed);
});
test('long tracking loss, timeout and occupied hands cancel preparation', () => {
  const g = ready(); for (let t = 260; t <= 1100; t += 20) g.update({}, head, t, destination); assert.equal(g.state, null);
  const h = ready(); for (let t = 260; t <= 4700; t += 20) h.update(hands(), head, t, destination); assert.equal(h.state, null);
  const k = ready(); assert.equal(k.update(hands(), head, 260, destination, { left: true }).state, null);
});
test('invalid destinations never become ready', () => {
  const g = new PortalGesture(); for (let t = 0; t <= 600; t += 20) g.update(hands(), head, t, null); assert.equal(g.state.phase, 'aim');
});
test('a fist or pinch can grasp a doorway side', () => {
  const h = hands().right; assert.equal(doorGrasp(h), false); h.pinch = .2; assert.equal(doorGrasp(h), true);
  h.pinch = 2; h.extension.index = h.extension.middle = h.extension.ring = .5; assert.equal(doorGrasp(h), true);
});
test('unheld portals shrink after 1.4 seconds; interaction keeps them open', () => {
  assert.equal(portalAperture(1000, 0, false), 1); assert.equal(portalAperture(2200, 0, false), .5);
  assert.equal(portalAperture(3100, 0, false), 0); assert.equal(portalAperture(10000, 0, true), 1);
  assert.equal(portalAperture(10000, 9500, false), 1);
});
test('rectangle crossings include corners, reject edges and backside entry, and allow slow steps', () => {
  assert.equal(portalCrossing(v(.35, .75, .01), v(.35, .75, -.01), .5, 1), true);
  assert.equal(portalCrossing(v(.48, 0, .1), v(.48, 0, -.1), .5, 1), false);
  assert.equal(portalCrossing(v(0, .95, .1), v(0, .95, -.1), .5, 1), false);
  assert.equal(portalCrossing(v(0, 0, -.1), v(0, 0, .1), .5, 1), false);
  assert.equal(portalCrossing(v(0, 0, .001), v(0, 0, -.001), .5, 1), true);
});
