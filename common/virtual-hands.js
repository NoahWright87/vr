// ============================================================
// VIRTUAL HANDS — the hand you see and that hits things, separate from
// the hand you control.
//
// The tracked hand (controller, hand tracking, or desktop's simulated
// hand) is the input and the truth. The virtual hand is drawn and
// collides. It *is* your hand — where the controller is, turned the way
// the controller is turned — except for a moment while it's helping you
// do something good, and then it comes straight back. A translucent
// ghost of the tracked hand shows while the two differ.
//
// Two kinds of help:
//   budget  a punch's fist drifting onto its target: paid for by real
//           hand motion (common/comfort-budget.js), at most handMax.
//   snap    a block or a counter: the hand goes there fast whether you're
//           moving or not — your character's reflexes, not yours.
// Either way, when nothing is asking any more it returns at Return
// speed, moving or not.
//
//   <a-entity virtual-hand="side: right; rig: #rig; tracked: #right-hand"></a-entity>
//   var vh = el.components['virtual-hand'];
//   vh.pull('melee', worldPoint, 1);          // this frame: drift there (budget)
//   vh.pull('guard', worldPoint, 4, 'snap');  // this frame: get there now
//   vh.perform('counter', pointOrFn, 220, { pose: 'fist', speed }); // snap for a while
//   vh.freeze(70);                            // hold still where it is (an impact)
//   vh.setPose('fist', 2);                    // this frame: show a fist
//   vh.orient(quaternion, 1);                 // this frame: turn the glove (a held gun)
//   vh.position / vh.previous                 // THREE.Vector3s, for swept hits
//
// Pose is output, not input: nothing reads hand poses, so the game is
// free to show a fist while a punch extends, an open palm while
// guarding, a grip around a gun. Rotation is shown, never read: what
// you do is still decided by where your hands go.
// ============================================================

import './motion-sense.js';
import { stepHandOffset, budgetSettings, recordAssist } from './comfort-budget.js';
import { defineTunables } from './tunables.js';

var THREE = AFRAME.THREE;

var tune = defineTunables('hands', 'Hands', [
  { key: 'ghost', label: 'Ghost', kind: 'select', value: 'offset', options: [
    { value: 'offset', label: 'When apart' }, { value: 'always', label: 'Always' }, { value: 'never', label: 'Never' },
  ], info: 'A see-through copy of your real hand, so you can see how far an assist has moved the one you hit with.' },
  { key: 'glove', label: 'Glove', kind: 'toggle', value: true, info: 'Off shows the raw input hands instead of the virtual ones.' },
  { key: 'wrist', label: 'Turn with', kind: 'select', value: 'controller', options: [
    { value: 'controller', label: 'Controller' }, { value: 'arm', label: 'Arm' },
  ], info: 'Controller: the glove turns the way your controller does. Arm: it points along shoulder to hand (for hand tracking, if the wrist is jittery).' },
  { key: 'tilt', label: 'Wrist tilt', value: 38, min: -20, max: 70, step: 2, unit: '°',
    info: 'How far below the controller\'s length your knuckles point. Headset controllers only.' },
  { key: 'roll', label: 'Wrist roll', value: 90, min: -90, max: 180, step: 15, unit: '°',
    info: 'Turns the glove about its length so it sits the way you hold a controller: 90° is a vertical fist, thumb up. Headset controllers only.' },
  { key: 'snap', label: 'Snap speed', value: 6, min: 1, max: 15, step: 0.5, unit: 'm/s',
    info: 'How fast a block or counter takes your hand to the punch.' },
  { key: 'snapMax', label: 'Snap reach', value: 0.8, min: 0.1, max: 1.5, step: 0.05, unit: 'm',
    info: 'The furthest a block or counter may take your hand from the real one.' },
  { key: 'back', label: 'Return', value: 3, min: 0.5, max: 10, step: 0.5, unit: 'm/s',
    info: 'How fast a hand comes back to your real hand once nothing needs it — moving or not.' },
]);

var DEG = Math.PI / 180;
var Z_AXIS = new THREE.Vector3(0, 0, 1);
var X_AXIS = new THREE.Vector3(1, 0, 0);
var FORWARD = new THREE.Vector3(0, 0, -1);

// Move `from` toward `to` by at most `step`, capped at `max` long.
function moveToward(from, to, step, max) {
  var dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  var d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  var k = d > step ? step / d : 1;
  var out = { x: from.x + dx * k, y: from.y + dy * k, z: from.z + dz * k };
  var l = Math.sqrt(out.x * out.x + out.y * out.y + out.z * out.z);
  if (max !== undefined && l > max) { out.x *= max / l; out.y *= max / l; out.z *= max / l; }
  return out;
}

var GLOVE = '#d8c3a5';
var GHOST = '#9fd3ff';

// Parts of a glove in its own frame: -Z along the arm, +Y up, palm down.
// Each pose moves the finger block; everything else stays put.
var POSES = {
  open: { fingers: { w: 0.082, h: 0.016, d: 0.085, x: 0, y: 0.004, z: -0.085 } },
  fist: { fingers: { w: 0.086, h: 0.05, d: 0.045, x: 0, y: -0.01, z: -0.062 } },
  gun: { fingers: { w: 0.07, h: 0.045, d: 0.04, x: 0, y: -0.02, z: -0.055 } },
};

function buildGlove(parent, color, side, ghost) {
  var material = ghost
    ? { color: color, opacity: 0.28, transparent: true, depthWrite: false, flatShading: true }
    : { color: color, flatShading: true };
  var parts = {};
  var add = function (name, w, h, d, x, y, z) {
    var el = document.createElement('a-entity');
    el.setAttribute('geometry', { primitive: 'box', width: w, height: h, depth: d });
    el.setAttribute('material', material);
    el.setAttribute('position', { x: x, y: y, z: z });
    parent.appendChild(el);
    parts[name] = el;
  };
  add('palm', 0.088, 0.036, 0.09, 0, 0, -0.01);
  add('fingers', 0.086, 0.05, 0.045, 0, -0.01, -0.062);
  add('thumb', 0.024, 0.024, 0.05, side * 0.052, -0.012, -0.025);
  add('cuff', 0.072, 0.05, 0.04, 0, 0, 0.055);
  return parts;
}

function len3(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function dist3(a, b) { return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y) + (a.z - b.z) * (a.z - b.z)); }

function applyPose(parts, name) {
  var f = (POSES[name] || POSES.open).fingers;
  parts.fingers.setAttribute('geometry', { width: f.w, height: f.h, depth: f.d });
  parts.fingers.object3D.position.set(f.x, f.y, f.z);
}

AFRAME.registerComponent('virtual-hand', {
  schema: {
    side: { default: 'right', oneOf: ['left', 'right'] },
    rig: { type: 'selector' },
    tracked: { type: 'selector' },
  },

  init: function () {
    var side = this.data.side === 'left' ? -1 : 1;
    this.offset = { x: 0, y: 0, z: 0 };
    this.position = new THREE.Vector3();
    this.previous = new THREE.Vector3();
    this.trackedPosition = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.quat = new THREE.Quaternion();
    this.cam = new THREE.Vector3();
    this.camDir = new THREE.Vector3();
    this.camQuat = new THREE.Quaternion();
    this.pending = [];
    this.performing = [];
    this.poseRequest = null;
    this.orientRequest = null;
    this.handQuat = new THREE.Quaternion();
    this.frozenUntil = 0;
    this.frozenAt = new THREE.Vector3();
    this.wristQuat = new THREE.Quaternion();
    this.pose = null;
    this.initialized = false;

    this.gloveEl = document.createElement('a-entity');
    this.el.appendChild(this.gloveEl);
    this.parts = buildGlove(this.gloveEl, GLOVE, side, false);

    // The ghost lives in the scene, not under this entity, because it
    // sits at the tracked hand while this entity sits at the virtual one.
    this.ghostEl = document.createElement('a-entity');
    this.ghostParts = buildGlove(this.ghostEl, GHOST, side, true);
    this.el.sceneEl.appendChild(this.ghostEl);
    this.setPoseNow('open');
  },

  remove: function () {
    if (this.ghostEl.parentNode) this.ghostEl.parentNode.removeChild(this.ghostEl);
  },

  // Assists call these every frame they want something; requests last
  // one frame.
  // mode: 'budget' (default; paid for by real motion) or 'snap'.
  pull: function (source, worldPoint, weight, mode) {
    this.pending.push({ source: source, x: worldPoint.x, y: worldPoint.y, z: worldPoint.z, w: weight === undefined ? 1 : weight, snap: mode === 'snap' });
  },

  // A move borrowing the hand: snap to `to` (a point, or a function
  // returning one each frame) for `ms`, then let it come back.
  // opts: { pose, weight }.
  perform: function (source, to, ms, opts) {
    var o = opts || {};
    this.performing.push({ source: source, to: to, until: this.el.sceneEl.time + ms, pose: o.pose, w: o.weight || 10, speed: o.speed || 0 });
  },

  // An impact: the hand holds exactly where it is for `ms` (the enemy
  // freezes too, through the action clock), then carries on — back to
  // your real hand at Return speed.
  freeze: function (ms) {
    this.frozenUntil = this.el.sceneEl.time + ms;
    this.frozenAt.copy(this.position);
  },

  busy: function () { return this.performing.length > 0; },

  orient: function (quaternion, priority) {
    var p = priority || 0;
    if (!this.orientRequest || p >= this.orientRequest.priority) this.orientRequest = { q: quaternion, priority: p };
  },

  setPose: function (name, priority) {
    var p = priority || 0;
    if (!this.poseRequest || p >= this.poseRequest.priority) this.poseRequest = { name: name, priority: p };
  },

  setPoseNow: function (name) {
    if (this.pose === name) return;
    this.pose = name;
    applyPose(this.parts, name);
    applyPose(this.ghostParts, name);
  },

  offsetLength: function () {
    var o = this.offset;
    return Math.sqrt(o.x * o.x + o.y * o.y + o.z * o.z);
  },

  sense: function () {
    var rig = this.data.rig;
    return rig && rig.components['motion-sense'];
  },

  // Is the tracked hand somewhere you could see it?
  inView: function () {
    var cam = this.el.sceneEl.camera;
    if (!cam) return true;
    cam.getWorldPosition(this.cam);
    cam.getWorldQuaternion(this.camQuat);
    this.camDir.set(0, 0, -1).applyQuaternion(this.camQuat);
    var dx = this.trackedPosition.x - this.cam.x, dy = this.trackedPosition.y - this.cam.y, dz = this.trackedPosition.z - this.cam.z;
    var d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    return (dx * this.camDir.x + dy * this.camDir.y + dz * this.camDir.z) / d > Math.cos(65 * Math.PI / 180);
  },

  hideInputVisuals: function () {
    var tracked = this.data.tracked;
    if (!tracked) return;
    var on = tune.values.glove;
    var xr = this.el.sceneEl.is('vr-mode');
    // control-mode-visibility toggles these on mode changes, so this
    // re-asserts every frame rather than once. With the glove off, the
    // input's own visuals come back: the desktop hand off a headset, the
    // markers in one.
    var desktop = tracked.querySelectorAll('.desktop-hand-visual');
    for (var i = 0; i < desktop.length; i++) desktop[i].object3D.visible = !on && !xr;
    var markers = tracked.querySelectorAll('.hand-marker');
    for (var j = 0; j < markers.length; j++) markers[j].object3D.visible = !on && xr;
    this.gloveEl.object3D.visible = on;
  },

  tick: function (time, rawDt) {
    var sense = this.sense();
    var tracked = this.data.tracked;
    if (!sense || !tracked) return;
    var side = this.data.side;
    var dtMs = Math.min(rawDt || 16, 50);
    tracked.object3D.getWorldPosition(this.trackedPosition);
    this.hideInputVisuals();

    // Moves borrowing the hand ask every frame until they're done.
    var snapSpeed = tune.values.snap;
    for (var m = this.performing.length - 1; m >= 0; m--) {
      var perf = this.performing[m];
      // Done — but every move gets at least one frame, however slow.
      if (time >= perf.until && perf.applied) { this.performing.splice(m, 1); continue; }
      perf.applied = true;
      var at = typeof perf.to === 'function' ? perf.to() : perf.to;
      if (at) this.pull(perf.source, at, perf.w, 'snap');
      if (perf.pose) this.setPose(perf.pose, 5);
      snapSpeed = Math.max(snapSpeed, perf.speed);
    }

    // Requests made since the last tick.
    var desired = { x: 0, y: 0, z: 0 };
    var total = 0;
    var snap = false;
    for (var i = 0; i < this.pending.length; i++) {
      var r = this.pending[i];
      desired.x += (r.x - this.trackedPosition.x) * r.w;
      desired.y += (r.y - this.trackedPosition.y) * r.w;
      desired.z += (r.z - this.trackedPosition.z) * r.w;
      total += r.w;
      if (r.snap) snap = true;
    }
    if (total > 0) { desired.x /= total; desired.y /= total; desired.z /= total; }
    var hadRequests = this.pending.length > 0;
    this.pending.length = 0;

    if (time < this.frozenUntil) {
      // Frozen on an impact: exactly where it hit.
      this.offset = { x: this.frozenAt.x - this.trackedPosition.x, y: this.frozenAt.y - this.trackedPosition.y, z: this.frozenAt.z - this.trackedPosition.z };
    } else if (!hadRequests && !this.inView()) {
      // Nobody can see it: put it back for free.
      this.offset.x = this.offset.y = this.offset.z = 0;
    } else {
      var dt = dtMs / 1000;
      var label = 'hand ' + side.charAt(0).toUpperCase();
      var growing = hadRequests && len3(desired) > this.offsetLength() + 1e-6;
      if (snap) {
        // A block or counter: there now.
        var before = this.offset;
        this.offset = moveToward(this.offset, desired, snapSpeed * dt, tune.values.snapMax);
        recordAssist(label, dist3(before, desired), dist3(before, this.offset));
      } else if (growing && this.offsetLength() < budgetSettings().handMax) {
        // A punch drifting onto its target: paid for by real motion.
        var travel = sense.state[side].speed * dtMs / 1000;
        var step = stepHandOffset(this.offset, desired, travel, sense.state.energy, budgetSettings());
        this.offset = step.offset;
        if (step.wanted > 0.002) recordAssist(label, step.wanted, step.granted);
      } else {
        // Coming back (or closer to where it's asked): always, quickly.
        this.offset = moveToward(this.offset, desired, tune.values.back * dt);
      }
    }

    this.previous.copy(this.initialized ? this.position : this.trackedPosition);
    this.position.set(this.trackedPosition.x + this.offset.x, this.trackedPosition.y + this.offset.y, this.trackedPosition.z + this.offset.z);
    this.initialized = true;

    // Turned the way your hand is (the ghost always is), unless
    // something holding it (a gun) says otherwise.
    var hq = this.handQuat;
    if (tune.values.wrist === 'controller') {
      tracked.object3D.getWorldQuaternion(hq);
      // A real controller is held below its length, and on its side.
      if (this.el.sceneEl.is('vr-mode') && tracked.components['tracked-controls']) {
        var sideSign = side === 'left' ? -1 : 1;
        hq.multiply(this.wristQuat.setFromAxisAngle(X_AXIS, -tune.values.tilt * DEG));
        hq.multiply(this.wristQuat.setFromAxisAngle(Z_AXIS, sideSign * tune.values.roll * DEG));
      }
    } else {
      var aim = sense.aimRayWorld(side);
      if (aim) this.dir.copy(aim.direction);
      hq.setFromUnitVectors(FORWARD, this.dir);
    }
    this.quat.copy(this.orientRequest ? this.orientRequest.q : hq);
    this.orientRequest = null;

    var o = this.el.object3D;
    o.position.copy(this.position);
    o.quaternion.copy(this.quat);
    // Off a headset the simulated hands sit a hand's length from the
    // camera, so they're drawn smaller, by the same desktopScale the
    // desktop hand model uses.
    var semantic = tracked.components['semantic-hand'];
    var scale = this.el.sceneEl.is('vr-mode') || !semantic ? 1 : semantic.data.desktopScale;
    o.scale.setScalar(scale);
    this.ghostEl.object3D.scale.setScalar(scale);

    var ghost = tune.values.ghost;
    var apart = this.offsetLength() > 0.01;
    this.ghostEl.object3D.visible = tune.values.glove && (ghost === 'always' || (ghost === 'offset' && apart));
    this.ghostEl.object3D.position.copy(this.trackedPosition);
    this.ghostEl.object3D.quaternion.copy(this.handQuat);

    this.setPoseNow(this.poseRequest ? this.poseRequest.name : 'open');
    this.poseRequest = null;

    var dd = this.el.sceneEl.systems['debug-draw'];
    if (dd && dd.on('assist') && apart) dd.line(this.trackedPosition, this.position, '#4fd1ff');
  },
});
