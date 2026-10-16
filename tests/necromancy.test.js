import test from 'node:test';
import assert from 'node:assert/strict';
import { Necromancy, GRAVES, hornsPose } from '../games/magic-hands/necromancy.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const graveHead = { position: v(0, 1.6), forward: v(0, 0, 1) }, battleHead = { ...graveHead, forward: v(0, 0, -1) };
const hand = (y = 1.15, direction = v(0, 1), extra = {}) => ({ palm: v(.18, y, .4), tip: v(.18, y, -.4), aim: direction, handAim: direction,
  extension: { index: .98, middle: .4, ring: .4, pinky: .95 }, thumbAlignment: .95, ...extra });
const target = { id: 'dummy', center: v(0, 1.4, -4), radius: .32 };
function raise(engine, start = 0, side = 'right') {
  const events = [];
  for (let time = start; time <= start + 600; time += 20) events.push(...engine.update({ [side]: hand(1.15 + Math.max(0, Math.min(.25, (time - start - 180) * .001))) }, graveHead, time).events);
  engine.update({}, graveHead, start + 620); return events;
}
function step(engine, start, end, hands = {}, head = battleHead, world = { targets: [target] }) {
  const events = []; for (let t = start; t <= end; t += 20) events.push(...engine.update(hands, head, t, world).events); return events;
}
test('horns require index + pinky with middle/ring curled; thumb is irrelevant', () => {
  const h = hand(); assert.equal(hornsPose(h), true); h.thumbAlignment = 0; assert.equal(hornsPose(h), true);
  h.extension.pinky = .4; assert.equal(hornsPose(h), false); h.extension.pinky = .98; h.extension.middle = .9; assert.equal(hornsPose(h), false);
});
test('horns reserve the hand immediately and glow eligible graves', () => {
  const r = new Necromancy().update({ right: hand() }, graveHead, 0);
  assert.equal(r.reserved.right, true); assert.equal(r.highlighted.length, 3); assert.equal(r.active, 0);
});
for (const side of ['left', 'right']) test(`${side} hand lift raises exactly one minion`, () => {
  const n = new Necromancy(), events = raise(n, 0, side);
  assert.equal(events.filter(e => e.type === 'raised').length, 1); assert.equal(n.active().length, 1);
  step(n, 640, 1800, { [side]: hand(1.4) }, graveHead, {}); assert.equal(n.active().length, 1);
});
test('standing still, lifting the head and hand together, or looking away cannot raise', () => {
  const n = new Necromancy(); step(n, 0, 800, { right: hand() }, graveHead, {}); assert.equal(n.active().length, 0);
  n.reset(); for (let t = 0; t <= 600; t += 20) { const rise = t * .001; n.update({ right: hand(1.15 + rise) }, { ...graveHead, position: v(0, 1.6 + rise) }, t); }
  assert.equal(n.active().length, 0); n.reset(); step(n, 0, 600, { right: hand(1.4) }, battleHead, {}); assert.equal(n.active().length, 0);
});
test('a returning or remembered hand cannot complete an unseen raising stroke', () => {
  const n = new Necromancy(); step(n, 0, 200, { right: hand() }, graveHead, {});
  step(n, 220, 600, { right: hand(1.5, v(0, 1), { tracked: false }) }, graveHead, {});
  n.update({ right: hand(1.5, v(0, 1), { reacquired: true }) }, graveHead, 620);
  step(n, 640, 1000, { right: hand(1.5) }, graveHead, {}); assert.equal(n.active().length, 0);
});
test('held fire, telekinesis or portal ownership blocks necromancy', () => {
  const n = new Necromancy(); for (let t = 0; t <= 600; t += 20) {
    const r = n.update({ right: hand(1.15 + t * .001) }, graveHead, t, {}, { right: true }); assert.equal(r.reserved.right, false);
  } assert.equal(n.active().length, 0);
});
test('raising a fourth retires the oldest, falls/sinks it, then removes it', () => {
  const n = new Necromancy(); for (let i = 0; i < 4; i++) raise(n, i * 800);
  assert.equal(n.active().length, 3); assert.deepEqual(n.active().map(m => m.id), [2, 3, 4]);
  const oldest = n.minions.find(m => m.id === 1); assert.equal(oldest.mode, 'dying'); assert.ok(oldest.diedAt > 2400);
  step(n, 3040, 5600, {}, graveHead, {}); assert.equal(n.minions.some(m => m.id === 1), false); assert.equal(n.active().length, 3);
});
test('single-use corpse sources are consumed; reusable grave sources replenish', () => {
  const n = new Necromancy([{ id: 'corpse', position: v(0, 0, 5), kind: 'corpse' }]); raise(n); raise(n, 1600); assert.equal(n.active().length, 1);
  const graves = new Necromancy([GRAVES[1]]); raise(graves); raise(graves, 1600); assert.equal(graves.active().length, 2);
});
test('unready and out-of-range sources cannot be raised', () => {
  const n = new Necromancy([{ ...GRAVES[1], ready: false }, { id: 'far', position: v(0, 0, 40), reusable: true }]); raise(n); assert.equal(n.active().length, 0);
});
test('forward horns designate a target after a brief hold and do not spam orders', () => {
  const n = new Necromancy(); raise(n); const events = step(n, 640, 2000, { right: hand(1.25, v(0, 0, -1)) });
  assert.equal(events.filter(e => e.type === 'command').length, 1); assert.equal(n.active()[0].target, 'dummy'); assert.equal(n.active()[0].mode, 'attack');
});
test('pointing down recalls the group and clears attack targets', () => {
  const n = new Necromancy(); raise(n); step(n, 640, 1200, { right: hand(1.25, v(0, 0, -1)) });
  const events = step(n, 1220, 1800, { right: hand(1.25, v(0, -1)) });
  assert.equal(events.filter(e => e.type === 'command' && e.command === 'recall').length, 1); assert.equal(n.active()[0].target, null); assert.equal(n.active()[0].mode, 'follow');
});
test('minions leave the graveyard through the gate, reach a target and headbutt for damage', () => {
  const n = new Necromancy(); raise(n);
  const obstacles = [
    { min: v(-3.1, 0, 3.1), max: v(-.9, .8, 3.3) }, { min: v(.9, 0, 3.1), max: v(3.1, .8, 3.3) },
    { min: v(-3.1, 0, 3.1), max: v(-2.9, .8, 8.1) }, { min: v(2.9, 0, 3.1), max: v(3.1, .8, 8.1) },
    { min: v(-3.1, 0, 7.9), max: v(3.1, .8, 8.1) }, { min: v(-.45, 0, -4.45), max: v(.45, .6, -3.55) },
  ];
  const world = { targets: [target], obstacles }; step(n, 640, 1000, { right: hand(1.25, v(0, 0, -1)) }, battleHead, world);
  const events = step(n, 1020, 18000, {}, battleHead, world);
  assert.ok(events.some(e => e.type === 'hit' && e.target === 'dummy' && e.damage === 12), JSON.stringify(n.minions));
  assert.ok(n.active()[0].position.z < -2.5);
});
test('scenery blocks designation and prevents damage through a wall', () => {
  const n = new Necromancy(); raise(n); const world = { targets: [target], obstacles: [{ min: v(-20, 0, -1), max: v(20, 3, -.8) }] };
  const events = step(n, 640, 15000, { right: hand(1.25, v(0, 0, -1)) }, battleHead, world);
  assert.equal(events.some(e => e.type === 'command' || e.type === 'hit'), false);
});
test('followers wander near the player and reset clears minions and cooldowns', () => {
  const n = new Necromancy(); raise(n); step(n, 640, 18000, {}, battleHead, {});
  const p = n.active()[0].position; assert.ok(Math.hypot(p.x, p.z) < 4.5); assert.equal(n.active()[0].mode, 'follow');
  n.reset(); assert.equal(n.minions.length, 0); assert.deepEqual(n.cooldowns, {});
});
