// ============================================================
// THROWN PROJECTILES — anything thrown at something, flown so it lands.
//
// A knife from a whip, an empty gun flung at someone's head: same
// flight. The `thrown-projectiles` system takes an entity and either a
// target or a plain velocity, and flies it:
//
//   guided   (a target) common/throw-solve.js's planGuided: the solved
//            arc, bent over the flight so it ends exactly on the
//            target's live position. Bullet-heaven rules: a throw at
//            someone hits them.
//   free     (no target) a plain ballistic arc.
//
// Contact is a swept sphere against every target's zones (the fist and
// knife test). What happens after is the thrower's choice: `stick`
// (stays in what it hit for a moment, riding it if it moves) or
// `bounce` (knocked back off it, then falls and lands). Either way the
// target gets the usual action-hit, and onHit/onLand are called.
// Everything runs on the action clock, so bullet time slows it.
//
//   var p = sceneEl.systems['thrown-projectiles'].launch({
//     el, from, target, velocity, gravity, opts: { rise, handSpeed, maxSpeed },
//     radius: 0.04, damage, force, after: 'stick'|'bounce', spin: 'point'|'flat'|'tumble',
//     onHit(p, hit), onLand(p), onDone(p),
//   });
// ============================================================

import './combat-targeting.js';
import './action-clock.js';
import { planGuided, guidedPosition } from './throw-solve.js';
import { sweptSphereZone } from './collide.js';
import { sound } from './action-feedback.js';
import './debug-draw.js';

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['thrown-projectiles']) {
  var THREE = AFRAME.THREE;

  AFRAME.registerSystem('thrown-projectiles', {
    init: function () {
      this.flying = [];
      this.tmp = new THREE.Vector3();
      this.fwd = new THREE.Vector3(0, 0, -1);
    },

    launch: function (o) {
      var p = {
        el: o.el,
        pos: new THREE.Vector3().copy(o.from),
        prev: new THREE.Vector3().copy(o.from),
        vel: new THREE.Vector3(),
        g: o.gravity === undefined ? 9.8 : o.gravity,
        t: 0,
        target: o.target || null,
        radius: o.radius || 0.04,
        damage: o.damage === undefined ? 1 : o.damage,
        force: o.force === undefined ? 0.9 : o.force,
        after: o.after || 'stick',
        spin: o.spin || 'point',
        onHit: o.onHit, onLand: o.onLand, onDone: o.onDone,
        state: 'flying',
        stuckFor: 0,
        source: o.source || 'throw',
      };
      if (p.target && p.target.alive) {
        p.plan = planGuided(o.from, p.target.aimPoint(), p.target.velocity, Object.assign({ gravity: p.g }, o.opts || {}));
        p.vel.set(p.plan.velocity.x, p.plan.velocity.y, p.plan.velocity.z);
        p.lastTarget = new THREE.Vector3().copy(p.target.aimPoint());
        this.commit(p, p.target);
      } else {
        p.vel.copy(o.velocity || this.fwd);
      }
      if (p.el.object3D.parent !== this.el.object3D) this.el.object3D.attach(p.el.object3D);
      p.el.object3D.position.copy(p.pos);
      p.el.object3D.visible = true;
      this.flying.push(p);
      return p;
    },

    remove: function (p) {
      this.uncommit(p);
      var i = this.flying.indexOf(p);
      if (i >= 0) this.flying.splice(i, 1);
    },

    tick: function (time, rawDt) {
      var clock = this.el.systems['action-clock'];
      var targets = this.el.systems['combat-targeting'].targets;
      for (var i = this.flying.length - 1; i >= 0; i--) {
        var p = this.flying[i];
        var dt = (clock ? clock.dt(p.el) : Math.min(rawDt || 16, 50)) / 1000;
        if (!dt) continue;
        if (p.state === 'stuck') {
          p.stuckFor -= dt;
          if (p.stuckFor <= 0) this.finish(p);
          continue;
        }
        p.t += dt;
        p.prev.copy(p.pos);
        if (p.plan && p.state === 'flying') {
          // Guided: follow the target. If it dies or ducks out of reach
          // mid-flight, bend onto the nearest live one instead (or, with
          // none, finish where it was last seen). The aim point eases
          // toward the target rather than jumping, so a switch is a curve.
          if (p.target && !(p.target.alive && p.target.targetable())) this.retarget(p, targets);
          if (p.target) {
            var aimNow = p.target.aimPoint();
            p.lastTarget.lerp(this.tmp.set(aimNow.x, aimNow.y, aimNow.z), Math.min(1, dt * 25));
          }
          var q = guidedPosition(p.plan, Math.min(p.t, p.plan.T * 1.25), p.lastTarget);
          if (p.t > p.plan.T * 1.25) {
            // Past the end with no contact (the target vanished): carry
            // on ballistically from here.
            p.plan = null;
          } else {
            p.pos.set(q.x, q.y, q.z);
            p.vel.copy(p.pos).sub(p.prev).divideScalar(dt);
          }
        }
        if (!p.plan) {
          p.vel.y -= p.g * dt;
          p.pos.addScaledVector(p.vel, dt);
        }
        this.orient(p);
        if (p.state === 'flying' && this.contact(p, targets)) continue;
        if (p.pos.y <= p.radius) this.land(p);
        else if (p.t > 6) this.finish(p);
      }
      this.drawPaths();
    },

    orient: function (p) {
      var o = p.el.object3D;
      o.position.copy(p.pos);
      if (p.vel.lengthSq() < 1e-6) return;
      if (p.spin === 'flat') {
        o.quaternion.identity();
        o.rotateY(p.t * 25);
      } else if (p.spin === 'tumble') {
        o.quaternion.setFromUnitVectors(this.fwd, this.tmp.copy(p.vel).normalize());
        o.rotateX(-p.t * 14);
      } else {
        // Point first, with a slow spin about its length.
        o.quaternion.setFromUnitVectors(this.fwd, this.tmp.copy(p.vel).normalize());
        o.rotateZ(p.t * 6);
      }
    },

    // Damage on its way to a target: a target that's already doomed by
    // what's in the air isn't picked again (see combat-target.incoming).
    commit: function (p, target) {
      this.uncommit(p);
      p.committed = target;
      target.incoming = (target.incoming || 0) + p.damage;
    },

    uncommit: function (p) {
      if (!p.committed) return;
      p.committed.incoming = Math.max(0, (p.committed.incoming || 0) - p.damage);
      p.committed = null;
    },

    retarget: function (p, targets) {
      this.uncommit(p);
      var best = null, bestD = 4;
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (t === p.target || !t.alive || !t.targetable() || t.data.team !== 'enemy') continue;
        var a = t.aimPoint();
        var d = Math.sqrt(Math.pow(a.x - p.lastTarget.x, 2) + Math.pow(a.y - p.lastTarget.y, 2) + Math.pow(a.z - p.lastTarget.z, 2));
        if (d < bestD) { bestD = d; best = t; }
      }
      p.target = best;
      if (best) this.commit(p, best);
    },

    contact: function (p, targets) {
      var first = null;
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (!t.alive || !t.targetable()) continue;
        if (t.el.classList.contains('slow-bullet')) continue;
        var zones = t.worldZones();
        for (var z = 0; z < zones.length; z++) {
          var c = sweptSphereZone(p.prev, p.pos, p.radius, zones[z]);
          if (c && (!first || c.t < first.t)) first = { t: c.t, point: c.point, target: t, zone: zones[z] };
        }
      }
      if (!first) return false;
      this.uncommit(p);
      var dir = this.tmp.copy(p.vel).normalize();
      var hit = first.target.applyHit({
        zone: first.zone, point: first.point, direction: { x: dir.x, y: dir.y, z: dir.z },
        force: p.force, damage: p.damage, source: p.source,
      });
      p.pos.set(first.point.x, first.point.y, first.point.z);
      p.el.object3D.position.copy(p.pos);
      if (p.onHit) p.onHit(p, hit, first);
      if (p.after === 'stick') {
        first.target.el.object3D.attach(p.el.object3D); // rides the target
        p.state = 'stuck';
        p.stuckFor = 1.2;
      } else {
        // Bounce: back off it, up a little, and fall from there.
        p.plan = null;
        p.vel.multiplyScalar(-0.25);
        p.vel.y = 1.5;
        p.state = 'bounced';
      }
      return true;
    },

    land: function (p) {
      this.uncommit(p);
      p.pos.y = p.radius;
      p.el.object3D.position.copy(p.pos);
      if (p.state === 'flying') sound('block', p.pos);
      this.remove(p);
      if (p.onLand) p.onLand(p);
      else this.finish(p);
    },

    finish: function (p) {
      this.uncommit(p);
      this.remove(p);
      if (p.el.object3D.parent !== this.el.object3D) this.el.object3D.attach(p.el.object3D);
      if (p.onDone) p.onDone(p);
      else p.el.object3D.visible = false;
    },

    // Draw > Intent: every guided flight's path.
    drawPaths: function () {
      var dd = this.el.systems['debug-draw'];
      if (!dd || !dd.on('intent')) return;
      for (var i = 0; i < this.flying.length; i++) {
        var p = this.flying[i];
        if (!p.plan) continue;
        var prev = p.plan.from;
        for (var k = 1; k <= 20; k++) {
          var q = guidedPosition(p.plan, (k / 20) * p.plan.T, p.lastTarget);
          dd.line(prev, q, '#ffe066');
          prev = q;
        }
      }
    },
  });
}
