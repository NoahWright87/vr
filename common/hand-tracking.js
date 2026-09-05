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
// changes -- see `hand-gesture-label` below for a debug display, but any
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
      if (handComponent) handComponent.setWorldTransform(this._wristPosition, this._wristQuaternion, null, true);
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

// A page-wide on/off switch for hand-gesture-label below, flipped from a
// watch/menu row -- see primitives/hand-tracking/index.html for the
// wiring. A system rather than component-local state so one menu toggle
// can reach every hand's label at once.
AFRAME.registerSystem('hand-gesture-labels', {
  init: function () {
    this.enabled = true;
  },

  setEnabled: function (enabled) {
    this.enabled = Boolean(enabled);
  },
});

// Optional debug readout for `hand-gesture-controls`: a small billboarded
// label that floats above the hand showing whichever canonical gesture is
// currently recognized ("Pinch", "Finger Gun (fired)", ...), or nothing
// when the hand isn't making any recognized shape. Entirely decoupled from
// gesture recognition itself -- it only listens for the generic
// `gesture-changed` event -- so leaving it off doesn't change any
// gameplay behavior, and a future experience can build its own display
// (or none) against the same event.
AFRAME.registerComponent('hand-gesture-label', {
  schema: {
    offset: { type: 'vec3', default: { x: 0, y: 0.12, z: 0 } },
  },

  init: function () {
    var THREE = AFRAME.THREE;
    this.system = this.el.sceneEl.systems['hand-gesture-labels'];
    this.gesture = GESTURES.NONE;

    var background = document.createElement('a-plane');
    background.setAttribute('geometry', 'primitive: plane; width: 0.6; height: 0.13');
    background.setAttribute('material', 'color: #080b12; opacity: 0.82; transparent: true; shader: flat; side: double');
    background.object3D.visible = false;
    this.el.sceneEl.appendChild(background);
    this.backgroundEl = background;

    var text = document.createElement('a-text');
    text.setAttribute('align', 'center');
    text.setAttribute('color', '#8de5ff');
    text.setAttribute('width', 1.05);
    text.setAttribute('wrap-count', 22);
    text.setAttribute('position', '0 0 0.006');
    background.appendChild(text);
    this.textEl = text;

    this.onGestureChanged = this.onGestureChanged.bind(this);
    this.el.addEventListener('gesture-changed', this.onGestureChanged);

    this._labelPosition = new THREE.Vector3();
    this._cameraPosition = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    // The plate's local front face (where its child <a-text> reads
    // correctly, not mirrored) is +Z at identity rotation -- the usual
    // A-Frame plane/text convention.
    this._plateForward = new THREE.Vector3(0, 0, 1);
  },

  onGestureChanged: function (evt) {
    this.gesture = evt.detail.gesture;
    this.textEl.setAttribute('text', 'value', evt.detail.label);
  },

  tick: function () {
    var visible = Boolean(this.system.enabled && this.gesture !== GESTURES.NONE);
    this.backgroundEl.object3D.visible = visible;
    if (!visible) return;

    this.el.object3D.getWorldPosition(this._labelPosition);
    this._labelPosition.add(this.data.offset);
    this.backgroundEl.object3D.position.copy(this._labelPosition);

    var cameraEl = this.el.sceneEl.camera && this.el.sceneEl.camera.el;
    if (!cameraEl) return;
    cameraEl.object3D.getWorldPosition(this._cameraPosition);
    this._forward.copy(this._cameraPosition).sub(this._labelPosition).normalize();
    this.backgroundEl.object3D.quaternion.setFromUnitVectors(this._plateForward, this._forward);
  },

  remove: function () {
    this.el.removeEventListener('gesture-changed', this.onGestureChanged);
    if (this.backgroundEl.parentNode) this.backgroundEl.parentNode.removeChild(this.backgroundEl);
  },
});
