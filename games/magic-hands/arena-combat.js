// Combat simulation shared by the headset view and deterministic tests.
import { sub, dot, unit, distance } from '../../common/hand-gestures.js';
import { sweepSphere, sweepBox } from './spell-sandbox.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const copy = p => v(p.x, p.y, p.z);
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a, n) => v(a.x * n, a.y * n, a.z * n);
const mix = (a, b, t) => add(a, mul(sub(b, a), t));
const flatDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const ARENA = { minX: 16, maxX: 32, minZ: -12, maxZ: 6, landing: v(19, 0, 1) };
export const inArena = (p, inset = 0) => p.x >= ARENA.minX + inset && p.x <= ARENA.maxX - inset && p.z >= ARENA.minZ + inset && p.z <= ARENA.maxZ - inset;
export const ENEMIES = [
  { id: 'arena-bear', name: 'Brawler', file: 'furniture-kit/bear.glb', height: 1.3, health: 64, speed: 1.15, damage: 16, type: 'melee', cooldown: 1500, position: v(23, 0, -3) },
  { id: 'arena-orc', name: 'Bruiser', file: 'mini-dungeon/character-orc.glb', height: 1.7, health: 112, speed: .75, damage: 26, type: 'melee', cooldown: 2200, position: v(28, 0, -5) },
  { id: 'arena-slinger', name: 'Slinger', file: 'blocky-characters/character-a.glb', height: 1.5, health: 48, speed: .9, damage: 12, type: 'ranged', cooldown: 2400, position: v(22, 0, -9) },
  { id: 'arena-crate', name: 'Crate wizard', file: 'blaster-kit/crate-medium.glb', height: .95, health: 40, speed: 1.3, damage: 10, type: 'ranged', cooldown: 1900, position: v(29, 0, 1) },
];

// Shields are finite disks, not an invulnerability flag. Return the first plane
// crossing inside a disk, expanded by the projectile's radius.
export function shieldIntersection(from, to, shields, radius = 0) {
  let best = null;
  for (const shield of shields) {
    const a = dot(sub(from, shield.center), shield.normal), b = dot(sub(to, shield.center), shield.normal);
    if (Math.abs(a - b) < 1e-8 || a * b > 0) continue;
    const t = a / (a - b), point = mix(from, to, t);
    if (t < 0 || t > 1 || distance(point, shield.center) > shield.radius + radius) continue;
    if (!best || t < best.t) best = { t, point, shield };
  }
  return best;
}
export class CombatShields {
  constructor() { this.reset(); }
  reset() {
    this.hands = Object.fromEntries(['left', 'right'].map(side => [side, { health: 60, lastHit: -Infinity, blockedUntil: 0, needsRelease: false }]));
    this.poses = []; this.lastTime = null;
  }
  update(result, hands, head, time) {
    const dt = this.lastTime === null ? 0 : Math.max(0, Math.min(.1, (time - this.lastTime) / 1000)); this.lastTime = time;
    const active = [];
    for (const side of ['left', 'right']) {
      const state = this.hands[side], requested = result[side] === 'shield';
      // Only an observed release counts. Tracking loss cannot reset a broken shield.
      if (hands[side]?.tracked !== false && hands[side] && !requested) state.needsRelease = false;
      if (time >= state.blockedUntil && !state.needsRelease && state.health <= 0) state.health = 60;
      if (time - state.lastHit > 1500 && state.health > 0) state.health = Math.min(60, state.health + dt * 9);
      if (requested && time >= state.blockedUntil && !state.needsRelease && state.health > 0) active.push(side);
    }
    const groups = active.length === 2 && distance(hands.left.palm, hands.right.palm) < .4 ? [active] : active.map(s => [s]);
    this.poses = groups.map(sides => {
      const palm = sides.reduce((sum, side) => add(sum, mul(hands[side].palm, 1 / sides.length)), v());
      const center = add(palm, mul(head.forward, .20));
      return { sides, center, normal: unit(sub(head.position, center)), radius: sides.length === 2 ? .5 : .25,
        strength: sides.reduce((sum, side) => sum + this.hands[side].health, 0) / (60 * sides.length) };
    });
    return this.poses;
  }
  hit(shield, damage, time) {
    for (const side of shield.sides) {
      const s = this.hands[side]; s.health = Math.max(0, s.health - damage / shield.sides.length); s.lastHit = time;
      if (!s.health) { s.blockedUntil = time + 1000; s.needsRelease = true; }
    }
    this.poses = this.poses.filter(p => p.sides.every(side => this.hands[side].health > 0));
    for (const pose of this.poses) pose.strength = pose.sides.reduce((sum, side) => sum + this.hands[side].health, 0) / (60 * pose.sides.length);
  }
}

export class ArenaCombat {
  constructor(definitions = ENEMIES) { this.definitions = definitions; this.reset(); }
  reset() {
    this.enemies = this.definitions.map(d => ({ ...d, spawn: copy(d.position), position: copy(d.position), hp: d.health, alive: true,
      life: 1, nextAttack: 0, attackAt: -Infinity, direction: v(0, 0, 1), moving: false, pending: null }));
    this.corpses = []; this.projectiles = []; this.nextProjectile = 1; this.lastTime = null; this.events = []; this.engaged = false;
  }
  hitEnemy(id, damage, time) {
    const e = this.enemies.find(e => e.id === id);
    if (!e?.alive || !Number.isFinite(damage) || damage <= 0) return null;
    const dealt = Math.min(damage, e.hp); e.hp -= dealt; e.flashUntil = time + 180;
    if (e.hp <= 0) {
      e.alive = false; e.diedAt = time; e.pending = null; e.respawnAt = time + 9000;
      this.corpses.push({ id: `${e.id}-corpse-${e.life}`, enemy: id, kind: 'corpse', position: copy(e.position), born: time, expires: time + 16000 });
    }
    return { damage: dealt, killed: !e.alive };
  }
  targetFor(e, actors) {
    // A nearby minion gets a small priority bonus; a far-away one cannot distract
    // enemies from a player standing directly in front of them.
    return actors.map(a => ({ actor: a, score: flatDistance(e.position, a.position) - (a.kind === 'minion' ? 1.5 : 0) }))
      .sort((a, b) => a.score - b.score)[0]?.actor || null;
  }
  clearPath(from, to, world) { return !(world.obstacles || []).some(box => sweepBox(from, to, box, .06) !== null); }
  impact(from, to, radius, damage, actors, shields, time, world) {
    let hit = null;
    const consider = (t, kind, object) => { if (t !== null && (!hit || t < hit.t)) hit = { t, kind, object }; };
    for (const actor of actors) consider(sweepSphere(from, to, actor.center, actor.radius + radius), 'actor', actor);
    for (const box of world.obstacles || []) consider(sweepBox(from, to, box, radius), 'wall', box);
    const block = shieldIntersection(from, to, shields.poses, radius);
    if (block) consider(block.t, 'shield', block.shield);
    if (!hit) return false;
    const point = mix(from, to, hit.t);
    if (hit.kind === 'shield') { shields.hit(hit.object, damage, time); this.events.push({ type: 'blocked', point, damage }); }
    if (hit.kind === 'actor') this.events.push({ type: 'damage', target: hit.object.id, kind: hit.object.kind, damage, point });
    return true;
  }
  update(head, minions, shields, time, world = {}, consumed = new Set()) {
    const elapsed = this.lastTime === null ? 0 : time - this.lastTime, dt = elapsed > 0 && elapsed < 250 ? Math.min(.05, elapsed / 1000) : 0;
    this.lastTime = time; this.events = []; this.engaged = inArena(head.position);
    this.corpses = this.corpses.filter(c => time < c.expires && !consumed.has(c.id));
    for (const e of this.enemies) if (!e.alive && time >= e.respawnAt) {
      e.alive = true; e.hp = e.health; e.life++; e.position = copy(e.spawn); e.pending = null; e.nextAttack = time + 1200; e.attackAt = -Infinity;
    }
    if (!this.engaged) {
      this.projectiles = [];
      for (const e of this.enemies) { e.pending = null; e.moving = false; e.target = null; e.nextAttack = Math.max(e.nextAttack, time + 1000); }
      return this.events;
    }
    const actors = [{ id: 'player', kind: 'player', position: head.position,
      center: add(head.position, v(0, -.28)), radius: .32 }, ...minions.filter(m => m.mode !== 'dying' && m.mode !== 'rising' && inArena(m.position)).map(m => ({
      id: m.id, kind: 'minion', position: m.position, center: add(m.position, v(0, .9)), radius: .44 }))];
    for (const e of this.enemies.filter(e => e.alive)) {
      const target = this.targetFor(e, actors); e.target = target?.id; e.moving = false;
      if (!target || !dt) continue;
      const delta = sub(target.position, e.position); delta.y = 0;
      const dir = unit(delta), range = flatDistance(e.position, target.position); e.direction = dir;
      const origin = () => add(e.position, v(0, 1.2));
      const rangeLimit = e.type === 'melee' ? 1.45 : 10;
      if (e.pending && time >= e.pending.at) {
        const victim = actors.find(a => a.id === e.pending.id); e.pending = null;
        if (victim && flatDistance(victim.position, e.position) <= rangeLimit + .35 && this.clearPath(origin(), victim.center, world)) {
          if (e.type === 'melee') this.impact(origin(), victim.center, .16, e.damage, actors, shields, time, world);
          else {
            const velocity = mul(unit(sub(victim.center, origin())), 2.8);
            this.projectiles.push({ id: this.nextProjectile++, position: origin(), velocity, radius: .13, damage: e.damage, born: time });
          }
        }
      }
      const stop = e.type === 'melee' ? 1.1 : 5;
      if (range > stop && !e.pending) {
        // Small separation and steering keep a slow bruiser from trapping the rest.
        for (const angle of [0, .65, -.65, 1.2, -1.2]) {
          const d = v(dir.x * Math.cos(angle) - dir.z * Math.sin(angle), 0, dir.x * Math.sin(angle) + dir.z * Math.cos(angle));
          const next = add(e.position, mul(d, dt * e.speed));
          const crowded = this.enemies.some(o => o !== e && o.alive && flatDistance(o.position, next) < .72 && flatDistance(o.position, next) < flatDistance(o.position, e.position));
          if (!inArena(next, .65) || crowded || !this.clearPath(origin(), add(next, v(0, 1.2)), world)) continue;
          e.position = next; e.moving = true; break;
        }
      }
      if (!e.pending && time >= e.nextAttack && range <= rangeLimit && this.clearPath(origin(), target.center, world)) {
        e.attackAt = time; e.nextAttack = time + e.cooldown; e.pending = { id: target.id, at: time + (e.type === 'melee' ? 450 : 650) };
      }
    }
    this.projectiles = this.projectiles.filter(p => {
      const end = add(p.position, mul(p.velocity, dt));
      if (!inArena(end) || time - p.born > 8000) return false;
      if (this.impact(p.position, end, p.radius, p.damage, actors, shields, time, world)) return false;
      p.position = end; return true;
    });
    return this.events;
  }
}
