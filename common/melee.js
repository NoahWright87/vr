// ============================================================
// MELEE — punches that connect.
//
// The loop (docs/actions/melee.spec.md), per hand:
//
//   sense    common/intent.js commits a strike as soon as the motion is
//            unambiguous (fast, past 55% of reach, energy up) — well
//            before the fist arrives.
//   resolve  combat-targeting's `strike` profile picks who it was for,
//            along the hand's motion from the shoulder, gaze-weighted,
//            preferring whoever this hand hit last (combos).
//   bring    cheapest first: the target leans in (action-incoming — free,
//            nothing about you moves); the virtual fist is pulled toward
//            the target's surface by what the comfort budget grants.
//   contact  a swept-sphere test of the virtual fist's motion this frame
//            against every nearby zone, so a fist that crosses an arm in
//            one frame still hits it. The first zone touched wins — a
//            peg in the way blocks the punch.
//   sell     the target reacts (it owns its own sound and wobble);
//            hit-stop freezes it, never you; haptics on the hand.
//
// If the pull can't close the gap, the fist *jumps*: when the arm is
// out and the punch would have missed, the virtual fist leaps the rest
// of the way (up to Jump reach) and connects hard. You might be
// play-punching; your character doesn't miss. (Assist: Pull for an
// honest whiff instead; Cheat lands it with no fist motion at all.)
//
// Every hit is named (common/strike-style.js: butt, uppercut, slap,
// body, jab) and sold: the fist and the target freeze for a moment
// (Impact freeze — the target through the action clock, never you),
// the controller rumbles, and the target acts out the style.
//
//   <a-entity melee-hands="rig: #rig; left: #left-virtual; right: #right-virtual"></a-entity>
// ============================================================

import './motion-sense.js';
import './virtual-hands.js';
import './combat-targeting.js';
import './action-clock.js';
import { createStrikeDetector, updateStrikes, committedAxis, strikeForce } from './intent.js';
import { sweptSphereZone, zoneSurfaceToward, distance } from './collide.js';
import { haptic } from './action-feedback.js';
import { strikeStyle } from './strike-style.js';
import { defineTunables } from './tunables.js';
import { registerReadout, logAction } from './debug-hud.js';

var THREE = AFRAME.THREE;
var FIST_RADIUS = 0.05;
var FOLLOW_THROUGH_MS = 160; // after full extension, contact still counts this long
var SIDES = ['left', 'right'];
// Damage by style: a gun butt or an uppercut hurts more; a slap is
// mostly humiliation.
var STYLE_DAMAGE = { butt: 1.3, uppercut: 1.2, jab: 1, body: 1, slap: 0.5 };

var tune = defineTunables('melee', 'Melee', [
  { key: 'assist', label: 'Assist', kind: 'select', value: 'jump', options: [
    { value: 'off', label: 'Off' }, { value: 'pull', label: 'Pull' }, { value: 'jump', label: 'Jump' }, { value: 'cheat', label: 'Cheat' },
  ], info: 'Off: your fist goes where your hand goes.\nPull: the target leans in and your fist is pulled to it, within the comfort budget.\nJump: Pull, and a punch that would miss has the fist leap out to connect.\nCheat: a committed punch at a target in range always lands, no fist motion.' },
  { key: 'jumpReach', label: 'Jump reach', value: 0.6, min: 0.1, max: 1, step: 0.05, unit: 'm',
    info: 'How far past your real fist a punch may leap to connect.' },
  { key: 'jumpSpeed', label: 'Jump speed', value: 9, min: 2, max: 20, step: 0.5, unit: 'm/s' },
  { key: 'slapSpeed', label: 'Slap', value: 2, min: 0.8, max: 5, step: 0.1, unit: 'm/s',
    info: 'A hand swiping sideways in front of you at least this fast, with someone in reach, slaps them (it jumps to connect too). They spin round, dizzy.' },
  { key: 'freeze', label: 'Impact freeze', value: 70, min: 0, max: 200, step: 10, unit: 'ms',
    info: 'On a solid hit your fist and the enemy hold still this long. You never freeze.' },
  { key: 'lean', label: 'Lean', value: 0.1, min: 0, max: 30, step: 1, unit: 'cm', scale: 100,
    info: 'How far a target leans into an incoming punch. Costs no comfort.' },
  { key: 'damage', label: 'Damage', value: 1, min: 0.25, max: 5, step: 0.25 },
  { key: 'graze', label: 'Graze', value: 2, min: 0.5, max: 6, step: 0.25, unit: 'm/s',
    info: 'A fist moving at least this fast that touches something, without a committed punch, still hits — speed only.' },
  { key: 'commitSpeed', label: 'Commit', value: 1.5, min: 0.5, max: 4, step: 0.1, unit: 'm/s',
    info: 'How fast a hand must be moving to commit a punch.' },
  { key: 'commitAt', label: 'Commit at', value: 0.55, min: 30, max: 90, step: 5, unit: '%', scale: 100 },
  { key: 'commitEnergy', label: 'Energy', value: 0.3, min: 0, max: 100, step: 5, unit: '%', scale: 100,
    info: 'Motion energy needed to commit. The guard against reaching and gesturing.' },
]);

var instances = [];
registerReadout('melee', 'Melee', function () {
  return instances.map(function (m) { return m.describe(); }).join('\n') || 'no melee';
});

AFRAME.registerComponent('melee-hands', {
  schema: {
    rig: { type: 'selector' },
    left: { type: 'selector' }, // virtual-hand entities
    right: { type: 'selector' },
  },

  init: function () {
    this.detector = createStrikeDetector();
    this.hands = {};
    SIDES.forEach(function (side) {
      this.hands[side] = { strike: null, last: null, cooldowns: new Map(), lastText: '' };
    }, this);
    this.dir = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    instances.push(this);
  },

  remove: function () {
    var i = instances.indexOf(this);
    if (i >= 0) instances.splice(i, 1);
  },

  sense: function () { var r = this.data.rig; return r && r.components['motion-sense']; },
  virtual: function (side) { var el = this.data[side]; return el && el.components['virtual-hand']; },
  targeting: function () { return this.el.sceneEl.systems['combat-targeting']; },

  describe: function () {
    return SIDES.map(function (side) {
      var h = this.hands[side];
      var axis = committedAxis(this.detector, side);
      return side.charAt(0).toUpperCase() + ': ' + (axis ? axis.toUpperCase() + ' ' : '') +
        (h.strike && h.strike.pick ? '-> ' + h.strike.pick.name + ' ' : '') + (h.lastText || '');
    }, this).join('\n');
  },

  tick: function (time) {
    var sense = this.sense();
    if (!sense) return;
    var s = this.detector.settings;
    s.commitSpeed = tune.values.commitSpeed;
    s.commitAt = tune.values.commitAt;
    s.commitEnergy = tune.values.commitEnergy;

    var events = updateStrikes(this.detector, sense.state);
    for (var i = 0; i < events.length; i++) this.onStrike(events[i], sense, time);
    for (var k = 0; k < SIDES.length; k++) this.updateHand(SIDES[k], sense, time);
  },

  onStrike: function (e, sense, time) {
    var hand = this.hands[e.hand];
    if (e.phase === 'commit') {
      var aim = sense.aimRayWorld(e.hand);
      if (!aim) return;
      // Who it's for: along the arm, bent toward the way the fist is
      // moving. Motion alone fails for an uppercut (it moves straight up,
      // and nobody is up there); the arm alone ignores a hook's swing.
      // An uppercut rises at whoever is in front of you, so it searches
      // from the body's facing, tipped up a little.
      var motionDir = sense.directionToWorld(e.direction || { x: 0, y: 0, z: -1 }, this.dir);
      var dir = e.axis === 'up'
        ? sense.directionToWorld(sense.state.facing, new THREE.Vector3()).add(new THREE.Vector3(0, 0.15, 0)).normalize()
        : new THREE.Vector3().copy(aim.direction).addScaledVector(motionDir, 0.6).normalize();
      var pick = this.targeting().resolve('strike', { origin: aim.origin, direction: dir, by: e.hand, current: hand.last });
      hand.strike = { event: e, pick: pick, landed: false, startT: time };
      // Tell the target a fist is coming, and how far it may lean into
      // it. Whatever owns the target decides whether it leans.
      if (pick && tune.values.assist !== 'off') {
        pick.el.emit('action-incoming', { by: e.hand, point: aim.hand, lean: tune.values.lean, ms: 400 }, false);
      }
      return;
    }
    if (!hand.strike) return;
    // 'land' means the arm reached full extension or stopped — but the
    // fist can still be on its way to something a little further out
    // (full extension is 90% of reach). Keep the strike live for a short
    // follow-through, and only call it a whiff after that.
    if (e.phase === 'land') hand.strike.landT = time;
    if (e.phase === 'cancel') hand.strike = null;
  },

  // A strike whose follow-through ran out without touching anything.
  finish: function (side, sense) {
    var hand = this.hands[side];
    var strike = hand.strike;
    hand.strike = null;
    if (strike.landed) return;
    var e = strike.event;
    var forced = tune.values.assist === 'cheat' && strike.pick && strike.pick.target.alive;
    if (forced) {
      var vh = this.virtual(side);
      var from = vh ? vh.position : sense.aimRayWorld(side).hand;
      var zone = this.zoneFor(strike.pick.target, from);
      this.hit(side, strike.pick.target, zone, zoneSurfaceToward(zone, from), e, true);
    } else {
      hand.lastText = 'whiff' + (strike.pick ? ' (' + strike.pick.name + ' out of reach)' : ' (no target)');
      logAction(side.charAt(0).toUpperCase() + ' ' + e.axis + ' whiffed' + (strike.pick ? ' at ' + strike.pick.name : ''));
    }
  },

  // The zone a punch from `from` is meant for: head if the fist is up
  // at head height, otherwise the nearest hittable zone.
  zoneFor: function (target, from) {
    var zones = target.worldZones();
    var best = null, bestD = Infinity;
    for (var i = 0; i < zones.length; i++) {
      if (zones[i].obstacle) continue;
      var d = distance(zoneSurfaceToward(zones[i], from), from);
      if (d < bestD) { bestD = d; best = zones[i]; }
    }
    return best || target.aimZone();
  },

  updateHand: function (side, sense, time) {
    var vh = this.virtual(side);
    if (!vh || !vh.initialized) return;
    var hand = this.hands[side];
    if (!hand.strike) this.slapCheck(side, sense, time);
    var strike = hand.strike;
    this.contact(side, sense, time);
    // Arm out, nothing touched, someone there: the fist jumps the gap.
    if (strike && strike.landT !== undefined && !strike.landed && !strike.jumpUntil && tune.values.assist === 'jump') this.jump(side, strike, time);
    // Contact first, then retire a strike whose follow-through ran out,
    // so a fist arriving on the last frame of it still counts.
    var through = strike && strike.jumpUntil ? Math.max(FOLLOW_THROUGH_MS, strike.jumpUntil - strike.landT) : FOLLOW_THROUGH_MS;
    if (strike && strike.landT !== undefined && (strike.landed || time - strike.landT > through)) {
      this.finish(side, sense);
      strike = null;
    }

    // A strike in flight: show a fist, and ask for the fist to be
    // pulled to the target's surface (a little past it, so the sweep
    // crosses it).
    if (strike) {
      vh.setPose('fist', 2);
      if (strike.pick && tune.values.assist !== 'off' && !strike.landed && strike.pick.target.alive) {
        var zone = this.zoneFor(strike.pick.target, vh.position);
        var surface = zoneSurfaceToward(zone, vh.position);
        var into = new THREE.Vector3(surface.x - vh.position.x, surface.y - vh.position.y, surface.z - vh.position.z);
        var l = into.length();
        if (l > 1e-4) into.multiplyScalar(0.03 / l);
        vh.pull('melee', { x: surface.x + into.x, y: surface.y + into.y, z: surface.z + into.z }, 1);
      }
    }
  },

  // A slap: the strike detector only knows forward and up, so a fast
  // sideways swipe in front of you, with someone in reach, becomes a
  // strike of its own — already at the end of its motion, so it jumps
  // to connect if it has to.
  slapCheck: function (side, sense, time) {
    var hand = this.hands[side];
    var vh = this.virtual(side);
    if (tune.values.assist === 'off' || !vh || vh.busy() || time < (hand.slapReady || 0)) return;
    var st = sense.state[side];
    var e = st.extension;
    if (!st.tracked || e.forward < 0.15 || e.up < -0.35) return;
    var right = sense.state.rightward, fwd = sense.state.facing;
    var v = st.relativeVelocity, sp = st.relativeSpeed;
    var hx = v.x * sp, hz = v.z * sp;
    var hs = Math.sqrt(hx * hx + hz * hz);
    if (hs < tune.values.slapSpeed) return;
    if (Math.abs(hx * right.x + hz * right.z) / hs < 0.7) return;
    var aim = sense.aimRayWorld(side);
    if (!aim) return;
    var dir = sense.directionToWorld(fwd, new THREE.Vector3());
    var pick = this.targeting().resolve('strike', { origin: aim.origin, direction: dir, by: side, current: hand.last });
    if (!pick || !pick.target.alive) return;
    var zone = this.zoneFor(pick.target, vh.position);
    if (distance(zoneSurfaceToward(zone, vh.position), vh.position) > tune.values.jumpReach + 0.1) return;
    hand.slapReady = time + 450;
    hand.strike = { event: { hand: side, axis: 'slap', speed: hs, travel: 0.3, headTravel: 0 }, pick: pick, landed: false, startT: time, landT: time };
  },

  // The punch would miss: if its target is within Jump reach of the
  // virtual fist, the fist leaps there (a fast snap move) and the
  // ordinary contact sweep lands it.
  jump: function (side, strike, time) {
    var pick = strike.pick;
    var vh = this.virtual(side);
    if (!pick || !vh || !pick.target.alive || vh.busy()) return;
    var zone = this.zoneFor(pick.target, vh.position);
    var surface = zoneSurfaceToward(zone, vh.position);
    if (distance(surface, vh.position) > tune.values.jumpReach) return;
    var self = this;
    var ms = 60 + 1000 * tune.values.jumpReach / tune.values.jumpSpeed;
    strike.jumpUntil = time + ms;
    strike.jumped = true;
    vh.perform('jump', function () {
      // Through the surface a little, so the sweep crosses it.
      var z = self.zoneFor(pick.target, vh.trackedPosition);
      var p = zoneSurfaceToward(z, vh.trackedPosition);
      var into = new THREE.Vector3(p.x - vh.trackedPosition.x, p.y - vh.trackedPosition.y, p.z - vh.trackedPosition.z);
      var l = into.length() || 1;
      return { x: p.x + into.x / l * 0.06, y: p.y + into.y / l * 0.06, z: p.z + into.z / l * 0.06 };
    }, ms, { pose: 'fist', speed: tune.values.jumpSpeed });
  },

  // Contact: sweep the virtual fist's motion this frame against every
  // nearby zone; the first touched wins.
  contact: function (side, sense, time) {
    var vh = this.virtual(side);
    var hand = this.hands[side];
    var strike = hand.strike && !hand.strike.landed ? hand.strike : null;
    var moved = vh.previous.distanceTo(vh.position);
    if (moved < 1e-5) return;
    var speed = sense.state[side].relativeSpeed;
    var committed = Boolean(strike);
    if (!committed && speed < tune.values.graze) return;

    var targets = this.targeting().targets;
    var first = null;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t.alive || !t.targetable()) continue;
      var center = t.el.object3D.getWorldPosition(this.vel);
      if (Math.abs(center.x - vh.position.x) > 2.5 || Math.abs(center.z - vh.position.z) > 2.5) continue;
      var cool = hand.cooldowns.get(t.el);
      if (cool && cool > time) continue;
      var zones = t.worldZones();
      for (var z = 0; z < zones.length; z++) {
        var contact = sweptSphereZone(vh.previous, vh.position, FIST_RADIUS, zones[z]);
        if (contact && (!first || contact.t < first.t)) first = { t: contact.t, point: contact.point, target: t, zone: zones[z] };
      }
    }
    if (!first) return;
    hand.cooldowns.set(first.target.el, time + 250);
    var e = strike ? strike.event : { speed: speed, travel: 0, headTravel: 0, axis: 'graze' };
    if (strike) strike.landed = true;
    this.hit(side, first.target, first.zone, first.point, e, false, strike && strike.jumped);
  },

  hit: function (side, target, zone, point, e, forced, jumped) {
    var hand = this.hands[side];
    var sense = this.sense();
    var vel = sense.directionToWorld(sense.state[side].relativeVelocity, this.dir).multiplyScalar(sense.state[side].relativeSpeed);
    // The hit's direction is the way the fist you see was going: a fist
    // that jumped to connect was going at them, wherever your hand is.
    var vh0 = this.virtual(side);
    var dir = vh0 ? vh0.position.clone().sub(vh0.previous) : vel.clone();
    if (dir.lengthSq() < 1e-8) dir.copy(vel);
    if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
    dir.normalize();
    var committed = e.axis !== 'graze';
    var vh = this.virtual(side);
    // A graze is speed only (Punch Pop's rule: it shouldn't hit as hard
    // as a committed strike).
    var force = committed ? strikeForce(e) : Math.min(1, (e.speed || 0) / 5);
    // A fist that jumped to connect connects hard.
    if (jumped) force = Math.max(force, 0.85);
    // A counter: the target is open (just parried), so it hits harder.
    var counter = committed && (target.openUntil || 0) > this.el.sceneEl.time;
    if (counter) force *= 1.5;

    // What kind of hit, for the target to act out.
    var center = target.el.object3D.getWorldPosition(new THREE.Vector3());
    var torso = target.worldZones().filter(function (z) { return z.name === 'torso'; })[0];
    var style = strikeStyle({
      axis: e.axis, holdingGun: Boolean(vh && vh.holding), velocity: vel,
      toTarget: { x: center.x - (vh ? vh.trackedPosition.x : point.x), z: center.z - (vh ? vh.trackedPosition.z : point.z) },
      pointY: point.y, zone: zone && zone.name, chestY: torso ? (torso.a.y + torso.b.y) / 2 : undefined,
    });
    var damage = force * tune.values.damage * (STYLE_DAMAGE[style] || 1);
    var result = target.applyHit({
      zone: zone, point: point, direction: { x: dir.x, y: dir.y, z: dir.z },
      force: force, damage: damage, source: 'strike', by: side, style: style, jumped: Boolean(jumped),
    });
    if (!result) return;
    var handEl = vh && vh.data.tracked; // haptics go to the real controller
    if (result.blocked) {
      haptic(handEl, 'block');
      hand.lastText = 'blocked by ' + result.zone;
    } else {
      var solid = committed || style === 'slap';
      haptic(handEl, style === 'slap' ? 'slap' : (jumped || force > 0.75 || style === 'uppercut' || style === 'butt') ? 'hit-crunch' : committed ? 'hit-heavy' : 'hit-light');
      // The impact: fist and enemy hold for a beat. Never you.
      var freeze = tune.values.freeze * (solid ? 1 : 0.5) * (0.7 + 0.3 * Math.min(1.5, force));
      var clock = this.el.sceneEl.systems['action-clock'];
      if (clock && freeze > 0) clock.hitStop(target.el, freeze);
      if (vh && freeze > 0) vh.freeze(freeze);
      hand.last = target.el;
      hand.hitAt = this.el.sceneEl.time;
      hand.lastText = (forced ? 'CHEAT ' : '') + (counter ? 'COUNTER ' : '') + (jumped ? 'JUMPED ' : '') + style + ' ' + result.zone + ' ' + force.toFixed(2) +
        (vh ? ' (assist ' + (vh.offsetLength() * 100).toFixed(1) + 'cm)' : '');
    }
    logAction(side.charAt(0).toUpperCase() + ' ' + hand.lastText + ' on ' + (target.el.id || 'target'));
  },
});
