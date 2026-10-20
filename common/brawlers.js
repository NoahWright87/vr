// ============================================================
// BRAWLERS — boxy robots that surround you and take swings.
//
//   brawler     one robot, Rock 'Em Sock 'Em style: legs, torso, head,
//               and two arms of two segments each with a fist. At rest
//               the arms hold a V guard, fists by the chin; to punch, an
//               arm draws back, then straightens out at you
//               (solveTwoBone, common/brawler-core.js). Hits knock it
//               back; enough of them and it falls over backwards and
//               pops back up a few seconds later.
//   brawl-ring  a group of them around the player. They circle you on
//               a ring and close in; only a couple take a turn at a time
//               (beat-'em-up style) while the rest circle and wait. A
//               robot knocked into another hands on its momentum and
//               both get hurt — so a parry that shoves one into its
//               friend is a thing.
//
// Kinds: boxer (red, punches), blocker (blue, guards only — a moving
// punching bag), brute (purple, big, slow, hits hard), quick (yellow,
// fast jabs, fragile).
//
// Their punches are attacks in the combat-attacks contract
// (common/attacks.js): block, parry (shoves it away and opens it for a
// counter), hit, dodge — and the magnetic guard pulls a moving hand onto
// a punch. Your punches land on them through common/melee.js like any
// target; guns and throws work on them too (team 'enemy').
// ============================================================

import './combat-targeting.js';
import './attacks.js';
import './action-clock.js';
import './action-effects.js';
import { sound } from './action-feedback.js';
import { logAction, registerReadout } from './debug-hud.js';
import { solveTwoBone, spreadAngles, collideDiscs } from './brawler-core.js';

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

var THREE = AFRAME.THREE;
var SIDES = [-1, 1]; // -1 its left, +1 its right

export var KINDS = {
  boxer: { color: '#c8332b', health: 4, punches: true, windupMs: 650, activeMs: 260, speed: 1.0, damage: 1, size: 1, weight: 1 },
  blocker: { color: '#2f62c8', health: 5, punches: false, windupMs: 0, activeMs: 0, speed: 0.9, damage: 0, size: 1, weight: 1.2 },
  brute: { color: '#7a3fb0', health: 8, punches: true, windupMs: 900, activeMs: 340, speed: 0.7, damage: 2, size: 1.15, weight: 1.8 },
  quick: { color: '#d6a42b', health: 2.5, punches: true, windupMs: 420, activeMs: 200, speed: 1.4, damage: 0.5, size: 0.9, weight: 0.8 },
};

var GLOW = '#ff3b2f';
var OPEN = '#4fd1ff';

var shared = null;
function geometry() {
  if (!shared) {
    shared = {
      box: new THREE.BoxGeometry(1, 1, 1),
      dark: new THREE.MeshLambertMaterial({ color: '#2b2f36', flatShading: true }),
      star: new THREE.MeshBasicMaterial({ color: '#ffe066' }),
    };
  }
  return shared;
}

function part(group, material, w, h, d, x, y, z) {
  var m = new THREE.Mesh(geometry().box, material);
  m.scale.set(w, h, d);
  m.position.set(x, y, z);
  group.add(m);
  return m;
}

// A box stretched from a to b (body-local), thickness t.
function segment(mesh, a, b, t) {
  var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  var l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
  mesh.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  mesh.quaternion.setFromUnitVectors(segment.z, segment.v.set(dx / l, dy / l, dz / l));
  mesh.scale.set(t, t, l);
}
segment.z = new THREE.Vector3(0, 0, 1);
segment.v = new THREE.Vector3();

var registry = [];
var stats = { hits: 0, knockdowns: 0, impacts: 0, styles: { jab: 0, uppercut: 0, body: 0, slap: 0, butt: 0 } };
function styleLine() {
  var st = stats.styles;
  return 'hits: jab ' + st.jab + '  uppercut ' + st.uppercut + '  body ' + st.body + '  slap ' + st.slap + '  butt ' + st.butt;
}

registerReadout('brawl', 'Brawl', function () {
  var ring = registry.filter(function (b) { return b.ring(); });
  if (!ring.length) return 'brawl off (B)  ' + registry.length + ' on the dummies line\n' + styleLine();
  var up = ring.filter(function (b) { return b.target.alive; }).length;
  var busy = ring.filter(function (b) { return b.engaged; }).map(function (b) { return b.el.id; });
  return up + '/' + ring.length + ' up  knockdowns ' + stats.knockdowns + '  pile-ups ' + stats.impacts +
    '\nengaged: ' + (busy.join(', ') || 'none') + '\n' + styleLine();
});

// ============================================================
// brawler
// ============================================================

AFRAME.registerComponent('brawler', {
  schema: {
    kind: { default: 'boxer', oneOf: Object.keys(KINDS) },
    resetMs: { default: 3000 },
    health: { default: 0 }, // 0: the kind's own
    // On its own (not in a brawl-ring): slide back and forth along its
    // local X on a rail, and swing at you when you're within `engage`.
    rail: { default: 0 }, // m either side of where it was placed
    railSpeed: { default: 0.6 }, // m/s
    engage: { default: 0 }, // m; 0 = never swings on its own
    intervalMs: { default: 1800 }, // between swings on its own
  },

  init: function () {
    var k = this.kind = KINDS[this.data.kind];
    var s = k.size;
    this.L1 = 0.36 * s;
    this.L2 = 0.37 * s;
    this.goal = null; // { x, z } set by the ring
    this.vel = new THREE.Vector3(); // its own walking
    this.knock = new THREE.Vector3(); // knocked about
    this.tilt = 0; this.tiltVel = 0; this.restTilt = 0; // the whole body, about the feet (falling)
    this.roll = 0; this.rollVel = 0; // side to side, about the feet
    this.bend = 0; this.bendVel = 0; // the upper half, about the waist
    this.air = 0; this.airVel = 0; // knocked off its feet
    this.spinVel = 0; // slapped round
    this.doubledUntil = 0; this.dizzyUntil = 0;
    this.state = 'up'; // up | down
    this.stateMs = 0;
    this.phase = 'guard'; // guard | windup | active | recovery
    this.phaseMs = 0;
    this.side = 1; // which arm punches next
    this.flashMs = 0;
    this.lunge = 0;
    this.engaged = false;
    this.attacksDone = 0;
    this.camPos = new THREE.Vector3();
    this.camLocal = new THREE.Vector3(); // the player in its parent's space
    this.home = null;
    this.railT = Math.random() * Math.PI * 2;
    this.soloMs = 0;
    this.q = new THREE.Quaternion();
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.aim = new THREE.Vector3();
    this.windFrom = new THREE.Vector3();
    this.shoulderW = new THREE.Vector3();
    this.fistW = new THREE.Vector3();
    this.inv = new THREE.Matrix4();

    this.bodyMat = new THREE.MeshLambertMaterial({ color: k.color, flatShading: true });
    this.fistBase = new THREE.Color(k.color).multiplyScalar(0.6);
    this.fistMat = new THREE.MeshLambertMaterial({ color: this.fistBase.clone(), flatShading: true });
    var dark = geometry().dark;
    // The body pivots at the feet, so it falls over backwards; the upper
    // half (torso, head, arms) pivots at the waist, so it can double
    // over or snap back. Upper-half parts are placed relative to the
    // waist.
    this.body = new THREE.Group();
    this.el.object3D.add(this.body);
    part(this.body, dark, 0.42 * s, 0.12, 0.36 * s, 0, 0.06, 0); // pedestal
    part(this.body, this.bodyMat, 0.34 * s, 0.7 * s, 0.24 * s, 0, 0.12 + 0.35 * s, 0); // legs
    var waistY = this.waistY = 0.12 + 0.7 * s;
    this.upper = new THREE.Group();
    this.upper.position.y = waistY;
    this.body.add(this.upper);
    var torsoY = 0.25 * s; // from the waist
    part(this.upper, this.bodyMat, 0.5 * s, 0.5 * s, 0.3 * s, 0, torsoY, 0); // torso
    var headY = torsoY + 0.25 * s + 0.15 * s;
    part(this.upper, this.bodyMat, 0.26 * s, 0.24 * s, 0.26 * s, 0, headY, 0); // head
    part(this.upper, dark, 0.2 * s, 0.05 * s, 0.02, 0, headY + 0.02 * s, 0.135 * s); // eye slot
    this.shoulderY = torsoY + 0.17 * s;
    this.headY = headY;
    this.torsoY = torsoY;
    this.arms = SIDES.map(function (sd) {
      return {
        side: sd,
        shoulder: new THREE.Vector3(sd * 0.31 * s, this.shoulderY, 0),
        fist: new THREE.Vector3(sd * 0.13 * s, this.shoulderY + 0.13 * s, 0.3 * s),
        upper: part(this.upper, this.bodyMat, 0.09, 0.09, 0.3),
        fore: part(this.upper, this.bodyMat, 0.085, 0.085, 0.3),
        hand: part(this.upper, this.fistMat, 0.13 * s, 0.13 * s, 0.13 * s, 0, 0, 0),
        elbow: part(this.upper, dark, 0.1, 0.1, 0.1, 0, 0, 0),
      };
    }, this);
    // Dizzy: stars circling the head.
    this.stars = new THREE.Group();
    this.stars.position.y = headY + 0.22 * s;
    this.stars.visible = false;
    this.upper.add(this.stars);
    for (var st = 0; st < 3; st++) {
      var a = st * Math.PI * 2 / 3;
      part(this.stars, geometry().star, 0.05, 0.05, 0.05, Math.cos(a) * 0.17 * s, 0, Math.sin(a) * 0.17 * s).rotation.set(0.6, 0.6, 0);
    }

    var health = this.data.health || k.health;
    this.el.setAttribute('combat-target', { health: health, aimZone: 'torso', team: 'enemy' });
    this.target = this.el.components['combat-target'];
    // Head and torso ride the upper half (`upper`: in waist space); the
    // legs the body.
    this.zonesLocal = [
      { name: 'head', type: 'sphere', a: { x: 0, y: headY, z: 0 }, b: { x: 0, y: headY, z: 0 }, r: 0.16 * s, damage: 1.5, upper: true },
      { name: 'torso', type: 'capsule', a: { x: 0, y: torsoY - 0.12 * s, z: 0 }, b: { x: 0, y: torsoY + 0.12 * s, z: 0 }, r: 0.24 * s, damage: 1, upper: true },
      { name: 'legs', type: 'capsule', a: { x: 0, y: 0.25, z: 0 }, b: { x: 0, y: 0.75 * s, z: 0 }, r: 0.17 * s, damage: 0.6 },
    ];
    this.upperM = new THREE.Matrix4();
    this.updateZones();

    this.onHit = this.onHit.bind(this);
    this.el.addEventListener('action-hit', this.onHit);
    registry.push(this);
  },

  remove: function () {
    this.el.removeEventListener('action-hit', this.onHit);
    this.endAttack();
    var i = registry.indexOf(this);
    if (i >= 0) registry.splice(i, 1);
  },

  attacks: function () { return this.el.sceneEl.systems['combat-attacks']; },
  isOpen: function () { return this.el.sceneEl.time < (this.target.openUntil || 0); },
  busy: function () { return this.phase !== 'guard'; },
  // Not while open, reeling, doubled over, dizzy or off its feet.
  stunned: function () {
    var t = this.el.sceneEl.time;
    return t < this.doubledUntil || t < this.dizzyUntil || this.air > 0.01;
  },
  canAttack: function () { return this.kind.punches && this.state === 'up' && this.phase === 'guard' && !this.isOpen() && !this.stunned() && this.knock.lengthSq() < 0.25; },

  setColor: function (c) {
    if (this.colorNow === c) return;
    this.colorNow = c;
    this.bodyMat.color.set(c);
  },
  setFists: function (c) { this.fistMat.color.set(c); },
  ring: function () {
    var p = this.el.parentNode;
    return p && p.components && p.components['brawl-ring'];
  },

  // Knocked about: a velocity on the floor that wears off.
  // dirX, dirZ are world space; it moves in its parent's space.
  shove: function (dirX, dirZ, speed) {
    var v = this.tmp2.set(dirX, 0, dirZ);
    var parent = this.el.object3D.parent;
    if (parent) v.applyQuaternion(parent.getWorldQuaternion(this.q).invert());
    v.y = 0;
    var l = v.length() || 1;
    this.knock.x += (v.x / l) * speed / this.kind.weight;
    this.knock.z += (v.z / l) * speed / this.kind.weight;
  },

  // Sold by the hit's direction and style (common/strike-style.js):
  // every hit rocks it away from where it came from; an uppercut lifts
  // it off its feet; a body shot doubles it over, then it stumbles back;
  // a slap spins it round and leaves it dizzy; a gun butt clangs.
  onHit: function (evt) {
    var hit = evt.detail;
    var fx = this.el.sceneEl.systems['action-effects'];
    var d = hit.direction || { x: 0, y: 0, z: -1 };
    var f = hit.force || 1;
    var style = hit.style || (hit.source === 'strike' ? 'jab' : hit.source);
    var time = this.el.sceneEl.time;
    if (hit.point) {
      if (hit.source !== 'impact') {
        sound(hit.source === 'gun' || style === 'butt' ? 'clang' : style === 'slap' ? 'slap' : (hit.jumped || f > 0.6) ? 'smack' : 'thump', hit.point);
      }
      if (fx) {
        var heavy = hit.jumped || style === 'uppercut' || style === 'butt';
        fx.sparks(hit.point, { x: -d.x, y: -d.y + 0.3, z: -d.z }, { count: heavy ? 22 : 10, color: style === 'slap' ? '#ffffff' : '#ffd27a', speed: heavy ? 3.2 : 2.2 });
      }
    }
    stats.hits++;
    if (stats.styles[style] !== undefined) stats.styles[style]++;
    this.flashMs = 80;
    this.setColor('#ffffff');
    var ring = this.ring();
    var knockScale = ring ? ring.data.knock : 1;
    var w = this.kind.weight;

    // Rock away from the hit, in its own frame (+z faces you).
    var dl = this.tmp2.set(d.x, 0, d.z);
    dl.applyQuaternion(this.el.object3D.getWorldQuaternion(this.q).invert());
    this.tiltVel += dl.z * f * 3 / w;
    this.rollVel -= dl.x * f * 3 / w;
    this.bendVel += dl.z * f * 4 / w; // the upper half whips more than the feet
    if (hit.zone === 'head') this.bendVel -= f * 3 / w; // a shot to the face snaps the head back

    var push = 1.3;
    if (style === 'uppercut') {
      // Off its feet, up and away.
      // About a hand's height for a boxer; less for a brute.
      this.airVel = Math.max(this.airVel, Math.min(2.6, (1.1 + 0.9 * Math.min(f, 1.5)) / Math.sqrt(w)));
      this.tiltVel -= 4 * f / w;
      this.bendVel -= 6 * f / w;
      push = 2;
    } else if (style === 'body') {
      // Ow, the gut: folds over for a moment, then stumbles back.
      this.doubledUntil = time + 750;
      this.bendVel += 7 * f / w;
      push = 1.5;
    } else if (style === 'slap') {
      // Spun round, dizzy. Which way: the way the hand was going across it.
      this.spinVel += (dl.x >= 0 ? 1 : -1) * (9 + 7 * f) / w;
      this.dizzyUntil = time + 2200;
      push = 0.5;
    } else if (style === 'butt') {
      push = 1.7;
    }
    if (hit.jumped) push *= 1.2;
    if (hit.source !== 'impact') this.shove(d.x, d.z, f * push * knockScale);
    // Hit while winding up: the punch is interrupted.
    if (this.phase === 'windup') this.toRecovery();
    if (hit.killed) this.fall();
  },

  fall: function () {
    stats.knockdowns++;
    this.state = 'down';
    this.stateMs = 0;
    this.restTilt = -1.45;
    this.endAttack();
    this.phase = 'guard';
    this.engaged = false;
    logAction((this.el.id || 'brawler') + ' is down');
  },

  standUp: function () {
    this.state = 'up';
    this.restTilt = 0;
    this.doubledUntil = this.dizzyUntil = 0;
    this.spinVel = 0;
    this.target.revive();
    this.target.openUntil = 0;
  },

  // ---------- punching ----------

  startAttack: function (aimAt) {
    if (!this.canAttack()) return false;
    this.side = -this.side;
    this.phase = 'windup';
    this.phaseMs = 0;
    this.aimAt = aimAt || (Math.random() < 0.6 ? 'head' : 'torso');
    var arm = this.arm();
    this.attack = this.attacks().begin({
      el: this.el, kind: 'thrust', phase: 'telegraph', base: this.shoulderW, tip: this.fistW,
      radius: 0.075 * this.kind.size, damage: this.kind.damage,
    });
    var self = this;
    this.attack.onResolve = function (outcome, r) { self.onResolve(outcome, r); };
    this.attack.aim = this.aim;
    return arm;
  },

  arm: function () { return this.arms[this.side > 0 ? 1 : 0]; },

  endAttack: function () {
    if (this.attack) { this.attacks().end(this.attack); this.attack = null; }
  },

  toRecovery: function () {
    if (this.attack && !this.attack.resolved && this.phase === 'active') this.attacks().dodged(this.attack);
    this.endAttack();
    this.phase = 'recovery';
    this.phaseMs = 0;
    this.attacksDone++;
  },

  // r.reaction (from a counter, common/counters.js) says how to react:
  // { label, push (world x/z, or null for away from you), speed, openMs,
  //   intoFriend, stagger }. A plain parry is knocked back the same way.
  onResolve: function (outcome, r) {
    var o = this.el.object3D.getWorldPosition(this.tmp);
    this.el.sceneEl.camera.getWorldPosition(this.camPos);
    var ax = o.x - this.camPos.x, az = o.z - this.camPos.z; // away from you
    var ring = this.ring();
    var shove = ring ? ring.data.parryShove : 3.2;
    if (outcome === 'parry') {
      var re = (r && r.reaction) || {};
      if (re.push) { ax = re.push.x; az = re.push.z; }
      if (re.speed !== undefined) shove = re.speed;
      // Shoved hard and opened for a counter. If a friend is roughly
      // that way, the shove bends to send it into them — cheat on the
      // world side, so the pile-up you meant happens.
      var into = re.intoFriend !== false && ring && ring.aimShove(this, ax, az);
      if (into) {
        ax = into.x; az = into.z;
        // Hard enough to get there (the knock wears off at 3.5/s) and
        // still be going when it does.
        shove = Math.max(shove, (into.gap * 3.5 + 1.8) * this.kind.weight);
      }
      this.shove(ax, az, shove);
      this.tiltVel -= re.stagger || 3;
      this.target.openUntil = this.el.sceneEl.time + (re.openMs === undefined ? 1500 : re.openMs);
      var clock = this.el.sceneEl.systems['action-clock'];
      if (clock) clock.hitStop(this.el, 100);
      logAction((this.el.id || 'brawler') + ' ' + (re.label || 'parried') + (into ? ' into ' + into.bot.el.id : ''));
    } else if (outcome === 'block') {
      this.shove(ax, az, 0.9);
    }
    this.toRecovery();
  },

  // The player's head or chest, in world space.
  aimPoint: function (out) {
    var cam = this.el.sceneEl.camera;
    cam.getWorldPosition(out);
    if (this.aimAt === 'torso') out.y -= 0.42;
    return out;
  },

  // Where a fist sits at rest (the V guard), drawn back (wind-up), or
  // limp (down), in body space.
  restFist: function (arm, out) {
    var s = this.kind.size;
    if (this.state === 'down') return out.set(arm.side * 0.36 * s, this.shoulderY - 0.5 * s, 0.05);
    return out.set(arm.side * 0.13 * s, this.shoulderY + 0.13 * s, 0.3 * s);
  },

  windupFist: function (arm, out) {
    var s = this.kind.size;
    return out.set(arm.side * 0.38 * s, this.shoulderY + 0.06 * s, -0.12 * s);
  },

  // ---------- each frame ----------

  tick: function (time, rawDt) {
    var clock = this.el.sceneEl.systems['action-clock'];
    var dtMs = clock ? clock.dt(this.el) : Math.min(rawDt || 16, 50);
    var dt = dtMs / 1000;
    // White for a moment when hit; blue while open for a counter.
    if (this.flashMs > 0) this.flashMs -= rawDt || 16;
    else this.setColor(this.isOpen() ? OPEN : this.kind.color);
    if (!dt) return;
    var o = this.el.object3D;
    var cam = this.el.sceneEl.camera;
    if (cam) {
      cam.getWorldPosition(this.camPos);
      this.camLocal.copy(this.camPos);
      if (o.parent) o.parent.worldToLocal(this.camLocal);
    }
    if (!this.home) this.home = { x: o.position.x, z: o.position.z, yaw: o.rotation.y };

    this.stateMs += dtMs;
    if (!this.ring()) this.solo(dtMs);
    if (this.state === 'down' && this.stateMs > this.data.resetMs) this.standUp();

    // Move: walk toward the ring's goal (unless reeling), plus whatever
    // knocked it about, which wears off.
    var reeling = this.knock.lengthSq() > 0.36 || this.state === 'down';
    var want = this.tmp.set(0, 0, 0);
    if (this.goal && !reeling) {
      want.set(this.goal.x - o.position.x, 0, this.goal.z - o.position.z);
      var gl = want.length();
      var spd = this.kind.speed * (this.phase === 'guard' ? 1 : 0.3);
      if (gl > 0.02) want.multiplyScalar(Math.min(spd, gl * 3) / gl); else want.set(0, 0, 0);
    }
    this.vel.lerp(want, Math.min(1, dt * 6));
    o.position.x += (this.vel.x + this.knock.x) * dt;
    o.position.z += (this.vel.z + this.knock.z) * dt;
    this.knock.multiplyScalar(Math.exp(-dt * 3.5));

    // Slapped round: spinning, winding down.
    o.rotation.y += this.spinVel * dt;
    this.spinVel *= Math.exp(-dt * 2.2);
    var dizzy = time < this.dizzyUntil;

    // Face the player (it turns its body) — slowly while dizzy, not
    // while still spinning.
    if (cam && this.state === 'up' && Math.abs(this.spinVel) < 2) {
      var yaw = Math.atan2(this.camLocal.x - o.position.x, this.camLocal.z - o.position.z);
      var diff = yaw - o.rotation.y;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      o.rotation.y += diff * Math.min(1, dt * (dizzy ? 1.2 : 6));
    }

    // Rock and fall on springs about the feet; bend at the waist.
    this.tiltVel += (-(this.tilt - this.restTilt) * (this.state === 'down' ? 50 : 110) - this.tiltVel * 9) * dt;
    this.tilt += this.tiltVel * dt;
    if (this.tilt < -1.5) { this.tilt = -1.5; this.tiltVel = 0; }
    this.rollVel += (-this.roll * 90 - this.rollVel * 8) * dt;
    this.roll += this.rollVel * dt;
    this.roll = Math.max(-0.6, Math.min(0.6, this.roll));
    var restBend = this.state === 'up' && time < this.doubledUntil ? 0.75 : 0;
    this.bendVel += (-(this.bend - restBend) * 70 - this.bendVel * 8) * dt;
    this.bend += this.bendVel * dt;
    this.bend = Math.max(-0.7, Math.min(1, this.bend));
    // Off its feet: up, and down again with a little bounce.
    if (this.air > 0 || this.airVel > 0) {
      this.airVel -= 9.8 * dt;
      this.air += this.airVel * dt;
      if (this.air <= 0) { this.air = 0; this.airVel = this.airVel < -1.5 ? -this.airVel * 0.25 : 0; }
    }
    this.body.rotation.set(this.tilt, 0, this.roll);
    this.body.position.y = this.air;
    this.upper.rotation.x = this.bend;
    // Dizzy: a woozy wobble and stars.
    this.upper.rotation.z = dizzy && this.state === 'up' ? Math.sin(time / 160) * 0.16 : 0;
    this.stars.visible = dizzy && this.state === 'up';
    if (this.stars.visible) this.stars.rotation.y = time / 180;

    this.updatePunch(dtMs);
    this.updateArms(dt);
    this.updateZones();
    this.target.threat = this.phase === 'active' ? 1 : this.phase === 'windup' ? 0.7 : this.engaged ? 0.3 : 0.1;
    this.target.data.priority = this.isOpen() ? 1 : 0;
  },

  // Without a ring: ride its rail, and swing when you're close.
  solo: function (dtMs) {
    var d = this.data;
    var h = this.home;
    if (d.rail > 0) {
      this.railT += (dtMs / 1000) * d.railSpeed / d.rail;
      var off = Math.sin(this.railT) * d.rail;
      this.goal = { x: h.x + Math.cos(h.yaw) * off, z: h.z - Math.sin(h.yaw) * off };
    } else {
      this.goal = { x: h.x, z: h.z };
    }
    this.soloMs += dtMs;
    if (d.engage > 0 && this.soloMs > d.intervalMs && this.canAttack()) {
      var p = this.el.object3D.position;
      if (Math.hypot(this.camLocal.x - p.x, this.camLocal.z - p.z) <= d.engage) {
        this.soloMs = Math.random() * d.intervalMs * 0.4;
        this.startAttack();
      }
    }
  },

  updatePunch: function (dtMs) {
    var k = this.kind;
    this.phaseMs += dtMs;
    var o = this.el.object3D;
    o.updateMatrixWorld();
    var arm = this.arm();
    if (this.phase === 'windup') {
      var t = Math.min(1, this.phaseMs / k.windupMs);
      this.aimPoint(this.aim);
      this.attack.late = t > 0.5;
      this.attack.soon = t > 0.65; // its last moments: counters and the guard
      if (Math.floor(this.phaseMs / 90) % 2) this.setFists(GLOW); else this.fistMat.color.copy(this.fistBase);
      if (t >= 1) {
        this.phase = 'active';
        this.phaseMs = 0;
        this.attack.phase = 'active';
        // The punch line locks now: step out of it to dodge.
        this.windFrom.copy(arm.fist).applyMatrix4(this.upper.matrixWorld);
      }
    } else if (this.phase === 'active') {
      var p = Math.min(1, this.phaseMs / k.activeMs);
      this.attack.progress = p;
      this.lunge = Math.sin(Math.min(1, p * 1.4) * Math.PI / 2) * 0.22 * k.size;
      this.setFists(GLOW);
      if (p >= 1) this.toRecovery();
    } else if (this.phase === 'recovery') {
      this.lunge *= 0.85;
      this.fistMat.color.copy(this.fistBase);
      if (this.phaseMs > 450) { this.phase = 'guard'; this.phaseMs = 0; }
    } else {
      this.lunge *= 0.8;
    }
    this.body.position.z = this.lunge;
  },

  // Arms live in the upper half's (waist) space.
  updateArms: function (dt) {
    this.el.object3D.updateMatrixWorld();
    this.inv.copy(this.upper.matrixWorld).invert();
    var s = this.kind.size;
    for (var i = 0; i < 2; i++) {
      var arm = this.arms[i];
      var punching = arm === this.arm() && (this.phase === 'windup' || this.phase === 'active');
      var goal = this.tmp2;
      if (punching && this.phase === 'windup') {
        this.windupFist(arm, goal);
        arm.fist.lerp(goal, Math.min(1, dt * 12));
      } else if (punching && this.phase === 'active') {
        // From the wind-up to the locked aim point, eased out, in world
        // space; then back into the body's frame for the arm.
        var p = Math.min(1, this.phaseMs / this.kind.activeMs);
        var e = 1 - Math.pow(1 - p, 2);
        goal.copy(this.windFrom).lerp(this.aim, e).applyMatrix4(this.inv);
        arm.fist.copy(goal);
      } else {
        this.restFist(arm, goal);
        arm.fist.lerp(goal, Math.min(1, dt * (this.state === 'down' ? 4 : 10)));
      }
      var pole = { x: arm.side, y: -1, z: -0.3 };
      // A punch may telescope the arm up to 30% to reach its mark.
      var st = 1;
      if (punching && this.phase === 'active') {
        var need = arm.shoulder.distanceTo(arm.fist) / (this.L1 + this.L2);
        st = Math.min(1.3, Math.max(1, need));
      }
      var r = solveTwoBone(arm.shoulder, arm.fist, this.L1 * st, this.L2 * st, pole);
      arm.fist.set(r.fist.x, r.fist.y, r.fist.z);
      segment(arm.upper, arm.shoulder, r.elbow, 0.09 * s);
      segment(arm.fore, r.elbow, r.fist, 0.085 * s);
      arm.elbow.position.set(r.elbow.x, r.elbow.y, r.elbow.z);
      arm.hand.position.set(r.fist.x, r.fist.y, r.fist.z);
      if (punching) {
        this.shoulderW.copy(arm.shoulder).applyMatrix4(this.upper.matrixWorld);
        this.fistW.copy(r.fist).applyMatrix4(this.upper.matrixWorld);
      }
    }
  },

  // Zones follow the body (lunge, fall, rock, lift) and the head and
  // torso the upper half too (bend, wobble).
  updateZones: function () {
    var key = [this.tilt, this.roll, this.lunge, this.air, this.bend, this.upper.rotation.z].map(function (n) { return n.toFixed(3); }).join();
    if (key === this.zoneKey) return;
    this.zoneKey = key;
    this.body.updateMatrix();
    this.upper.updateMatrix();
    var mb = this.body.matrix;
    var mu = this.upperM.multiplyMatrices(this.body.matrix, this.upper.matrix);
    var v = this.tmp;
    this.target.setZones(this.zonesLocal.map(function (z) {
      var m = z.upper ? mu : mb;
      var a = v.set(z.a.x, z.a.y, z.a.z).applyMatrix4(m);
      var A = { x: a.x, y: a.y, z: a.z };
      var b = v.set(z.b.x, z.b.y, z.b.z).applyMatrix4(m);
      return { name: z.name, type: z.type, a: A, b: { x: b.x, y: b.y, z: b.z }, r: z.r, damage: z.damage };
    }));
  },
});

// ============================================================
// brawl-ring: surround the player
// ============================================================

AFRAME.registerComponent('brawl-ring', {
  schema: {
    count: { default: 6 },
    mix: { default: 'mixed' }, // mixed | boxer | blocker | brute | quick
    holdRadius: { default: 1.7 }, // where the waiting ones circle
    engageRadius: { default: 0.85 }, // how close one comes to swing
    attackers: { default: 2 }, // how many take a turn at once
    orbit: { default: 0.25 }, // rad/s they drift around you
    pace: { default: 1.2 }, // s between turns being handed out
    flank: { default: false }, // may attack from outside your view
    knock: { default: 1 }, // how far your hits knock them
    parryShove: { default: 3.2 }, // m/s a parry shoves one back
    impactDamage: { default: 0.6 }, // per m/s when one is knocked into another
    shoveCone: { default: 60 }, // °: a parry bends its shove onto a friend this far off the line
  },

  init: function () {
    this.center = new THREE.Vector3();
    this.haveCenter = false;
    this.camPos = new THREE.Vector3();
    this.camDir = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.sinceTurn = 0;
    this.pairCooldown = new Map();
  },

  update: function (old) {
    if (old && old.count === this.data.count && old.mix === this.data.mix) return;
    this.clear();
    var cam = this.el.sceneEl.camera;
    if (cam) cam.getWorldPosition(this.center); else this.center.set(0, 0, 0);
    this.haveCenter = true;
    var mixed = ['boxer', 'quick', 'blocker', 'boxer', 'brute', 'quick', 'boxer', 'blocker', 'brute', 'boxer', 'quick', 'boxer'];
    for (var i = 0; i < this.data.count; i++) {
      var kind = this.data.mix === 'mixed' ? mixed[i % mixed.length] : this.data.mix;
      var a = (i / this.data.count) * Math.PI * 2;
      var r = this.data.holdRadius + 2;
      var el = document.createElement('a-entity');
      el.classList.add('brawl-bot');
      el.id = 'brawler-' + (i + 1) + '-' + kind;
      el.setAttribute('position', { x: this.center.x + Math.sin(a) * r, y: 0, z: this.center.z + Math.cos(a) * r });
      el.setAttribute('brawler', { kind: kind });
      el.dataset.angle = a;
      el.dataset.dir = i % 2 ? 1 : -1;
      this.el.appendChild(el);
    }
  },

  clear: function () {
    var old = this.el.querySelectorAll('.brawl-bot');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
  },

  remove: function () { this.clear(); },

  bots: function () {
    var out = [];
    var els = this.el.querySelectorAll('.brawl-bot');
    for (var i = 0; i < els.length; i++) if (els[i].components.brawler) out.push(els[i].components.brawler);
    return out;
  },

  tick: function (time, rawDt) {
    var cam = this.el.sceneEl.camera;
    var bots = this.bots();
    if (!cam || !bots.length) return;
    var clock = this.el.sceneEl.systems['action-clock'];
    var dt = (clock ? clock.dt(null) : Math.min(rawDt || 16, 50)) / 1000;
    if (!dt) return;
    var d = this.data;

    // The ring's centre follows you, smoothly: they surround you
    // wherever you stand.
    cam.getWorldPosition(this.camPos);
    cam.getWorldQuaternion(this.camQuat);
    this.camDir.set(0, 0, -1).applyQuaternion(this.camQuat);
    this.center.x += (this.camPos.x - this.center.x) * Math.min(1, dt * 3);
    this.center.z += (this.camPos.z - this.center.z) * Math.min(1, dt * 3);

    // Where each one actually is around you (they get knocked about).
    var up = bots.filter(function (b) { return b.state === 'up'; });
    var center = this.center;
    function angleOf(b) {
      var p = b.el.object3D.position;
      return Math.atan2(p.x - center.x, p.z - center.z);
    }

    // Turns: release the ones that have had theirs, hand out new ones.
    up.forEach(function (b) {
      if (b.engaged && (b.attacksDone >= b.turnAttacks || time - b.engagedAt > 6000) && !b.busy()) b.engaged = false;
    });
    bots.forEach(function (b) { if (b.state !== 'up') b.engaged = false; });
    this.sinceTurn += dt;
    var engaged = up.filter(function (b) { return b.engaged; });
    if (this.sinceTurn > d.pace && engaged.length < d.attackers) {
      var pick = this.choose(up.filter(function (b) { return !b.engaged && b.kind.punches; }));
      if (pick) {
        pick.engaged = true;
        pick.engagedAt = time;
        pick.attacksDone = 0;
        pick.turnAttacks = pick.data.kind === 'quick' ? 3 : pick.data.kind === 'brute' ? 1 : 2;
        this.sinceTurn = 0;
        engaged.push(pick);
      }
    }

    // Behind each one stepping in, the nearest of the rest queues up for
    // its turn — so there's someone to parry it into.
    var queued = new Map();
    engaged.forEach(function (e) {
      var ae = angleOf(e), best = null, bestGap = Math.PI / 2;
      up.forEach(function (b) {
        if (b.engaged || queued.has(b)) return;
        var gap = Math.abs(wrapAngle(angleOf(b) - ae));
        if (gap < bestGap) { bestGap = gap; best = b; }
      });
      if (best) queued.set(best, ae);
    });

    // The rest circle at the hold radius (blockers a little closer —
    // moving punching bags), pushed apart so they spread round you.
    var circling = up.filter(function (b) { return !b.engaged && !queued.has(b); });
    var angles = circling.map(angleOf);
    var nudge = spreadAngles(angles, (Math.PI * 2 / Math.max(up.length, 1)) * 0.85, 0.6);
    var goal = function (b, a, r) { b.goal = { x: center.x + Math.sin(a) * r, z: center.z + Math.cos(a) * r }; };
    circling.forEach(function (b, i) {
      var a = angles[i] + nudge[i] + d.orbit * Number(b.el.dataset.dir || 1) * dt;
      goal(b, a, b.data.kind === 'blocker' ? d.holdRadius - 0.5 : d.holdRadius);
    });
    queued.forEach(function (a, b) { goal(b, a, Math.min(d.holdRadius, d.engageRadius + 0.8)); });
    engaged.forEach(function (b) {
      goal(b, angleOf(b), d.engageRadius);
      // In range and ready: swing.
      if (b.canAttack()) {
        var p = b.el.object3D.position;
        if (Math.hypot(p.x - this.camPos.x, p.z - this.camPos.z) < d.engageRadius + 0.2) b.startAttack();
      }
    }, this);

    this.collide(bots, time);
  },

  // A parried robot is shoved away from you. If another stands within
  // `shoveCone` of that line and close enough to reach, returns the way
  // to it (world x/z, and the bot) so the shove lands it there.
  aimShove: function (bot, ax, az) {
    var cone = Math.cos(this.data.shoveCone * Math.PI / 180);
    var al = Math.hypot(ax, az) || 1;
    var p = bot.el.object3D.position;
    var best = null, bestDot = cone;
    this.bots().forEach(function (other) {
      if (other === bot || other.state !== 'up') return;
      var q = other.el.object3D.position;
      var dx = q.x - p.x, dz = q.z - p.z;
      var l = Math.hypot(dx, dz);
      if (l < 1e-3 || l > 2.4) return;
      var dot = (dx * ax + dz * az) / (l * al);
      if (dot > bestDot) { bestDot = dot; best = { x: dx / l, z: dz / l, bot: other, gap: Math.max(0, l - 0.3 * (bot.kind.size + other.kind.size)) }; }
    });
    return best;
  },

  // Who gets the next turn: someone you can see (unless flanking is
  // allowed), nearest to where you're looking.
  choose: function (candidates) {
    var best = null, bestDot = -Infinity;
    for (var i = 0; i < candidates.length; i++) {
      var p = candidates[i].el.object3D.position;
      var dx = p.x - this.camPos.x, dz = p.z - this.camPos.z;
      var l = Math.hypot(dx, dz) || 1;
      var dot = (dx * this.camDir.x + dz * this.camDir.z) / l;
      if (!this.data.flank && dot < Math.cos(70 * Math.PI / 180)) continue;
      var score = dot + Math.random() * 0.4;
      if (score > bestDot) { bestDot = score; best = candidates[i]; }
    }
    return best;
  },

  // Bodies bump. One knocked into another hands on its momentum, and
  // both take damage from the impact.
  collide: function (bots, time) {
    var d = this.data;
    for (var i = 0; i < bots.length; i++) {
      for (var j = i + 1; j < bots.length; j++) {
        var A = bots[i], B = bots[j];
        var pa = A.el.object3D.position, pb = B.el.object3D.position;
        // Only being knocked about counts toward an impact: walking into
        // each other just nudges them apart.
        var a = { x: pa.x, z: pa.z, vx: A.knock.x, vz: A.knock.z, r: 0.3 * A.kind.size };
        var b = { x: pb.x, z: pb.z, vx: B.knock.x, vz: B.knock.z, r: 0.3 * B.kind.size };
        var hit = collideDiscs(a, b, 1.2, 0.7);
        if (!hit) continue;
        pa.x = a.x; pa.z = a.z; pb.x = b.x; pb.z = b.z;
        if (!hit.impact) continue;
        A.knock.x = a.vx; A.knock.z = a.vz;
        B.knock.x = b.vx; B.knock.z = b.vz;
        var key = A.el.id + '|' + B.el.id;
        if ((this.pairCooldown.get(key) || 0) > time) continue;
        this.pairCooldown.set(key, time + 400);
        stats.impacts++;
        var dmg = hit.impact * d.impactDamage;
        var mid = { x: (pa.x + pb.x) / 2, y: 1.0, z: (pa.z + pb.z) / 2 };
        sound('thump', mid);
        var fx = this.el.sceneEl.systems['action-effects'];
        if (fx) fx.sparks(mid, { x: 0, y: 1, z: 0 }, { count: 14, color: '#ffffff', speed: 2.5 });
        [A, B].forEach(function (bot) {
          if (bot.target.alive) bot.target.applyHit({ zone: 'torso', point: mid, direction: { x: 0, y: 0, z: 0 }, force: hit.impact / 3, damage: dmg, source: 'impact' });
        });
        logAction((A.el.id || 'one') + ' crashed into ' + (B.el.id || 'another') + ' (' + hit.impact.toFixed(1) + ' m/s)');
      }
    }
  },
});
