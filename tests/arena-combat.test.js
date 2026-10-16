import test from 'node:test';
import assert from 'node:assert/strict';
import { ArenaCombat, CombatShields, ENEMIES, inArena, shieldIntersection } from '../games/magic-hands/arena-combat.js';
import { Necromancy } from '../games/magic-hands/necromancy.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const head = { position: v(20, 1.6, 0), forward: v(0, 0, -1) };
const hand = (x = 20) => ({ palm: v(x, 1.32, -.6), tracked: true });
const shieldPose = { center: v(20, 1.32, -.8), normal: v(0, 0, 1), radius: .5, sides: ['right'], strength: 1 };
const dummy = (overrides = {}) => ({ ...ENEMIES[0], position: v(20, 0, -1.1), ...overrides });
function run(arena, start, end, { player = head, minions = [], shields = new CombatShields(), world = {}, consumed = new Set() } = {}) {
  const events = []; for (let time = start; time <= end; time += 20) events.push(...arena.update(player, minions, shields, time, world, consumed)); return events;
}
test('mixed Kenney enemies have distinct combat stats', () => {
  assert.equal(new Set(ENEMIES.map(e => e.file)).size, 4);
  assert.equal(new Set(ENEMIES.map(e => e.health)).size, 4);
  assert.deepEqual(new Set(ENEMIES.map(e => e.type)), new Set(['melee', 'ranged']));
});
test('arena is dormant outside, clears outgoing projectiles, and does not chase out', () => {
  const a = new ArenaCombat(), positions = a.enemies.map(e => ({ ...e.position }));
  const outside = { ...head, position: v(0, 1.6) };
  assert.deepEqual(run(a, 0, 10000, { player: outside }), []); assert.deepEqual(a.enemies.map(e => e.position), positions);
  a.projectiles.push({ id: 1 }); a.update(outside, [], new CombatShields(), 10020); assert.equal(a.projectiles.length, 0);
});
test('nearby minions take priority but a distant minion does not override nearest player', () => {
  const a = new ArenaCombat([dummy()]), e = a.enemies[0];
  const player = { id: 'player', kind: 'player', position: v(20, 0, 0) };
  const minion = { id: 1, kind: 'minion', position: v(20, 0, 1) };
  assert.equal(a.targetFor(e, [player, minion]).id, 1); minion.position.z = 10;
  assert.equal(a.targetFor(e, [player, minion]).id, 'player');
});
test('headbutts have a windup and deal damage only in reach', () => {
  const a = new ArenaCombat([dummy()]); assert.equal(run(a, 0, 400).length, 0);
  assert.ok(run(a, 420, 700).some(e => e.type === 'damage' && e.target === 'player' && e.damage === 16));
  const b = new ArenaCombat([dummy()]); run(b, 0, 100);
  b.enemies[0].speed = 0;
  assert.equal(run(b, 120, 2000, { player: { ...head, position: v(20, 1.6, 5) } }).some(e => e.type === 'damage'), false);
});
test('ranged attacks emit slow swept projectiles which can hit player or minions', () => {
  const a = new ArenaCombat([dummy({ type: 'ranged', position: v(20, 0, -5) })]); run(a, 0, 800);
  assert.ok(a.projectiles.length); assert.ok(Math.abs(Math.hypot(...Object.values(a.projectiles[0].velocity)) - 2.8) < .001);
  assert.ok(run(a, 820, 3000).some(e => e.kind === 'player' && e.type === 'damage'));
  const b = new ArenaCombat([dummy({ type: 'ranged', position: v(20, 0, -5) })]);
  assert.ok(run(b, 0, 3000, { minions: [{ id: 7, position: v(20, 0, -.5), mode: 'follow' }] }).some(e => e.kind === 'minion' && e.target === 7));
});
test('walls block enemy attacks and projectiles', () => {
  const a = new ArenaCombat([dummy({ type: 'ranged', position: v(20, 0, -5) })]);
  const world = { obstacles: [{ min: v(15, 0, -3), max: v(25, 4, -2.8) }] };
  assert.equal(run(a, 0, 6000, { world }).some(e => e.type === 'damage'), false);
  assert.equal(a.projectiles.length, 0);
});
test('enemies and their projectiles stay within arena boundaries', () => {
  const a = new ArenaCombat([dummy({ position: v(16.7, 0, 5), speed: 4 })]);
  run(a, 0, 20000, { player: { ...head, position: v(16.05, 1.6, 5.9) } }); assert.ok(inArena(a.enemies[0].position, .65));
  a.projectiles.push({ id: 99, position: v(31.99, 1, 0), velocity: v(3, 0, 0), born: 20000, damage: 10, radius: .13 });
  a.update(head, [], new CombatShields(), 20020); assert.equal(a.projectiles.some(p => p.id === 99), false);
});
test('shield collision uses disks and earliest crossing, including fast projectiles', () => {
  assert.ok(shieldIntersection(v(20, 1.32, -10), head.position, [shieldPose]));
  assert.equal(shieldIntersection(v(22, 1.32, -10), v(22, 1.32, 0), [shieldPose]), null);
  assert.equal(shieldIntersection(v(20, 1.32, -.4), head.position, [shieldPose]), null);
  const near = { ...shieldPose, center: v(20, 1.32, -2) };
  assert.equal(shieldIntersection(v(20, 1.32, -10), head.position, [shieldPose, near]).shield, near);
});
for (const type of ['melee', 'ranged']) test(`shield intercepts ${type} hits before player, but not attacks from behind`, () => {
  const a = new ArenaCombat([dummy({ type, position: v(20, 0, type === 'melee' ? -1.1 : -5), damage: 10, speed: 0 })]);
  const s = new CombatShields(); s.poses = [shieldPose]; const events = run(a, 0, 3000, { shields: s });
  assert.ok(events.some(e => e.type === 'blocked')); assert.equal(events.some(e => e.kind === 'player'), false); assert.ok(s.hands.right.health < 60);
  const b = new ArenaCombat([dummy({ position: v(20, 0, 1.1), damage: 10, speed: 0 })]);
  assert.ok(run(b, 0, 1000, { shields: s }).some(e => e.kind === 'player'));
});
test('shield damage is immediately reflected in strength, then slowly regenerates', () => {
  const s = new CombatShields(), hands = { right: hand() };
  s.update({ right: 'shield' }, hands, head, 0); s.hit(s.poses[0], 30, 20); assert.equal(s.poses[0].strength, .5);
  s.update({ right: 'shield' }, hands, head, 1200); assert.equal(s.hands.right.health, 30);
  for (let t = 1220; t < 6000; t += 20) s.update({ right: 'shield' }, hands, head, t);
  assert.equal(s.hands.right.health, 60);
});
test('broken shields need a real release and a full second; tracking loss and merge cannot bypass', () => {
  const s = new CombatShields(), hands = { right: hand(), left: hand(20.1) };
  s.update({ right: 'shield' }, hands, head, 0); s.hit(s.poses[0], 65, 20);
  s.update({ right: 'shield' }, hands, head, 2000); assert.equal(s.poses.length, 0);
  s.update({}, { right: { ...hand(), tracked: false } }, head, 2020); assert.equal(s.hands.right.needsRelease, true);
  s.update({ right: 'shield', left: 'shield' }, hands, head, 2040); assert.deepEqual(s.poses[0].sides, ['left']);
  s.update({}, hands, head, 2060); s.update({ right: 'shield' }, hands, head, 2080); assert.equal(s.poses.length, 1); assert.equal(s.hands.right.health, 60);
  s.hit(s.poses[0], 60, 2100); s.update({}, hands, head, 2120); s.update({ right: 'shield' }, hands, head, 2400); assert.equal(s.poses.length, 0);
  s.update({ right: 'shield' }, hands, head, 3100); assert.equal(s.poses.length, 1);
});
test('two hands create a larger shield with combined durability', () => {
  const s = new CombatShields(); s.update({ right: 'shield', left: 'shield' }, { right: hand(), left: hand(20.2) }, head, 0);
  assert.equal(s.poses.length, 1); assert.equal(s.poses[0].radius, .5); s.hit(s.poses[0], 60, 20);
  assert.equal(s.hands.right.health, 30); assert.equal(s.hands.left.health, 30);
});
test('death scores only remaining health, leaves one usable corpse and respawns with fresh health', () => {
  const a = new ArenaCombat([dummy()]); assert.equal(a.hitEnemy('arena-bear', 20, 0).damage, 20);
  assert.deepEqual(a.hitEnemy('arena-bear', 100, 20), { damage: 44, killed: true });
  assert.equal(a.hitEnemy('arena-bear', 100, 40), null); assert.equal(a.corpses.length, 1);
  const corpse = a.corpses[0]; run(a, 40, 9000); assert.equal(a.enemies[0].alive, false);
  run(a, 9020, 9040); assert.equal(a.enemies[0].hp, 64); assert.equal(a.enemies[0].life, 2); assert.equal(a.enemies[0].alive, true);
  a.hitEnemy('arena-bear', 100, 9060); assert.notEqual(a.corpses[1].id, corpse.id);
  a.update(head, [], new CombatShields(), 9080, {}, new Set([corpse.id])); assert.equal(a.corpses.length, 1);
  a.update(head, [], new CombatShields(), 26000); assert.equal(a.corpses.length, 0);
});
test('dynamic corpses can be raised once, and skeletons fight enemies and take lethal damage', () => {
  const a = new ArenaCombat([dummy()]); a.hitEnemy('arena-bear', 100, 0);
  const n = new Necromancy([]); const world = { sources: a.corpses, targets: [] };
  const h = y => ({ palm: v(20, y, -.5), tip: v(20, y, -.7), aim: v(0, 1), extension: { index: 1, pinky: 1, middle: .3, ring: .3 } });
  for (let t = 20; t <= 600; t += 20) n.update({ right: h(1 + Math.max(0, t - 200) * .001) }, head, t, world);
  assert.equal(n.active().length, 1); assert.ok(n.consumed.has(a.corpses[0].id));
  n.damage(1, 20, 620); assert.equal(n.active()[0].health, 40); n.damage(1, 50, 640); assert.equal(n.active().length, 0); assert.equal(n.minions[0].mode, 'dying');
  for (let t = 660; t < 3000; t += 20) n.update({}, head, t, world); assert.equal(n.minions.length, 0);
});
test('followers defend player in arena; recall overrides automatic defense for several seconds', () => {
  const n = new Necromancy(); n.raise({ id: 'corpse', position: v(20, 0, -2) }, 'right', head, 0);
  const world = { inArena: true, targets: [{ id: 'enemy', hostile: true, center: v(20, .9, -3), radius: .65 }] }; const events = [];
  for (let t = 0; t < 3000; t += 20) events.push(...n.update({}, head, t, world).events);
  assert.ok(events.some(e => e.type === 'hit' && e.target === 'enemy'));
  n.command('recall', null, head, 3000); for (let t = 3020; t < 7000; t += 20) n.update({}, head, t, world);
  assert.equal(n.active()[0].mode, 'follow');
});
