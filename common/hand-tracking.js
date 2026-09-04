import { angleBetweenDegrees, isFingerGunPose, isHammerDropped } from './hand-gestures.js';

// `finger-gun-controls` is a WebXR-hand-tracking input SOURCE, the bare-hand
// equivalent of `oculus-touch-controls`: it drives its entity's pose and
// fires the same handful of named events real controller components fire
// (`gripdown`/`gripup`, `triggerdown`/`triggerup`, `controllerconnected`/
// `controllerdisconnected`) -- the small shared action vocabulary the rest
// of this codebase already treats as input-agnostic (`semantic-hand`'s
// grab/point handling in interaction-hints.js, the watch/menu fingertip
// cursor in watch-menu.js, and desktop-controls.js's own synthetic
// gripdown/gripup for a keyboard-driven hand all target these exact same
// event names, with none of them caring what actually produced them). Point
// with your index finger and cock your thumb up like a hammer to aim --
// this fires gripdown, exactly like squeezing a real grip button -- then
// drop the thumb until it's roughly parallel with the finger to fire --
// this fires triggerdown, exactly like pulling a real trigger. It doesn't
// know about menus, grabbing, or watches; it only knows how to recognize
// that gesture and speak the same events everything else already listens
// for, so any future experience can drop it onto a hand entity and get a
// real-hand pointer for free.
//
// This does its own direct WebXR Hand Input polling (frame.getJointPose)
// rather than reading A-Frame's own `hand-tracking-controls`: that
// component's per-joint data is a private implementation detail (an
// unlabeled Float32Array), where the joints read here are the standard,
// stable joint names from the WebXR Hand Input spec. A separate, purely
// decorative entity can still carry `hand-tracking-controls` for the
// rendered hand mesh -- see primitives/menus/index.html -- entirely
// decoupled from this component's own tracking.
AFRAME.registerComponent('finger-gun-controls', {
  schema: {
    hand: { default: 'right', oneOf: ['left', 'right'] },
    maxIndexCurlDegrees: { default: 40 },
    minThumbCockedDegrees: { default: 45 },
    maxHammerDroppedDegrees: { default: 25 },
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
    this.pointing = false;
    this.activated = false;
    this.referenceSpace = null;

    // Public, in world space, for anything that wants a real per-frame
    // pointer ray -- see watch-menu.js's use of this for the fingertip
    // laser -- rather than a fixed offset off the hand's own transform.
    this.pointerPosition = new THREE.Vector3();
    this.pointerDirection = new THREE.Vector3(0, 0, -1);

    this._wristPosition = new THREE.Vector3();
    this._wristQuaternion = new THREE.Quaternion();
    this._indexMetacarpal = new THREE.Vector3();
    this._indexProximal = new THREE.Vector3();
    this._indexTip = new THREE.Vector3();
    this._thumbMetacarpal = new THREE.Vector3();
    this._thumbTip = new THREE.Vector3();
    this._segmentA = new THREE.Vector3();
    this._segmentB = new THREE.Vector3();
    this._thumbVector = new THREE.Vector3();

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

  tick: function () {
    var frame = this.el.sceneEl.frame;
    var inputSource = this.referenceSpace && frame && this.findHandInputSource();
    if (!inputSource) {
      this.setPresent(false);
      return;
    }
    this.setPresent(true);

    var hand = inputSource.hand;
    var gotWrist = this.readJointPose(frame, hand, 'wrist', this._wristPosition, this._wristQuaternion);
    var gotIndexMeta = this.readJointPose(frame, hand, 'index-finger-metacarpal', this._indexMetacarpal);
    var gotIndexProx = this.readJointPose(frame, hand, 'index-finger-phalanx-proximal', this._indexProximal);
    var gotIndexTip = this.readJointPose(frame, hand, 'index-finger-tip', this._indexTip);
    var gotThumbMeta = this.readJointPose(frame, hand, 'thumb-metacarpal', this._thumbMetacarpal);
    var gotThumbTip = this.readJointPose(frame, hand, 'thumb-tip', this._thumbTip);

    if (gotWrist) {
      var handComponent = this.el.components['semantic-hand'];
      if (handComponent) handComponent.setWorldTransform(this._wristPosition, this._wristQuaternion, null, true);
    }

    if (!gotIndexMeta || !gotIndexProx || !gotIndexTip || !gotThumbMeta || !gotThumbTip) {
      this.setPointing(false);
      return;
    }

    this.pointerPosition.copy(this._indexTip);
    this.pointerDirection.copy(this._indexTip).sub(this._indexMetacarpal).normalize();

    this._segmentA.copy(this._indexProximal).sub(this._indexMetacarpal);
    this._segmentB.copy(this._indexTip).sub(this._indexProximal);
    var indexCurlDegrees = angleBetweenDegrees(
      this._segmentA.x, this._segmentA.y, this._segmentA.z,
      this._segmentB.x, this._segmentB.y, this._segmentB.z
    );

    this._thumbVector.copy(this._thumbTip).sub(this._thumbMetacarpal);
    var thumbIndexAngleDegrees = angleBetweenDegrees(
      this._thumbVector.x, this._thumbVector.y, this._thumbVector.z,
      this.pointerDirection.x, this.pointerDirection.y, this.pointerDirection.z
    );

    var pointing = isFingerGunPose(indexCurlDegrees, thumbIndexAngleDegrees, this.data);
    this.setPointing(pointing);
    this.setActivated(pointing && isHammerDropped(thumbIndexAngleDegrees, this.data));
  },

  setPresent: function (present) {
    if (present === this.present) return;
    this.present = present;
    this.el.emit(present ? 'controllerconnected' : 'controllerdisconnected', { name: 'finger-gun-controls' }, false);
    if (!present) this.setPointing(false);
  },

  setPointing: function (pointing) {
    if (pointing === this.pointing) return;
    this.pointing = pointing;
    this.el.emit(pointing ? 'gripdown' : 'gripup', null, false);
    if (!pointing) this.setActivated(false);
  },

  setActivated: function (activated) {
    if (activated === this.activated) return;
    this.activated = activated;
    this.el.emit(activated ? 'triggerdown' : 'triggerup', null, false);
  },

  remove: function () {
    this.el.sceneEl.removeEventListener('enter-vr', this.onSessionChanged);
    this.el.sceneEl.removeEventListener('exit-vr', this.onSessionChanged);
  },
});
