import './control-mode.js';
import { updateArmSwingState, ARM_SWING_DEFAULTS } from './arm-swing.js';

function xrIsPresenting(sceneEl) {
  var controlMode = sceneEl && sceneEl.systems && sceneEl.systems['control-mode'];
  return Boolean(controlMode && controlMode.isMode('xr'));
}

// Bare-bones walking locomotion driven entirely by swinging your arms --
// no joystick, no teleport button. Each arm's forward swing takes one
// step and slides the rig forward (in whatever direction the camera is
// currently facing) by `stepDistance`, gated by updateArmSwingState's
// bilateral-alternation check (common/arm-swing.js): only a genuine,
// opposite-phase swing of BOTH arms counts, which is what keeps reaching
// for something, pointing, or just gesturing with one hand from ever
// moving the player. This is explicitly a "let's try it" experiment, not
// a tuned/validated locomotion scheme -- the three schema knobs below are
// exactly the ones worth adjusting on a real headset before trusting it.
//
// Reads leftHand/rightHand's own world position every frame, so it works
// regardless of what's actually driving them -- Touch controllers,
// hand-gesture-controls (common/hand-tracking.js), or anything else that
// moves those entities -- the same "don't care what produced the input,
// only the shared shape of it" spirit as the rest of this project's
// locomotion and semantic-hand code. XR-only: there's no desktop
// equivalent of swinging your arms, so this does nothing outside a real
// XR session.
AFRAME.registerComponent('arm-swing-locomotion', {
  schema: {
    leftHand: { type: 'selector' },
    rightHand: { type: 'selector' },
    camera: { type: 'selector' },
    stepDistance: { default: 0.7 },
    armThreshold: { default: ARM_SWING_DEFAULTS.armThreshold },
    enabled: { default: true },
  },

  init: function () {
    var THREE = AFRAME.THREE;
    this.leftState = { armed: false };
    this.rightState = { armed: false };

    this._shoulderPosition = new THREE.Vector3();
    this._shoulderOffset = new THREE.Vector3();
    this._handPosition = new THREE.Vector3();
    this._toHand = new THREE.Vector3();
    this._cameraPosition = new THREE.Vector3();
    this._cameraQuaternion = new THREE.Quaternion();
    this._cameraEuler = new THREE.Euler();
    this._forward = new THREE.Vector3();
    this._upAxis = new THREE.Vector3(0, 1, 0);
    this._step = new THREE.Vector3();
  },

  setEnabled: function (enabled) {
    this.data.enabled = Boolean(enabled);
  },

  // Mirrors semantic-hand's own getShoulderWorldPosition approximation
  // (interaction-hints.js) -- duplicated rather than shared so this
  // component has no hard dependency on semantic-hand being present at
  // all, only on a hand entity's position and the camera. Yaw-only (not
  // the camera's full orientation): looking up or down shouldn't move
  // where your shoulders are.
  computeForwardOffset: function (handEl, side) {
    var signedSide = side === 'left' ? -1 : 1;
    this._shoulderOffset.set(signedSide * 0.19, -0.17, 0.02);
    this._shoulderOffset.applyAxisAngle(this._upAxis, this._cameraEuler.y);
    this._shoulderPosition.copy(this._cameraPosition).add(this._shoulderOffset);

    handEl.object3D.getWorldPosition(this._handPosition);
    this._toHand.copy(this._handPosition).sub(this._shoulderPosition);
    return this._toHand.dot(this._forward);
  },

  takeStep: function () {
    this._step.copy(this._forward).multiplyScalar(this.data.stepDistance);
    this.el.object3D.position.add(this._step);
    this.el.emit('arm-swing-step', null, false);
  },

  tick: function () {
    if (!this.data.enabled || !xrIsPresenting(this.el.sceneEl)) return;
    var cameraEl = this.data.camera;
    var leftHand = this.data.leftHand;
    var rightHand = this.data.rightHand;
    if (!cameraEl || !leftHand || !rightHand) return;

    cameraEl.object3D.getWorldPosition(this._cameraPosition);
    cameraEl.object3D.getWorldQuaternion(this._cameraQuaternion);
    this._cameraEuler.setFromQuaternion(this._cameraQuaternion, 'YXZ');
    this._forward.set(0, 0, -1).applyAxisAngle(this._upAxis, this._cameraEuler.y).normalize();

    var leftOffset = this.computeForwardOffset(leftHand, 'left');
    var rightOffset = this.computeForwardOffset(rightHand, 'right');

    this.leftState = updateArmSwingState(this.leftState, leftOffset, rightOffset, this.data);
    this.rightState = updateArmSwingState(this.rightState, rightOffset, leftOffset, this.data);

    if (this.leftState.stepped || this.rightState.stepped) this.takeStep();
  },
});
