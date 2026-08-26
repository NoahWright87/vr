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
    // The invisible cursor mouse/touch-drag/look-stick move around inside
    // the watch panel while in watch mode (see onMouseMove/onSemanticLook).
    // A little beyond +/-1 is deliberate margin around the panel's own
    // extent (see watchCursorWorldPoint/getWatchPanelExtent).
    this.watchCursor = new THREE.Vector2(0, 0);
    this.watchCursorMargin = 1.15;
    // Tracks the watch hand's own qualify/don't-qualify transitions —
    // see placeWatchHand's virtual-poke check.
    this._watchWasQualifying = false;
    this._watchFaceScratch = new THREE.Object3D();
    // lookAt() points local -Z at its target; the watch face's own
    // "normal" (the axis projected-menu reads to decide poke/laser mode
    // and orientation, see menus.js's computeMode) is local +Y instead.
    // Post-multiplying this fixed 90deg-about-X quaternion after a lookAt
    // remaps which local axis ends up aimed at the target, from -Z to +Y,
    // without needing any per-call trig (verified empirically — dotCam
    // reads exactly 1.0 head-on).
    this._watchFaceFixQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    // Rotating around the face's own local Y (applied before the fix
    // above, so it spins the face in its own plane without disturbing
    // which axis ends up pointing at the camera) corrects the panel's
    // "which way is up" roll relative to the authored template — the
    // lookAt's own up-vector orthogonalization doesn't line up with it
    // on its own. -90deg verified empirically (screenshot: chrome bar on
    // top, rows in authored order reading right-side up).
    this._watchFaceRollQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    this.mountedPokingUntil = 0;
    this.mountedTransition = null;
    this.mountedOpenTimer = null;
    this.watchPitchTransition = null;
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
    this.onSemanticTap = this.onSemanticTap.bind(this);
    this.onSemanticLook = this.onSemanticLook.bind(this);
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
    this.sceneEl.addEventListener('semantic-tap', this.onSemanticTap);
    this.el.addEventListener('semantic-action-intent', this.onSemanticAction);
    this.el.addEventListener('semantic-look', this.onSemanticLook);

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
      if (this.mode === 'normal' || this.mode === 'watch') this.toggleManualCrouch();
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

  // Mouse clicks and touch taps landing directly on the canvas both end up
  // here. Mounted panels aim with the fixed center reticle (mouse-look
  // turns the camera to point it — see setMode); a touch tap that reaches
  // the canvas directly (nothing else caught it first) just activates
  // whatever that reticle is over. Watch mode aims via the real fingertip
  // laser (see activateMenuSelection) driven by the invisible cursor —
  // onMouseMove/onSemanticLook move it, a tap here or via onSemanticTap
  // below only ever activates whatever it's currently pointing at, never
  // repositions it from where the tap landed.
  onPointerDown: function (evt) {
    if (this.mode === 'normal' || !this.activePointerHand || xrIsPresenting(this.sceneEl)) return;
    if (evt.pointerType === 'touch') {
      if (this.mode === 'watch' && evt.target !== this.sceneEl.canvas) return;
    } else if (evt.pointerType === 'mouse' && evt.button !== 0) {
      return;
    }
    evt.preventDefault();
    this.activateMenuSelection();
  },

  // Mobile's look-drag area (common/input-router.js's touch-controls)
  // covers most of the screen so the player can still drag to move the
  // invisible cursor around the watch panel — which means it also
  // swallows a plain tap before it ever reaches the canvas. touch-controls
  // tells short, near-stationary presses apart from real drags and
  // re-emits those as this scene-level event instead.
  onSemanticTap: function () {
    if (this.mode !== 'watch' || !this.activePointerHand || xrIsPresenting(this.sceneEl)) return;
    this.activateMenuSelection();
  },

  // Raw mouse movement while in watch mode drives the invisible cursor
  // instead of the camera (look-controls is paused for the duration —
  // see setMode). No pointer lock needed: MouseEvent.movementX/Y is
  // reported on ordinary mouse events too, whether the mouse happens to
  // already be locked (from earlier free-look navigation) or not — see
  // openWatch for why watch mode never requests it either way.
  // Touch-drag and gamepad-look reach the same cursor through
  // onSemanticLook below.
  onMouseMove: function (evt) {
    if (this.mode !== 'watch' || xrIsPresenting(this.sceneEl)) return;
    this.moveWatchCursor(evt.movementX * 0.0032, -evt.movementY * 0.0032);
  },

  // semantic-look-controls (input-router.js) skips itself while watch mode
  // has the view locked, so this is the only consumer of touch-drag and
  // gamepad-look-stick deltas during that time — same invisible cursor
  // onMouseMove drives, just fed from a different input family.
  onSemanticLook: function (evt) {
    if (this.mode !== 'watch' || !evt.detail) return;
    var detail = evt.detail;
    if (detail.kind === 'delta') {
      this.moveWatchCursor(detail.x * 0.0032, -detail.y * 0.0032);
    } else {
      var seconds = Math.min(detail.deltaMs || 0, 50) / 1000;
      this.moveWatchCursor(detail.x * 1.6 * seconds, -detail.y * 1.6 * seconds);
    }
  },

  moveWatchCursor: function (dx, dy) {
    var margin = this.watchCursorMargin;
    this.watchCursor.x = THREE.MathUtils.clamp(this.watchCursor.x + dx, -margin, margin);
    this.watchCursor.y = THREE.MathUtils.clamp(this.watchCursor.y + dy, -margin, margin);
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

  // Watch mode always goes through the real fingertip laser/cursor —
  // wireUpFingertipPointing (watch-menu.js), the exact mechanism VR uses,
  // now made reliable because the pointer hand is actually posed and
  // aimed correctly (see placeWatchPointer). data-ray-target is set by
  // that same physical raycaster whenever it's currently hitting
  // something (interaction-hints.js); if it hasn't settled yet (the
  // ~180ms point-gesture delay after gripdown — see openWatch) or isn't
  // hitting anything, the click is simply a no-op, same as VR.
  activateMenuSelection: function () {
    if (this.mode === 'normal' || !this.activePointerHand || xrIsPresenting(this.sceneEl)) return false;
    var handEl = this.activePointerHand.el;
    if (this.mode === 'watch') {
      var watch = handEl.components['hand-with-watch'];
      if (!watch || !watch.laserActive || !handEl.hasAttribute('data-ray-target')) return false;
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
      if (this.mode === 'normal' || this.mode === 'watch') this.toggleManualCrouch();
    } else if (detail.action === 'activate') {
      this.activateMenuSelection();
    }
  },

  // Used only by mounted mode's click selection: whichever .menu-target in
  // the active scope projects closest to cursorNdc (the fixed center
  // reticle — see setMode), within a tolerance loose enough to forgive an
  // imprecise touch tap without requiring pixel-perfect aim. Watch mode
  // selects through the real fingertip laser instead (activateMenuSelection).
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
    var target = this.findNearestMenuTarget(scope, 0.055);
    if (!target) return false;
    var menuItem = target.getAttribute('menu-item');
    this.activePointerHand.el.setAttribute('data-ray-target', (menuItem && (menuItem.value || menuItem.label)) || target.id || 'target');
    target.emit('click', null, false);
    return true;
  },

  getActiveMenuScope: function () {
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
    this.el.setAttribute('data-desktop-mode', mode);
    this.hintSystem.setTargetingEnabled(mode === 'normal');
    // Mounted panels aim by turning the camera at a fixed center reticle,
    // so look stays free there. Watch mode is different: entering it
    // clamps and locks the camera onto the watch (see openWatch) so the
    // menu stays framed the whole time it's open — look input during that
    // time drives the invisible in-menu cursor instead of the camera (see
    // onMouseMove/onSemanticLook).
    this.setLookEnabled(mode !== 'watch');
    this.setGazeEnabled(mode === 'normal');
    this.updateCursorStyle();
    this.sceneEl.emit('desktop-interaction-mode-changed', { mode: mode }, false);
  },

  updateCursorStyle: function () {
    var canvas = this.sceneEl.canvas;
    if (!canvas) return;
    canvas.classList.toggle('desktop-menu-aiming', this.mode !== 'normal');
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
    this.cursorStyleEl.textContent = 'canvas.desktop-menu-aiming { cursor: none !important; }';
    document.head.appendChild(this.cursorStyleEl);
  },

  setLookEnabled: function (enabled) {
    var look = this.cameraEl && this.cameraEl.components['look-controls'];
    if (!look) return;
    if (enabled) {
      this.rebaselineMagicWindowYaw(look);
      if (look.play) look.play();
    } else if (look.pause) {
      look.pause();
    }
  },

  // look-controls freezes its magic-window (gyro) tracking for as long as
  // it's paused — pausing stops tick(), and updateMagicWindowOrientation
  // (which folds the phone's live orientation into the camera) only ever
  // runs from there. The raw deviceorientation events keep arriving the
  // whole time regardless (that listener lives on the DeviceOrientation-
  // Controls instance itself, independent of pause/play), so the moment
  // ticking resumes, look-controls treats the *entire* paused-duration's
  // physical rotation as a single frame's worth of delta and dumps it
  // straight into the camera — snapping the view to wherever the phone
  // now physically points and discarding whatever the player did with
  // drag/touch before the lock. Refreshing the magic-window baseline
  // immediately before resuming makes that first post-resume delta ~0
  // instead, so the camera picks back up exactly where it was locked
  // rather than jumping.
  rebaselineMagicWindowYaw: function (look) {
    var controls = look.magicWindowControls;
    if (!controls || !controls.enabled) return;
    controls.update();
    look.previousMagicWindowYaw = this._cameraEuler.setFromQuaternion(look.magicWindowObject.quaternion, 'YXZ').y;
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
    this.watchCursor.set(0, 0);
    this.setMode('watch');
    // Level out an extreme pitch instead of freezing wherever the player
    // happened to be looking, eased in rather than snapped (see
    // updateWatchPitchTransition) — placeWatchHand is about to put the
    // watch hand directly along this same (now-locked) view direction
    // every tick, so this is what guarantees the menu opens centered on
    // screen instead of stranded off it (the bug that got camera-locking
    // pulled last time — see git history).
    this.beginWatchPitchLevel();
    // No requestPointerLock here: onMouseMove below reads plain
    // MouseEvent.movementX/Y, which browsers report on ordinary mouse
    // events too, locked or not -- pointer lock only matters for
    // *unbounded* movement like a full look-around turn, and the watch
    // cursor's range is small and bounded. Requesting lock bought nothing
    // but a jarring "click to recapture"/permission-prompt round trip on
    // desktop, and outright broke touch input, which has no mouse to lock
    // in the first place (mounted-panel aiming used to request it here
    // too, for the same reason — see beginMounted).
    // The real VR mechanism for "point with your other hand" is a held
    // grip (see wireUpFingertipPointing in watch-menu.js) — firing the
    // same event here, rather than forcing the menu into a mode or
    // position, makes the pointer hand's own fingertip laser/cursor real.
    // No explicit open() call here — the hand hasn't moved into place
    // yet at this point, so the pose wouldn't qualify anyway; placeWatchHand
    // opens it itself the instant the live pose actually does (see the
    // comment there for why, and why that has to be edge-triggered).
    this.activePointerHand.el.emit('gripdown', null, false);
    this._watchWasQualifying = false;
    this.placeWatchHand();
    this.placeWatchPointer();
  },

  beginWatchPitchLevel: function () {
    var startPitch = this.getCameraLocalPitch();
    var targetPitch = this.clampedCameraPitch();
    if (Math.abs(targetPitch - startPitch) < 0.001) {
      this.watchPitchTransition = null;
      return;
    }
    this.watchPitchTransition = {
      startedAt: performance.now(),
      duration: THREE.MathUtils.clamp(Math.abs(targetPitch - startPitch) / THREE.MathUtils.degToRad(150), 0.15, 0.35) * 1000,
      yaw: this.getCameraLocalYaw(),
      startPitch: startPitch,
      targetPitch: targetPitch,
    };
  },

  updateWatchPitchTransition: function (now) {
    var transition = this.watchPitchTransition;
    if (!transition) return;
    var progress = THREE.MathUtils.clamp((now - transition.startedAt) / transition.duration, 0, 1);
    var eased = progress * progress * (3 - 2 * progress);
    this.setCameraLocalRotation(transition.yaw, transition.startPitch + (transition.targetPitch - transition.startPitch) * eased);
    if (progress >= 1) this.watchPitchTransition = null;
  },

  clampedCameraPitch: function () {
    return THREE.MathUtils.clamp(
      this.getCameraLocalPitch(),
      THREE.MathUtils.degToRad(-20),
      THREE.MathUtils.degToRad(30)
    );
  },

  // The reference frame every watch-mode placement below is built from:
  // the camera's current world yaw, with pitch clamped (see
  // clampedCameraPitch) so glancing at the watch while looking sharply up
  // or down never puts it somewhere odd. openWatch eases the now-locked
  // camera toward this exact same pitch, so what's computed here always
  // matches what the player ends up actually looking at.
  watchViewQuaternion: function () {
    var pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.clampedCameraPitch());
    return this.cameraYawQuaternion().multiply(pitchQuat);
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
  },

  // yawObject/pitchObject hold only the mouse/touch-drag contribution —
  // look-controls adds the magic-window (gyro) contribution on top of
  // them each tick (object3D.rotation = magicWindowDeltaEuler +
  // yawObject/pitchObject). Setting yawObject/pitchObject to the desired
  // *combined* result directly would double-count whatever the magic
  // window is currently contributing, so subtract it out here instead —
  // that's what makes the combined result land exactly on yaw/pitch.
  setCameraLocalRotation: function (yaw, pitch) {
    var look = this.cameraEl && this.cameraEl.components['look-controls'];
    if (look && look.yawObject) {
      var magicWindow = look.magicWindowDeltaEuler;
      look.yawObject.rotation.y = yaw - (magicWindow ? magicWindow.y : 0);
      if (look.pitchObject) look.pitchObject.rotation.x = pitch - (magicWindow ? magicWindow.x : 0);
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
    this.watchPitchTransition = null;
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
    this.watchCursor.set(0, 0);
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

  // Mouse-drag and touch-drag pitch are already clamped to +/-90deg at
  // the source (look-controls' own onMouseMove, and semantic-look-
  // controls' onLook for gamepad/touch) -- but mobile's magic-window
  // (gyro) pitch isn't clamped anywhere: it's a direct, unbounded copy of
  // the phone's own physical tilt (see look-controls.js's
  // updateMagicWindowOrientation). Once combined with a nonzero yaw, a
  // magic-window pitch past +/-90deg composes into a 3D orientation that
  // sits exactly on the YXZ decomposition's gimbal lock -- yaw and roll
  // become degenerate there, so this whole file's YXZ-based reads
  // (getCameraLocalYaw/Pitch) come back with yaw flipped ~180deg and
  // pitch mirrored back into range, even though nothing about the actual
  // orientation looks out of range once decomposed. That's why this
  // clamps magicWindowDeltaEuler.x itself -- the raw, still-unambiguous
  // input -- rather than the camera's already-decomposed pose: by the
  // time a flip shows up in the decomposed values, the composition that
  // caused it has already happened and re-decomposing again can't tell
  // it apart from a legitimate orientation. Clamping a couple of degrees
  // short of the pole (89deg, not exactly 90) keeps every consumer of
  // the camera's pose safely on one side of it, however far the player
  // keeps tilting their phone. This runs after look-controls' own tick
  // this frame, so it recomputes the just-rendered pose from the clamped
  // input rather than leaving the flip to correct itself next frame.
  enforcePitchLimit: function () {
    var look = this.cameraEl && this.cameraEl.components['look-controls'];
    var magicWindow = look && look.magicWindowDeltaEuler;
    if (!magicWindow) return;
    var maxPitch = THREE.MathUtils.degToRad(89);
    if (magicWindow.x <= maxPitch && magicWindow.x >= -maxPitch) return;
    magicWindow.x = THREE.MathUtils.clamp(magicWindow.x, -maxPitch, maxPitch);
    if (look.updateOrientation) look.updateOrientation();
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
      // Aiming purely opposite the surface normal is a straight-on poke —
      // for a target that faces mostly up or down (a pedestal button),
      // that's a much bigger swing away from the hand's own resting
      // orientation than a real reach would be (nobody points straight
      // down at a button from directly above it; they reach in at an
      // angle). Blending in the natural "reach from roughly where you're
      // standing" direction keeps the preview's turn-to-point closer to
      // the hand's resting orientation, the same way an unmounted target's
      // preview already aims.
      var naturalReach = target.clone().sub(this.cameraWorldPosition()).normalize();
      direction = outwardNormal.clone().negate().addScaledVector(naturalReach, 0.6).normalize();
    } else {
      direction = target.clone().sub(this.cameraWorldPosition()).normalize();
      fingertip = target.clone().addScaledVector(direction, -standoff);
    }
    hand.setPointPose(fingertip, direction, 'Point');
  },

  // Places the real watch hand in a genuine "held up to your face, face
  // toward the camera" pose every tick (continuously, not a one-time
  // snapshot, so it tracks the player's position and crouch height while
  // the watch stays open — the camera itself is locked, so its facing
  // direction doesn't change on its own). This is the pose real VR
  // players put their wrist in to trigger the small up-close menu layout
  // (see menus.js's computeMode/computeAutomaticIntent) — scripting the
  // hand into it, rather than overriding where the panel renders, is what
  // lets projected-menu's own existing logic drive the menu correctly.
  placeWatchHand: function () {
    var watch = this.activeWatchHand.el.components['hand-with-watch'];
    if (!watch) return;
    var viewQuat = this.watchViewQuaternion();
    var camPos = this.cameraWorldPosition();
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewQuat);
    var right = new THREE.Vector3(1, 0, 0).applyQuaternion(viewQuat);
    var up = new THREE.Vector3(0, 1, 0).applyQuaternion(viewQuat);
    var side = this.activeWatchHand.data.hand === 'left' ? -1 : 1;
    var facePosition = camPos.clone()
      .addScaledVector(forward, 0.5)
      .addScaledVector(right, side * 0.07)
      .addScaledVector(up, -0.09);

    this._watchFaceScratch.position.copy(facePosition);
    this._watchFaceScratch.up.copy(up);
    this._watchFaceScratch.lookAt(camPos);
    var faceQuaternion = this._watchFaceScratch.quaternion.clone()
      .multiply(this._watchFaceFixQuat)
      .multiply(this._watchFaceRollQuat);

    var handPose = watch.computeHandPoseForFace(facePosition, faceQuaternion);
    this.activeWatchHand.setWorldTransform(handPose.position, handPose.quaternion, this.activeWatchHand.heldEl ? 'Hold' : 'Open');

    // The desktop equivalent of a physical poke: VR only ever opens a
    // watch once a real hand's pose already satisfies computeMode() (an
    // automatic-mode raise self-heals into that moment on its own; a
    // manual-mode poke is a physical collision, which by construction
    // can't happen until the hand is already there) — it never asks the
    // menu to open before the hand backing that request has arrived.
    // Scripting the hand into place over a few frames instead of
    // teleporting it means the same has to hold here: open the instant
    // the live pose first satisfies it, not before (openWatch no longer
    // opens it up front for exactly this reason). Edge-triggered on the
    // qualify/don't-qualify transition, not level-triggered on it — the
    // scripted hand keeps holding a qualifying pose for as long as watch
    // mode stays active, including the moment the player explicitly
    // clicks close, and a level check would immediately re-open it right
    // back (this is, in fact, exactly the bug that caused).
    var qualifies = Boolean(watch.projectedMenu.computeMode());
    if (qualifies && !this._watchWasQualifying && !watch.projectedMenu.active) watch.projectedMenu.open();
    this._watchWasQualifying = qualifies;
  },

  // Places the pointer hand close to the camera in the real VR "point"
  // pose (closed fist, extended finger — the same pose/laser mechanism
  // wireUpFingertipPointing already wires up in watch-menu.js), aimed at
  // wherever the invisible cursor currently is inside the watch panel.
  placeWatchPointer: function () {
    var viewQuat = this.watchViewQuaternion();
    var camPos = this.cameraWorldPosition();
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(viewQuat);
    var right = new THREE.Vector3(1, 0, 0).applyQuaternion(viewQuat);
    var up = new THREE.Vector3(0, 1, 0).applyQuaternion(viewQuat);
    var side = this.activePointerHand.data.hand === 'left' ? -1 : 1;
    var fingertip = camPos.clone()
      .addScaledVector(right, side * 0.24)
      .addScaledVector(up, -0.16)
      .addScaledVector(forward, 0.13);
    var cursorPoint = this.watchCursorWorldPoint();
    var direction = cursorPoint ? cursorPoint.sub(fingertip).normalize() : forward;
    this.activePointerHand.setPointPose(fingertip, direction, 'Point');
  },

  // Maps the invisible cursor (moved by onMouseMove/onSemanticLook, in
  // +/-1-ish normalized panel space) onto the currently visible watch
  // page's own authored background plane, so the pointer hand's laser
  // always lands somewhere sensible regardless of which page/template a
  // given game authors — see getWatchPanelExtent.
  watchCursorWorldPoint: function () {
    var watch = this.activeWatchHand && this.activeWatchHand.el.components['hand-with-watch'];
    var panelEl = watch && watch.projectedMenu && watch.projectedMenu.panelEl;
    if (!panelEl) return null;
    var extent = this.getWatchPanelExtent(panelEl);
    // watchCursor is already clamped to the same margin by moveWatchCursor.
    var localPoint = new THREE.Vector3(
      extent.centerX + this.watchCursor.x * extent.halfW,
      extent.centerY + this.watchCursor.y * extent.halfH,
      0.02
    );
    return panelEl.object3D.localToWorld(localPoint);
  },

  getWatchPanelExtent: function (panelEl) {
    var pages = panelEl.components['menu-pages'];
    var currentPage = pages && pages.currentPage;
    var pageEl = currentPage ? panelEl.querySelector('[data-menu-page="' + currentPage + '"]') : null;
    var background = (pageEl || panelEl).querySelector('a-plane, a-box');
    var geometry = background && background.getAttribute('geometry');
    var width = (geometry && geometry.width) || 1.2;
    var height = (geometry && geometry.height) || 2;
    var position = background ? background.object3D.position : null;
    return {
      halfW: width / 2,
      halfH: height / 2,
      centerX: position ? position.x : 0,
      centerY: position ? position.y : 0,
    };
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
    this.enforcePitchLimit();
    this.syncHandsToCameraPose();
    this.updateCrouch(delta);
    this.syncHandsToCameraPose();
    if (this.mode === 'normal') {
      this.applyMovement(delta);
      this.updateNormalHands();
    } else if (this.mode === 'watch') {
      // Movement (and crouch — see onKeyDown/onSemanticAction) still work
      // while checking the watch, per spec — only look is locked (see
      // setMode), with the freed-up look input driving the invisible
      // cursor instead (onMouseMove/onSemanticLook).
      this.applyMovement(delta);
      this.updateWatchPitchTransition(performance.now());
      this.placeWatchHand();
      this.placeWatchPointer();
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
    this.sceneEl.removeEventListener('semantic-tap', this.onSemanticTap);
    this.el.removeEventListener('semantic-action-intent', this.onSemanticAction);
    this.el.removeEventListener('semantic-look', this.onSemanticLook);
  },
});
