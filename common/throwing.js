// ============================================================
// THROWING — an overhand whip throws a knife, and it lands.
//
// Position only (docs/actions/throwing.spec.md): no grip, no button.
// Bring a hand up by your head (a knife appears in it) and whip it
// forward; common/intent.js's throw detector calls the release. Then:
//
//   resolve  combat-targeting's `throw` profile — gaze-heavy, along the
//            way the hand was moving and the way you're looking.
//   solve    common/throw-solve.js: where in the swing you let go picks
//            the arc (lob or flat), the speed is solved to land on the
//            target, capped by how hard you threw, and a moving target
//            is led. No target: the hand's own velocity, exaggerated.
//   fly      a pooled knife on the action clock (bullet time slows it),
//            with a little homing toward the target in flight.
//   land     a swept sphere against every target's zones, the same
//            contact test as a fist; it sticks where it hits, and the
//            target gets the usual action-hit (source 'throw').
//
//   <a-entity throwing-hands="rig: #rig; left: #left-virtual; right: #right-virtual"></a-entity>
//
// Off a headset, `desktop-throw-input` on the rig makes T throw: it
// moves the simulated hand through a real wind-up and whip, so the
// detector and everything after it run for real.
// ============================================================

import './motion-sense.js';
import './combat-targeting.js';
import './action-clock.js';
import { createThrowDetector, updateThrows } from './intent.js';
import { leadTarget, positionAt } from './throw-solve.js';
import { sweptSphereZone } from './collide.js';
import { sound, haptic } from './action-feedback.js';
import { defineTunables } from './tunables.js';
import { registerReadout, logAction } from './debug-hud.js';

var THREE = AFRAME.THREE;
var SIDES = ['left', 'right'];
var DEG = Math.PI / 180;

var tune = defineTunables('throw', 'Throw', [
  { key: 'on', label: 'Throws', kind: 'toggle', value: true },
  { key: 'item', label: 'Item', kind: 'select', value: 'knife', options: [
    { value: 'knife', label: 'Knife' }, { value: 'star', label: 'Star' },
  ] },
  { key: 'maxSpeed', label: 'Max speed', value: 14, min: 4, max: 30, step: 1, unit: 'm/s' },
  { key: 'homing', label: 'Homing', value: 30, min: 0, max: 360, step: 10, unit: '°/s',
    info: 'How hard a thrown knife steers toward its target in flight. 0 is pure ballistics.' },
  { key: 'gravity', label: 'Gravity', value: 0.6, min: 0, max: 100, step: 10, unit: '%', scale: 100,
    info: 'Under 100% keeps throws up longer — easier to see, easier to land.' },
  { key: 'damage', label: 'Damage', value: 2, min: 0.25, max: 10, step: 0.25 },
  { key: 'releaseSpeed', label: 'Whip', value: 2.2, min: 1, max: 5, step: 0.1, unit: 'm/s',
    info: 'How fast the hand must whip forward from by your head to throw.' },
]);

var last = { text: 'no throws yet' };
registerReadout('throw', 'Throw', function () { return last.text; });

function makeItem(kind) {
  var el = document.createElement('a-entity');
  var part = function (w, h, d, x, y, z, color) {
    var p = document.createElement('a-entity');
    p.setAttribute('geometry', { primitive: 'box', width: w, height: h, depth: d });
    p.setAttribute('material', { color: color, flatShading: true });
    p.setAttribute('position', { x: x, y: y, z: z });
    el.appendChild(p);
  };
  if (kind === 'star') {
    part(0.12, 0.012, 0.03, 0, 0, 0, '#c9d1dc');
    part(0.03, 0.012, 0.12, 0, 0, 0, '#c9d1dc');
  } else {
    part(0.02, 0.006, 0.13, 0, 0, -0.06, '#d9dee6'); // blade, toward -Z
    part(0.024, 0.02, 0.07, 0, 0, 0.04, '#2b2f36'); // handle
  }
  return el;
}

AFRAME.registerComponent('throwing-hands', {
  schema: {
    rig: { type: 'selector' },
    left: { type: 'selector' }, // virtual-hand entities
    right: { type: 'selector' },
  },

  init: function () {
    this.detector = createThrowDetector();
    this.flying = [];
    this.pool = { knife: [], star: [] };
    this.held = {};
    SIDES.forEach(function (side) {
      var vh = this.data[side];
      if (!vh) return;
      // A knife in your hand while it's cocked: the cue that a whip will
      // throw.
      var held = makeItem('knife');
      held.object3D.visible = false;
      held.object3D.position.set(0, 0.02, -0.05);
      vh.appendChild(held);
      this.held[side] = held;
    }, this);
    this.tmp = new THREE.Vector3();
  },

  sense: function () { var r = this.data.rig; return r && r.components['motion-sense']; },

  tick: function (time, rawDt) {
    var sense = this.sense();
    if (!sense) return;
    this.detector.settings.releaseSpeed = tune.values.releaseSpeed;
    var events = tune.values.on ? updateThrows(this.detector, sense.state) : [];
    SIDES.forEach(function (side) {
      if (this.held[side]) this.held[side].object3D.visible = tune.values.on && this.detector.hands[side] === 'cocked';
    }, this);
    for (var i = 0; i < events.length; i++) this.release(events[i], sense);
    this.fly(time, rawDt);
    this.drawArcNow(time);
  },

  release: function (e, sense) {
    var vhEl = this.data[e.hand];
    var vh = vhEl && vhEl.components['virtual-hand'];
    var from = vh ? vh.position.clone() : sense.toWorld(e.position);
    var handVel = sense.directionToWorld(e.velocity, new THREE.Vector3()).multiplyScalar(e.speed);
    var gaze = this.el.sceneEl.systems['combat-targeting'].gaze();
    // Look where the hand went and where you're looking, together.
    var dir = handVel.clone().normalize();
    if (gaze) dir.add(gaze.direction).normalize();
    var pick = this.el.sceneEl.systems['combat-targeting'].resolve('throw', { origin: from, direction: dir, by: e.hand, team: 'enemy' });
    var g = 9.8 * tune.values.gravity;
    var velocity;
    var solve = null;
    if (pick) {
      solve = leadTarget(from, pick.aimPoint, pick.target.velocity || { x: 0, y: 0, z: 0 },
        { rise: e.rise, handSpeed: e.speed, gravity: g, maxSpeed: tune.values.maxSpeed });
      velocity = new THREE.Vector3(solve.velocity.x, solve.velocity.y, solve.velocity.z);
      last.text = (e.hand === 'left' ? 'L' : 'R') + ' -> ' + pick.name + '  ' + (solve.angle / DEG).toFixed(0) + '° ' +
        solve.speed.toFixed(1) + ' m/s' + (solve.reaches ? '' : ' (falls short)');
    } else {
      // Nothing to aim at: throw it where the hand sent it, exaggerated
      // (bare hand speed throws disappointingly short — Pistols' hurl).
      velocity = handVel.multiplyScalar(1.9);
      if (velocity.y < 1.4) velocity.y += 1.4;
      last.text = (e.hand === 'left' ? 'L' : 'R') + ' threw at nothing (' + velocity.length().toFixed(1) + ' m/s)';
    }
    logAction(last.text);
    sound('whoosh', from);
    haptic(vh ? vh.data.tracked : null, 'hit-light', 0.5);
    this.launch(from, velocity, pick, g);
    this.drawArc(from, velocity, g);
  },

  launch: function (from, velocity, pick, g) {
    var kind = tune.values.item;
    var p = this.pool[kind].pop();
    if (!p) {
      var el = makeItem(kind);
      this.el.sceneEl.appendChild(el);
      p = { el: el, kind: kind, pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3() };
    }
    p.pos.copy(from);
    p.prev.copy(from);
    p.vel.copy(velocity);
    p.g = g;
    p.target = pick ? pick.target : null;
    p.age = 0;
    p.stuck = 0;
    p.el.object3D.visible = true;
    p.el.object3D.position.copy(from);
    this.flying.push(p);
  },

  retire: function (p) {
    var i = this.flying.indexOf(p);
    if (i >= 0) this.flying.splice(i, 1);
    p.el.object3D.visible = false;
    if (p.el.object3D.parent !== this.el.sceneEl.object3D) this.el.sceneEl.object3D.attach(p.el.object3D);
    this.pool[p.kind].push(p);
  },

  fly: function (time, rawDt) {
    var clock = this.el.sceneEl.systems['action-clock'];
    var targets = this.el.sceneEl.systems['combat-targeting'].targets;
    for (var i = this.flying.length - 1; i >= 0; i--) {
      var p = this.flying[i];
      var dt = (clock ? clock.dt(p.el) : Math.min(rawDt || 16, 50)) / 1000;
      if (p.stuck) {
        p.stuck -= dt;
        if (p.stuck <= 0) this.retire(p);
        continue;
      }
      p.age += dt;
      // A little homing: turn the horizontal heading toward the target's
      // aim point, at most `homing` degrees a second.
      if (p.target && p.target.alive && tune.values.homing > 0) {
        var aim = p.target.aimPoint();
        var want = Math.atan2(aim.x - p.pos.x, aim.z - p.pos.z);
        var have = Math.atan2(p.vel.x, p.vel.z);
        var diff = want - have;
        while (diff > Math.PI) diff -= 2 * Math.PI;
        while (diff < -Math.PI) diff += 2 * Math.PI;
        var turn = Math.max(-1, Math.min(1, diff / (tune.values.homing * DEG * dt || 1))) * tune.values.homing * DEG * dt;
        var h = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
        var heading = have + turn;
        p.vel.x = Math.sin(heading) * h;
        p.vel.z = Math.cos(heading) * h;
      }
      p.prev.copy(p.pos);
      p.vel.y -= p.g * dt;
      p.pos.addScaledVector(p.vel, dt);
      var o = p.el.object3D;
      o.position.copy(p.pos);
      // Knives fly point-first and tumble; stars spin flat.
      if (p.kind === 'knife') {
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.tmp.copy(p.vel).normalize());
        o.rotateX(-p.age * 18);
      } else {
        o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 1, 0));
        o.rotateY(p.age * 25);
      }
      if (this.contact(p, targets)) continue;
      if (p.pos.y <= 0.02) { p.pos.y = 0.02; o.position.copy(p.pos); p.stuck = 1; sound('block', p.pos); continue; }
      if (p.age > 4) this.retire(p);
    }
  },

  contact: function (p, targets) {
    var first = null;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t.alive || !t.targetable()) continue;
      if (t.el.classList.contains('slow-bullet')) continue;
      var zones = t.worldZones();
      for (var z = 0; z < zones.length; z++) {
        var c = sweptSphereZone(p.prev, p.pos, 0.04, zones[z]);
        if (c && (!first || c.t < first.t)) first = { t: c.t, point: c.point, target: t, zone: zones[z] };
      }
    }
    if (!first) return false;
    var dir = p.vel.clone().normalize();
    first.target.applyHit({
      zone: first.zone, point: first.point, direction: { x: dir.x, y: dir.y, z: dir.z },
      force: 0.9, damage: tune.values.damage, source: 'throw',
    });
    // Stick where it hit, riding the target if it moves.
    p.pos.set(first.point.x, first.point.y, first.point.z);
    p.el.object3D.position.copy(p.pos);
    first.target.el.object3D.attach(p.el.object3D);
    p.stuck = 1.2;
    logAction('knife hit ' + (first.target.el.id || 'target') + ' ' + first.zone.name);
    return true;
  },

  // Draw > Intent: the solved arc for a second after each throw.
  drawArc: function (from, velocity, g) {
    this.arc = { from: from.clone(), vel: velocity.clone(), g: g, until: this.el.sceneEl.time + 1000 };
  },

  drawArcNow: function (time) {
    var dd = this.el.sceneEl.systems['debug-draw'];
    if (!dd || !dd.on('intent') || !this.arc || time > this.arc.until) return;
    var prev = this.arc.from;
    for (var i = 1; i <= 24; i++) {
      var p = positionAt(this.arc.from, this.arc.vel, i * 0.06, this.arc.g);
      if (p.y < 0) break;
      dd.line(prev, p, '#ffe066');
      prev = p;
    }
  },
});

// ---------- desktop: T throws, through the real hand ----------

AFRAME.registerComponent('desktop-throw-input', {
  schema: {
    camera: { type: 'selector' },
    leftHand: { type: 'selector' },
    rightHand: { type: 'selector' },
    key: { default: 'KeyT' },
  },

  init: function () {
    this.next = 'right';
    this.onKey = this.onKey.bind(this);
    document.addEventListener('keydown', this.onKey);
  },

  remove: function () { document.removeEventListener('keydown', this.onKey); },

  frame: function (offset) {
    var cam = this.data.camera.object3D;
    var pos = cam.getWorldPosition(new THREE.Vector3());
    var q = cam.getWorldQuaternion(new THREE.Quaternion());
    var e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    var yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), e.y);
    return { position: offset.clone().applyQuaternion(yaw).add(pos), quaternion: yaw };
  },

  onKey: function (evt) {
    if (evt.code !== this.data.key || evt.repeat || this.el.sceneEl.is('vr-mode')) return;
    var side = this.next;
    this.next = side === 'right' ? 'left' : 'right';
    var handEl = side === 'right' ? this.data.rightHand : this.data.leftHand;
    var hand = handEl && handEl.components['semantic-hand'];
    if (!hand || !this.data.camera) return;
    var s = side === 'right' ? 1 : -1;
    var cock = this.frame(new THREE.Vector3(s * 0.2, 0.06, 0.1));
    var whip = this.frame(new THREE.Vector3(s * 0.1, -0.04, -0.5));
    // Follow through low, the way an arm does after a throw (and the
    // way the detector needs it to before the next one).
    var follow = this.frame(new THREE.Vector3(s * 0.2, -0.38, -0.25));
    handEl.setAttribute('data-semantic-action-active', 'throw');
    hand.cancelMotion();
    hand.runWorldMotion([
      { position: cock.position, quaternion: cock.quaternion, pose: 'Hold', duration: 260 },
      { position: cock.position, quaternion: cock.quaternion, pose: 'Hold', duration: 120 },
      { position: whip.position, quaternion: whip.quaternion, pose: 'Open', duration: 120 },
      { position: follow.position, quaternion: follow.quaternion, pose: 'Open', duration: 220 },
    ], { action: 'throw', source: 'desktop' });
    handEl.addEventListener('semantic-hand-motion-complete', function done() {
      handEl.removeEventListener('semantic-hand-motion-complete', done);
      handEl.removeAttribute('data-semantic-action-active');
    });
  },
});
