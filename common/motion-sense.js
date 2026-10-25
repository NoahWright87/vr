// ============================================================
// MOTION SENSE — what the player's body is doing, in numbers.
//
// The shared input layer for actions (docs/actions/): head and both
// hands in, a handful of derived facts out, every frame. Nothing in
// here knows about guns, punches or menus; they all read it.
//
// The core is plain functions over plain {x,y,z} / {x,y,z,w} objects so
// it runs under node --test and can replay recorded motion. The A-Frame
// component at the bottom only gathers poses and hands them in.
//
// Three rules it keeps (see docs/actions/motion-sense.spec.md):
//
//   Physical space. Poses are rig-local — where you are in your real
//   room — never world. Locomotion moves the rig; a world-space
//   velocity would count that as you moving and pay for assists you
//   never earned.
//
//   Turn-immune extension. How far a hand is "out" is its offset from
//   an estimated torso point, measured along the body's facing. Turning
//   with an arm held out rotates both together and changes nothing.
//
//   Energy is earned by moving, not by looking. Motion energy rises
//   with head-relative hand speed and head travel, not head rotation,
//   so standing still and looking around stays near zero.
// ============================================================

import { defineTunables } from './tunables.js';
import { registerReadout } from './debug-hud.js';
import './debug-draw.js';

export var DEFAULT_MOTION_SETTINGS = {
  // Body frame.
  torsoDrop: 0.32, // m below the eyes to the torso reference point
  torsoBack: 0.08, // m behind the eyes along the facing (eyes sit forward of the spine)
  facingMs: 120, // smoothing time constant for the facing direction

  // Shoulders, for aiming along the arm: half the shoulder width out
  // from the body's centre line, this far below the eyes.
  shoulderHalfWidth: 0.18,
  shoulderDrop: 0.2,

  // Reach, until calibration exists: how far a typical adult's hand gets
  // from the torso point forward, up and to the side.
  reachForward: 0.62,
  reachUp: 0.6,
  reachSide: 0.6,

  // Velocity.
  velocityMs: 35, // smoothing time constant
  maxSpeed: 15, // m/s; anything faster is a tracking jump, not a hand
  maxGapMs: 250, // a longer frame gap restarts velocity instead of spanning it

  // Presented: a hand held out. Hysteresis on forward extension.
  presentOn: 0.55,
  presentOff: 0.42,

  // Motion energy. Each drive is 0 below its deadzone and 1 at "full".
  handDeadzone: 0.35, // m/s, head-relative
  handFull: 3.0,
  headDeadzone: 0.2, // m/s of head travel
  headFull: 1.6,
  energyRiseMs: 60, // attack: fast, so a punch's first 100 ms already counts
  energyFallMs: 700, // release: slow, so shadowboxing holds between punches

  historySeconds: 2, // samples kept for queries and recording
};

var SIDES = ['left', 'right'];

// ---------- small vector helpers (no THREE in the core) ----------

function v(x, y, z) { return { x: x || 0, y: y || 0, z: z || 0 }; }
function copyInto(out, a) { out.x = a.x; out.y = a.y; out.z = a.z; return out; }
function sub(a, b) { return v(a.x - b.x, a.y - b.y, a.z - b.z); }
function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
function clamp01(n) { return n < 0 ? 0 : n > 1 ? 1 : n; }
function smoothing(dtMs, tauMs) { return tauMs > 0 ? 1 - Math.exp(-dtMs / tauMs) : 1; }

// Forward (-Z) of a quaternion, flattened to the floor and normalised.
// Null when looking almost straight up or down, where it means nothing.
export function flatForward(q) {
  // Rotate (0,0,-1) by q.
  var x = -(2 * (q.x * q.z + q.w * q.y));
  var z = -(1 - 2 * (q.x * q.x + q.y * q.y));
  var l = Math.sqrt(x * x + z * z);
  if (l < 0.2) return null;
  return v(x / l, 0, z / l);
}

function yawOf(dir) { return Math.atan2(-dir.x, -dir.z); }

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function drive(speed, deadzone, full) {
  return clamp01((speed - deadzone) / Math.max(full - deadzone, 1e-6));
}

// ---------- state ----------

function createTrack() {
  return {
    position: v(),
    velocity: v(),
    speed: 0,
    hasPrevious: false,
    previous: v(),
    glitches: 0, // samples rejected as tracking jumps, ever
  };
}

function createHand() {
  var hand = createTrack();
  hand.tracked = false;
  hand.relativeVelocity = v();
  hand.relativeSpeed = 0;
  hand.offset = v(); // from the torso point
  hand.extension = { forward: 0, up: 0, side: 0, reach: 0 };
  hand.presented = false;
  return hand;
}

export function createMotionSense(settings) {
  var state = {
    settings: Object.assign({}, DEFAULT_MOTION_SETTINGS, settings || {}),
    t: null,
    dtMs: 0,
    head: createTrack(),
    left: createHand(),
    right: createHand(),
    facing: v(0, 0, -1),
    rightward: v(1, 0, 0), // body right, on the floor
    yaw: 0,
    yawRate: 0, // deg/s, signed, of the head (not the smoothed facing)
    headYaw: null, // the head's own yaw last frame, radians
    torso: v(),
    energy: 0,
    drive: { hand: 0, head: 0 },
    history: [],
  };
  return state;
}

export function setMotionSettings(state, partial) {
  Object.assign(state.settings, partial || {});
  return state.settings;
}

// One track's velocity from a new position. Gaps restart it; jumps
// faster than maxSpeed are rejected (the position is accepted as the
// new baseline, the velocity is not touched).
function updateTrack(track, position, dtMs, s) {
  var hadPrevious = track.hasPrevious;
  copyInto(track.previous, track.position);
  copyInto(track.position, position);
  track.hasPrevious = true;
  if (!hadPrevious || dtMs <= 0 || dtMs > s.maxGapMs) {
    track.velocity = v();
    track.speed = 0;
    return;
  }
  var dt = dtMs / 1000;
  var raw = v(
    (position.x - track.previous.x) / dt,
    (position.y - track.previous.y) / dt,
    (position.z - track.previous.z) / dt
  );
  if (len(raw) > s.maxSpeed) {
    track.glitches++;
    return;
  }
  var a = smoothing(dtMs, s.velocityMs);
  track.velocity.x += (raw.x - track.velocity.x) * a;
  track.velocity.y += (raw.y - track.velocity.y) * a;
  track.velocity.z += (raw.z - track.velocity.z) * a;
  track.speed = len(track.velocity);
}

function pushHistory(state, sample) {
  var history = state.history;
  history.push(cloneSample(sample));
  var horizon = sample.t - state.settings.historySeconds * 1000;
  var drop = 0;
  while (drop < history.length - 1 && history[drop].t < horizon) drop++;
  if (drop) history.splice(0, drop);
}

function clonePose(p) {
  if (!p) return null;
  return {
    position: copyInto(v(), p.position),
    quaternion: p.quaternion ? { x: p.quaternion.x, y: p.quaternion.y, z: p.quaternion.z, w: p.quaternion.w } : null,
    tracked: p.tracked !== false,
  };
}

// The recording format: { t, head, left, right }, each pose
// { position, quaternion, tracked }. Times are milliseconds.
export function cloneSample(sample) {
  return { t: sample.t, head: clonePose(sample.head), left: clonePose(sample.left), right: clonePose(sample.right) };
}

// Feed one frame. Returns the state, which holds every derived value.
export function updateMotionSense(state, sample) {
  var s = state.settings;
  var dtMs = state.t === null ? 0 : sample.t - state.t;
  state.t = sample.t;
  state.dtMs = dtMs;

  // Head and facing.
  var head = sample.head;
  updateTrack(state.head, head.position, dtMs, s);
  var forward = head.quaternion ? flatForward(head.quaternion) : null;
  if (forward) {
    var targetYaw = yawOf(forward);
    var previousYaw = state.yaw;
    if (dtMs <= 0 || dtMs > s.maxGapMs) {
      state.yaw = targetYaw;
      state.yawRate = 0;
    } else {
      // The head's own turn rate, unsmoothed, for budgets that pay for
      // rotation with rotation.
      state.yawRate = (wrapAngle(targetYaw - (state.headYaw === null ? targetYaw : state.headYaw)) / (dtMs / 1000)) * 180 / Math.PI;
      state.yaw = previousYaw + wrapAngle(targetYaw - previousYaw) * smoothing(dtMs, s.facingMs);
    }
    state.headYaw = targetYaw;
    state.yaw = wrapAngle(state.yaw);
  }
  state.facing = v(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  state.rightward = v(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  state.torso = v(
    head.position.x - state.facing.x * s.torsoBack,
    head.position.y - s.torsoDrop,
    head.position.z - state.facing.z * s.torsoBack
  );

  // Hands.
  var handDrive = 0;
  for (var i = 0; i < SIDES.length; i++) {
    var side = SIDES[i];
    var pose = sample[side];
    var hand = state[side];
    if (!pose || pose.tracked === false) {
      hand.tracked = false;
      hand.hasPrevious = false; // the next real sample starts fresh
      hand.velocity = v();
      hand.speed = 0;
      hand.relativeVelocity = v();
      hand.relativeSpeed = 0;
      hand.presented = false;
      continue;
    }
    hand.tracked = true;
    updateTrack(hand, pose.position, dtMs, s);
    hand.relativeVelocity = sub(hand.velocity, state.head.velocity);
    hand.relativeSpeed = len(hand.relativeVelocity);

    hand.offset = sub(hand.position, state.torso);
    var e = hand.extension;
    e.forward = dot(hand.offset, state.facing) / s.reachForward;
    e.up = hand.offset.y / s.reachUp;
    e.side = dot(hand.offset, state.rightward) / s.reachSide * (side === 'left' ? -1 : 1);
    e.reach = len(hand.offset) / s.reachForward;
    hand.presented = hand.presented ? e.forward > s.presentOff : e.forward > s.presentOn;

    handDrive = Math.max(handDrive, drive(hand.relativeSpeed, s.handDeadzone, s.handFull));
  }

  // Energy: the strongest drive, through a fast-attack slow-release
  // envelope.
  var headDrive = drive(state.head.speed, s.headDeadzone, s.headFull);
  state.drive.hand = handDrive;
  state.drive.head = headDrive;
  var target = Math.max(handDrive, headDrive);
  if (dtMs > 0 && dtMs <= s.maxGapMs) {
    var tau = target > state.energy ? s.energyRiseMs : s.energyFallMs;
    state.energy += (target - state.energy) * smoothing(dtMs, tau);
  } else if (dtMs > s.maxGapMs) {
    state.energy = 0;
  }

  pushHistory(state, sample);
  return state;
}

// Estimated shoulder for a side, from the head and the body facing.
export function shoulderOf(state, side) {
  var s = state.settings;
  var out = side === 'left' ? -1 : 1;
  var head = state.head.position;
  return v(
    head.x - state.facing.x * s.torsoBack + state.rightward.x * s.shoulderHalfWidth * out,
    head.y - s.shoulderDrop,
    head.z - state.facing.z * s.torsoBack + state.rightward.z * s.shoulderHalfWidth * out
  );
}

// Where an arm is pointing: from the shoulder through the hand. This is
// the aim for anything held out (README principle 1) — position only,
// so it works the same for controllers, hand tracking and desktop.
// Null when the hand is untracked or too close to the shoulder to mean
// a direction.
export function aimRay(state, side) {
  var hand = state[side];
  if (!hand || !hand.tracked) return null;
  var origin = shoulderOf(state, side);
  var d = sub(hand.position, origin);
  var l = len(d);
  if (l < 0.12) return null;
  return { origin: origin, hand: copyInto(v(), hand.position), direction: v(d.x / l, d.y / l, d.z / l), length: l };
}

// A compact multi-line summary for HUDs, sidecars and screenshots.
export function describeMotion(state) {
  function n(x, d) { return (Math.round(x * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function bar(x) {
    var filled = Math.round(clamp01(x) * 10);
    return '[' + '#'.repeat(filled) + '-'.repeat(10 - filled) + ']';
  }
  var lines = ['ENERGY ' + bar(state.energy) + ' ' + n(state.energy, 2) +
    '  (hand ' + n(state.drive.hand, 2) + ' head ' + n(state.drive.head, 2) + ')'];
  lines.push('head ' + n(state.head.speed, 2) + ' m/s  turn ' + Math.round(state.yawRate) + ' deg/s');
  SIDES.forEach(function (side) {
    var h = state[side];
    if (!h.tracked) { lines.push(side.charAt(0).toUpperCase() + ': --'); return; }
    var e = h.extension;
    lines.push(side.charAt(0).toUpperCase() + ': ' + n(h.relativeSpeed, 1) + ' m/s  fwd ' + pct(e.forward) +
      ' up ' + pct(e.up) + ' side ' + pct(e.side) + (h.presented ? '  PRESENTED' : ''));
  });
  return lines.join('\n');
}

// ============================================================
// A-Frame shell
// ============================================================

if (typeof AFRAME !== 'undefined' && !AFRAME.components['motion-sense']) {
  var THREE = AFRAME.THREE;
  var live = []; // every motion-sense component on the page

  // Every setting as a visor row (Tuning > Motion), applied to every
  // motion-sense on the page, with the live readout above the values.
  // Rows fit 14 characters, so labels are short and units ride the value.
  var tune = defineTunables('motion', 'Motion', [
    { key: 'handDeadzone', label: 'Hand min', value: DEFAULT_MOTION_SETTINGS.handDeadzone, min: 0, max: 2, step: 0.05 },
    { key: 'handFull', label: 'Hand max', value: DEFAULT_MOTION_SETTINGS.handFull, min: 0.5, max: 8, step: 0.25 },
    { key: 'headDeadzone', label: 'Head min', value: DEFAULT_MOTION_SETTINGS.headDeadzone, min: 0, max: 1, step: 0.05 },
    { key: 'headFull', label: 'Head max', value: DEFAULT_MOTION_SETTINGS.headFull, min: 0.3, max: 4, step: 0.1 },
    { key: 'energyRiseMs', label: 'Rise', value: DEFAULT_MOTION_SETTINGS.energyRiseMs, min: 10, max: 400, step: 10, unit: 'ms' },
    { key: 'energyFallMs', label: 'Fall', value: DEFAULT_MOTION_SETTINGS.energyFallMs, min: 100, max: 3000, step: 50, unit: 'ms' },
    { key: 'presentOn', label: 'Present', value: DEFAULT_MOTION_SETTINGS.presentOn, min: 20, max: 100, step: 5, unit: '%', scale: 100 },
    { key: 'presentOff', label: 'Lower', value: DEFAULT_MOTION_SETTINGS.presentOff, min: 10, max: 100, step: 5, unit: '%', scale: 100 },
    { key: 'reachForward', label: 'Reach', value: DEFAULT_MOTION_SETTINGS.reachForward, min: 30, max: 100, step: 1, unit: 'cm', scale: 100 },
    { key: 'torsoDrop', label: 'Torso', value: DEFAULT_MOTION_SETTINGS.torsoDrop, min: 10, max: 60, step: 1, unit: 'cm', scale: 100 },
  ], function (values) {
    live.forEach(function (component) { setMotionSettings(component.state, values); });
  }, {
    info: function () { return live.length ? describeMotion(live[0].state) : ''; },
  });

  registerReadout('motion', 'Motion', function () { return live.length ? describeMotion(live[0].state) : ''; });

  // On the rig. Reads the camera and both hands each frame in the rig's
  // own space (the physical room), and keeps the state on
  // this.state for anything that wants it.
  AFRAME.registerComponent('motion-sense', {
    schema: {
      camera: { type: 'selector' },
      leftHand: { type: 'selector' },
      rightHand: { type: 'selector' },
    },

    init: function () {
      this.state = createMotionSense(tune.values);
      this.rigInverse = new THREE.Matrix4();
      this.rigQuaternionInverse = new THREE.Quaternion();
      this.worldPosition = new THREE.Vector3();
      this.worldQuaternion = new THREE.Quaternion();
      this.scratchScale = new THREE.Vector3();
      this.scratchPosition = new THREE.Vector3();
      this.scratchA = new THREE.Vector3();
      this.scratchB = new THREE.Vector3();
      this.sample = {
        t: 0,
        head: { position: v(), quaternion: { x: 0, y: 0, z: 0, w: 1 }, tracked: true },
        left: { position: v(), quaternion: { x: 0, y: 0, z: 0, w: 1 }, tracked: false },
        right: { position: v(), quaternion: { x: 0, y: 0, z: 0, w: 1 }, tracked: false },
      };
      live.push(this);
    },

    remove: function () {
      var i = live.indexOf(this);
      if (i >= 0) live.splice(i, 1);
    },

    setSettings: function (partial) { return setMotionSettings(this.state, partial); },
    describe: function () { return describeMotion(this.state); },

    // Rig-local (physical) point -> world, into a THREE.Vector3.
    toWorld: function (p, out) {
      return (out || new THREE.Vector3()).set(p.x, p.y, p.z).applyMatrix4(this.el.object3D.matrixWorld);
    },

    // Rig-local direction -> world.
    directionToWorld: function (d, out) {
      var q = this.el.object3D.getWorldQuaternion(this.worldQuaternion);
      return (out || new THREE.Vector3()).set(d.x, d.y, d.z).applyQuaternion(q).normalize();
    },

    // The shoulder-to-hand aim for a side, in world space:
    // { origin, hand, direction } as THREE.Vector3s, or null.
    aimRayWorld: function (side) {
      var ray = aimRay(this.state, side);
      if (!ray) return null;
      return {
        origin: this.toWorld(ray.origin),
        hand: this.toWorld(ray.hand),
        direction: this.directionToWorld(ray.direction),
        length: ray.length,
      };
    },

    readPose: function (el, out) {
      if (!el || !el.object3D) { out.tracked = false; return; }
      el.object3D.updateMatrixWorld();
      el.object3D.matrixWorld.decompose(this.worldPosition, this.worldQuaternion, this.scratchScale);
      this.worldPosition.applyMatrix4(this.rigInverse);
      this.worldQuaternion.premultiply(this.rigQuaternionInverse);
      out.position.x = this.worldPosition.x;
      out.position.y = this.worldPosition.y;
      out.position.z = this.worldPosition.z;
      out.quaternion.x = this.worldQuaternion.x;
      out.quaternion.y = this.worldQuaternion.y;
      out.quaternion.z = this.worldQuaternion.z;
      out.quaternion.w = this.worldQuaternion.w;
      // Real dropout detection (hand tracking losing a hand) is not
      // here yet — see docs/actions/motion-sense.todo.md. Impossible
      // jumps are still rejected by the core.
      out.tracked = true;
    },

    tick: function (time) {
      var rig = this.el.object3D;
      rig.updateMatrixWorld();
      this.rigInverse.copy(rig.matrixWorld).invert();
      rig.matrixWorld.decompose(this.scratchPosition, this.rigQuaternionInverse, this.scratchScale);
      this.rigQuaternionInverse.invert();

      this.sample.t = time;
      this.readPose(this.data.camera, this.sample.head);
      this.readPose(this.data.leftHand, this.sample.left);
      this.readPose(this.data.rightHand, this.sample.right);
      updateMotionSense(this.state, this.sample);
      this.drawDebug();
    },

    // Draw > Motion: the torso point and facing, each shoulder-to-hand
    // aim line (green while presented), and each hand's head-relative
    // velocity as a short orange line.
    drawDebug: function () {
      var dd = this.el.sceneEl.systems['debug-draw'];
      if (!dd || !dd.on('motion')) return;
      var state = this.state;
      var torso = this.toWorld(state.torso, this.scratchA);
      dd.cross(torso, 0.08, '#ffffff');
      var facing = this.directionToWorld(state.facing, this.scratchB);
      dd.line(torso, { x: torso.x + facing.x * 0.4, y: torso.y, z: torso.z + facing.z * 0.4 }, '#ffffff');
      ['left', 'right'].forEach(function (side) {
        var ray = this.aimRayWorld(side);
        if (!ray) return;
        dd.line(ray.origin, ray.hand, state[side].presented ? '#5fe08a' : '#7f8aa8');
        var vel = this.directionToWorld(state[side].relativeVelocity, new THREE.Vector3());
        var speed = state[side].relativeSpeed * 0.1; // 10 cm per m/s
        dd.line(ray.hand, { x: ray.hand.x + vel.x * speed, y: ray.hand.y + vel.y * speed, z: ray.hand.z + vel.z * speed }, '#ffb547');
      }, this);
    },
  });
}
