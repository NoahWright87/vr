import './input-router.js';
import './interaction-hints.js';

var THREE = AFRAME.THREE;
var PREFERENCES_KEY = 'vr-showcase-player-preferences-v1';

function xrIsPresenting(sceneEl) {
  var controlMode = sceneEl && sceneEl.systems && sceneEl.systems['control-mode'];
  return Boolean(controlMode && controlMode.isMode('xr'));
}

function visibleInHierarchy(object3D) {
  for (var current = object3D; current; current = current.parent) {
    if (!current.visible) return false;
  }
  return true;
}

function readPreferences() {
  var fallback = { handedness: 'right', hintMode: 'delayed' };
  try {
    var saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY));
    if (saved && (saved.handedness === 'left' || saved.handedness === 'right')) fallback.handedness = saved.handedness;
    if (saved && ['always', 'delayed', 'never'].indexOf(saved.hintMode) !== -1) fallback.hintMode = saved.hintMode;
  } catch (err) {
    // Storage can be disabled in private or embedded browsers. Defaults are fine.
  }
  return fallback;
}

function writePreferences(preferences) {
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch (err) {
    // Preferences remain live for this session even when storage is unavailable.
  }
}

AFRAME.registerComponent('desktop-controls', {
  schema: {
    camera: { type: 'selector' },
    leftHand: { type: 'selector' },
    rightHand: { type: 'selector' },
    crouchHeight: { default: 0.92 },
    crouchSpeed: { default: 1.8 },
    sprintEnabled: { default: false },
    mountedMoveSpeed: { default: 1.8 },
    mountedTurnSpeed: { default: 200 },
  },

  init: function () {
    var self = this;
    this.sceneEl = this.el.sceneEl;
    this.cameraEl = this.data.camera || this.el.querySelector('a-camera') || document.querySelector('a-camera');
    // a-camera enables A-Frame's own WASD controller by default. Desktop
    // controls own keyboard intent so both XR and desktop reach the shared
    // locomotion component exactly once per frame.
    if (this.cameraEl) this.cameraEl.setAttribute('wasd-controls', 'enabled', false);
    this.hands = {
      left: (this.data.leftHand || document.querySelector('#left-hand')).components['semantic-hand'],
      right: (this.data.rightHand || document.querySelector('#right-hand')).components['semantic-hand'],
    };
    this.hintSystem = this.sceneEl.systems['interaction-hints'];
    this.preferences = readPreferences();
    this.hintSystem.setPreferences(this.preferences);
    this.keys = {};
    this.mode = 'normal';
    this.activeMounted = null;
    this.activePointerHand = null;
    this.activeWatchHand = null;
    this.activeMenuEl = null;
    this.cursorStyleEl = null;
    this.cursorNdc = new THREE.Vector2(0, 0);
    this.hoveredMenuTarget = null;
    this.mountedPokingUntil = 0;
    this.mountedTransition = null;
    this.mountedOpenTimer = null;
    this._worldPosition = new THREE.Vector3();
    this._worldQuaternion = new THREE.Quaternion();
    this._cameraQuaternion = new THREE.Quaternion();
    this._cameraPosition = new THREE.Vector3();
    this._targetPosition = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this._cameraPivot = new THREE.Vector3();
    this._cameraTurn = new THREE.Quaternion();
    this._cameraRelative = new THREE.Vector3();
    this._cameraEuler = new THREE.Euler();
    this.standingHeight = this.cameraEl.object3D.position.y;
    this.hintSystem.setDesktopCrouchOffset(this.data.crouchHeight - this.standingHeight);
    this.manualCrouched = false;
    this.autoCrouch = null;
    this._lastCameraYaw = this.getCameraLocalYaw();
    this._lastCameraY = this.cameraEl.object3D.position.y;
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMountedRequest = this.onMountedRequest.bind(this);
    this.onActiveMenuClosed = this.onActiveMenuClosed.bind(this);
    this.onPreferenceChange = this.onPreferenceChange.bind(this);
    this.onWatchReady = this.syncPreferenceControls.bind(this);
    this.onControlModeChanged = this.handleControlModeChanged.bind(this);
    this.onSemanticAction = this.onSemanticAction.bind(this);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('mousemove', this.onMouseMove, true);
    this.sceneEl.addEventListener('mounted-interaction-request', this.onMountedRequest);
    this.sceneEl.addEventListener('menu-option-change', this.onPreferenceChange);
    this.sceneEl.addEventListener('watch-menu-ready', this.onWatchReady);
    this.sceneEl.addEventListener('control-mode-changed', this.onControlModeChanged);
    this.el.addEventListener('semantic-action-intent', this.onSemanticAction);

    this.ensureCursorStyleEl();
    this.setMode('normal');
    this.updateCrouchStateAttribute();
    setTimeout(function () { self.syncPreferenceControls(); }, 0);
  },

  dominantSide: function () {
    return this.preferences.handedness === 'left' ? 'left' : 'right';
  },

  watchSide: function () {
    return this.dominantSide() === 'left' ? 'right' : 'left';
  },

  getDominantHand: function () {
    return this.hands[this.dominantSide()];
  },

  onPreferenceChange: function (evt) {
    var detail = evt.detail || {};
    if (detail.key === 'handedness' && (detail.value === 'left' || detail.value === 'right')) {
      this.preferences.handedness = detail.value;
    } else if (detail.key === 'interaction-hints' && ['always', 'delayed', 'never'].indexOf(detail.value) !== -1) {
      this.preferences.hintMode = detail.value;
    } else {
      return;
    }
    writePreferences(this.preferences);
    this.hintSystem.setPreferences(this.preferences);
    this.syncPreferenceControls();
    this.sceneEl.emit('player-preferences-changed', Object.assign({}, this.preferences), false);
  },

  syncPreferenceControls: function () {
    var preferences = this.preferences;
    Array.prototype.forEach.call(document.querySelectorAll('[menu-option]'), function (el) {
      var component = el.components['menu-option'];
      if (!component) return;
      if (component.data.key === 'handedness') component.setValue(preferences.handedness);
      if (component.data.key === 'interaction-hints') component.setValue(preferences.hintMode);
    });
  },

  shouldHandleKeyboard: function (evt) {
    if (document.documentElement.classList.contains('editor-mode')) return false;
    var tag = evt.target && evt.target.tagName;
    return tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT';
  },

  onKeyDown: function (evt) {
    if (!this.shouldHandleKeyboard(evt)) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].indexOf(evt.code) !== -1) {
      this.keys[evt.code] = true;
      evt.preventDefault();
      return;
    }
    if (evt.repeat) return;

    if (evt.code === 'Tab') {
      evt.preventDefault();
      if (this.mode === 'watch') this.exitInteraction();
      else if (this.mode === 'normal') this.openWatch();
    } else if (evt.code === 'Escape') {
      if (this.mode !== 'normal') this.exitInteraction();
      else this.openWatch();
    } else if (evt.code === 'KeyE') {
      evt.preventDefault();
      if (this.mode === 'mounted') {
        this.exitInteraction();
      } else if (this.mode === 'normal') {
        var mountedCandidate = this.hintSystem.getDesktopCandidate('mounted');
        if (mountedCandidate) {
          this.hintSystem.activateForHand('mounted', mountedCandidate.hand.el, 'start', 'desktop');
        }
      }
    } else if (evt.code === 'KeyC') {
      evt.preventDefault();
      if (this.mode === 'normal') this.toggleManualCrouch();
    } else if (evt.code === 'KeyF') {
      evt.preventDefault();
      this.handleGrabKey();
    }
  },

  onKeyUp: function (evt) {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].indexOf(evt.code) !== -1) {
      this.keys[evt.code] = false;
      evt.preventDefault();
    }
  },

  // Mouse clicks and touch taps both end up here. A touch tap while the
  // watch is open carries its own screen point (there's no continuous
  // hover to have primed cursorNdc first, and no separate "aim, then
  // press a button" step the way mouse/keyboard has) — set cursorNdc from
  // the tap itself so the same nearest-target hit test used everywhere
  // else picks the right thing in one motion, matching a normal touch UI.
  onPointerDown: function (evt) {
    if (this.mode === 'normal' || !this.activePointerHand || xrIsPresenting(this.sceneEl)) return;
    if (evt.pointerType === 'touch') {
      // Only the watch's tap-anywhere-to-select needs the tap's own screen
      // point; mounted panels still use the existing fixed-center-reticle
      // aim (cursorNdc stays wherever mouse-look last left it).
      if (this.mode === 'watch') {
        if (evt.target !== this.sceneEl.canvas) return;
        this.setCursorNdcFromScreenPoint(evt.clientX, evt.clientY);
      }
    } else if (evt.pointerType === 'mouse' && evt.button !== 0) {
      return;
    }
    evt.preventDefault();
    this.activateMenuSelection();
  },

  onMouseMove: function (evt) {
    if (this.mode !== 'watch' || xrIsPresenting(this.sceneEl)) return;
    this.setCursorNdcFromScreenPoint(evt.clientX, evt.clientY);
    this.updateHoveredMenuTarget();
  },

  setCursorNdcFromScreenPoint: function (clientX, clientY) {
    var canvas = this.sceneEl.canvas;
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.cursorNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1)
    );
  },

  updateHoveredMenuTarget: function () {
    var scope = this.getActiveMenuScope();
    var next = scope ? this.findNearestMenuTarget(scope, 0.09) : null;
    if (next === this.hoveredMenuTarget) return;
    if (this.hoveredMenuTarget) this.hoveredMenuTarget.emit('mouseleave', null, false);
    this.hoveredMenuTarget = next;
    if (this.hoveredMenuTarget) this.hoveredMenuTarget.emit('mouseenter', null, false);
  },

  clearHoveredMenuTarget: function () {
    if (!this.hoveredMenuTarget) return;
    this.hoveredMenuTarget.emit('mouseleave', null, false);
    this.hoveredMenuTarget = null;
  },

  activateMenuSelection: function () {
    if (this.mode === 'normal' || !this.activePointerHand || xrIsPresenting(this.sceneEl)) return false;
    var handEl = this.activePointerHand.el;
    var watch = handEl.components['hand-with-watch'];
    // data-ray-target is set by the physical fingertip raycaster
    // (interaction-hints.js) and never cleared on its own once set — it
    // only means something while that raycaster is actually enabled
    // (mounted mode still turns it on via gripdown in startMountedPoke).
    // Watch mode no longer enables it at all (selection is cursor/tap
    // driven — see clickDesktopMenuTarget), so checking the attribute
    // alone would keep firing this stale branch off whatever it was last
    // set to before laser turned off, never reaching the real hit test.
    if (watch && watch.laserActive && handEl.hasAttribute('data-ray-target')) {
      handEl.emit('triggerdown', null, false);
      requestAnimationFrame(function () { handEl.emit('triggerup', null, false); });
      return true;
    }
    return this.clickDesktopMenuTarget();
  },

  onSemanticAction: function (evt) {
    var detail = evt.detail || {};
    if (detail.phase !== 'perform' || xrIsPresenting(this.sceneEl)) return;
    var source = detail.source || 'desktop';
    if (detail.action === 'watch') {
      if (this.mode === 'watch') this.exitInteraction();
      else if (this.mode === 'normal') this.openWatch();
    } else if (detail.action === 'back') {
      if (this.mode !== 'normal') this.exitInteraction();
    } else if (detail.action === 'interact') {
      if (this.mode === 'mounted') {
        this.exitInteraction();
      } else if (this.mode === 'normal') {
        var mountedCandidate = this.hintSystem.getDesktopCandidate('mounted');
        if (mountedCandidate) this.hintSystem.activateForHand('mounted', mountedCandidate.hand.el, 'start', source);
      }
    } else if (detail.action === 'grab') {
      this.handleGrabKey(source);
    } else if (detail.action === 'crouch') {
      if (this.mode === 'normal') this.toggleManualCrouch();
    } else if (detail.action === 'activate') {
      this.activateMenuSelection();
    }
  },

  // Shared by click selection and hover highlighting alike: whichever
  // .menu-target in the active scope projects closest to cursorNdc, within
  // a tolerance loose enough to forgive an imprecise mouse position or
  // touch tap without requiring pixel-perfect aim.
  findNearestMenuTarget: function (scope, tolerance) {
    var best = null;
    Array.prototype.forEach.call(scope.querySelectorAll('.menu-target'), function (targetEl) {
      if (!targetEl.object3D || !visibleInHierarchy(targetEl.object3D)) return;
      var projected = new THREE.Vector3();
      targetEl.object3D.getWorldPosition(projected);
      projected.project(this.sceneEl.camera);
      if (projected.z < -1 || projected.z > 1) return;
      var distance = this.cursorNdc.distanceToSquared(projected);
      if (!best || distance < best.distance) best = { el: targetEl, distance: distance };
    }, this);
    return best && best.distance <= (tolerance === undefined ? 0.055 : tolerance) ? best.el : null;
  },

  clickDesktopMenuTarget: function () {
    if (!this.activePointerHand) return false;
    var scope = this.getActiveMenuScope();
    if (!scope) return false;
    var target = this.findNearestMenuTarget(scope, this.mode === 'watch' ? 0.09 : 0.055);
    if (!target) return false;
    var menuItem = target.getAttribute('menu-item');
    this.activePointerHand.el.setAttribute('data-ray-target', (menuItem && (menuItem.value || menuItem.label)) || target.id || 'target');
    target.emit('click', null, false);
    return true;
  },

  getActiveMenuScope: function () {
    if (this.mode === 'watch' && this.activeWatchHand) {
      var watch = this.activeWatchHand.el.components['hand-with-watch'];
      return watch && watch.projectedMenu && watch.projectedMenu.panelEl;
    }
    if (this.mode === 'mounted' && this.activeMounted) {
      var menu = this.activeMounted.el.components['projected-menu'];
      return menu && menu.panelEl;
    }
    return null;
  },

  onMountedRequest: function (evt) {
    if (xrIsPresenting(this.sceneEl) || this.mode !== 'normal') return;
    this.beginMounted(evt.detail.component, evt.detail.handEl.components['semantic-hand']);
  },

  setMode: function (mode) {
    this.mode = mode;
    this.cursorNdc.set(0, 0);
    this.clearHoveredMenuTarget();
    this.el.setAttribute('data-desktop-mode', mode);
    this.hintSystem.setTargetingEnabled(mode === 'normal');
    // Watch mode locks the view instead of steering it (see openWatch): a
    // free-roaming mouse cursor selects menu items directly, so there's
    // nothing left for look-controls to do while it's open. Mounted panels
    // keep the older look-to-aim scheme.
    this.setLookEnabled(mode !== 'watch');
    this.setGazeEnabled(mode === 'normal');
    this.updateCursorStyle();
    this.sceneEl.emit('desktop-interaction-mode-changed', { mode: mode }, false);
  },

  updateCursorStyle: function () {
    var canvas = this.sceneEl.canvas;
    if (!canvas) return;
    // Mounted panels still aim via a fixed center reticle (mouse-look
    // turns the camera to point it), so the real cursor stays hidden
    // there. Watch mode aims with the real cursor itself, so it stays
    // visible — a crosshair, to read as "this is what selects", not a
    // stray arrow left over from the OS.
    canvas.classList.toggle('desktop-menu-aiming', this.mode === 'mounted');
    canvas.classList.toggle('desktop-watch-aiming', this.mode === 'watch');
  },

  handleControlModeChanged: function (evt) {
    if (evt.detail.mode === 'xr') this.exitInteraction(false);
    else this.setMode('normal');
  },

  handleGrabKey: function (source) {
    if (this.mode !== 'normal' || this.autoCrouch) return;
    var heldHand = this.findHeldHand();
    if (heldHand) {
      var held = heldHand.heldEl.components['simple-grabbable'];
      if (held) held.release(heldHand.el);
      return;
    }
    var grabCandidate = this.hintSystem.getDesktopCandidate('grab');
    if (grabCandidate) {
      if (grabCandidate.requiresCrouch && !this.manualCrouched) this.beginAutoCrouch(grabCandidate, source);
      else this.activateGrabCandidate(grabCandidate, source);
      return;
    }
    if (this.manualCrouched) return;
    var shoulderYOffset = this.data.crouchHeight - this.cameraEl.object3D.position.y;
    var crouchCandidate = this.hintSystem.getDesktopCrouchCandidate('grab', shoulderYOffset);
    if (!crouchCandidate) return;
    this.beginAutoCrouch(crouchCandidate, source);
  },

  beginAutoCrouch: function (candidate, source) {
    this.autoCrouch = { phase: 'down', candidate: candidate, source: source || 'desktop' };
    this.updateCrouchStateAttribute();
  },

  activateGrabCandidate: function (candidate, source) {
    if (!candidate || !candidate.hand) return false;
    candidate.hand.playPose('Hold');
    return this.hintSystem.activateCandidate(candidate, 'grab', candidate.hand.el, 'start', source || 'desktop');
  },

  toggleManualCrouch: function () {
    if (this.autoCrouch) {
      this.autoCrouch = null;
      this.manualCrouched = true;
    } else {
      this.manualCrouched = !this.manualCrouched;
    }
    this.updateCrouchStateAttribute();
  },

  updateCrouchStateAttribute: function () {
    var state = this.manualCrouched
      ? 'manual'
      : (this.autoCrouch ? 'auto-' + this.autoCrouch.phase : 'standing');
    this.el.setAttribute('data-crouch-state', state);
  },

  updateCrouch: function (delta) {
    var shouldBeLow = this.manualCrouched || (this.autoCrouch && this.autoCrouch.phase === 'down');
    var targetHeight = shouldBeLow ? this.data.crouchHeight : this.standingHeight;
    var currentHeight = this.cameraEl.object3D.position.y;
    var difference = targetHeight - currentHeight;
    var maxStep = this.data.crouchSpeed * Math.min(delta || 0, 50) / 1000;
    if (Math.abs(difference) <= maxStep) this.cameraEl.object3D.position.y = targetHeight;
    else this.cameraEl.object3D.position.y += Math.sign(difference) * maxStep;
    this.cameraEl.object3D.updateMatrixWorld(true);

    if (!this.autoCrouch || Math.abs(this.cameraEl.object3D.position.y - targetHeight) > 0.0001) return;
    if (this.autoCrouch.phase === 'down') {
      var candidate = this.autoCrouch.candidate;
      this.activateGrabCandidate(candidate, this.autoCrouch.source);
      this.autoCrouch.phase = 'up';
      this.updateCrouchStateAttribute();
    } else {
      this.autoCrouch = null;
      this.updateCrouchStateAttribute();
    }
  },

  ensureCursorStyleEl: function () {
    if (this.cursorStyleEl) return;
    this.cursorStyleEl = document.createElement('style');
    this.cursorStyleEl.textContent =
      'canvas.desktop-menu-aiming { cursor: none !important; } ' +
      'canvas.desktop-watch-aiming { cursor: crosshair !important; }';
    document.head.appendChild(this.cursorStyleEl);
  },

  ensureMouseLookCapture: function () {
    var canvas = this.sceneEl.canvas;
    if (!canvas || document.pointerLockElement || !canvas.requestPointerLock) return;
    var request = canvas.requestPointerLock();
    if (request && request.catch) request.catch(function () {});
  },

  setLookEnabled: function (enabled) {
    var look = this.cameraEl && this.cameraEl.components['look-controls'];
    if (!look) return;
    if (enabled && look.play) look.play();
    else if (!enabled && look.pause) look.pause();
  },

  setGazeEnabled: function (enabled) {
    var gaze = document.querySelector('#gaze-cursor');
    if (!gaze) return;
    gaze.setAttribute('raycaster', 'enabled', enabled);
    gaze.setAttribute('visible', enabled);
  },

  openWatch: function () {
    if (xrIsPresenting(this.sceneEl) || this.mode !== 'normal') return;
    var watchHand = this.hands[this.watchSide()];
    var pointerHand = this.getDominantHand();
    var watch = watchHand && watchHand.el.components['hand-with-watch'];
    if (!watch || !watch.projectedMenu) return;
    this.activeWatchHand = watchHand;
    this.activePointerHand = pointerHand;
    this.trackActiveMenu(watch.faceEl);
    // Level the view and hold it there (setMode pauses look-controls):
    // with a fixed view, the panel can be parked in a fixed spot in front
    // of it — up and out of the way of the hand/watch, which sit low —
    // instead of chasing wherever the player last looked.
    this.setCameraLocalRotation(this.getCameraLocalYaw(), 0);
    if (document.exitPointerLock) document.exitPointerLock();
    this.setMode('watch');
    watch.projectedMenu.openInMode('laser');
    this.placeWatchHand();
    this.placeWatchPointer();
  },

  beginMounted: function (component, hand) {
    if (!component || !hand || xrIsPresenting(this.sceneEl)) return;
    this.cameraEl.object3D.getWorldPosition(this._cameraPosition);
    var anchor = component.getAnchorWorldPosition(new THREE.Vector3(), this._cameraPosition);
    var targetRigPosition = this.el.object3D.position.clone();
    if (anchor) {
      targetRigPosition.x += anchor.x - this._cameraPosition.x;
      targetRigPosition.z += anchor.z - this._cameraPosition.z;
    }
    var facingPosition = component.getFacingWorldPosition(new THREE.Vector3());
    var targetCameraPosition = this._cameraPosition.clone();
    if (anchor) {
      targetCameraPosition.x = anchor.x;
      targetCameraPosition.z = anchor.z;
    }
    var facingDirection = facingPosition.clone().sub(targetCameraPosition);
    var facingDistance = facingDirection.length();
    if (facingDistance) facingDirection.divideScalar(facingDistance);
    var targetWorldYaw = Math.atan2(-facingDirection.x, -facingDirection.z);
    var targetPitch = Math.asin(THREE.MathUtils.clamp(facingDirection.y, -1, 1));
    this.el.object3D.getWorldQuaternion(this._worldQuaternion);
    var rigWorldYaw = this._cameraEuler.setFromQuaternion(this._worldQuaternion, 'YXZ').y;
    var startYaw = this.getCameraLocalYaw();
    var startPitch = this.getCameraLocalPitch();
    var targetYaw = targetWorldYaw - rigWorldYaw;
    var yawDelta = Math.atan2(Math.sin(targetYaw - startYaw), Math.cos(targetYaw - startYaw));
    var pitchDelta = targetPitch - startPitch;
    var moveDistance = this.el.object3D.position.distanceTo(targetRigPosition);
    var moveDuration = moveDistance / Math.max(0.1, this.data.mountedMoveSpeed);
    var turnDuration = Math.max(Math.abs(yawDelta), Math.abs(pitchDelta)) /
      THREE.MathUtils.degToRad(Math.max(1, this.data.mountedTurnSpeed));
    var duration = THREE.MathUtils.clamp(Math.max(moveDuration, turnDuration) * 1000, 280, 1000);

    this.activeMounted = component;
    this.activePointerHand = hand;
    this.trackActiveMenu(component.el);
    this.mountedPokingUntil = 0;
    this.mountedTransition = {
      startedAt: performance.now(),
      duration: duration,
      startPosition: this.el.object3D.position.clone(),
      targetPosition: targetRigPosition,
      startYaw: startYaw,
      yawDelta: yawDelta,
      startPitch: startPitch,
      pitchDelta: pitchDelta,
    };
    this.el.setAttribute('data-mounted-transition', 'moving');
    this.setMode('mounted');
    this.ensureMouseLookCapture();
  },

  setCameraLocalRotation: function (yaw, pitch) {
    var look = this.cameraEl && this.cameraEl.components['look-controls'];
    if (look && look.yawObject) {
      look.yawObject.rotation.y = yaw;
      if (look.pitchObject) look.pitchObject.rotation.x = pitch;
      if (look.updateOrientation) look.updateOrientation();
    } else {
      this.cameraEl.object3D.rotation.y = yaw;
      this.cameraEl.object3D.rotation.x = pitch;
    }
    this.cameraEl.object3D.updateMatrixWorld(true);
  },

  updateMountedTransition: function (now) {
    var transition = this.mountedTransition;
    if (!transition) return false;
    var progress = THREE.MathUtils.clamp((now - transition.startedAt) / transition.duration, 0, 1);
    var eased = progress * progress * (3 - 2 * progress);
    this.el.object3D.position.lerpVectors(transition.startPosition, transition.targetPosition, eased);
    this.setCameraLocalRotation(
      transition.startYaw + transition.yawDelta * eased,
      transition.startPitch + transition.pitchDelta * eased
    );
    this.el.object3D.updateMatrixWorld(true);
    if (progress < 1) return true;

    this.mountedTransition = null;
    this.el.removeAttribute('data-mounted-transition');
    this.startMountedPoke();
    return false;
  },

  startMountedPoke: function () {
    if (!this.activeMounted || !this.activePointerHand) return;
    var component = this.activeMounted;
    this.mountedPokingUntil = performance.now() + 500;
    this.placeMountedPoke();
    this.activePointerHand.el.emit('gripdown', null, false);
    var self = this;
    this.mountedOpenTimer = setTimeout(function () {
      self.mountedOpenTimer = null;
      if (self.activeMounted !== component) return;
      component.open();
    }, 400);
  },

  exitInteraction: function (restoreMode) {
    if (this.mountedOpenTimer) clearTimeout(this.mountedOpenTimer);
    this.mountedOpenTimer = null;
    this.mountedTransition = null;
    this.el.removeAttribute('data-mounted-transition');
    this.trackActiveMenu(null);
    if (this.activePointerHand) this.activePointerHand.el.emit('gripup', null, false);
    if (this.activeWatchHand) {
      var watch = this.activeWatchHand.el.components['hand-with-watch'];
      if (watch && watch.projectedMenu) watch.projectedMenu.close();
    }
    if (this.activeMounted) this.activeMounted.close();
    this.activeWatchHand = null;
    this.activePointerHand = null;
    this.activeMounted = null;
    this.mountedPokingUntil = 0;
    this.cursorNdc.set(0, 0);
    if (restoreMode !== false) this.setMode('normal');
  },

  trackActiveMenu: function (menuEl) {
    if (this.activeMenuEl === menuEl) return;
    if (this.activeMenuEl) this.activeMenuEl.removeEventListener('projected-menu-closed', this.onActiveMenuClosed);
    this.activeMenuEl = menuEl || null;
    if (this.activeMenuEl) this.activeMenuEl.addEventListener('projected-menu-closed', this.onActiveMenuClosed);
  },

  onActiveMenuClosed: function () {
    if (this.mode !== 'normal') this.exitInteraction();
  },

  getCameraLocalYaw: function () {
    return this._cameraEuler.setFromQuaternion(this.cameraEl.object3D.quaternion, 'YXZ').y;
  },

  getCameraLocalPitch: function () {
    return this._cameraEuler.setFromQuaternion(this.cameraEl.object3D.quaternion, 'YXZ').x;
  },

  handFollowsCameraPose: function (hand) {
    if (this.mode === 'watch') return hand === this.activePointerHand;
    if (this.mode === 'mounted' && hand === this.activePointerHand && performance.now() < this.mountedPokingUntil) return false;
    if (this.mode === 'normal') {
      var candidate = this.autoCrouch && this.autoCrouch.phase === 'down'
        ? this.autoCrouch.candidate
        : this.hintSystem.desktopCandidate;
      if (candidate && candidate.hand === hand && !hand.heldEl) return false;
    }
    return true;
  },

  syncHandsToCameraPose: function () {
    var yaw = this.getCameraLocalYaw();
    var yawDelta = Math.atan2(Math.sin(yaw - this._lastCameraYaw), Math.cos(yaw - this._lastCameraYaw));
    var cameraY = this.cameraEl.object3D.position.y;
    var yDelta = cameraY - this._lastCameraY;
    if (Math.abs(yawDelta) < 0.000001 && Math.abs(yDelta) < 0.000001) return;

    this._cameraPivot.copy(this.cameraEl.object3D.position);
    this._cameraTurn.setFromAxisAngle(this._up, yawDelta);
    ['left', 'right'].forEach(function (side) {
      var hand = this.hands[side];
      if (!hand || !this.handFollowsCameraPose(hand)) return;
      hand.el.object3D.position.y += yDelta;
      hand.desiredPosition.y += yDelta;
      if (Math.abs(yawDelta) >= 0.000001) {
        this._cameraRelative.copy(hand.el.object3D.position).sub(this._cameraPivot).applyQuaternion(this._cameraTurn);
        hand.el.object3D.position.copy(this._cameraPivot).add(this._cameraRelative);
        this._cameraRelative.copy(hand.desiredPosition).sub(this._cameraPivot).applyQuaternion(this._cameraTurn);
        hand.desiredPosition.copy(this._cameraPivot).add(this._cameraRelative);
        hand.el.object3D.quaternion.premultiply(this._cameraTurn);
        hand.desiredQuaternion.premultiply(this._cameraTurn);
      }
      hand.el.object3D.updateMatrixWorld(true);
    }, this);
    this._lastCameraYaw = yaw;
    this._lastCameraY = cameraY;
  },

  cameraWorldPosition: function () {
    this.cameraEl.object3D.getWorldPosition(this._cameraPosition);
    return this._cameraPosition.clone();
  },

  cameraOffsetToWorld: function (offset, includePitch) {
    this.cameraEl.object3D.getWorldPosition(this._cameraPosition);
    this.cameraEl.object3D.getWorldQuaternion(this._cameraQuaternion);
    if (!includePitch) {
      var yaw = new THREE.Euler().setFromQuaternion(this._cameraQuaternion, 'YXZ').y;
      this._cameraQuaternion.setFromAxisAngle(this._up, yaw);
    }
    return this._cameraPosition.clone().add(offset.clone().applyQuaternion(this._cameraQuaternion));
  },

  cameraYawQuaternion: function () {
    this.cameraEl.object3D.getWorldQuaternion(this._cameraQuaternion);
    var yaw = new THREE.Euler().setFromQuaternion(this._cameraQuaternion, 'YXZ').y;
    return new THREE.Quaternion().setFromAxisAngle(this._up, yaw);
  },

  currentAimDirection: function (pointerOrigin) {
    this.cameraEl.object3D.getWorldPosition(this._cameraPosition);
    var rayDirection = new THREE.Vector3(this.cursorNdc.x, this.cursorNdc.y, 0.5)
      .unproject(this.sceneEl.camera)
      .sub(this._cameraPosition)
      .normalize();
    if (!pointerOrigin) return rayDirection;

    // Aim the fingertip at the mouse ray's intersection with the live menu
    // plane. This removes the camera/hand parallax that a parallel ray would
    // otherwise introduce while keeping the hand motion continuous.
    var scope = this.getActiveMenuScope();
    if (!scope || !scope.object3D) return rayDirection;
    scope.object3D.getWorldPosition(this._targetPosition);
    scope.object3D.getWorldQuaternion(this._worldQuaternion);
    var planeNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(this._worldQuaternion);
    var denominator = planeNormal.dot(rayDirection);
    if (Math.abs(denominator) < 0.0001) return rayDirection;
    var distance = planeNormal.dot(this._targetPosition.clone().sub(this._cameraPosition)) / denominator;
    if (distance <= 0) return rayDirection;
    var menuPoint = this._cameraPosition.clone().add(rayDirection.multiplyScalar(distance));
    return menuPoint.sub(pointerOrigin).normalize();
  },

  placeRestHand: function (hand) {
    var sideX = hand.data.hand === 'left' ? -0.24 : 0.24;
    var position = this.cameraOffsetToWorld(new THREE.Vector3(sideX, -0.38, -0.42), true);
    hand.setWorldTransform(position, this.cameraYawQuaternion(), hand.heldEl ? 'Hold' : 'Open');
  },

  placeHeldHand: function (hand) {
    var sideX = hand.data.hand === 'left' ? -0.2 : 0.2;
    var position = this.cameraOffsetToWorld(new THREE.Vector3(sideX, -0.25, -0.48), true);
    hand.setWorldTransform(position, this.cameraYawQuaternion(), 'Hold');
  },

  placeCandidatePreview: function (candidate) {
    var hand = candidate.hand;
    var target = candidate.zone.getWorldPosition(new THREE.Vector3());
    var mounted = candidate.zone.el.components['mounted-interaction'];
    var standoff = mounted ? mounted.data.previewStandoff : candidate.zone.data.previewStandoff;
    var direction;
    var fingertip;
    if (mounted) {
      var outwardNormal = mounted.getWorldNormal(new THREE.Vector3());
      fingertip = target.clone().add(outwardNormal.clone().multiplyScalar(standoff));
      direction = outwardNormal.negate();
    } else {
      direction = target.clone().sub(this.cameraWorldPosition()).normalize();
      fingertip = target.clone().addScaledVector(direction, -standoff);
    }
    hand.setPointPose(fingertip, direction, 'Point');
  },

  // Desktop-only (real XR never calls this — see openWatch's early
  // xrIsPresenting return). The view is locked level for the whole time
  // the watch is open (see openWatch), so unlike every other desktop hand
  // placement this doesn't need to track where the camera is looking —
  // it just needs to sit low, out of the way of the panel positionWatchPanel
  // projects up above it. Selection itself is driven by the real cursor
  // (see onPointerDown/onMouseMove), not by this hand's aim.
  placeWatchHand: function (snap) {
    var side = this.activeWatchHand.data.hand === 'left' ? -1 : 1;
    var watchPosition = this.cameraOffsetToWorld(new THREE.Vector3(side * 0.16, -0.42, -0.4), false);
    var watchQuaternion = this.cameraYawQuaternion().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.6, 0, side * -0.25)));
    this.activeWatchHand.setWorldTransform(watchPosition, watchQuaternion, 'Open', snap);
  },

  // Parked low and slightly forward of the watch hand, pointing generally
  // ahead — a resting "using the watch" pose rather than an aimed one, so
  // it never has a reason to drift up into the panel above it.
  placeWatchPointer: function (snap) {
    var side = this.activePointerHand.data.hand === 'left' ? -1 : 1;
    var fingertip = this.cameraOffsetToWorld(new THREE.Vector3(side * 0.24, -0.48, -0.42), false);
    var aimAt = this.cameraOffsetToWorld(new THREE.Vector3(side * 0.12, -0.15, -1), false);
    this.activePointerHand.setPointPose(fingertip, aimAt.sub(fingertip).normalize(), 'Point', snap);
  },

  // Overrides the panel's normal hand-relative position (set moments
  // earlier this same frame by projected-menu's own tick — see menus.js's
  // updatePanelPosition) so it renders up and out in front of the locked
  // view instead of hovering around the watch/hand sitting low below it.
  // Runs in tock, guaranteed to happen after every entity's tick this
  // frame, so this always has the final say over where the panel ends up.
  positionWatchPanel: function () {
    var watch = this.activeWatchHand && this.activeWatchHand.el.components['hand-with-watch'];
    var pm = watch && watch.projectedMenu;
    var panelObject = pm && pm.panelEl && pm.panelEl.object3D;
    var parent = panelObject && panelObject.parent;
    if (!parent) return;
    parent.updateMatrixWorld(true);
    var worldPosition = this.cameraOffsetToWorld(new THREE.Vector3(0, 0.22, -0.62), false);
    var camPos = this.cameraWorldPosition();

    // Object3D.lookAt() factors out the target's own parent rotation to
    // produce a correct world-facing orientation — but the watch hand's
    // pose while open (see placeWatchHand) is contorted enough that this
    // breaks down and the panel ends up facing sideways. A detached,
    // parent-less scratch object never takes that code path at all: do
    // the lookAt in plain world space, then convert to local the same
    // way setWorldTransform does for hands (interaction-hints.js).
    if (!this._panelLookAtScratch) this._panelLookAtScratch = new THREE.Object3D();
    this._panelLookAtScratch.position.copy(worldPosition);
    this._panelLookAtScratch.lookAt(camPos);
    var worldQuaternion = this._panelLookAtScratch.quaternion;

    var parentQuaternion = new THREE.Quaternion();
    parent.getWorldQuaternion(parentQuaternion);
    panelObject.position.copy(parent.worldToLocal(worldPosition.clone()));
    panelObject.quaternion.copy(parentQuaternion.invert().multiply(worldQuaternion));
  },

  placeMountedPoke: function (snap) {
    if (!this.activeMounted || !this.activePointerHand) return;
    var target = this.activeMounted.getActionWorldPosition(new THREE.Vector3());
    var normal = this.activeMounted.getWorldNormal(new THREE.Vector3());
    this.activePointerHand.setPointPose(target, normal.negate(), 'Point', snap);
  },

  placeMountedPointer: function () {
    var sideX = this.activePointerHand.data.hand === 'left' ? -0.24 : 0.24;
    var fingertip = this.cameraOffsetToWorld(new THREE.Vector3(sideX, -0.25, -0.42), true);
    this.activePointerHand.setPointPose(fingertip, this.currentAimDirection(fingertip), 'Point');
    var other = this.hands[this.activePointerHand.data.hand === 'left' ? 'right' : 'left'];
    if (other) this.placeRestHand(other);
  },

  findHeldHand: function () {
    if (this.hands.left && this.hands.left.heldEl) return this.hands.left;
    if (this.hands.right && this.hands.right.heldEl) return this.hands.right;
    return null;
  },

  closeUnrequestedDesktopWatches: function () {
    if (this.mode === 'watch') return;
    ['left', 'right'].forEach(function (side) {
      var hand = this.hands[side];
      var watch = hand && hand.el.components['hand-with-watch'];
      if (watch && watch.projectedMenu && watch.projectedMenu.active) watch.projectedMenu.close();
    }, this);
  },

  updateNormalHands: function () {
    var candidate = this.autoCrouch && this.autoCrouch.phase === 'down'
      ? this.autoCrouch.candidate
      : this.hintSystem.desktopCandidate;
    ['left', 'right'].forEach(function (side) {
      var hand = this.hands[side];
      if (!hand) return;
      if (hand.heldEl) this.placeHeldHand(hand);
      else if (candidate && candidate.hand === hand) this.placeCandidatePreview(candidate);
      else this.placeRestHand(hand);
    }, this);
  },

  applyMovement: function (delta) {
    if (this.autoCrouch) return;
    var x = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    var z = (this.keys.KeyS ? 1 : 0) - (this.keys.KeyW ? 1 : 0);
    if (!x && !z) return;
    var locomotion = this.el.components['locomotion-demo'];
    var sprint = this.data.sprintEnabled && Boolean(this.keys.ShiftLeft || this.keys.ShiftRight);
    if (locomotion && locomotion.applyDesktopMove) locomotion.applyDesktopMove(x, z, delta, sprint);
  },

  tick: function (time, delta) {
    if (xrIsPresenting(this.sceneEl)) {
      this._lastCameraYaw = this.getCameraLocalYaw();
      this._lastCameraY = this.cameraEl.object3D.position.y;
      return;
    }
    this.syncHandsToCameraPose();
    this.updateCrouch(delta);
    this.syncHandsToCameraPose();
    this.closeUnrequestedDesktopWatches();
    if (this.mode === 'normal') {
      this.applyMovement(delta);
      this.updateNormalHands();
    } else if (this.mode === 'watch') {
      this.placeWatchHand();
      this.placeWatchPointer();
      // Must run in tick, not tock: A-Frame renders the scene between the
      // tick and tock phases, so a tock-only override is always one frame
      // late for rendering (the next tick's own updatePanelPosition — see
      // menus.js's projected-menu — would already have put the panel back
      // at its hand-relative default by the time the following tock ran).
      // Called after placeWatchHand/placeWatchPointer so the camera-locked
      // math above has already run this frame too.
      this.positionWatchPanel();
    } else if (this.mode === 'mounted') {
      if (this.updateMountedTransition(performance.now())) {
        var zone = this.activeMounted && this.activeMounted.el.components['hint-zone'];
        if (zone) this.placeCandidatePreview({ hand: this.activePointerHand, zone: zone });
      } else if (performance.now() < this.mountedPokingUntil) this.placeMountedPoke();
      else this.placeMountedPointer();
      var other = this.activePointerHand && this.hands[this.activePointerHand.data.hand === 'left' ? 'right' : 'left'];
      if (other) this.placeRestHand(other);
    }
  },

  tock: function () {
    if (xrIsPresenting(this.sceneEl)) return;
    this.syncHandsToCameraPose();
  },

  remove: function () {
    this.trackActiveMenu(null);
    if (this.cursorStyleEl) this.cursorStyleEl.remove();
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    document.removeEventListener('mousemove', this.onMouseMove, true);
    this.sceneEl.removeEventListener('mounted-interaction-request', this.onMountedRequest);
    this.sceneEl.removeEventListener('menu-option-change', this.onPreferenceChange);
    this.sceneEl.removeEventListener('watch-menu-ready', this.onWatchReady);
    this.sceneEl.removeEventListener('control-mode-changed', this.onControlModeChanged);
    this.el.removeEventListener('semantic-action-intent', this.onSemanticAction);
  },
});
