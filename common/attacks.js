// ============================================================
// ATTACKS — things that come at the player, and how hands meet them.
//
// Nothing attacked the player before this. An attacker (the attacker
// dummy's thrust, a shooter's slow bullet) registers an *attack*: a
// record with a phase and a strike volume — a capsule from `base` to
// `tip`, radius `radius` — that the attacker moves each frame. While an
// attack is active this system resolves it, in order:
//
//   block    a virtual hand within blockRadius of the strike volume
//   parry    ...and moving fast *into* it (back along it, toward the
//            attacker), early in the active window:
//            the attacker is staggered and opened for a counter
//   hit      the tip reached your head or torso
//   (dodge)  the active window ended with none of those
//
// And it helps, in the punch's last moments (the attacker sets
// `attack.soon` near the end of its telegraph) and through its drive:
//
//   counters  a hand near the punch, moving the right way, plays a move
//             (common/counters.js: swat it aside, meet it head-on, and
//             whatever's added there) — resolved as a 'parry' with
//             r.move and r.reaction for the attacker to act out.
//   guard     otherwise one hand snaps onto the punch's line to block
//             it: a hand held up in front of you (a guard) from up to
//             Guard up away, any other hand from Guard away. It snaps
//             whether you're moving or not — the character's reflexes —
//             and comes straight back after.
//
// A hand's real position decides all of this; the virtual hand is
// what gets moved and what touches the punch.
//
// Slow bullets are attacks too, and combat-targets (team 'enemy', high
// threat) so autofire shoots them down. A hand that meets one deflects
// it; a parry sends it back at whoever fired it. Bullets run on the
// action clock, so bullet time slows them.
//
// resolveContact / guardPoint are pure, tested by tests/attacks.test.js.
// ============================================================

import { closestOnSegment, distance, sweptSphereZone } from './collide.js';
import { defineTunables } from './tunables.js';
import { registerReadout, logAction } from './debug-hud.js';
import { haptic, sound } from './action-feedback.js';
import './combat-targeting.js';
import './action-clock.js';
import './action-effects.js';
import './player-hurt.js';
import { chooseCounter, counterSettings } from './counters.js';

export var DEFAULT_DEFENSE = {
  blockRadius: 0.1, // m between a hand's centre and the strike volume
  parrySpeed: 1.6, // m/s, hand moving into the attack
  parryWindow: 0.6, // fraction of the active window a parry can happen in
  guardReach: 0.35, // m: any hand this close to an attack's line snaps onto it
  guardUp: 0.7, // m: a hand held up in a guard snaps from this far
};

function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

// attack: { base, tip, radius, progress (0..1 through active) }
// hands:  [{ side, position, velocity, speed }]
// body:   { head: { c, r }, torso: { a, b, r } }
// Returns { outcome: 'parry'|'block'|'hit'|null, hand?, point }.
export function resolveContact(attack, hands, body, settings) {
  var s = settings || DEFAULT_DEFENSE;
  var best = null;
  for (var i = 0; i < hands.length; i++) {
    var h = hands[i];
    if (!h.position) continue;
    var on = closestOnSegment(h.position, attack.base, attack.tip).point;
    var d = distance(h.position, on);
    if (d > attack.radius + s.blockRadius) continue;
    if (!best || d < best.d) best = { d: d, hand: h, point: on };
  }
  if (best) {
    // Meeting it: the hand moving back along the attack, toward
    // whoever threw it.
    var h2 = best.hand;
    var toward = sub(attack.base, attack.tip);
    var tl = Math.sqrt(dot(toward, toward));
    var into = tl > 1e-6 && h2.speed > 0 ? dot(h2.velocity, toward) / (tl * h2.speed) : 0;
    var parry = h2.speed >= s.parrySpeed && into > 0.3 && (attack.progress === undefined || attack.progress <= s.parryWindow);
    return { outcome: parry ? 'parry' : 'block', hand: h2, point: best.point };
  }
  if (body.head && distance(attack.tip, body.head.c) <= body.head.r + attack.radius) {
    return { outcome: 'hit', zone: 'head', point: attack.tip };
  }
  if (body.torso) {
    var t = closestOnSegment(attack.tip, body.torso.a, body.torso.b).point;
    if (distance(attack.tip, t) <= body.torso.r + attack.radius) return { outcome: 'hit', zone: 'torso', point: attack.tip };
  }
  return { outcome: null };
}

// Where a hand should be pulled to meet an attack along base→aim: the
// closest point on that line, if the hand is within reach of it.
export function guardPoint(base, aim, hand, reach) {
  var on = closestOnSegment(hand, base, aim);
  // Not behind the attacker's own shoulder.
  if (on.t <= 0.02) return null;
  return distance(hand, on.point) <= reach ? on.point : null;
}

// ---------- the system ----------

var tune = defineTunables('defense', 'Defense', [
  { key: 'blockRadius', label: 'Block', value: DEFAULT_DEFENSE.blockRadius, min: 2, max: 40, step: 1, unit: 'cm', scale: 100,
    info: 'How close a hand must be to an attack to block it.' },
  { key: 'parrySpeed', label: 'Parry', value: DEFAULT_DEFENSE.parrySpeed, min: 0.5, max: 5, step: 0.1, unit: 'm/s',
    info: 'How fast a hand must move into an attack to parry it (stagger and open the attacker).' },
  { key: 'parryWindow', label: 'Parry win', value: DEFAULT_DEFENSE.parryWindow, min: 10, max: 100, step: 10, unit: '%', scale: 100 },
  { key: 'guardReach', label: 'Guard', value: DEFAULT_DEFENSE.guardReach, min: 0, max: 80, step: 5, unit: 'cm', scale: 100,
    info: 'Any hand this close to an incoming punch snaps onto it to block. 0 turns the guard off.' },
  { key: 'guardUp', label: 'Guard up', value: DEFAULT_DEFENSE.guardUp, min: 0, max: 120, step: 5, unit: 'cm', scale: 100,
    info: 'A hand held up in front of you (a guard) snaps onto a punch from this far away.' },
  { key: 'bulletSpeed', label: 'Bullets', value: 7, min: 2, max: 30, step: 1, unit: 'm/s' },
]);

var stats = { block: 0, parry: 0, hit: 0, dodge: 0, deflect: 0, last: '' };
registerReadout('defense', 'Defense', function () {
  return 'blocks ' + stats.block + ' parries ' + stats.parry + ' (swat ' + (stats.swat || 0) + ' meet ' + (stats.meet || 0) + ') deflects ' + stats.deflect +
    ' hits ' + stats.hit + ' dodges ' + stats.dodge + (stats.last ? '\nlast: ' + stats.last : '');
});

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['combat-attacks']) {
  var THREE = AFRAME.THREE;

  AFRAME.registerSystem('combat-attacks', {
    init: function () {
      this.attacks = [];
      this.bullets = [];
      this.pool = [];
      this.camPos = new THREE.Vector3();
      this.v = new THREE.Vector3();
    },

    settings: function () { return tune.values; },

    begin: function (attack) {
      attack.phase = attack.phase || 'telegraph';
      attack.radius = attack.radius || 0.06;
      this.attacks.push(attack);
      return attack;
    },

    end: function (attack) {
      var i = this.attacks.indexOf(attack);
      if (i >= 0) this.attacks.splice(i, 1);
    },

    sense: function () {
      var rig = this.el.querySelector('[motion-sense]');
      return rig && rig.components['motion-sense'];
    },

    // The player's head and torso, in world space.
    body: function (sense) {
      var cam = this.el.camera;
      if (!cam) return {};
      cam.getWorldPosition(this.camPos);
      var body = { head: { c: { x: this.camPos.x, y: this.camPos.y, z: this.camPos.z }, r: 0.13 } };
      if (sense) {
        var top = sense.toWorld(sense.state.torso);
        body.torso = { a: { x: top.x, y: top.y, z: top.z }, b: { x: top.x, y: top.y - 0.45, z: top.z }, r: 0.17 };
      }
      return body;
    },

    hands: function (sense) {
      var out = [];
      var els = this.el.querySelectorAll('[virtual-hand]');
      for (var i = 0; i < els.length; i++) {
        var vh = els[i].components['virtual-hand'];
        if (!vh || !vh.initialized) continue;
        var side = vh.data.side;
        var vel = sense ? sense.directionToWorld(sense.state[side].relativeVelocity, new THREE.Vector3()) : new THREE.Vector3();
        var speed = sense ? sense.state[side].relativeSpeed : 0;
        var e = sense ? sense.state[side].extension : null;
        out.push({
          side: side, vh: vh, position: vh.position, real: vh.trackedPosition,
          velocity: vel.multiplyScalar(speed), speed: speed,
          // Held up in front of you: about chest height or above, forward.
          up: Boolean(e && e.up > -0.05 && e.forward > 0.1),
        });
      }
      for (var j = 0; j < out.length; j++) out[j].other = out[1 - j] || null;
      return out;
    },

    // A hand near a punch, moving the right way: a counter. Returns true
    // if one played.
    counter: function (a, hands, sense, time) {
      var cs = counterSettings();
      var line = this.line(a);
      if (!line) return false;
      var best = null;
      for (var h = 0; h < hands.length; h++) {
        var hand = hands[h];
        if (hand.vh.busy()) continue;
        var dist = distance(hand.real, closestOnSegment(hand.real, line.base, line.aim).point);
        if (dist > cs.reach) continue;
        // Where on their arm (shoulder to fist, as it is now) the hand would catch it.
        var grab = closestOnSegment(hand.real, a.base, a.tip).point;
        var ctx = { hand: hand, other: hand.other, attack: a, line: line, distance: dist, grab: grab, time: time, body: this.bodyMotion(sense) };
        var pick = chooseCounter(ctx, cs);
        if (pick && (!best || pick.found.score > best.pick.found.score)) best = { pick: pick, ctx: ctx };
      }
      if (!best) return false;
      var reaction = best.pick.counter.perform(best.ctx, best.pick.found, cs);
      this.resolve(a, { outcome: 'parry', move: best.pick.counter.id, reaction: reaction, hand: best.ctx.hand, point: { x: a.tip.x, y: a.tip.y, z: a.tip.z } });
      return true;
    },

    // The guard: the best-placed hand snaps onto the punch's line, a
    // little in front of you, to block it.
    guard: function (a, hands, s) {
      var line = this.line(a);
      if (!line) return;
      var best = null;
      for (var h = 0; h < hands.length; h++) {
        var hand = hands[h];
        if (hand.vh.busy()) continue;
        var on = closestOnSegment(hand.real, line.base, line.aim);
        var d = distance(hand.real, on.point);
        if (d > (hand.up ? Math.max(s.guardUp, s.guardReach) : s.guardReach) || on.t <= 0.02) continue;
        if (!best || d < best.d) best = { d: d, hand: hand, t: on.t };
      }
      if (!best) return;
      // Meet it in front of your face, not at it.
      var stop = Math.max(0.05, 1 - 0.25 / Math.max(line.length, 0.3));
      var t = Math.min(best.t, stop);
      var p = { x: line.base.x + (line.aim.x - line.base.x) * t, y: line.base.y + (line.aim.y - line.base.y) * t, z: line.base.z + (line.aim.z - line.base.z) * t };
      // Weighted over melee's pull (1): with something coming at you,
      // meeting it matters more than finishing your punch.
      best.hand.vh.pull('guard', p, 4, 'snap');
      best.hand.vh.setPose('open', 3);
    },

    // The punch's line: from its base (shoulder) to where it's aimed.
    line: function (a) {
      if (!a.aim) return null;
      var base = a.guardBase || a.base;
      var dx = a.aim.x - base.x, dy = a.aim.y - base.y, dz = a.aim.z - base.z;
      var l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l < 1e-4) return null;
      var fl = Math.sqrt(dx * dx + dz * dz) || 1;
      return { base: base, aim: a.aim, length: l, dir: { x: dx / l, y: dy / l, z: dz / l }, flat: { x: dx / fl, y: 0, z: dz / fl } };
    },

    bodyMotion: function (sense) {
      if (!sense) return {};
      var st = sense.state;
      return { yawRate: st.yawRate, headVelocity: sense.directionToWorld(st.head.velocity, new THREE.Vector3()), headHeight: st.head.position.y };
    },

    tick: function (time, dt) {
      var s = this.settings();
      var sense = this.sense();
      var hands = this.hands(sense);
      var body = this.body(sense);
      this.updateBullets(time, dt, hands, body, s);

      for (var i = this.attacks.length - 1; i >= 0; i--) {
        var a = this.attacks[i];
        if (a.resolved) continue;
        // Its last moments and its drive: counter it, or guard it.
        var coming = a.phase === 'active' || (a.phase === 'telegraph' && a.soon);
        if (coming) {
          // Bullets get the guard (deflect, parry back) but not the moves.
          var early = a.phase !== 'active' || a.progress === undefined || a.progress <= s.parryWindow;
          if (a.kind !== 'bullet' && early && this.counter(a, hands, sense, time)) continue;
          if (s.guardReach > 0 || s.guardUp > 0) this.guard(a, hands, s);
        }
        if (a.phase !== 'active') continue;
        var r = resolveContact(a, hands, body, s);
        if (r.outcome) this.resolve(a, r);
      }
    },

    resolve: function (a, r) {
      a.resolved = r.outcome;
      stats[r.outcome] = (stats[r.outcome] || 0) + 1;
      var who = (a.el && a.el.id) || 'attacker';
      if (r.outcome === 'hit') {
        this.el.systems['player-hurt'].hurt(a.damage || 1, r.point);
        stats.last = who + ' hit your ' + r.zone;
      } else {
        var handEl = r.hand.vh.data.tracked;
        sound(r.outcome === 'parry' ? 'parry' : 'block', r.point);
        haptic(handEl, r.outcome);
        var fx = this.el.systems['action-effects'];
        if (fx) fx.sparks(r.point, { x: 0, y: 1, z: 0 }, { count: r.outcome === 'parry' ? 16 : 8, color: r.outcome === 'parry' ? '#9fe6ff' : '#ffd27a' });
        if (r.move) stats[r.move] = (stats[r.move] || 0) + 1;
        stats.last = (r.move ? 'COUNTER ' + r.move.toUpperCase() + ' ' : r.outcome === 'parry' ? 'PARRIED ' : 'blocked ') + who +
          ' (' + r.hand.side + ' hand, ' + r.hand.speed.toFixed(1) + ' m/s)';
      }
      logAction(stats.last);
      if (a.onResolve) a.onResolve(r.outcome, r);
    },

    // An attack that finished its active window untouched.
    dodged: function (a) {
      if (a.resolved) return;
      a.resolved = 'dodge';
      stats.dodge++;
      stats.last = 'dodged ' + ((a.el && a.el.id) || 'attacker');
      logAction(stats.last);
    },

    // ---------- slow bullets ----------

    // A visible bullet from `from` toward `to` at `speed` m/s (default:
    // Tuning > Defense > Bullets). `owner` is the shooter's entity.
    fireBullet: function (from, to, owner, speed) {
      var b = this.pool.pop() || this.makeBullet();
      var v = speed || this.settings().bulletSpeed;
      var d = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z).normalize().multiplyScalar(v);
      b.pos.set(from.x, from.y, from.z);
      b.prev.copy(b.pos);
      b.vel.copy(d);
      b.age = 0;
      b.owner = owner;
      b.friendly = false; // sent back by a parry
      b.harmless = false; // knocked aside
      b.el.object3D.position.copy(b.pos);
      b.el.object3D.visible = true;
      b.el.setAttribute('material', 'color', '#ff5533');
      var target = b.el.components['combat-target'];
      if (target) { target.revive(); target.available = true; target.threat = 1; }
      b.attack = this.begin({ el: owner, kind: 'bullet', phase: 'active', base: b.prev, tip: b.pos, radius: 0.04, damage: 1, bullet: b });
      var self = this;
      b.attack.onResolve = function (outcome, r) { self.bulletResolved(b, outcome, r); };
      this.bullets.push(b);
      return b;
    },

    makeBullet: function () {
      var el = document.createElement('a-entity');
      el.setAttribute('geometry', { primitive: 'sphere', radius: 0.035, segmentsWidth: 8, segmentsHeight: 6 });
      el.setAttribute('material', { color: '#ff5533', shader: 'flat' });
      el.classList.add('slow-bullet');
      el.id = 'bullet-' + (this.bulletCount = (this.bulletCount || 0) + 1);
      // A bullet is a target: autofire can shoot it down.
      el.setAttribute('combat-target', { team: 'enemy', priority: 1, health: 0.1, aimZone: 'core' });
      this.el.appendChild(el);
      var b = { el: el, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0 };
      var self = this;
      el.addEventListener('loaded', function () {
        el.components['combat-target'].setZones([{ name: 'core', type: 'sphere', a: { x: 0, y: 0, z: 0 }, r: 0.08 }]);
      });
      if (el.hasLoaded) el.components['combat-target'].setZones([{ name: 'core', type: 'sphere', a: { x: 0, y: 0, z: 0 }, r: 0.08 }]);
      el.addEventListener('action-hit', function (evt) {
        if (evt.detail.source === 'deflect') return;
        var fx = self.el.systems['action-effects'];
        if (fx) fx.sparks(b.pos, { x: 0, y: 1, z: 0 }, { count: 10, color: '#ff8a5c' });
        logAction('shot a bullet down');
        self.retire(b);
      });
      return b;
    },

    retire: function (b) {
      var i = this.bullets.indexOf(b);
      if (i < 0) return;
      this.bullets.splice(i, 1);
      this.end(b.attack);
      b.el.object3D.visible = false;
      var target = b.el.components['combat-target'];
      if (target) { target.available = false; target.threat = 0; }
      this.pool.push(b);
    },

    bulletResolved: function (b, outcome, r) {
      if (outcome === 'hit') { this.retire(b); return; }
      stats.deflect++;
      var target = b.el.components['combat-target'];
      if (target) { target.available = false; target.threat = 0; } // no longer worth shooting
      this.end(b.attack);
      if (outcome === 'parry' && b.owner) {
        // Straight back where it came from, faster.
        var home = b.owner.object3D.localToWorld(new THREE.Vector3(0, 1.1, 0));
        b.vel.copy(home).sub(b.pos).normalize().multiplyScalar(b.vel.length() * 1.6);
        b.friendly = true;
        b.el.setAttribute('material', 'color', '#9fe6ff');
      } else {
        // Knocked aside: off to one side and up, harmless.
        var side = new THREE.Vector3(-b.vel.z, 0, b.vel.x).normalize().multiplyScalar(Math.random() < 0.5 ? -1 : 1);
        b.vel.multiplyScalar(-0.3).add(side.multiplyScalar(3)).add(new THREE.Vector3(0, 2, 0));
        b.harmless = true;
        b.el.setAttribute('material', 'color', '#888888');
      }
    },

    updateBullets: function (time, rawDt, hands, body, s) {
      var clock = this.el.systems['action-clock'];
      for (var i = this.bullets.length - 1; i >= 0; i--) {
        var b = this.bullets[i];
        var dt = (clock ? clock.dt(b.el) : Math.min(rawDt || 16, 50)) / 1000;
        b.age += dt;
        b.prev.copy(b.pos);
        if (b.harmless) b.vel.y -= 9.8 * dt;
        b.pos.addScaledVector(b.vel, dt);
        b.el.object3D.position.copy(b.pos);
        // The guard line for a bullet: where it will be over the next
        // half second.
        if (!b.harmless && !b.friendly && b.attack) {
          b.guardFrom = b.guardFrom || new THREE.Vector3();
          b.guardTo = b.guardTo || new THREE.Vector3();
          b.guardFrom.copy(b.pos);
          b.guardTo.copy(b.pos).addScaledVector(b.vel, 0.5);
          b.attack.guardBase = b.guardFrom;
          b.attack.aim = b.guardTo;
        }
        if (b.friendly && b.owner) {
          var owner = b.owner.components['combat-target'];
          var zones = owner ? owner.worldZones() : [];
          for (var z = 0; z < zones.length; z++) {
            if (zones[z].obstacle) continue;
            var c = sweptSphereZone(b.prev, b.pos, 0.04, zones[z]);
            if (c) {
              owner.applyHit({ zone: zones[z].name, point: c.point, direction: b.vel.clone().normalize(), force: 1.2, damage: 3, source: 'deflect', by: 'player' });
              logAction('sent a bullet back into ' + (b.owner.id || 'its shooter'));
              this.retire(b);
              break;
            }
          }
          if (this.bullets.indexOf(b) < 0) continue;
        }
        if (b.age > 5 || b.pos.y < 0) this.retire(b);
      }
    },
  });
}
