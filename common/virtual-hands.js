// ============================================================
// VIRTUAL HANDS — the hand you see and that hits things, separate from
// the hand you control.
//
// The tracked hand (controller, hand tracking, or desktop's simulated
// hand) is the input and the truth. The virtual hand is drawn and
// collides; usually it sits exactly on the tracked one, but assists may
// pull it away — toward the target a punch was meant for, or the attack
// a guard was meant for — by however much the comfort budget grants
// (common/comfort-budget.js). A translucent ghost of the tracked hand
// shows while the two differ, so you always know where your real hand
// is.
//
//   <a-entity virtual-hand="side: right; rig: #rig; tracked: #right-hand"></a-entity>
//   var vh = el.components['virtual-hand'];
//   vh.pull('melee', worldPoint, 1);   // this frame: I'd like the hand there
//   vh.setPose('fist', 2);             // this frame: show a fist
//   vh.position / vh.previous          // THREE.Vector3s, for swept hits
//
// Pose is output, not input: nothing reads hand poses, so the game is
// free to show a fist while a punch extends, an open palm while
// guarding, a grip around a gun.
//
// The glove points along the shoulder→hand line (like the guns), so it
// never depends on wrist rotation either.
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
]);

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
    this.poseRequest = null;
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
  pull: function (source, worldPoint, weight) {
    this.pending.push({ source: source, x: worldPoint.x, y: worldPoint.y, z: worldPoint.z, w: weight === undefined ? 1 : weight });
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

    // Requests made since the last tick.
    var desired = { x: 0, y: 0, z: 0 };
    var total = 0;
    for (var i = 0; i < this.pending.length; i++) {
      var r = this.pending[i];
      desired.x += (r.x - this.trackedPosition.x) * r.w;
      desired.y += (r.y - this.trackedPosition.y) * r.w;
      desired.z += (r.z - this.trackedPosition.z) * r.w;
      total += r.w;
    }
    if (total > 0) { desired.x /= total; desired.y /= total; desired.z /= total; }
    var hadRequests = this.pending.length > 0;
    this.pending.length = 0;

    if (!hadRequests && !this.inView()) {
      // Nobody can see it: put it back for free.
      this.offset.x = this.offset.y = this.offset.z = 0;
    } else {
      var travel = sense.state[side].speed * dtMs / 1000;
      var step = stepHandOffset(this.offset, desired, travel, sense.state.energy, budgetSettings());
      this.offset = step.offset;
      if (step.wanted > 0.002) recordAssist('hand ' + side.charAt(0).toUpperCase(), step.wanted, step.granted);
    }

    this.previous.copy(this.initialized ? this.position : this.trackedPosition);
    this.position.set(this.trackedPosition.x + this.offset.x, this.trackedPosition.y + this.offset.y, this.trackedPosition.z + this.offset.z);
    this.initialized = true;

    var aim = sense.aimRayWorld(side);
    if (aim) this.dir.copy(aim.direction);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.dir);

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
    this.ghostEl.object3D.quaternion.copy(this.quat);

    this.setPoseNow(this.poseRequest ? this.poseRequest.name : 'open');
    this.poseRequest = null;

    var dd = this.el.sceneEl.systems['debug-draw'];
    if (dd && dd.on('assist') && apart) dd.line(this.trackedPosition, this.position, '#4fd1ff');
  },
});
