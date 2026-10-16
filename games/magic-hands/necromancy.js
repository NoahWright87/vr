// Corpse/grave selection, hand intent and minion behavior without rendering.
import { sub, dot, unit, length, distance } from '../../common/hand-gestures.js';
import { selectLightningTarget } from './lightning-aim.js';
import { sweepBox } from './spell-sandbox.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const copy = a => v(a.x, a.y, a.z);
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a, n) => v(a.x * n, a.y * n, a.z * n);
const flat = a => v(a.x, 0, a.z);
export const GRAVEYARD = { minX: -3, maxX: 3, minZ: 3.2, maxZ: 8, gate: v(0, 0, 3.2) };
export const GRAVES = [-1.6, 0, 1.6].map((x, i) => ({ id: `grave-${i}`, kind: 'grave', reusable: true, position: v(x, 0, i === 1 ? 6.1 : 5.1) }));
export function hornsPose(hand) {
  if (!hand) return false;
  const e = hand.extension;
  return e.index > .74 && e.pinky > .72 && e.middle < .73 && e.ring < .73;
}
const handState = () => ({ since: null, liftBase: null, lifted: false, candidate: null, candidateSince: null, lastCommand: null, lastRaised: -Infinity });
const insideYard = p => p.x > -2.9 && p.x < 2.9 && p.z > 3 && p.z < 8;
export class Necromancy {
  constructor(sources = GRAVES) { this.sources = sources; this.reset(); }
  reset() { this.minions = []; this.cooldowns = {}; this.consumed = new Set(); this.nextId = 1; this.lastTime = null; this.events = []; this.suspend(); }
  suspend() { this.hands = { left: handState(), right: handState() }; }
  active() { return this.minions.filter(m => m.mode !== 'dying'); }
  clearPath(from, to, world, radius = 0) { return !(world.obstacles || []).some(box => sweepBox(from, to, box, radius) !== null); }
  available(source, time) { return source.ready !== false && !this.consumed.has(source.id) && time >= (this.cooldowns[source.id] || 0); }
  sourceFor(head, time) {
    return this.sources.filter(s => this.available(s, time) && distance(s.position, head.position) < 12 &&
      dot(unit(sub(add(s.position, v(0, .5)), head.position)), head.forward) > .40)
      .sort((a, b) => dot(unit(sub(add(b.position, v(0, .5)), head.position)), head.forward) - dot(unit(sub(add(a.position, v(0, .5)), head.position)), head.forward))[0] || null;
  }
  raise(source, side, head, time) {
    if (!this.available(source, time)) return;
    const active = this.active();
    if (active.length >= 3) { active[0].mode = 'dying'; active[0].diedAt = time; this.events.push({ type: 'retired', minion: active[0].id }); }
    this.cooldowns[source.id] = time + 1300;
    if (source.reusable !== true) this.consumed.add(source.id);
    this.minions.push({ id: this.nextId++, position: copy(source.position), direction: unit(flat(sub(head.position, source.position))),
      mode: 'rising', born: time, nextWander: time, attackAt: -Infinity, nextAttack: time + 1000, moving: false });
    this.events.push({ type: 'raised', spell: 'necromancy', hand: side, source: source.id, minion: this.nextId - 1 });
    // Retirement visuals are bounded even under rapid alternating hands.
    const dying = this.minions.filter(m => m.mode === 'dying');
    if (dying.length > 3) this.minions = this.minions.filter(m => !dying.slice(0, dying.length - 3).includes(m));
  }
  commandTarget(hand, world) {
    const targets = (world.targets || []).filter(t => t.center.y - t.radius < 2).map(t => ({ ...t,
      visible: this.clearPath(hand.tip, t.center, world) }));
    return selectLightningTarget(hand.tip, hand.aim, targets, { coneDegrees: 22, arcDegrees: 22, arcMiss: 0, range: 40 })?.target || null;
  }
  command(kind, target, head, time) {
    for (const m of this.active()) {
      m.order = kind; m.target = kind === 'attack' ? target.id : null; m.nextWander = time; m.pendingHit = null; m.recalling = kind === 'recall';
      if (m.mode !== 'rising') m.mode = kind === 'attack' ? 'attack' : 'follow';
    }
    this.events.push({ type: 'command', command: kind, target: target?.id });
  }
  gesture(side, hand, head, time, world, occupied, result) {
    let state = this.hands[side];
    if (!hand || occupied || !hornsPose(hand)) { this.hands[side] = handState(); return; }
    result.reserved[side] = true;
    if (hand.tracked === false) { state.liftBase = null; state.since = null; state.candidate = null; state.label = 'STILL READY / HAND OUT OF VIEW'; return; }
    if (hand.reacquired) this.hands[side] = state = handState();
    state.since ??= time;
    const relativeY = hand.palm.y - head.position.y;
    const direction = unit(hand.aim), upright = (hand.handAim || direction).y > .40;
    const source = this.sourceFor(head, time);
    if (upright) {
      state.candidate = state.lastCommand = null; state.target = null;
      state.label = source ? 'LIFT YOUR HAND / RAISE A SKELETON' : 'LOOK TOWARD A GLOWING GRAVE'; state.source = source?.id;
      if (state.liftBase === null) state.liftBase = relativeY;
      if (state.lifted && relativeY < state.raisedY - .10) { state.lifted = false; state.liftBase = relativeY; state.since = time; }
      if (source && !state.lifted && time - state.since > 140 && time - state.lastRaised > 650 && relativeY - state.liftBase > .12) {
        this.raise(source, side, head, time); state.lifted = true; state.raisedY = relativeY; state.lastRaised = time;
      }
      return;
    }
    state.liftBase = null; state.lifted = false; state.source = null;
    const target = direction.y > -.50 && dot(direction, head.forward) > .40 ? this.commandTarget(hand, world) : null;
    const command = direction.y < -.60 ? 'recall' : target ? 'attack' : null;
    const key = command === 'attack' ? `attack:${target.id}` : command;
    state.target = target?.id; state.label = command === 'recall' ? 'POINT DOWN / COME BACK' : target ? 'POINT / ATTACK THIS TARGET' : 'POINT AT A TARGET / DOWN TO RECALL';
    if (!this.active().length) { state.label = 'FIND A GRAVE / LIFT TO RAISE'; return; }
    if (key !== state.candidate) { state.candidate = key; state.candidateSince = time; }
    if (key && key !== state.lastCommand && time - state.candidateSince >= 220) { this.command(command, target, head, time); state.lastCommand = key; }
  }
  canStep(from, to, world) {
    if (Math.abs(to.x) > 56 || Math.abs(to.z) > 56) return false;
    return [.3, 1.2].every(y => this.clearPath(add(from, v(0, y)), add(to, v(0, y)), world, .18));
  }
  move(m, goal, dt, world) {
    let waypoint = goal;
    if (insideYard(m.position) !== insideYard(goal)) {
      const gate = GRAVEYARD.gate;
      if (insideYard(m.position)) waypoint = Math.abs(m.position.x) > .38 && m.position.z > 3.55 ? v(0, 0, 3.7) : v(0, 0, 2.65);
      else waypoint = m.position.z < 2.9 || Math.abs(m.position.x) > .6 ? v(gate.x, 0, 2.65) : v(0, 0, 3.7);
    }
    const offset = flat(sub(waypoint, m.position)), remaining = length(offset);
    m.moving = false; if (remaining < .12 || dt <= 0) return;
    const desired = unit(offset), step = Math.min(remaining, dt * (m.recalling ? 2.8 : m.mode === 'attack' ? 2.1 : 1.5));
    let best = null;
    for (const angle of [0, .55, -.55, 1.1, -1.1, 1.7, -1.7]) {
      const direction = v(desired.x * Math.cos(angle) - desired.z * Math.sin(angle), 0, desired.x * Math.sin(angle) + desired.z * Math.cos(angle));
      const next = add(m.position, mul(direction, step));
      if (!this.canStep(m.position, next, world)) continue;
      const score = distance(next, waypoint) + (1 - dot(direction, m.direction)) * .025;
      if (!best || score < best.score) best = { next, direction, score };
    }
    if (best) { m.position = best.next; m.direction = best.direction; m.moving = true; }
  }
  followGoal(m, head, time, world) {
    if (m.recalling && length(flat(sub(m.position, head.position))) < 3.5) m.recalling = false;
    if (!m.goal || time >= m.nextWander || distance(m.goal, head.position) > 4.2) {
      const angle = m.id * 2.399 + (m.recalling ? 0 : Math.floor(time / 2800) * .85), radius = 1.8 + (m.id % 3) * .5;
      m.goal = add(flat(head.position), v(Math.sin(angle) * radius, 0, Math.cos(angle) * radius)); m.nextWander = time + 2800;
    }
    if (distance(m.position, head.position) > 26 && !insideYard(m.position)) {
      // A recalled follower can catch up after portal travel by re-emerging nearby.
      if (this.canStep(m.goal, m.goal, world)) { m.position = copy(m.goal); m.mode = 'rising'; m.born = time; }
    }
    let goal = copy(m.goal);
    for (const other of this.active()) if (other !== m && distance(m.position, other.position) < .65) goal = add(goal, mul(unit(flat(sub(m.position, other.position))), .5));
    return goal;
  }
  simulate(head, time, dt, world) {
    this.minions = this.minions.filter(m => m.mode !== 'dying' || time - m.diedAt < 2200);
    for (const m of this.active()) {
      if (m.mode === 'rising') {
        if (time - m.born < 1000) continue;
        m.mode = m.order === 'attack' ? 'attack' : 'follow';
      }
      const target = m.mode === 'attack' && (world.targets || []).find(t => t.id === m.target);
      if (m.mode === 'attack' && !target) { m.mode = 'follow'; m.nextWander = time; }
      if (target) {
        const toward = unit(flat(sub(target.center, m.position))), range = length(flat(sub(target.center, m.position)));
        const goal = add(flat(target.center), mul(toward, -(target.radius + .60)));
        this.move(m, goal, dt, world);
        if (range <= target.radius + .85 && this.clearPath(add(m.position, v(0, 1.4)), target.center, world)) {
          m.direction = toward;
          if (time >= m.nextAttack) { m.attackAt = time; m.nextAttack = time + 1100; m.pendingHit = target.id; }
        }
        if (m.pendingHit && time - m.attackAt >= 200) {
          if (range <= target.radius + 1 && this.clearPath(add(m.position, v(0, 1.4)), target.center, world)) this.events.push({ type: 'hit', target: m.pendingHit, point: target.center, damage: 12, spell: 'necromancy', minion: m.id });
          m.pendingHit = null;
        }
      } else this.move(m, this.followGoal(m, head, time, world), dt, world);
    }
  }
  update(hands, head, time, world = {}, occupied = {}) {
    let elapsed = this.lastTime === null ? 0 : time - this.lastTime;
    if (elapsed > 250 || elapsed < 0) { this.suspend(); elapsed = 0; }
    this.lastTime = time; this.events = [];
    const result = { reserved: { left: false, right: false }, hands: this.hands, highlighted: [], events: this.events };
    for (const side of ['left', 'right']) this.gesture(side, hands[side], head, time, world, occupied[side], result);
    if (Object.values(result.reserved).some(Boolean)) result.highlighted = this.sources.filter(s => this.available(s, time) && distance(s.position, head.position) < 12).map(s => s.id);
    this.simulate(head, time, Math.min(elapsed / 1000, .05), world);
    result.hands = this.hands; result.active = this.active().length; return result;
  }
}
