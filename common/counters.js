// ============================================================
// COUNTERS — what your hands do to a punch, chosen by how you move.
//
// Arkham-style: you don't pick a move, you move, and the game picks the
// best-looking one that fits. As a punch comes in (its last moments
// before launching, and early in its drive), every registered counter
// looks at each hand near the punch's line and scores how well what
// you're doing fits it. The best score wins and the counter plays: it
// borrows your hand for a moment (virtual-hand.perform) and tells the
// attacker how to react. Nothing fits: the guard blocks it, or it
// lands.
//
// Adding a move is adding an entry:
//
//   registerCounter({
//     id: 'shove', label: 'shoved aside',
//     detect: function (ctx, settings) { return null or { score: 0..1, ...anything } },
//     perform: function (ctx, found, settings) { borrow hands; return reaction },
//   });
//
// ctx (all world space; velocities are the hand relative to your head,
// so walking doesn't swat):
//   hand      { side, position (real hand), velocity, speed, vh, other }
//   other     the other hand, same shape (for two-handed moves), or null
//   attack    the attack record (attacks.js): base, tip, aim, phase, progress, el
//   line      { base, aim, dir (unit, base→aim), flat (unit, horizontal) }
//   body      { yawRate (deg/s, signed), headVelocity, headHeight }
//   distance  hand to the punch's line, m
//   grab      the point on their arm (shoulder to fist, now) nearest the hand
//
// A reaction is what the attacker does about it, for it to act out:
//   { label, push: { x, z } (world, unit) or null for "away from you",
//     speed (m/s), openMs, intoFriend (bend the push onto a friend),
//     stagger }
//
// detectSwat / detectMeet are pure, tested by tests/counters.test.js.
// The moves (and how to detect them) are expected to grow a lot — see
// docs/actions/counters.todo.md.
// ============================================================

import { defineTunables } from './tunables.js';

export var DEFAULT_COUNTERS = {
  reach: 0.5, // m: a hand this close to a punch's line can counter it
  swatSpeed: 1.1, // m/s across the punch
  swatAcross: 0.55, // fraction of the hand's (horizontal) motion that must be across
  meetSpeed: 1.6, // m/s into the punch
  meetInto: 0.5, // fraction of the hand's motion back along the punch
  shove: 3.6, // m/s a swat shoves them aside
  knock: 3.2, // m/s meeting it knocks them back
  openMs: 1500,
};

function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// The hand sweeping across the punch, horizontally. Returns null or
// { score, push: { x, z } } — the way it was swept.
export function detectSwat(velocity, lineDir, s) {
  var vx = velocity.x, vz = velocity.z;
  var speed = Math.sqrt(vx * vx + vz * vz);
  if (speed < s.swatSpeed) return null;
  var fl = Math.sqrt(lineDir.x * lineDir.x + lineDir.z * lineDir.z) || 1;
  var dx = lineDir.x / fl, dz = lineDir.z / fl;
  var px = -dz, pz = dx; // horizontal perpendicular to the punch
  var across = (vx * px + vz * pz) / speed;
  if (Math.abs(across) < s.swatAcross) return null;
  var sign = across > 0 ? 1 : -1;
  return {
    score: Math.abs(across) * Math.min(1, speed / (2 * s.swatSpeed)),
    push: { x: px * sign, z: pz * sign },
  };
}

// The hand driving back along the punch, at the attacker: meeting it
// head-on. Returns null or { score }.
export function detectMeet(velocity, speed, lineDir, s) {
  if (speed < s.meetSpeed) return null;
  var into = -dot(velocity, lineDir) / speed;
  if (into < s.meetInto) return null;
  return { score: into * Math.min(1, speed / (2 * s.meetSpeed)) };
}

var registry = [];

export function registerCounter(counter) {
  for (var i = 0; i < registry.length; i++) {
    if (registry[i].id === counter.id) { registry[i] = counter; return counter; }
  }
  registry.push(counter);
  return counter;
}

export function listCounters() { return registry.slice(); }

// The best { counter, found } for this context, or null.
export function chooseCounter(ctx, settings) {
  var best = null;
  for (var i = 0; i < registry.length; i++) {
    var c = registry[i];
    if (c.enabled === false) continue;
    var found = c.detect(ctx, settings);
    if (found && found.score > 0 && (!best || found.score > best.found.score)) best = { counter: c, found: found };
  }
  return best;
}

var tune = typeof AFRAME !== 'undefined' ? defineTunables('counters', 'Counters', [
  { key: 'reach', label: 'Reach', value: DEFAULT_COUNTERS.reach, min: 0.1, max: 1, step: 0.05, unit: 'm',
    info: 'How close a hand must be to an incoming punch to counter it.' },
  { key: 'swatSpeed', label: 'Swat', value: DEFAULT_COUNTERS.swatSpeed, min: 0.4, max: 4, step: 0.1, unit: 'm/s',
    info: 'How fast a hand sweeping sideways across a punch must move to grab it and shove them aside.' },
  { key: 'meetSpeed', label: 'Meet', value: DEFAULT_COUNTERS.meetSpeed, min: 0.4, max: 4, step: 0.1, unit: 'm/s',
    info: 'How fast a hand driving into a punch must move to knock them back.' },
  { key: 'shove', label: 'Shove', value: DEFAULT_COUNTERS.shove, min: 0, max: 8, step: 0.2, unit: 'm/s' },
  { key: 'knock', label: 'Knock back', value: DEFAULT_COUNTERS.knock, min: 0, max: 8, step: 0.2, unit: 'm/s' },
  { key: 'openMs', label: 'Opening', value: DEFAULT_COUNTERS.openMs, min: 0, max: 4000, step: 100, unit: 'ms',
    info: 'How long a countered attacker stays open (blue) for a harder punch.' },
]) : null;

export function counterSettings() {
  return Object.assign({}, DEFAULT_COUNTERS, tune ? tune.values : {});
}

// ---------- the first two moves ----------

// Swat: sweep a hand sideways across the punch. Your hand catches their
// arm and throws the arm (and them) the way you swept.
registerCounter({
  id: 'swat',
  label: 'swatted aside',
  detect: function (ctx, s) { return detectSwat(ctx.hand.velocity, ctx.line.dir, s); },
  perform: function (ctx, found, s) {
    var grab = { x: ctx.grab.x, y: ctx.grab.y, z: ctx.grab.z };
    var push = found.push;
    // Catch the arm, then carry it on the way you swept.
    var carry = { x: grab.x + push.x * 0.18, y: grab.y, z: grab.z + push.z * 0.18 };
    var t0 = ctx.time;
    ctx.hand.vh.perform('counter', function () {
      var k = Math.min(1, (ctx.hand.vh.el.sceneEl.time - t0) / 220);
      return { x: grab.x + (carry.x - grab.x) * k, y: grab.y, z: grab.z + (carry.z - grab.z) * k };
    }, 260, { pose: 'fist' });
    return { label: 'swatted aside', push: push, speed: s.shove, openMs: s.openMs, intoFriend: true, stagger: 2.5 };
  },
});

// Meet: drive a hand into the punch. Fist meets fist; they're knocked
// back on their heels.
registerCounter({
  id: 'meet',
  label: 'knocked back',
  detect: function (ctx, s) { return detectMeet(ctx.hand.velocity, ctx.hand.speed, ctx.line.dir, s); },
  perform: function (ctx, found, s) {
    var at = { x: ctx.grab.x, y: ctx.grab.y, z: ctx.grab.z };
    ctx.hand.vh.perform('counter', at, 180, { pose: 'fist' });
    return { label: 'knocked back', push: null, speed: s.knock, openMs: s.openMs, intoFriend: true, stagger: 3 };
  },
});
