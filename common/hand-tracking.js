import {
  angleBetweenDegrees,
  classifyHandGesture,
  gestureDrivesGrip,
  gestureDrivesTrigger,
  GESTURES,
  GESTURE_LABELS,
} from './hand-gestures.js';

var FINGER_JOINTS = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-tip'],
  index: ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-tip'],
  ring: ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-tip'],
  pinky: ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-tip'],
};
var FINGER_NAMES = Object.keys(FINGER_JOINTS);

// `hand-gesture-controls` is a WebXR-hand-tracking input SOURCE, the
// bare-hand equivalent of `oculus-touch-controls`: it drives its entity's
// pose and fires the same handful of named events real controller
// components fire (`gripdown`/`gripup`, `triggerdown`/`triggerup`,
// `controllerconnected`/`controllerdisconnected`) -- the small shared
// action vocabulary the rest of this codebase already treats as
// input-agnostic (`semantic-hand`'s grab/point handling in
// interaction-hints.js, the watch/menu fingertip cursor in
// watch-menu.js, and desktop-controls.js's own synthetic gripdown/gripup
// for a keyboard-driven hand all target these exact same event names,
// with none of them caring what actually produced them).
//
// Underneath, it classifies the tracked hand's shape every frame into one
// of a small, named catalog of canonical gestures (common/hand-gestures.js)
// and emits a generic `gesture-changed` event whenever that classification
// changes -- see `gesture-hud` below for a debug display, but any
// future experience can listen for the same event and map whichever
// gestures it cares about onto its own actions, without needing to touch
// this component at all. Only two gestures currently drive the shared
// grip/trigger vocabulary (see gestureDrivesGrip/gestureDrivesTrigger in
// hand-gestures.js): a pinch (thumb and index touching) grabs or holds the
// way squeezing a real grip button does, and a "finger gun" -- point your
// index finger, cock your thumb up like a hammer to aim, drop it until
// it's roughly parallel with the finger to fire -- points and clicks the
// way grip-then-trigger does. The rest (okay, thumbs up/down) are
// recognized and labeled but not wired to anything yet.
//
// This does its own direct WebXR Hand Input polling (frame.getJointPose)
// rather than reading A-Frame's own `hand-tracking-controls`: that
// component's per-joint data is a private implementation detail (an
// unlabeled Float32Array), where the joints read here are the standard,
// stable joint names from the WebXR Hand Input spec. A separate, purely
// decorative entity can still carry `hand-tracking-controls` for the
// rendered hand mesh -- see primitives/menus/index.html -- entirely
// decoupled from this component's own tracking.
AFRAME.registerComponent('hand-gesture-controls', {
  schema: {
    hand: { default: 'right', oneOf: ['left', 'right'] },
    curledMaxDegrees: { default: 40 },
    curledMinDegrees: { default: 55 },
    pinchMaxDistance: { default: 0.025 },
    maxHammerDroppedDegrees: { default: 25 },
    thumbAlignMaxDegrees: { default: 40 },
  },

  init: function () {
    var THREE = AFRAME.THREE;
    var sceneEl = this.el.sceneEl;

    // Same opt-in as A-Frame's own hand-tracking-controls: ask WebXR for
    // hand joint data if the page didn't already request it.
    var webxrData = sceneEl.getAttribute('webxr');
    if (webxrData.optionalFeatures.indexOf('hand-tracking') === -1) {
      webxrData.optionalFeatures.push('hand-tracking');
      sceneEl.setAttribute('webxr', webxrData);
    }

    this.present = false;
    this.gesture = GESTURES.NONE;
    this.gripActive = false;
    this.triggerActive = false;
    this.referenceSpace = null;

    // Public, in world space, for anything that wants a real per-frame
    // pointer ray -- see watch-menu.js's use of this for the fingertip
    // laser -- rather than a fixed offset off the hand's own transform.
    this.pointerPosition = new THREE.Vector3();
    this.pointerDirection = new THREE.Vector3(0, 0, -1);

    this._wristPosition = new THREE.Vector3();
    this._wristQuaternion = new THREE.Quaternion();
    // WebXR's wrist joint orientation follows the Hand Input spec's own
    // bone convention (-Z local = distal, along the bone toward the
    // fingers; -Y local = dorsal, perpendicular to the skin and outward
    // from the palm) -- a completely different convention from a Touch
    // controller's grip pose, which is what hand-with-watch's watch
    // geometry (band + face) is actually built against. Fed the raw
    // wrist quaternion uncorrected, the band ends up encircling the
    // wrong axis entirely and the face points out to the side instead
    // of off the back of the hand. This fixed per-hand correction
    // (derived and checked numerically against both hands across
    // several poses -- band-to-forearm and face-to-dorsal alignment
    // both land within floating-point error of 0) rotates a raw wrist
    // pose into one indistinguishable, as far as
    // hand-with-watch/semantic-hand are concerned, from a real Touch
    // controller's grip pose for the same physical hand position.
    var side = this.data.hand === 'left' ? 1 : -1;
    this._wristCorrection = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side * Math.PI / 2));
    this._segmentA = new THREE.Vector3();
    this._segmentB = new THREE.Vector3();
    this._thumbVector = new THREE.Vector3();

    // One { metacarpal, proximal, tip } group of scratch vectors per
    // finger, keyed the same as FINGER_JOINTS/FINGER_NAMES above.
    this._fingers = {};
    FINGER_NAMES.forEach(function (name) {
      this._fingers[name] = {
        metacarpal: new THREE.Vector3(),
        proximal: new THREE.Vector3(),
        tip: new THREE.Vector3(),
      };
    }, this);

    this.onSessionChanged = this.onSessionChanged.bind(this);
    sceneEl.addEventListener('enter-vr', this.onSessionChanged);
    sceneEl.addEventListener('exit-vr', this.onSessionChanged);
  },

  onSessionChanged: function () {
    var self = this;
    var sceneEl = this.el.sceneEl;
    var xrSession = sceneEl.xrSession;
    this.referenceSpace = null;
    if (!xrSession) return;
    var spaceType = sceneEl.systems.webxr.sessionReferenceSpaceType;
    xrSession.requestReferenceSpace(spaceType).then(function (space) {
      self.referenceSpace = space;
    }).catch(function () {
      // No hand tracking this session (e.g. a browser/runtime that
      // doesn't support it) -- tick() below already no-ops without a
      // reference space, so there's nothing further to do here.
    });
  },

  findHandInputSource: function () {
    var session = this.el.sceneEl.xrSession;
    if (!session) return null;
    var sources = session.inputSources;
    for (var i = 0; i < sources.length; i++) {
      if (sources[i].hand && sources[i].handedness === this.data.hand) return sources[i];
    }
    return null;
  },

  // Reads one named joint's world position (and, for the wrist,
  // orientation too) into the given THREE objects. Returns false without
  // touching them if that joint's pose isn't available this frame (a
  // WebXR runtime can legitimately lose tracking of individual joints,
  // e.g. ones briefly hidden from the cameras).
  readJointPose: function (frame, hand, jointName, position, quaternion) {
    var jointSpace = hand.get(jointName);
    if (!jointSpace) return false;
    var pose = frame.getJointPose(jointSpace, this.referenceSpace);
    if (!pose) return false;
    var p = pose.transform.position;
    position.set(p.x, p.y, p.z);
    if (quaternion) {
      var o = pose.transform.orientation;
      quaternion.set(o.x, o.y, o.z, o.w);
    }
    return true;
  },

  // Reads a finger's three tracked joints and returns its curl angle in
  // degrees (the angle between its two segments -- 0 straight, larger the
  // more it's bent), or null if any of the three isn't available.
  readFingerCurl: function (frame, hand, fingerName) {
    var joints = FINGER_JOINTS[fingerName];
    var scratch = this._fingers[fingerName];
    var got =
      this.readJointPose(frame, hand, joints[0], scratch.metacarpal) &&
      this.readJointPose(frame, hand, joints[1], scratch.proximal) &&
      this.readJointPose(frame, hand, joints[2], scratch.tip);
    if (!got) return null;
    this._segmentA.copy(scratch.proximal).sub(scratch.metacarpal);
    this._segmentB.copy(scratch.tip).sub(scratch.proximal);
    return angleBetweenDegrees(
      this._segmentA.x, this._segmentA.y, this._segmentA.z,
      this._segmentB.x, this._segmentB.y, this._segmentB.z
    );
  },

  tick: function () {
    var frame = this.el.sceneEl.frame;
    var inputSource = this.referenceSpace && frame && this.findHandInputSource();
    if (!inputSource) {
      this.setPresent(false);
      return;
    }
    this.setPresent(true);

    var hand = inputSource.hand;
    if (this.readJointPose(frame, hand, 'wrist', this._wristPosition, this._wristQuaternion)) {
      var handComponent = this.el.components['semantic-hand'];
      if (handComponent) {
        this._wristQuaternion.multiply(this._wristCorrection);
        handComponent.setLocalTransform(this._wristPosition, this._wristQuaternion, null, true);
      }
    }

    var curl = {};
    var complete = true;
    FINGER_NAMES.forEach(function (name) {
      var degrees = this.readFingerCurl(frame, hand, name);
      if (degrees === null) complete = false;
      curl[name] = degrees;
    }, this);
    if (!complete) {
      this.setGesture(GESTURES.NONE);
      return;
    }

    var index = this._fingers.index;
    var thumb = this._fingers.thumb;
    this.pointerPosition.copy(index.tip);
    this.pointerDirection.copy(index.tip).sub(index.metacarpal).normalize();

    this._thumbVector.copy(thumb.tip).sub(thumb.metacarpal);
    var thumbIndexAngleDegrees = angleBetweenDegrees(
      this._thumbVector.x, this._thumbVector.y, this._thumbVector.z,
      this.pointerDirection.x, this.pointerDirection.y, this.pointerDirection.z
    );
    var thumbWorldUpAngleDegrees = angleBetweenDegrees(
      this._thumbVector.x, this._thumbVector.y, this._thumbVector.z,
      0, 1, 0
    );

    var gesture = classifyHandGesture({
      curl: curl,
      thumbIndexDistance: thumb.tip.distanceTo(index.tip),
      thumbIndexAngleDegrees: thumbIndexAngleDegrees,
      thumbWorldUpAngleDegrees: thumbWorldUpAngleDegrees,
    }, this.data);
    this.setGesture(gesture);
  },

  // A clean, by-value snapshot of everything this hand currently knows,
  // for anything that needs to buffer it over time (the gesture recorder,
  // common/gesture-recorder.js) rather than read the live tracking state
  // frame by frame -- the fields above (_wristPosition, _fingers, ...) are
  // scratch objects this component mutates in place every tick, so a
  // caller holding onto them directly would see every buffered "sample"
  // silently become whatever the hand is doing right now.
  getSample: function () {
    if (!this.present) return null;
    var wristPosition = this._wristPosition;
    var wristQuaternion = this._wristQuaternion;
    var fingers = {};
    FINGER_NAMES.forEach(function (name) {
      var joints = this._fingers[name];
      fingers[name] = {
        metacarpal: { x: joints.metacarpal.x, y: joints.metacarpal.y, z: joints.metacarpal.z },
        proximal: { x: joints.proximal.x, y: joints.proximal.y, z: joints.proximal.z },
        tip: { x: joints.tip.x, y: joints.tip.y, z: joints.tip.z },
      };
    }, this);
    return {
      wristPosition: { x: wristPosition.x, y: wristPosition.y, z: wristPosition.z },
      wristQuaternion: { x: wristQuaternion.x, y: wristQuaternion.y, z: wristQuaternion.z, w: wristQuaternion.w },
      fingers: fingers,
      gesture: this.gesture,
    };
  },

  setPresent: function (present) {
    if (present === this.present) return;
    this.present = present;
    this.el.emit(present ? 'controllerconnected' : 'controllerdisconnected', { name: 'hand-gesture-controls' }, false);
    if (!present) this.setGesture(GESTURES.NONE);
  },

  setGesture: function (gesture) {
    if (gesture !== this.gesture) {
      this.gesture = gesture;
      this.el.emit('gesture-changed', { gesture: gesture, label: GESTURE_LABELS[gesture] || gesture }, false);
    }
    this.setGripActive(gestureDrivesGrip(gesture));
    this.setTriggerActive(gestureDrivesTrigger(gesture));
  },

  setGripActive: function (active) {
    if (active === this.gripActive) return;
    this.gripActive = active;
    this.el.emit(active ? 'gripdown' : 'gripup', null, false);
    if (!active) this.setTriggerActive(false);
  },

  setTriggerActive: function (active) {
    if (active === this.triggerActive) return;
    this.triggerActive = active;
    this.el.emit(active ? 'triggerdown' : 'triggerup', null, false);
  },

  remove: function () {
    this.el.sceneEl.removeEventListener('enter-vr', this.onSessionChanged);
    this.el.sceneEl.removeEventListener('exit-vr', this.onSessionChanged);
  },
});

// A page-wide on/off switch for gesture-hud below, flipped from a
// watch/menu row -- see primitives/hand-tracking/index.html for the
// wiring. A system rather than component-local state so one menu toggle
// can reach every HUD slot at once.
AFRAME.registerSystem('hand-gesture-labels', {
  init: function () {
    this.enabled = true;
  },

  setEnabled: function (enabled) {
    this.enabled = Boolean(enabled);
  },
});

var HUD_SLOT_POSITIONS = {
  left: { x: -0.32, y: -0.22, z: -0.6 },
  right: { x: 0.32, y: -0.22, z: -0.6 },
  center: { x: 0, y: -0.26, z: -0.6 },
  top: { x: 0, y: 0.28, z: -0.6 },
};

// Optional debug readout for anything that emits `gesture-changed`
// (hand-gesture-controls above, arm-swing-locomotion's own step
// announcements, or common/gesture-recorder.js's status line): a fixed
// slot in a Halo-style visor HUD -- bottom-left, bottom-right,
// bottom-center, or top-center -- per-hand vs. whole-body vs. recorder
// status -- rather than a
// label floating in the 3D scene, which reads as far more obtrusive since
// it competes with everything else at world scale and follows the hand
// into your peripheral vision. A HUD slot is a plain child of the camera
// at a fixed local offset (the same "attach straight to <a-camera>, no
// extra rotation needed" convention Cube Pop's own hud-text already
// uses), so it simply never moves on screen regardless of where the
// source entity's hand or body actually is. Entirely decoupled from
// gesture recognition itself -- it only listens for the generic
// `gesture-changed` event on its own entity -- so leaving it off doesn't
// change any gameplay behavior, and a future experience can build its own
// display (or none) against the same event.
AFRAME.registerComponent('gesture-hud', {
  schema: {
    slot: { default: 'left', oneOf: ['left', 'right', 'center', 'top'] },
  },

  init: function () {
    this.system = this.el.sceneEl.systems['hand-gesture-labels'];
    this.gesture = GESTURES.NONE;

    var cameraEl = this.el.sceneEl.camera && this.el.sceneEl.camera.el;
    var host = cameraEl || this.el.sceneEl;
    var slotPosition = HUD_SLOT_POSITIONS[this.data.slot];

    var plate = document.createElement('a-plane');
    plate.setAttribute('geometry', 'primitive: plane; width: 0.34; height: 0.09');
    plate.setAttribute('material', 'color: #080b12; opacity: 0.8; transparent: true; shader: flat; side: double; depthTest: false');
    plate.setAttribute('position', slotPosition);
    plate.object3D.visible = false;
    host.appendChild(plate);
    this.plateEl = plate;

    var text = document.createElement('a-text');
    text.setAttribute('align', 'center');
    text.setAttribute('color', '#8de5ff');
    text.setAttribute('width', 0.9);
    text.setAttribute('wrap-count', 20);
    text.setAttribute('position', '0 0 0.006');
    plate.appendChild(text);
    this.textEl = text;

    this.onGestureChanged = this.onGestureChanged.bind(this);
    this.el.addEventListener('gesture-changed', this.onGestureChanged);
  },

  onGestureChanged: function (evt) {
    this.gesture = evt.detail.gesture;
    this.textEl.setAttribute('text', 'value', evt.detail.label);
  },

  tick: function () {
    this.plateEl.object3D.visible = Boolean(this.system.enabled && this.gesture !== GESTURES.NONE);
  },

  remove: function () {
    this.el.removeEventListener('gesture-changed', this.onGestureChanged);
    if (this.plateEl.parentNode) this.plateEl.parentNode.removeChild(this.plateEl);
  },
});
