// ============================================================
// DUMMIES — stand-ins for enemies until there are real assets.
//
//   steel-silhouette   a human-sized steel cut-out: head, torso and legs
//                      zones. Rings and rocks on a hit, tips over (or
//                      shatters) when it runs out of health, stands
//                      back up. Can slide on a rail, pop up and down,
//                      or walk at you.
//   target-spawner     lays out N of them in an arc and rebuilds them
//                      when its settings change.
//
// Everything they do runs on the action clock's world time, so bullet
// time slows them and hit-stop freezes the one that was hit.
// Hits arrive through combat-target's action-hit (see
// common/combat-targeting.js) whatever caused them — a bullet, a fist,
// a thrown knife — and the reaction scales with `force`.
// ============================================================

import './combat-targeting.js';
import './action-clock.js';
import './action-effects.js';
import { sound } from './action-feedback.js';

var THREE = AFRAME.THREE;

var STEEL = '#8f97a3';
var FLASH = '#ffffff';

function box(parent, w, h, d, x, y, z, color) {
  var el = document.createElement('a-entity');
  el.setAttribute('geometry', { primitive: 'box', width: w, height: h, depth: d });
  el.setAttribute('material', { color: color, flatShading: true });
  el.setAttribute('position', { x: x, y: y, z: z });
  parent.appendChild(el);
  return el;
}

function disc(parent, r, d, x, y, z, color) {
  var el = document.createElement('a-entity');
  el.setAttribute('geometry', { primitive: 'cylinder', radius: r, height: d, segmentsRadial: 12 });
  el.setAttribute('material', { color: color, flatShading: true });
  el.setAttribute('position', { x: x, y: y, z: z });
  el.setAttribute('rotation', '90 0 0');
  parent.appendChild(el);
  return el;
}

AFRAME.registerComponent('steel-silhouette', {
  schema: {
    color: { default: STEEL },
    health: { default: 3 },
    death: { default: 'tip', oneOf: ['tip', 'shatter'] },
    resetMs: { default: 2500 },
    mover: { default: 'none', oneOf: ['none', 'rail', 'popup', 'walker'] },
    railRange: { default: 1.2 }, // m either side
    speed: { default: 0.8 }, // m/s on a rail or walking
    upMs: { default: 2200 }, // popup: time up
    downMs: { default: 1400 }, // popup: time down
    stopDistance: { default: 1.4 }, // walker: how close it gets
  },

  init: function () {
    var el = this.el;
    this.home = el.object3D.position.clone();
    this.homeYaw = el.object3D.rotation.y;
    this.phase = Math.random() * Math.PI * 2;
    this.angle = 0; // body tilt about local X, radians; negative is away from the front
    this.angleVel = 0;
    this.restAngle = 0;
    this.state = 'up'; // up | down | popdown
    this.stateMs = 0;
    this.flashMs = 0;
    this.tmp = new THREE.Vector3();
    this.camPos = new THREE.Vector3();

    // A short post the silhouette stands on; the body pivots at its foot.
    box(el, 0.06, 0.06, 0.3, 0, 0.03, 0, '#3c414b');
    this.body = document.createElement('a-entity');
    el.appendChild(this.body);
    var c = this.data.color;
    this.parts = [
      box(this.body, 0.34, 0.72, 0.03, 0, 0.38, 0, c), // legs
      box(this.body, 0.48, 0.6, 0.03, 0, 1.03, 0, c), // torso
      box(this.body, 0.12, 0.1, 0.03, 0, 1.37, 0, c), // neck
      disc(this.body, 0.13, 0.03, 0, 1.53, 0, c), // head
    ];

    el.setAttribute('combat-target', { health: this.data.health, aimZone: 'torso' });
    this.target = el.components['combat-target'];
    // Zones are on the entity, not the body: they tip with it below.
    this.zones = [
      { name: 'head', type: 'sphere', a: { x: 0, y: 1.53, z: 0 }, r: 0.14, damage: 3 },
      { name: 'torso', type: 'capsule', a: { x: 0, y: 0.88, z: 0 }, b: { x: 0, y: 1.18, z: 0 }, r: 0.22, damage: 1 },
      { name: 'legs', type: 'capsule', a: { x: 0, y: 0.14, z: 0 }, b: { x: 0, y: 0.62, z: 0 }, r: 0.16, damage: 0.5 },
    ];
    this.applyZones();

    this.onHit = this.onHit.bind(this);
    el.addEventListener('action-hit', this.onHit);
  },

  remove: function () {
    this.el.removeEventListener('action-hit', this.onHit);
  },

  // Zones follow the body's tilt, so a tipped silhouette's hitbox lies
  // down with it.
  applyZones: function () {
    var c = Math.cos(this.angle), s = Math.sin(this.angle);
    var rot = function (p) { return { x: p.x, y: p.y * c - p.z * s, z: p.y * s + p.z * c }; };
    this.target.setZones(this.zones.map(function (z) {
      return { name: z.name, type: z.type, a: rot(z.a), b: rot(z.b || z.a), r: z.r, damage: z.damage };
    }));
  },

  setColor: function (color) {
    for (var i = 0; i < this.parts.length; i++) this.parts[i].setAttribute('material', 'color', color);
  },

  onHit: function (evt) {
    var hit = evt.detail;
    var scene = this.el.sceneEl;
    var fx = scene.systems['action-effects'];
    var clock = scene.systems['action-clock'];
    var d = hit.direction || { x: 0, y: 0, z: -1 };
    if (fx && hit.point) fx.sparks(hit.point, { x: -d.x, y: -d.y + 0.3, z: -d.z }, { count: hit.zone === 'head' ? 14 : 8 });
    if (hit.point) sound('clang', hit.point);
    this.flashMs = 70;
    this.setColor(FLASH);
    if (clock && hit.source !== 'gun') clock.hitStop(this.el);

    // Rock away from the hit. The push is about the body's base, so a
    // head shot rocks it harder than a leg shot.
    var lever = hit.zone === 'head' ? 1.4 : hit.zone === 'legs' ? 0.5 : 1;
    this.angleVel -= (hit.force === undefined ? 1 : hit.force) * 2.2 * lever;

    if (hit.killed) this.die(hit);
  },

  die: function (hit) {
    this.state = 'down';
    this.stateMs = 0;
    if (this.data.death === 'shatter') {
      var fx = this.el.sceneEl.systems['action-effects'];
      var centre = this.el.object3D.localToWorld(this.tmp.set(0, 0.9, 0));
      var d = hit.direction || { x: 0, y: 0, z: -1 };
      var push = 1.2 + (hit.force || 1) * 0.8;
      if (fx) fx.shatter(centre, { count: 40, color: this.data.color, radius: 0.3, spread: { x: 0.9, y: 2.4, z: 0.3 }, velocity: { x: d.x * push, y: 0.6, z: d.z * push }, size: 0.08 });
      sound('shatter', centre);
      this.body.object3D.visible = false;
    } else {
      this.restAngle = -1.48; // flat on its back, just off the ground
    }
  },

  standUp: function () {
    this.state = 'up';
    this.stateMs = 0;
    this.restAngle = 0;
    this.body.object3D.visible = true;
    this.target.revive();
    this.target.available = true;
    if (this.data.mover === 'walker') {
      this.el.object3D.position.copy(this.home);
      this.el.object3D.rotation.y = this.homeYaw;
      if (this.data.death === 'shatter') this.angle = 0;
    }
    if (this.data.death === 'shatter') {
      this.angle = 0;
      this.angleVel = 0;
      this.body.object3D.scale.setScalar(0.01); // pops back in
    }
  },

  tick: function (time, rawDt) {
    var clock = this.el.sceneEl.systems['action-clock'];
    var dtMs = clock ? clock.dt(this.el) : Math.min(rawDt || 16, 50);
    var dt = dtMs / 1000;

    if (this.flashMs > 0) {
      this.flashMs -= rawDt || 16;
      if (this.flashMs <= 0) this.setColor(this.data.color);
    }
    if (!dt) return;

    this.stateMs += dtMs;
    if (this.state === 'down' && this.stateMs > this.data.resetMs) this.standUp();
    this.updateMover(dt);

    // A damped spring toward the rest angle: a hit rings and settles, a
    // death falls and stays down.
    var stiffness = this.state === 'down' ? 60 : 90;
    var damping = this.state === 'down' ? 9 : 7;
    this.angleVel += (-(this.angle - this.restAngle) * stiffness - this.angleVel * damping) * dt;
    this.angle += this.angleVel * dt;
    if (this.angle < -1.5) { this.angle = -1.5; this.angleVel = Math.abs(this.angleVel) * 0.25; }
    this.body.object3D.rotation.x = this.angle;
    var s = this.body.object3D.scale.x;
    if (s < 1) this.body.object3D.scale.setScalar(Math.min(1, s + dt * 5));
    this.applyZones();
  },

  updateMover: function (dt) {
    var data = this.data;
    var o = this.el.object3D;
    if (data.mover === 'rail') {
      this.phase += (data.speed / Math.max(data.railRange, 0.1)) * dt;
      var side = Math.sin(this.phase) * data.railRange;
      // Along the silhouette's own right, so a rail runs across your view.
      o.position.set(
        this.home.x + Math.cos(this.homeYaw) * side,
        this.home.y,
        this.home.z - Math.sin(this.homeYaw) * side
      );
    } else if (data.mover === 'popup' && this.state !== 'down') {
      var cycle = data.upMs + data.downMs;
      var t = (this.stateMs + this.phase * 1000) % cycle;
      var up = t < data.upMs;
      this.restAngle = up ? 0 : -1.48;
      this.target.available = up && this.angle > -0.6;
    } else if (data.mover === 'walker' && this.state !== 'down') {
      var cam = this.el.sceneEl.camera;
      if (!cam) return;
      cam.getWorldPosition(this.camPos);
      if (o.parent) o.parent.worldToLocal(this.camPos);
      var dx = this.camPos.x - o.position.x;
      var dz = this.camPos.z - o.position.z;
      var dist = Math.sqrt(dx * dx + dz * dz);
      o.rotation.y = Math.atan2(dx, dz);
      if (dist > data.stopDistance) {
        var step = Math.min(data.speed * dt, dist - data.stopDistance);
        o.position.x += (dx / dist) * step;
        o.position.z += (dz / dist) * step;
      }
    }
  },
});

// Lays out `count` silhouettes in an arc at `distance` in front of
// itself (local -Z), each turned to face the spawner's origin, and
// rebuilds them whenever its attributes change.
AFRAME.registerComponent('target-spawner', {
  schema: {
    count: { default: 5 },
    distance: { default: 6 },
    arc: { default: 70 }, // degrees across
    depth: { default: 0 }, // extra metres of stagger between neighbours
    mover: { default: 'none' },
    death: { default: 'tip' },
    health: { default: 3 },
    resetMs: { default: 2500 },
    speed: { default: 0.8 },
  },

  update: function () {
    this.clear();
    var d = this.data;
    for (var i = 0; i < d.count; i++) {
      var f = d.count === 1 ? 0.5 : i / (d.count - 1);
      var a = (f - 0.5) * d.arc * Math.PI / 180;
      var r = d.distance + (i % 2) * d.depth;
      var x = Math.sin(a) * r;
      var z = -Math.cos(a) * r;
      var el = document.createElement('a-entity');
      el.classList.add('spawned-target');
      el.id = this.el.id ? this.el.id + '-' + (i + 1) : '';
      el.setAttribute('position', { x: x, y: 0, z: z });
      el.setAttribute('rotation', { x: 0, y: Math.atan2(-x, -z) * 180 / Math.PI, z: 0 });
      el.setAttribute('steel-silhouette', {
        mover: d.mover, death: d.death, health: d.health, resetMs: d.resetMs, speed: d.speed,
      });
      this.el.appendChild(el);
    }
  },

  clear: function () {
    var old = this.el.querySelectorAll('.spawned-target');
    for (var i = 0; i < old.length; i++) old[i].parentNode.removeChild(old[i]);
  },

  remove: function () { this.clear(); },
});

// ============================================================
// peg-dummy: a wooden training dummy (a mook jong) for melee.
//
// A trunk you can hit (head and body zones) with three pegs sticking
// out toward you, and the pegs are obstacles: a punch that meets one
// first is blocked — a clack, no damage — so slipping a punch between
// them is a thing. It never dies; it counts hits and shows the last
// one's force.
//
// Leaning in: an `action-incoming` event ({ point, lean? }) — sent by
// melee when a strike commits toward it — makes the dummy lean toward
// the fist by up to `lean` metres (the event's, else the schema's), so contact happens without the player's
// hand having to be moved as far. The cheapest assist there is: it
// costs no comfort, because nothing about you moves.
// ============================================================

var WOOD = '#8b5a2b';
var PEG = '#a8743f';

function capsuleBox(parent, a, b, r, color) {
  var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  var el = document.createElement('a-entity');
  el.setAttribute('geometry', { primitive: 'cylinder', radius: r, height: len, segmentsRadial: 8 });
  el.setAttribute('material', { color: color, flatShading: true });
  el.object3D.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  el.object3D.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
  parent.appendChild(el);
  return el;
}

AFRAME.registerComponent('peg-dummy', {
  schema: {
    lean: { default: 0.1 }, // m it may lean toward an incoming fist
    pegs: { default: true },
  },

  init: function () {
    var el = this.el;
    this.tilt = { x: 0, z: 0, vx: 0, vz: 0 }; // rock, radians
    this.leanTarget = new THREE.Vector3();
    this.leanNow = new THREE.Vector3();
    this.leanUntil = 0;
    this.hits = 0;
    this.lastForce = 0;
    this.tmp = new THREE.Vector3();

    box(el, 0.5, 0.06, 0.5, 0, 0.03, 0, '#3c414b'); // base plate
    this.body = document.createElement('a-entity');
    el.appendChild(this.body);
    capsuleBox(this.body, { x: 0, y: 0.05, z: 0 }, { x: 0, y: 1.42, z: 0 }, 0.12, WOOD);
    disc(this.body, 0.12, 0.24, 0, 1.53, 0, WOOD).setAttribute('rotation', '0 0 0'); // head block
    this.parts = [];

    // Zones in the dummy's frame: it faces +Z.
    var zones = [
      { name: 'head', type: 'sphere', a: { x: 0, y: 1.53, z: 0 }, r: 0.14, damage: 1.5 },
      { name: 'torso', type: 'capsule', a: { x: 0, y: 0.95, z: 0 }, b: { x: 0, y: 1.35, z: 0 }, r: 0.13, damage: 1 },
    ];
    if (this.data.pegs) {
      var pegs = [
        { name: 'peg-left', a: { x: -0.05, y: 1.28, z: 0.1 }, b: { x: -0.22, y: 1.36, z: 0.46 } },
        { name: 'peg-right', a: { x: 0.05, y: 1.28, z: 0.1 }, b: { x: 0.22, y: 1.36, z: 0.46 } },
        { name: 'peg-middle', a: { x: 0, y: 1.02, z: 0.1 }, b: { x: 0, y: 0.98, z: 0.52 } },
      ];
      pegs.forEach(function (p) {
        capsuleBox(this.body, p.a, p.b, 0.035, PEG);
        zones.push({ name: p.name, type: 'capsule', a: p.a, b: p.b, r: 0.04, obstacle: true });
      }, this);
    }
    this.zones = zones;

    this.label = document.createElement('a-text');
    this.label.setAttribute('align', 'center');
    this.label.setAttribute('color', '#ffd27a');
    this.label.setAttribute('width', 0.9);
    this.label.setAttribute('position', '0 1.9 0');
    this.label.setAttribute('value', 'hits 0');
    el.appendChild(this.label);

    // Team 'dummy': fists find it, guns leave it alone.
    el.setAttribute('combat-target', { health: 1e9, aimZone: 'torso', team: 'dummy' });
    this.target = el.components['combat-target'];
    this.applyZones();

    this.onHit = this.onHit.bind(this);
    this.onIncoming = this.onIncoming.bind(this);
    el.addEventListener('action-hit', this.onHit);
    el.addEventListener('action-incoming', this.onIncoming);
  },

  remove: function () {
    this.el.removeEventListener('action-hit', this.onHit);
    this.el.removeEventListener('action-incoming', this.onIncoming);
  },

  // Zones follow the body's lean and rock.
  applyZones: function () {
    var body = this.body.object3D;
    body.updateMatrix();
    var m = body.matrix;
    var v = this.tmp;
    this.target.setZones(this.zones.map(function (z) {
      var a = v.set(z.a.x, z.a.y, z.a.z).applyMatrix4(m);
      var A = { x: a.x, y: a.y, z: a.z };
      var b = v.set(z.b ? z.b.x : z.a.x, z.b ? z.b.y : z.a.y, z.b ? z.b.z : z.a.z).applyMatrix4(m);
      return { name: z.name, type: z.type, a: A, b: { x: b.x, y: b.y, z: b.z }, r: z.r, damage: z.damage, obstacle: z.obstacle };
    }));
  },

  // A fist is on its way to `point` (world): lean toward it.
  onIncoming: function (evt) {
    var p = evt.detail && evt.detail.point;
    var lean = evt.detail && evt.detail.lean !== undefined ? evt.detail.lean : this.data.lean;
    if (!p || !lean) return;
    var local = this.el.object3D.worldToLocal(this.tmp.set(p.x, p.y, p.z));
    local.y = 0;
    var l = local.length();
    if (l < 1e-3) return;
    this.leanTarget.copy(local).multiplyScalar(Math.min(lean, l * 0.5) / l);
    this.leanUntil = this.el.sceneEl.time + (evt.detail.ms || 350);
  },

  onHit: function (evt) {
    var hit = evt.detail;
    var fx = this.el.sceneEl.systems['action-effects'];
    var d = hit.direction || { x: 0, y: 0, z: -1 };
    if (hit.blocked) {
      if (hit.point) sound('block', hit.point);
      if (fx && hit.point) fx.sparks(hit.point, { x: -d.x, y: -d.y + 0.2, z: -d.z }, { count: 4, color: '#c9a57a', speed: 1.5 });
      return;
    }
    this.hits++;
    this.lastForce = hit.force || 0;
    this.label.setAttribute('value', 'hits ' + this.hits + '\nlast ' + this.lastForce.toFixed(2) + ' ' + (hit.zone || ''));
    if (hit.point) sound('thump', hit.point);
    if (fx && hit.point) fx.sparks(hit.point, { x: -d.x, y: -d.y + 0.3, z: -d.z }, { count: 10, color: '#e6d3b3', speed: 2 });
    // Rock away from the punch, in the dummy's frame.
    var local = this.el.object3D.worldToLocal(this.tmp.set(d.x, d.y, d.z).add(this.el.object3D.getWorldPosition(new THREE.Vector3()))).normalize();
    var push = (hit.force || 1) * 1.6;
    this.tilt.vx += local.z * push; // pushed toward -Z tips the top back (negative X rotation)
    this.tilt.vz -= local.x * push;
    this.target.health = 1e9; // a training dummy: never dies
  },

  tick: function (time, rawDt) {
    var clock = this.el.sceneEl.systems['action-clock'];
    var dt = (clock ? clock.dt(this.el) : Math.min(rawDt || 16, 50)) / 1000;
    if (!dt) return;
    var t = this.tilt;
    t.vx += (-t.x * 120 - t.vx * 9) * dt;
    t.vz += (-t.z * 120 - t.vz * 9) * dt;
    t.x += t.vx * dt;
    t.z += t.vz * dt;
    var want = time < this.leanUntil ? this.leanTarget : this.tmp.set(0, 0, 0);
    this.leanNow.lerp(want, 1 - Math.exp(-dt * 18));
    var o = this.body.object3D;
    o.position.copy(this.leanNow);
    o.rotation.set(t.x, 0, t.z);
    this.applyZones();
  },
});
