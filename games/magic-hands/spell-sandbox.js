// Stateful spell intent and small swept-sphere physics, independent of A-Frame.
// A hand owns one action at a time; renderers consume events and body poses.
import { clamp, sub, dot, unit, length, distance, farsightPose, FINGERS } from '../../common/hand-gestures.js';
import { selectLightningTarget } from './lightning-aim.js';
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const copy = a => v(a.x, a.y, a.z);
const add = (a, b) => v(a.x + b.x, a.y + b.y, a.z + b.z);
const mul = (a, n) => v(a.x * n, a.y * n, a.z * n);
const mix = (a, b, t) => add(a, mul(sub(b, a), t));
export const openness = hand => FINGERS.reduce((sum, f) => sum + hand.extension[f], 0) / 4;
export const isFist = hand => Math.max(...FINGERS.map(f => hand.extension[f])) < .66;
const openHand = hand => Math.min(...FINGERS.map(f => hand.extension[f])) > .84;
const palmUp = hand => hand.normal.y > .65 && openness(hand) > .48;

export function sweepSphere(from, to, center, radius) {
  const d = sub(to, from), offset = sub(from, center), a = dot(d, d), c = dot(offset, offset) - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-10) return null;
  const b = dot(offset, d), disc = b * b - a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / a;
  return t >= 0 && t <= 1 ? t : null;
}
export function sweepBox(from, to, box, radius = 0) {
  let near = 0, far = 1;
  for (const axis of ['x', 'y', 'z']) {
    const delta = to[axis] - from[axis], lo = box.min[axis] - radius, hi = box.max[axis] + radius;
    if (Math.abs(delta) < 1e-8) { if (from[axis] < lo || from[axis] > hi) return null; continue; }
    let a = (lo - from[axis]) / delta, b = (hi - from[axis]) / delta;
    if (a > b) [a, b] = [b, a]; near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return null;
  }
  return near;
}

const newHand = () => ({ mode: 'idle', since: 0, fistSince: null, scoop: null, pinchReady: false, openSince: null, motion: null });
export const PRACTICE_PROPS = [
  { id: 'rune-cube', shape: 'cube', position: v(-.75, .85, -1.5), radius: .16, color: '#72cabb' },
  { id: 'rune-stone', shape: 'stone', position: v(.75, .85, -1.65), radius: .18, color: '#ae92e4' },
  { id: 'rune-orb', shape: 'orb', position: v(0, 1.20, -2.4), radius: .16, color: '#e6bc75' },
];

export class SpellSandbox {
  constructor(props = PRACTICE_PROPS) { this.spawns = props; this.reset(); }
  reset() {
    this.hands = { left: newHand(), right: newHand() }; this.lastTime = null; this.nextId = 1;
    this.bodies = this.spawns.map(p => ({ ...p, position: copy(p.position), velocity: v(), owner: null, awake: false, thrownUntil: 0 }));
    this.projectiles = []; this.bursts = []; this.events = [];
  }
  release(state) {
    if (state.body) { state.body.owner = null; state.body.velocity = v(); state.body.awake = true; state.body.thrownUntil = 0; }
    state.body = null;
  }
  suspend() {
    Object.values(this.hands).forEach(s => this.release(s));
    this.hands = { left: newHand(), right: newHand() }; this.projectiles = []; this.bursts = []; this.lastTime = null;
  }
  teleport(transform) {
    // Carry owned props and their anchors; loose props/projectiles stay in the world.
    for (const state of Object.values(this.hands)) {
      state.motion = null;
      for (const key of ['anchor', 'origin', 'previousPalm']) if (state[key]) state[key] = transform(state[key]);
      state.hover = null; state.focus = null; state.scoop = null;
      if (state.body) { state.body.position = transform(state.body.position); state.body.velocity = v(); }
    }
  }
  recovery(side, time) {
    this.release(this.hands[side]); this.hands[side] = { ...newHand(), mode: 'recovery', since: time, motion: this.hands[side].motion };
  }
  impact(from, to, radius, world, ignoreBody = null, includeProps = true) {
    let hit = null;
    const consider = (t, kind, object) => { if (t !== null && (!hit || t < hit.t)) hit = { t, kind, object, point: mix(from, to, t) }; };
    for (const target of world.targets || []) consider(sweepSphere(from, to, target.center, radius + target.radius), 'target', target);
    for (const box of world.obstacles || []) consider(sweepBox(from, to, box, radius), 'wall', box);
    if (includeProps) for (const body of this.bodies) {
      if (body !== ignoreBody && !body.owner) consider(sweepSphere(from, to, body.position, radius + body.radius), 'body', body);
    }
    if (to.y < radius && from.y >= radius) consider((from.y - radius) / Math.max(1e-8, from.y - to.y), 'floor', null);
    return hit;
  }
  clearPath(from, to, world) {
    return !(world.obstacles || []).some(box => sweepBox(from, to, box) !== null);
  }
  targetProp(hand, world) {
    const targets = this.bodies.filter(b => !b.owner).map(body => ({ ...body, center: body.position,
      visible: this.clearPath(hand.tip, body.position, world) }));
    return selectLightningTarget(hand.tip, hand.aim, targets, { coneDegrees: 12, arcDegrees: 12, arcMiss: 0, range: 8 })?.target.id || null;
  }
  motion(state, hand, head, time, dt) {
    const relative = sub(hand.palm, head.position), previous = state.motion;
    const jump = previous && (distance(previous.palm, hand.palm) > .35 || distance(previous.head, head.position) > .35);
    const relativeVelocity = previous && dt > 0 && !jump ? mul(sub(relative, previous.relative), 1 / dt) : v();
    const velocity = previous && dt > 0 && !jump ? mul(sub(hand.palm, previous.palm), 1 / dt) : v();
    const history = previous && !jump ? previous.history.filter(s => time - s.time <= 100) : [];
    history.push({ time, relativeVelocity, velocity });
    state.motion = { palm: copy(hand.palm), head: copy(head.position), relative, relativeVelocity, velocity, history, jump };
    return state.motion;
  }
  launchVelocity(motion, head, minimum = 4) {
    const stroke = [...motion.history].sort((a, b) => length(b.relativeVelocity) - length(a.relativeVelocity))[0];
    const speed = length(stroke.relativeVelocity);
    return { deliberate: speed > .80 && dot(stroke.relativeVelocity, unit(motion.relative)) > .30,
      velocity: mul(unit(add(stroke.velocity, mul(head.forward, .12))), clamp(speed * 1.6, minimum, 13)) };
  }
  acquire(side, state, hand, body, time, held = false) {
    Object.assign(state, { mode: 'telekinesis', body, phase: held ? 'held' : 'remote', since: time, anchor: copy(hand.palm),
      origin: copy(body.position), startReach: length(state.motion.relative), releaseSince: null });
    body.owner = side; body.awake = true; body.velocity = v(); body.thrownUntil = 0; state.scoop = null;
    this.events.push({ type: 'acquired', hand: side, body: body.id });
  }
  throwBody(side, state, hand, head, time, velocity) {
    const body = state.body; body.owner = null; body.velocity = velocity; body.awake = true; body.thrownUntil = time + 4000;
    state.body = null; this.events.push({ type: 'cast', spell: 'telekinesis', hand: side }); this.recovery(side, time);
  }
  fire(side, state, hand, head, time, world, velocity) {
    const position = add(hand.palm, v(0, .10, 0));
    const targets = (world.targets || []).map(t => ({ ...t, visible: this.clearPath(position, t.center, world) }));
    const selected = selectLightningTarget(position, velocity, targets, { coneDegrees: 10, arcDegrees: 10, arcMiss: 0, range: 30 });
    if (selected) {
      const flight = distance(position, selected.target.center) / length(velocity);
      velocity = mul(unit(sub(selected.target.center, position)), length(velocity));
      velocity.y += .30 * flight; // Compensate the fireball's gentle gravity.
    }
    if (this.projectiles.length >= 12) this.projectiles.shift();
    this.projectiles.push({ id: this.nextId++, position, previous: copy(position), velocity, radius: .10, born: time, hand: side });
    this.events.push({ type: 'cast', spell: 'fireball', hand: side }); this.recovery(side, time);
  }
  updateHand(side, hand, head, time, dt, world, circle) {
    let state = this.hands[side];
    if (!hand) { this.release(state); this.hands[side] = newHand(); return; }
    const motion = this.motion(state, hand, head, time, dt);
    if (motion.jump) { this.recovery(side, time); return; }
    const reach = length(motion.relative), fist = isFist(hand), open = openHand(hand), pinched = hand.pinch < .45;
    const launch = this.launchVelocity(motion, head);
    if (state.mode === 'recovery') {
      if (time - state.since > 300 && reach < .52 && !fist && !pinched && !palmUp(hand)) this.hands[side] = { ...newHand(), motion };
      return;
    }
    if (state.mode === 'fireball') {
      const opening = openness(hand); state.lowestOpenness = Math.min(state.lowestOpenness, opening);
      if (opening < .94) state.releaseReady = true;
      if (open && state.releaseReady && opening - state.lowestOpenness > .045 && time - state.since > 150 && launch.deliberate) {
        this.fire(side, state, hand, head, time, world, launch.velocity); return;
      }
      if (open && hand.normal.y < -.35 && length(motion.relativeVelocity) < .30) {
        state.cancelSince ??= time;
        if (time - state.cancelSince > 350) this.recovery(side, time);
      } else state.cancelSince = null;
      return;
    }
    if (state.mode === 'telekinesis') {
      if (open && dot(hand.normal, unit(motion.relative)) > .45 && launch.deliberate) {
        this.throwBody(side, state, hand, head, time, launch.velocity); return;
      }
      if (state.phase === 'remote' && fist && state.startReach - reach > .12) state.phase = 'pulling';
      if (state.phase === 'remote' && hand.pinch > .72) {
        state.releaseSince ??= time;
        if (time - state.releaseSince > 100) { this.recovery(side, time); return; }
      } else if (state.phase !== 'remote' && open) {
        state.releaseSince ??= time;
        if (time - state.releaseSince > 120) { this.recovery(side, time); return; }
      } else state.releaseSince = null;
      const desired = state.phase === 'remote' ? add(state.origin, mul(sub(hand.palm, state.anchor), 2.5)) : add(hand.palm, mul(head.forward, .12));
      desired.y = Math.max(state.body.radius, desired.y);
      const next = mix(state.body.position, desired, 1 - Math.exp(-dt / (state.phase === 'pulling' ? .10 : .06)));
      // Held objects stop at scenery rather than being pulled through it.
      const wall = (world.obstacles || []).some(box => sweepBox(state.body.position, next, box, state.body.radius) !== null);
      if (!wall) state.body.position = next;
      if (state.phase === 'pulling' && distance(state.body.position, desired) < .14) state.phase = 'held';
      return;
    }
    if (state.mode === 'boulder') {
      if (!fist) { this.recovery(side, time); return; }
      state.minReach = Math.min(state.minReach, reach);
      if (state.punch && reach < state.hitReach - .10) { state.punch = false; state.minReach = reach; }
      if (!state.punch && reach - state.minReach > .12 && dot(motion.relativeVelocity, unit(motion.relative)) > .60) {
        state.punch = true; state.hitReach = reach; state.punchUntil = time + 220; state.struck = false;
        this.events.push({ type: 'cast', spell: 'boulder', hand: side });
      }
      if (state.punch && !state.struck && time <= state.punchUntil) {
        state.hitReach = Math.max(state.hitReach, reach);
        const hit = this.impact(state.previousPalm, hand.palm, .18, world);
        if (hit) {
          state.struck = true;
          if (hit.kind === 'target') this.events.push({ type: 'hit', target: hit.object.id, point: hit.point, damage: 60, spell: 'boulder', hand: side });
          if (hit.kind === 'body') { hit.object.velocity = mul(unit(motion.relativeVelocity), 7); hit.object.awake = true; hit.object.thrownUntil = time + 4000; }
          this.burst(hit.point, '#bdb0a2', time, .25);
        }
      }
      state.previousPalm = copy(hand.palm); return;
    }
    if (circle) { state.fistSince = null; state.scoop = null; state.focus = null; state.pinchReady = false; return; }
    // Nearby physical grabs take precedence over empty-hand boulders.
    const nearby = this.bodies.filter(b => !b.owner && distance(b.position, hand.palm) < b.radius + .13 && this.clearPath(hand.palm, b.position, world))
      .sort((a, b) => distance(a.position, hand.palm) - distance(b.position, hand.palm))[0];
    if (nearby && (fist || pinched)) { this.acquire(side, state, hand, nearby, time, true); return; }
    if (hand.pinch > .72) state.pinchReady = true;
    const pointed = hand.extension.index > .65 ? this.targetProp(hand, world) : null;
    if (!pinched && pointed) state.hover = { id: pointed, time, palm: copy(hand.palm) };
    // Forming a pinch bends the aiming index. Preserve the visibly selected
    // prop briefly instead of requiring the reshaped finger to keep its ray.
    const hoveredBody = state.hover && this.bodies.find(b => b.id === state.hover.id && !b.owner);
    const remembered = pinched && hoveredBody && time - state.hover.time <= 250 && distance(state.hover.palm, hand.palm) < .15 &&
      this.clearPath(hand.palm, hoveredBody.position, world) ? hoveredBody.id : null;
    const targetId = remembered || pointed;
    state.focus = targetId;
    if (targetId && state.pinchReady && pinched) {
      this.acquire(side, state, hand, this.bodies.find(b => b.id === targetId), time); return;
    }
    if (palmUp(hand) && reach < .70) {
      state.scoop ??= { time, height: motion.relative.y };
      state.charge = clamp((motion.relative.y - state.scoop.height) / .08);
      if (time - state.scoop.time >= 100 && state.charge >= 1 && motion.relativeVelocity.y > .10) {
        Object.assign(state, { mode: 'fireball', since: time, lowestOpenness: openness(hand), releaseReady: openness(hand) < .94 }); state.fistSince = null; return;
      }
      if (time - state.scoop.time > 1200) state.scoop = { time, height: motion.relative.y };
    } else { state.scoop = null; state.charge = 0; }
    if (fist) {
      state.fistSince ??= time;
      if (time - state.fistSince > 180) Object.assign(state, { mode: 'boulder', since: time, minReach: reach, previousPalm: copy(hand.palm), punch: false });
    } else state.fistSince = null;
  }
  burst(position, color, time, radius = .65) {
    this.bursts.push({ id: this.nextId++, position: copy(position), color, born: time, radius });
    if (this.bursts.length > 16) this.bursts.shift();
  }
  explode(projectile, point, world, time) {
    this.burst(point, '#ff9b3c', time, .8);
    for (const target of world.targets || []) {
      if (distance(point, target.center) < .8 + target.radius && this.clearPath(point, target.center, world)) {
        this.events.push({ type: 'hit', target: target.id, point, damage: 50, spell: 'fireball', hand: projectile.hand });
      }
    }
    for (const body of this.bodies) if (!body.owner && distance(body.position, point) < 1.2) {
      body.velocity = add(mul(unit(sub(body.position, point)), 4), v(0, 2, 0)); body.awake = true; body.thrownUntil = time + 3000;
    }
  }
  physics(world, time, dt) {
    // Substeps plus swept collisions keep fast projectiles from tunnelling.
    const steps = Math.max(1, Math.ceil(dt / .016)), step = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.projectiles = this.projectiles.filter(p => {
        if (time - p.born > 5000) return false;
        p.previous = copy(p.position); p.velocity.y -= .6 * step;
        const next = add(p.position, mul(p.velocity, step));
        const hit = this.impact(p.position, next, p.radius, world);
        if (hit) { this.explode(p, hit.point, world, time); return false; }
        p.position = next; return true;
      });
      for (const body of this.bodies) {
        if (body.owner || !body.awake) continue;
        body.velocity.y -= 9.8 * step;
        const next = add(body.position, mul(body.velocity, step));
        const hit = this.impact(body.position, next, body.radius, world, body, false);
        if (hit) {
          if (hit.kind === 'target' && body.thrownUntil > time && length(body.velocity) > 2) {
            this.events.push({ type: 'hit', target: hit.object.id, point: hit.point, damage: 40, spell: 'telekinesis' });
          }
          body.position = mix(body.position, next, Math.max(0, hit.t - .01)); body.velocity = mul(body.velocity, -.2); body.thrownUntil = 0;
        } else body.position = next;
        if (body.position.y <= body.radius + .015) {
          body.position.y = body.radius; body.velocity.y = Math.abs(body.velocity.y) < .4 ? 0 : Math.abs(body.velocity.y) * .25;
          body.velocity.x *= Math.exp(-step * 5); body.velocity.z *= Math.exp(-step * 5);
        }
        if (length(body.position) > 35 || body.position.y < -2) {
          const spawn = this.spawns.find(p => p.id === body.id); body.position = copy(spawn.position); body.velocity = v(); body.awake = false;
        }
      }
    }
    this.bursts = this.bursts.filter(b => time - b.born < 450);
  }
  update(hands, head, time, world = {}, reserved = {}) {
    let elapsed = this.lastTime === null ? 0 : time - this.lastTime;
    if (elapsed > 180 || elapsed < 0) { this.suspend(); elapsed = 0; }
    this.lastTime = time; this.events = [];
    const circle = farsightPose(hands.left, hands.right, head, true);
    for (const side of ['left', 'right']) {
      if (reserved[side]) {
        this.release(this.hands[side]); this.hands[side] = newHand();
      } else this.updateHand(side, hands[side], head, time, Math.min(elapsed / 1000, .10), world, circle);
    }
    this.physics(world, time, Math.min(elapsed / 1000, .10));
    return { reserved: Object.fromEntries(['left', 'right'].map(side => [side, this.hands[side].mode !== 'idle'])), hands: this.hands, events: this.events };
  }
}
