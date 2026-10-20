// ============================================================
// GUNS — real guns you pick up, shoot, empty, throw and replace.
//
//   gun        one gun: a pistol, SMG or shotgun (common/gun-core.js has
//              what each one is). Sits in a rack, is held, flies, or
//              lies loose on the floor — and a loose gun goes up in
//              smoke after a while (Pistols at Dawn's rule: the world
//              can hand out guns forever only because loose ones
//              perish).
//   gun-hands  the hands' side: grab (grip, or by just reaching for one),
//              trigger, drop, and throw — a fast release, or the
//              overhand whip, flings the gun, guided onto a target like
//              any throw (common/projectiles.js).
//   gun-rack   a table of gun slots that restock themselves a few
//              seconds after a gun leaves.
//
// Aim assist is always on, whatever fires the gun: a held gun points
// where your hand points (or along your arm — Tuning > Gun > Aim from)
// and turns onto the best target within the assist cone, and a shot at
// a target lands. What fires it is Tuning > Gun > Fire: the trigger
// (default — semi-autos fire as fast as you can pull), autofire (hold
// the gun out at someone, as common/autofire.js did), or both.
// ============================================================

import './motion-sense.js';
import './virtual-hands.js';
import './combat-targeting.js';
import './action-clock.js';
import './action-effects.js';
import './projectiles.js';
import { WEAPONS, createFireControl, pressTrigger, releaseTrigger, heldShots, pelletDirections } from './gun-core.js';
import { angleBetween, turnToward } from './autofire-core.js';
import { createThrowDetector, updateThrows } from './intent.js';
import { haptic, sound } from './action-feedback.js';
import { defineTunables } from './tunables.js';
import { registerReadout, logAction } from './debug-hud.js';
import { zoneSurfaceToward, rayZone } from './collide.js';

var THREE = AFRAME.THREE;
var DEG = Math.PI / 180;
var SIDES = ['left', 'right'];

var ASSIST = { off: 0, tight: 12, soft: 25, wide: 45 };

var tune = defineTunables('gun', 'Gun', [
  { key: 'fire', label: 'Fire', kind: 'select', value: 'trigger', options: [
    { value: 'trigger', label: 'Trigger' }, { value: 'auto', label: 'Auto' }, { value: 'both', label: 'Both' },
  ], info: 'Trigger: you pull it (semi-autos fire as fast as you can pull; the SMG while held).\nAuto: hold the gun out at someone and it fires itself.\nAim assist works either way.' },
  { key: 'assist', label: 'Assist', kind: 'select', value: 'soft', options: [
    { value: 'off', label: 'Off' }, { value: 'tight', label: 'Tight' }, { value: 'soft', label: 'Soft' }, { value: 'wide', label: 'Wide' },
  ], info: 'How far off your aim a target can be and still get hit: Tight 12°, Soft 25°, Wide 45°.' },
  { key: 'aimFrom', label: 'Aim from', kind: 'select', value: 'hand', options: [
    { value: 'hand', label: 'Hand' }, { value: 'arm', label: 'Arm' },
  ], info: 'Hand: where the controller points. Arm: the line from your shoulder through your hand (better for hand tracking).' },
  { key: 'tilt', label: 'Grip tilt', value: 38, min: -20, max: 70, step: 2, unit: '°',
    info: 'How far below the controller\'s length the barrel points, so a gun held naturally points where you mean. Headset controllers only.' },
  { key: 'ammo', label: 'Ammo', kind: 'select', value: 'mag', options: [
    { value: 'mag', label: 'Magazine' }, { value: 'infinite', label: 'Infinite' },
  ] },
  { key: 'grab', label: 'Grab', kind: 'select', value: 'grip', options: [
    { value: 'grip', label: 'Grip' }, { value: 'reach', label: 'Reach' },
  ], info: 'Grip: squeeze to pick up, let go to drop or throw.\nReach: an empty hand that lingers by a gun picks it up; throw it to let go.' },
  { key: 'throwSpeed', label: 'Fling', value: 1.8, min: 0.5, max: 5, step: 0.1, unit: 'm/s',
    info: 'Let go of a gun with the hand moving at least this fast and it\'s thrown (guided at a target) instead of dropped.' },
  { key: 'damage', label: 'Damage', value: 1, min: 25, max: 400, step: 25, unit: '%', scale: 100 },
  { key: 'recoil', label: 'Recoil', value: 1, min: 0, max: 200, step: 10, unit: '%', scale: 100 },
  { key: 'tracers', label: 'Tracers', kind: 'toggle', value: true },
  { key: 'looseSec', label: 'Loose life', value: 20, min: 3, max: 120, step: 1, unit: 's',
    info: 'A gun left on the floor disappears after this long.' },
]);

var allGuns = [];
var handsInstances = [];
registerReadout('gun', 'Gun', function () {
  return handsInstances.map(function (h) { return h.describe(); }).join('\n') || 'no hands';
});

// ---------- models: local -Z is the barrel, the grip is at the origin ----------

var MODELS = {
  pistol: { color: '#2b2f36', muzzle: [0, 0.012, -0.19], parts: [
    [0.034, 0.042, 0.2, 0, 0.012, -0.075], [0.03, 0.1, 0.042, 0, -0.04, 0, 14], [0.012, 0.012, 0.03, 0, 0.038, -0.16],
  ] },
  smg: { color: '#3b4a3f', muzzle: [0, 0.01, -0.36], parts: [
    [0.045, 0.06, 0.28, 0, 0.012, -0.1], [0.02, 0.02, 0.09, 0, 0.012, -0.29], [0.03, 0.1, 0.04, 0, -0.04, 0, 14],
    [0.028, 0.15, 0.034, 0, -0.07, -0.13], [0.04, 0.05, 0.1, 0, 0.0, 0.08],
  ] },
  shotgun: { color: '#5a3d2b', muzzle: [0, 0.022, -0.56], parts: [
    [0.034, 0.034, 0.5, 0, 0.022, -0.3], [0.05, 0.045, 0.16, 0, -0.008, -0.33], [0.05, 0.065, 0.17, 0, 0.012, -0.03],
    [0.04, 0.085, 0.25, 0, -0.025, 0.17], [0.03, 0.09, 0.04, 0, -0.04, 0.02, 14],
  ] },
};

function buildModel(el, type) {
  var m = MODELS[type] || MODELS.pistol;
  m.parts.forEach(function (p) {
    var part = document.createElement('a-entity');
    part.setAttribute('geometry', { primitive: 'box', width: p[0], height: p[1], depth: p[2] });
    part.setAttribute('material', { color: m.color, flatShading: true });
    part.setAttribute('position', { x: p[3], y: p[4], z: p[5] });
    if (p[6]) part.setAttribute('rotation', { x: p[6], y: 0, z: 0 });
    el.appendChild(part);
  });
  // An ammo bar along the right side: how full the magazine is.
  var bar = document.createElement('a-entity');
  bar.setAttribute('geometry', { primitive: 'box', width: 0.006, height: 0.008, depth: 0.1 });
  bar.setAttribute('material', { color: '#5fe08a', shader: 'flat' });
  bar.setAttribute('position', { x: 0.026, y: 0.02, z: -0.05 });
  el.appendChild(bar);
  return { bar: bar, muzzle: new THREE.Vector3(m.muzzle[0], m.muzzle[1], m.muzzle[2]) };
}

// ============================================================
// gun
// ============================================================

AFRAME.registerComponent('gun', {
  schema: {
    type: { default: 'pistol', oneOf: ['pistol', 'smg', 'shotgun'] },
    state: { default: 'loose', oneOf: ['rack', 'loose'] },
  },

  init: function () {
    this.weapon = WEAPONS[this.data.type];
    this.fc = createFireControl(this.weapon);
    this.state = this.data.state;
    var built = buildModel(this.el, this.data.type);
    this.bar = built.bar;
    this.muzzleLocal = built.muzzle;
    this.holder = null; // { side, hands }
    this.current = null; // target element
    this.pick = null;
    this.gunDir = new THREE.Vector3(0, 0, -1);
    this.baseDir = new THREE.Vector3(0, 0, -1);
    this.pos = new THREE.Vector3();
    this.muzzle = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.basis = new THREE.Matrix4();
    this.holdQuat = new THREE.Quaternion();
    this.kick = 0;
    this.kickVel = 0;
    this.looseMs = 0;
    this.shots = 0;
    this.kills = 0;
    this.lastAmmo = -1;
    allGuns.push(this);
  },

  remove: function () {
    var i = allGuns.indexOf(this);
    if (i >= 0) allGuns.splice(i, 1);
  },

  infinite: function () { return tune.values.ammo === 'infinite'; },

  grabbable: function () { return this.state === 'rack' || this.state === 'loose' || this.state === 'flying'; },

  grab: function (side, hands) {
    var proj = this.el.sceneEl.systems['thrown-projectiles'];
    if (this.state === 'flying' && this.flight) proj.remove(this.flight);
    this.flight = null;
    this.state = 'held';
    this.holder = { side: side, hands: hands };
    this.looseMs = 0;
    this.el.object3D.scale.setScalar(1);
    this.el.sceneEl.object3D.attach(this.el.object3D);
    this.el.emit('gun-taken', { side: side }, false);
  },

  // Thrown or dropped: common/projectiles.js flies it; when it lands it's
  // loose on the floor.
  letGo: function (launch) {
    releaseTrigger(this.fc);
    this.holder = null;
    this.current = null;
    this.pick = null;
    this.state = 'flying';
    this.el.object3D.scale.setScalar(1);
    var self = this;
    this.flight = this.el.sceneEl.systems['thrown-projectiles'].launch(Object.assign({
      el: this.el, radius: 0.06, after: 'bounce', spin: 'tumble', source: 'throw',
      damage: this.weapon.throwDamage * tune.values.damage, force: 1.5,
      onHit: function (p, hit, first) {
        logAction('gun thrown into ' + (first.target.el.id || 'target') + ' ' + first.zone.name + (hit && hit.killed ? ' (down)' : ''));
      },
      onLand: function () { self.flight = null; self.state = 'loose'; self.looseMs = 0; self.settle(); },
      onDone: function () { self.flight = null; self.state = 'loose'; self.looseMs = 0; },
    }, launch));
  },

  // Lying on the floor: on its side, at rest.
  settle: function () {
    var o = this.el.object3D;
    var yaw = Math.atan2(this.gunDir.x, this.gunDir.z);
    o.rotation.set(0, yaw, Math.PI / 2);
    o.position.y = 0.03;
  },

  triggerDown: function () {
    if (this.state !== 'held' || tune.values.fire === 'auto') return;
    var r = pressTrigger(this.fc, this.weapon, this.el.sceneEl.time, this.infinite());
    if (r.dry) { sound('click', this.muzzle); return; }
    // A pull fires now, at whatever the assist has picked — even if the
    // barrel hasn't finished turning onto it.
    if (r.fired) this.shoot(true);
  },

  triggerUp: function () { releaseTrigger(this.fc); },

  tick: function (time, rawDt) {
    var dtMs = Math.min(rawDt || 16, 50);
    this.updateBar();
    if (this.state === 'held') return this.updateHeld(time, dtMs);
    if (this.state === 'loose') {
      this.looseMs += dtMs;
      var life = tune.values.looseSec * 1000;
      if (this.looseMs > life - 800) this.el.object3D.scale.setScalar(Math.max(0.01, (life - this.looseMs) / 800));
      if (this.looseMs > life && this.el.parentNode) {
        // Back under its DOM parent first, or removing the entity would
        // leave its meshes behind in the scene it was moved to.
        if (this.el.parentNode.object3D) this.el.parentNode.object3D.attach(this.el.object3D);
        this.el.parentNode.removeChild(this.el);
      }
    }
  },

  updateBar: function () {
    var ammo = this.infinite() ? this.weapon.mag : this.fc.ammo;
    if (ammo === this.lastAmmo) return;
    this.lastAmmo = ammo;
    var f = ammo / this.weapon.mag;
    this.bar.object3D.scale.z = Math.max(0.02, f);
    this.bar.object3D.position.z = -0.05 + (1 - f) * 0.05;
    this.bar.setAttribute('material', 'color', f > 0.34 ? '#5fe08a' : f > 0 ? '#ffb547' : '#ff3b2f');
  },

  // Where the gun's aim starts from, before assist: the controller's
  // pointing direction (Aim from: Hand), or shoulder→hand (Arm).
  baseAim: function (hands, side, sense) {
    var vh = hands.virtual(side);
    var tracked = vh && vh.data.tracked;
    if (tune.values.aimFrom === 'hand' && tracked) {
      var q = tracked.object3D.getWorldQuaternion(new THREE.Quaternion());
      // A real controller points below its grip axis; a desktop hand
      // (oriented like the camera) points straight.
      var xr = this.el.sceneEl.is('vr-mode') && tracked.components['tracked-controls'];
      var tilt = xr ? tune.values.tilt * DEG : 0;
      return this.baseDir.set(0, -Math.sin(tilt), -Math.cos(tilt)).applyQuaternion(q).normalize();
    }
    var aim = sense.aimRayWorld(side);
    return aim ? this.baseDir.copy(aim.direction) : this.baseDir;
  },

  updateHeld: function (time, dtMs) {
    var hands = this.holder.hands;
    var side = this.holder.side;
    var sense = hands.sense();
    var vh = hands.virtual(side);
    if (!sense || !vh) return;
    vh.setPose('gun', 1);
    this.pos.copy(vh.position);
    var base = this.baseAim(hands, side, sense);

    // Assist: the best target near where it's pointing.
    var cone = ASSIST[tune.values.assist] || 0;
    this.pick = cone > 0 ? this.el.sceneEl.systems['combat-targeting'].resolve('gun', {
      origin: this.pos, direction: base, by: side, current: this.current, coneDeg: cone, team: 'enemy',
    }) : null;
    this.current = this.pick ? this.pick.el : null;

    var want = base;
    if (this.pick) {
      var to = this.tmp.copy(this.pick.aimPoint).sub(this.pos).normalize();
      var t = turnToward(base, to, (cone + 5) * DEG);
      want = new THREE.Vector3(t.x, t.y, t.z);
    }
    var turned = turnToward(this.gunDir, want, 1500 * DEG * dtMs / 1000);
    this.gunDir.set(turned.x, turned.y, turned.z);

    this.kickVel += (-this.kick * 260 - this.kickVel * 22) * dtMs / 1000;
    this.kick += this.kickVel * dtMs / 1000;
    this.place();

    // Autofire (and a held SMG trigger).
    var fire = tune.values.fire;
    var autoOn = fire !== 'trigger';
    var aligned = this.pick && angleBetween(this.gunDir, this.tmp.copy(this.pick.aimPoint).sub(this.pos).normalize()) < 4 * DEG;
    var wantAuto = autoOn && sense.state[side].presented && aligned;
    if (fire === 'auto') releaseTrigger(this.fc); // the trigger is ignored in pure autofire
    var r = heldShots(this.fc, this.weapon, dtMs, wantAuto, time, this.infinite());
    for (var i = 0; i < r.fired; i++) this.shoot(false);
    if (r.dry && this.fc.held) { sound('click', this.muzzle); releaseTrigger(this.fc); }
    if (this.pick) this.el.sceneEl.systems['combat-targeting'].claim(this.pick.el, side);
  },

  // Upright, barrel along gunDir, with the recoil kick.
  place: function () {
    var o = this.el.object3D;
    var z = this.tmp.copy(this.gunDir).negate();
    var x = new THREE.Vector3(0, 1, 0).cross(z);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    var y = new THREE.Vector3().crossVectors(z, x);
    this.basis.makeBasis(x, y, z);
    o.quaternion.setFromRotationMatrix(this.basis);
    o.position.copy(this.pos);
    // Drawn at the hand's scale (smaller off a headset, like the glove).
    var vh = this.holder && this.holder.hands.virtual(this.holder.side);
    o.scale.setScalar(vh ? vh.el.object3D.scale.x : 1);
    // The hand holding it turns with it (so it swings onto a target too).
    if (vh) vh.orient(this.holdQuat.copy(o.quaternion), 2);
    o.rotateX(this.kick * 0.5);
    o.translateZ(this.kick * 0.06);
  },

  shoot: function (snap) {
    var o = this.el.object3D;
    var pick = this.pick && this.pick.target.alive ? this.pick : null;
    if (pick && snap) {
      // A trigger pull at a picked target: the barrel snaps onto it.
      this.gunDir.copy(pick.aimPoint).sub(this.pos).normalize();
      this.place();
    }
    o.updateMatrixWorld();
    this.muzzle.copy(this.muzzleLocal).applyMatrix4(o.matrixWorld);
    var fx = this.el.sceneEl.systems['action-effects'];
    var w = this.weapon;
    var dirs = pelletDirections({ x: this.gunDir.x, y: this.gunDir.y, z: this.gunDir.z }, w);
    var targets = this.el.sceneEl.systems['combat-targeting'].targets;
    for (var i = 0; i < dirs.length; i++) {
      // The first pellet at a picked target is guaranteed; the rest (a
      // shotgun's spread) hit whatever their line meets.
      if (i === 0 && pick) this.hitTarget(pick.target, pick.target.data.aimZone, this.muzzle, fx);
      else this.freeShot(dirs[i], targets, fx);
    }
    if (fx) fx.flash(this.muzzle, this.gunDir, { size: this.data.type === 'shotgun' ? 0.14 : 0.09 });
    sound(this.data.type === 'shotgun' ? 'boom' : 'shot', this.muzzle);
    var vh = this.holder && this.holder.hands.virtual(this.holder.side);
    haptic(vh && vh.data.tracked, 'shot', w.recoil > 1 ? 1.6 : 1);
    this.kickVel += 9 * w.recoil * tune.values.recoil;
    this.shots++;
  },

  hitTarget: function (target, zoneName, from, fx) {
    var zone = target.zone(zoneName);
    if (!zone) return;
    var point = zoneSurfaceToward(zone, from);
    var dir = this.tmp.copy(point).sub(from).normalize();
    if (fx && tune.values.tracers) fx.tracer(from, point);
    var r = target.applyHit({
      zone: zone, point: point, direction: { x: dir.x, y: dir.y, z: dir.z }, force: this.weapon.force,
      damage: this.weapon.damage * tune.values.damage, source: 'gun', by: this.holder ? this.holder.side : null,
    });
    if (r && r.killed) {
      this.kills++;
      logAction((this.holder ? this.holder.side.charAt(0).toUpperCase() + ' ' : '') + this.weapon.label + ' killed ' + (target.el.id || 'target') + ' (' + r.zone + ')');
    }
  },

  // A shot with no picked target: it hits the first zone along its line,
  // if any.
  freeShot: function (dir, targets, fx) {
    var best = null;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (!t.alive || !t.targetable() || t.data.team !== 'enemy') continue;
      var zones = t.worldZones();
      for (var z = 0; z < zones.length; z++) {
        var d = rayZone(this.muzzle, dir, zones[z]);
        if (d >= 0 && d < 40 && (!best || d < best.d)) best = { d: d, target: t, zone: zones[z] };
      }
    }
    if (best) { this.hitTarget(best.target, best.zone.name, this.muzzle, fx); return; }
    if (fx && tune.values.tracers) fx.tracer(this.muzzle, { x: this.muzzle.x + dir.x * 30, y: this.muzzle.y + dir.y * 30, z: this.muzzle.z + dir.z * 30 });
  },
});

// ============================================================
// gun-hands
// ============================================================

AFRAME.registerComponent('gun-hands', {
  schema: {
    rig: { type: 'selector' },
    left: { type: 'selector' }, // virtual-hand entities
    right: { type: 'selector' },
    camera: { type: 'selector' }, // for desktop reach
    grabRadius: { default: 0.2 },
  },

  init: function () {
    this.held = { left: null, right: null };
    this.dwell = { left: 0, right: 0 };
    this.detector = createThrowDetector();
    this.bound = false;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    handsInstances.push(this);
  },

  remove: function () {
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    var i = handsInstances.indexOf(this);
    if (i >= 0) handsInstances.splice(i, 1);
  },

  sense: function () { var r = this.data.rig; return r && r.components['motion-sense']; },
  virtual: function (side) { var el = this.data[side]; return el && el.components['virtual-hand']; },

  describe: function () {
    return SIDES.map(function (side) {
      var g = this.held[side];
      var tag = side.charAt(0).toUpperCase() + ': ';
      if (!g) return tag + 'empty';
      var ammo = g.infinite() ? '∞' : g.fc.ammo + '/' + g.weapon.mag;
      return tag + g.weapon.label + ' ' + ammo + (g.pick ? ' -> ' + g.pick.name : '') + '  shots ' + g.shots + ' kills ' + g.kills;
    }, this).join('\n');
  },

  // Controller buttons, once the tracked hands exist.
  bind: function () {
    if (this.bound) return;
    var self = this;
    SIDES.forEach(function (side) {
      var vh = self.virtual(side);
      var el = vh && vh.data.tracked;
      if (!el) return;
      el.addEventListener('gripdown', function () { if (tune.values.grab === 'grip') self.grab(side); });
      el.addEventListener('gripup', function () { if (tune.values.grab === 'grip') self.release(side); });
      el.addEventListener('triggerdown', function () { if (self.held[side]) self.held[side].triggerDown(); });
      el.addEventListener('triggerup', function () { if (self.held[side]) self.held[side].triggerUp(); });
    });
    this.bound = SIDES.every(function (s) { return self.virtual(s); });
  },

  nearest: function (side, radius) {
    var vh = this.virtual(side);
    if (!vh) return null;
    var best = null, bestD = radius;
    var p = new THREE.Vector3();
    for (var i = 0; i < allGuns.length; i++) {
      var g = allGuns[i];
      if (!g.grabbable()) continue;
      g.el.object3D.getWorldPosition(p);
      var d = p.distanceTo(vh.position);
      if (d < bestD) { bestD = d; best = g; }
    }
    return best;
  },

  grab: function (side) {
    if (this.held[side]) return false;
    var g = this.nearest(side, this.data.grabRadius);
    if (!g) return false;
    g.grab(side, this);
    this.held[side] = g;
    var vh = this.virtual(side);
    vh.holding = g;
    haptic(vh.data.tracked, 'hit-light', 0.6);
    logAction(side.charAt(0).toUpperCase() + ' took a ' + g.weapon.label + (g.infinite() ? '' : ' (' + g.fc.ammo + ')'));
    return true;
  },

  // Let go: a fast hand flings it (guided at a target), a slow one drops it.
  release: function (side, whip) {
    var g = this.held[side];
    if (!g) return;
    var sense = this.sense();
    var vh = this.virtual(side);
    this.held[side] = null;
    vh.holding = null;
    // The knife thrower watches the same whip; tell it this one was a gun.
    vh.releasedGunAt = this.el.sceneEl.time;
    var v = whip ? whip.velocity : sense.state[side].velocity;
    var speed = whip ? whip.speed : sense.state[side].speed;
    var vel = sense.directionToWorld(v, new THREE.Vector3()).multiplyScalar(speed);
    var from = vh.position.clone();
    if (speed < tune.values.throwSpeed && !whip) {
      g.letGo({ from: from, velocity: vel });
      logAction(side.charAt(0).toUpperCase() + ' dropped the ' + g.weapon.label);
      return;
    }
    var targeting = this.el.sceneEl.systems['combat-targeting'];
    var gaze = targeting.gaze();
    var dir = vel.clone().normalize();
    if (gaze) dir.add(gaze.direction).normalize();
    var pick = targeting.resolve('throw', { origin: from, direction: dir, by: side, team: 'enemy' });
    var free = vel.clone().multiplyScalar(1.6);
    if (free.y < 1.2) free.y += 1.2;
    g.letGo({
      from: from, target: pick ? pick.target : null, velocity: free,
      opts: { rise: speed > 0 ? v.y / speed : 0, handSpeed: 4, maxSpeed: 16 },
    });
    sound('whoosh', from);
    logAction(side.charAt(0).toUpperCase() + ' threw the ' + g.weapon.label + (pick ? ' at ' + pick.name : ''));
  },

  tick: function (time, rawDt) {
    this.bind();
    var sense = this.sense();
    if (!sense) return;
    // The overhand whip throws whatever gun the hand holds (and
    // throwing-hands skips its knife for a hand that's holding one).
    var events = updateThrows(this.detector, sense.state);
    for (var i = 0; i < events.length; i++) {
      if (this.held[events[i].hand]) this.release(events[i].hand, events[i]);
    }
    // Reach mode: an empty hand lingering by a gun takes it.
    if (tune.values.grab === 'reach') {
      var dt = Math.min(rawDt || 16, 50);
      SIDES.forEach(function (side) {
        if (this.held[side]) { this.dwell[side] = 0; return; }
        var near = this.nearest(side, 0.14);
        this.dwell[side] = near ? this.dwell[side] + dt : 0;
        if (this.dwell[side] > 250) { this.grab(side); this.dwell[side] = 0; }
      }, this);
    }
  },

  // ---------- desktop: G / H grab or drop (right / left), Space fires ----------

  onKeyDown: function (evt) {
    if (this.el.sceneEl.is('vr-mode') || evt.repeat) return;
    if (evt.code === 'KeyG') this.desktopGrab('right');
    if (evt.code === 'KeyH') this.desktopGrab('left');
    if (evt.code === 'Space') {
      evt.preventDefault();
      SIDES.forEach(function (side) {
        var vh = this.virtual(side);
        if (this.held[side] && vh) vh.data.tracked.emit('triggerdown');
      }, this);
    }
  },

  onKeyUp: function (evt) {
    if (evt.code !== 'Space') return;
    SIDES.forEach(function (side) {
      var vh = this.virtual(side);
      if (vh) vh.data.tracked.emit('triggerup');
    }, this);
  },

  // Reach the simulated hand out to the nearest gun within arm's length
  // and squeeze (a real gripdown on the hand); or, holding one, let go.
  desktopGrab: function (side) {
    var vh = this.virtual(side);
    var tracked = vh && vh.data.tracked;
    var hand = tracked && tracked.components['semantic-hand'];
    if (!hand) return;
    if (this.held[side]) { tracked.emit('gripup'); if (tune.values.grab !== 'grip') this.release(side); return; }
    var cam = this.data.camera && this.data.camera.object3D;
    var g = null, bestD = 1.1;
    var p = new THREE.Vector3(), c = new THREE.Vector3();
    if (cam) cam.getWorldPosition(c);
    for (var i = 0; i < allGuns.length; i++) {
      if (!allGuns[i].grabbable()) continue;
      allGuns[i].el.object3D.getWorldPosition(p);
      var d = p.distanceTo(c);
      if (d < bestD) { bestD = d; g = allGuns[i]; }
    }
    if (!g) { logAction('no gun within reach — walk up to the table'); return; }
    var at = g.el.object3D.getWorldPosition(new THREE.Vector3());
    var q = cam.getWorldQuaternion(new THREE.Quaternion());
    var self = this;
    tracked.setAttribute('data-semantic-action-active', 'grab');
    hand.cancelMotion();
    hand.runWorldMotion([{ position: at, quaternion: q, pose: 'Hold', duration: 260 }], { action: 'grab', source: 'desktop' });
    tracked.addEventListener('semantic-hand-motion-complete', function done() {
      tracked.removeEventListener('semantic-hand-motion-complete', done);
      if (tune.values.grab === 'grip') tracked.emit('gripdown'); else self.grab(side);
      tracked.removeAttribute('data-semantic-action-active');
    });
  },
});

// ============================================================
// gun-rack: a table of guns that restock themselves
// ============================================================

AFRAME.registerComponent('gun-rack', {
  schema: {
    slots: { default: 'pistol,pistol,smg,smg,shotgun' },
    respawnMs: { default: 3000 },
    spacing: { default: 0.26 },
  },

  init: function () {
    var types = this.data.slots.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    var width = types.length * this.data.spacing + 0.2;
    var top = document.createElement('a-entity');
    top.setAttribute('geometry', { primitive: 'box', width: width, height: 0.04, depth: 0.55 });
    top.setAttribute('material', { color: '#4a3a2c', flatShading: true });
    top.setAttribute('position', { x: 0, y: 0.93, z: 0 });
    this.el.appendChild(top);
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        var leg = document.createElement('a-entity');
        leg.setAttribute('geometry', { primitive: 'box', width: 0.05, height: 0.91, depth: 0.05 });
        leg.setAttribute('material', { color: '#3a2d22', flatShading: true });
        leg.setAttribute('position', { x: sx * (width / 2 - 0.05), y: 0.455, z: sz * 0.22 });
        this.el.appendChild(leg);
      }, this);
    }, this);
    this.slots = types.map(function (type, i) {
      return { type: type, x: (i - (types.length - 1) / 2) * this.data.spacing, gun: null, emptyMs: 0 };
    }, this);
    var self = this;
    this.slots.forEach(function (slot) { self.stock(slot); });
  },

  stock: function (slot) {
    var el = document.createElement('a-entity');
    el.setAttribute('gun', { type: slot.type, state: 'rack' });
    // Lying on its side, barrel away from you (toward the range).
    el.setAttribute('position', { x: slot.x, y: 0.97, z: 0.05 });
    el.setAttribute('rotation', { x: 0, y: 0, z: 90 });
    el.object3D.scale.setScalar(0.01);
    this.el.appendChild(el);
    slot.gun = el;
    slot.emptyMs = 0;
  },

  tick: function (time, rawDt) {
    var dt = Math.min(rawDt || 16, 50);
    for (var i = 0; i < this.slots.length; i++) {
      var slot = this.slots[i];
      var g = slot.gun && slot.gun.components.gun;
      if (g && g.state === 'rack') {
        var s = slot.gun.object3D.scale.x;
        if (s < 1) slot.gun.object3D.scale.setScalar(Math.min(1, s + dt / 250)); // pops in
        continue;
      }
      slot.emptyMs += dt;
      if (slot.emptyMs > this.data.respawnMs) this.stock(slot);
    }
  },
});
