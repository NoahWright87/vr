import './control-mode.js';
import './interaction-hints.js';
import { chargedActionStrength } from './desktop-action-utils.js';

export { chargedActionStrength } from './desktop-action-utils.js';

// Architectural direction: eventually every practical shared VR interaction
// should also be usable and testable on a laptop. VR commands hands physically;
// desktop input expresses intent and lets shared semantic hands perform the
// corresponding motion. New games should consume the intent events below
// instead of branching their gameplay rules on an XR-versus-desktop check.

function registerDesktopInputComponents() {
  if (typeof AFRAME === 'undefined') return;
  var THREE = AFRAME.THREE;

  function isDesktop(sceneEl) {
    var mode = sceneEl && sceneEl.systems && sceneEl.systems['control-mode'];
    return Boolean(mode && mode.isMode('desktop'));
  }

  function isEditable(target) {
    if (!target || !target.closest) return false;
    return Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"]'));
  }

  function isCanvasInput(evt, sceneEl) {
    var canvas = sceneEl && sceneEl.canvas;
    return Boolean(canvas && (evt.target === canvas || document.pointerLockElement === canvas));
  }

  AFRAME.registerComponent('desktop-movement-input', {
    schema: {
      enabled: { default: true },
    },

    init: function () {
      this.keys = {};
      this.onKeyDown = this.onKeyDown.bind(this);
      this.onKeyUp = this.onKeyUp.bind(this);
      this.onBlur = this.onBlur.bind(this);
      window.addEventListener('keydown', this.onKeyDown);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
    },

    onKeyDown: function (evt) {
      if (isEditable(evt.target)) return;
      this.keys[evt.code] = true;
    },

    onKeyUp: function (evt) {
      this.keys[evt.code] = false;
    },

    onBlur: function () {
      this.keys = {};
    },

    tick: function (time, delta) {
      if (!this.data.enabled || !delta || !isDesktop(this.el.sceneEl)) return;
      var x = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
      var z = (this.keys.KeyS ? 1 : 0) - (this.keys.KeyW ? 1 : 0);
      if (!x && !z) return;
      var length = Math.hypot(x, z);
      this.el.emit('semantic-move', {
        x: x / length,
        z: z / length,
        deltaMs: delta,
        source: 'desktop',
      }, false);
    },

    remove: function () {
      window.removeEventListener('keydown', this.onKeyDown);
      window.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
    },
  });

  AFRAME.registerComponent('desktop-action-input', {
    schema: {
      primaryAction: { default: 'primary' },
      secondaryAction: { default: 'secondary' },
      leftHand: { type: 'selector' },
      rightHand: { type: 'selector' },
      dominantHand: { default: 'right', oneOf: ['left', 'right'] },
      alternateHands: { default: true },
      chargeMs: { default: 900 },
      minimumStrength: { default: 0.35 },
    },

    init: function () {
      this.active = new Map();
      this.nextHand = this.data.dominantHand;
      this.onMouseDown = this.onMouseDown.bind(this);
      this.onMouseUp = this.onMouseUp.bind(this);
      this.onContextMenu = this.onContextMenu.bind(this);
      this.cancelAll = this.cancelAll.bind(this);
      document.addEventListener('mousedown', this.onMouseDown, true);
      document.addEventListener('mouseup', this.onMouseUp, true);
      document.addEventListener('contextmenu', this.onContextMenu, true);
      window.addEventListener('blur', this.cancelAll);
      this.el.sceneEl.addEventListener('control-mode-changed', this.cancelAll);
    },

    getAction: function (button) {
      if (button === 0) return this.data.primaryAction;
      if (button === 2) return this.data.secondaryAction;
      return '';
    },

    chooseHand: function () {
      var side = this.nextHand;
      var handEl = side === 'left' ? this.data.leftHand : this.data.rightHand;
      if (!handEl) {
        side = side === 'left' ? 'right' : 'left';
        handEl = side === 'left' ? this.data.leftHand : this.data.rightHand;
      }
      if (this.data.alternateHands) this.nextHand = side === 'left' ? 'right' : 'left';
      return handEl;
    },

    emitIntent: function (action, phase, button, handEl, heldMs) {
      this.el.emit('semantic-action-intent', {
        action: action,
        phase: phase,
        button: button,
        handEl: handEl,
        heldMs: heldMs,
        strength: chargedActionStrength(heldMs, this.data.chargeMs, this.data.minimumStrength),
        source: 'desktop',
      }, false);
    },

    onMouseDown: function (evt) {
      var action = this.getAction(evt.button);
      if (!action || evt.repeat || this.active.has(evt.button) || !isDesktop(this.el.sceneEl)) return;
      if (!isCanvasInput(evt, this.el.sceneEl)) return;
      var handEl = this.chooseHand();
      var startedAt = performance.now();
      this.active.set(evt.button, { action: action, handEl: handEl, startedAt: startedAt });
      this.emitIntent(action, 'start', evt.button, handEl, 0);
      if (evt.button === 2) evt.preventDefault();
    },

    onMouseUp: function (evt) {
      var pending = this.active.get(evt.button);
      if (!pending) return;
      this.active.delete(evt.button);
      var heldMs = Math.max(0, performance.now() - pending.startedAt);
      this.emitIntent(pending.action, 'perform', evt.button, pending.handEl, heldMs);
      if (evt.button === 2) evt.preventDefault();
    },

    onContextMenu: function (evt) {
      if (isDesktop(this.el.sceneEl) && isCanvasInput(evt, this.el.sceneEl)) evt.preventDefault();
    },

    cancelAll: function () {
      var self = this;
      this.active.forEach(function (pending, button) {
        self.emitIntent(pending.action, 'cancel', button, pending.handEl, 0);
      });
      this.active.clear();
    },

    remove: function () {
      document.removeEventListener('mousedown', this.onMouseDown, true);
      document.removeEventListener('mouseup', this.onMouseUp, true);
      document.removeEventListener('contextmenu', this.onContextMenu, true);
      window.removeEventListener('blur', this.cancelAll);
      this.el.sceneEl.removeEventListener('control-mode-changed', this.cancelAll);
    },
  });

  AFRAME.registerComponent('desktop-hand-presence', {
    schema: {
      camera: { type: 'selector' },
      leftHand: { type: 'selector' },
      rightHand: { type: 'selector' },
      forward: { default: 0.5 },
      down: { default: 0.22 },
      spread: { default: 0.24 },
    },

    init: function () {
      this.cameraPosition = new THREE.Vector3();
      this.cameraQuaternion = new THREE.Quaternion();
      this.handPosition = new THREE.Vector3();
      this.handQuaternion = new THREE.Quaternion();
      this.offset = new THREE.Vector3();
    },

    placeHand: function (handEl, side) {
      if (!handEl || handEl.hasAttribute('data-semantic-action-active')) return;
      var hand = handEl.components['semantic-hand'];
      if (!hand || hand.activeMotion) return;
      this.offset.set(side * this.data.spread, -this.data.down, -this.data.forward);
      this.handPosition.copy(this.offset).applyQuaternion(this.cameraQuaternion).add(this.cameraPosition);
      this.handQuaternion.copy(this.cameraQuaternion);
      hand.setWorldTransform(this.handPosition, this.handQuaternion, 'Open', false);
    },

    tick: function () {
      if (!isDesktop(this.el.sceneEl) || !this.data.camera) return;
      this.data.camera.object3D.getWorldPosition(this.cameraPosition);
      this.data.camera.object3D.getWorldQuaternion(this.cameraQuaternion);
      this.placeHand(this.data.leftHand, -1);
      this.placeHand(this.data.rightHand, 1);
    },
  });

}

registerDesktopInputComponents();
