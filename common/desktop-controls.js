import './input-router.js';
import './interaction-hints.js';

var THREE = AFRAME.THREE;
var PREFERENCES_KEY = 'vr-showcase-player-preferences-v1';
var AIM_PITCH_LIMIT_DEG = 55; // see aimLookQuaternion -- a plausible wrist range, not a camera-comfort limit
var ADS_HAND_OFFSET = { x: 0.06, y: -0.09, z: -0.32 }; // camera-relative ADS hand position (dominant side), before a weapon's own aimOffset -- tune by feel per DESIGN.md; z is forward (camera-local -Z), matching every other offset in this file
var TWO_HAND_SPAN_FALLBACK = 0.4; // meters, only used if a supported weapon somehow declares heldPosition/supportGrip at the same point

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
  // Toggle is the default: it's the more accessible option (no button
  // needs to be held down for the whole time you're aiming).
  var fallback = { handedness: 'right', hintMode: 'delayed', aimMode: 'toggle' };
  try {
    var saved = JSON.parse(localStorage.getItem(PREFERENCES_KEY));
    if (saved && (saved.handedness === 'left' || saved.handedness === 'right')) fallback.handedness = saved.handedness;
    if (saved && ['always', 'delayed', 'never'].indexOf(saved.hintMode) !== -1) fallback.hintMode = saved.hintMode;
    if (saved && (saved.aimMode === 'hold' || saved.aimMode === 'toggle')) fallback.aimMode = saved.aimMode;
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
    // Snapshotted once when the watch opens and held fixed until it
    // closes — see captureWatchAnchor/watchViewQuaternion.
    this.watchAnchorQuaternion = null;
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
    this._pendingMountedTransition = null;
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
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this._aimKeyHeld = false; // raw right mouse button -- see onPointerDown/onPointerUp
    this._aimActionHeld = false; // touch/gamepad's semantic 'aim' action -- see onSemanticAction
    // Both are literally "is the button down" in hold mode, and a
    // press-triggered flip-flop in toggle mode (this.preferences.aimMode,
    // default 'toggle' -- see readPreferences/the aim-mode menu-option).
    this.isAiming = false; // the two above, combined -- see updateAiming
    this.onSemanticTap = this.onSemanticTap.bind(this);
    this.onMountedRequest = this.onMountedRequest.bind(this);
    this.onActiveMenuClosed = this.onActiveMenuClosed.bind(this);
    this.onPreferenceChange = this.onPreferenceChange.bind(this);
    this.onWatchReady = this.syncPreferenceControls.bind(this);
    this.onControlModeChanged = this.handleControlModeChanged.bind(this);
    this.onSemanticAction = this.onSemanticAction.bind(this);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('pointerdown', this.onPointerDown, true);
    document.addEventListener('pointerup', this.onPointerUp, true);
    document.addEventListener('contextmenu', this.onContextMenu, true);
    this.sceneEl.addEventListener('mounted-interaction-request', this.onMountedRequest);
    this.sceneEl.addEventListener('menu-option-change', this.onPreferenceChange);
    this.sceneEl.addEventListener('watch-menu-ready', this.onWatchReady);
    this.sceneEl.addEventListener('control-mode-changed', this.onControlModeChanged);
    this.sceneEl.addEventListener('semantic-tap', this.onSemanticTap);
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
    } else if (detail.key === 'aim-mode' && (detail.value === 'hold' || detail.value === 'toggle')) {
      this.preferences.aimMode = detail.value;
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
      if (component.data.key === 'aim-mode') component.setValue(preferences.aimMode);
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
    } else if (evt.code === 'Digit1' || evt.code === 'Digit2' || evt.code === 'Digit3') {
      evt.preventDefault();
      if (this.mode === 'normal') this.emitHotbarFallback(Number(evt.code.slice(-1)));
    }
  },

  onKeyUp: function (evt) {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].indexOf(evt.code) !== -1) {
      this.keys[evt.code] = false;
      evt.preventDefault();
    }
  },

  // Mouse clicks and touch taps landing directly on the canvas both end up
  // here. Both mounted panels and the watch aim with the fixed center
  // reticle (mouse-look/touch-drag/gyro turn the camera to point it — see
  // setMode/currentAimDirection); a touch tap that reaches the canvas
  // directly (nothing else caught it first) just activates whatever that
  // reticle is over. Watch mode selects through the real fingertip laser
  // instead (see activateMenuSelection) — a tap here or via onSemanticTap
  // below only ever activates whatever it's currently pointing at.
  onPointerDown: function (evt) {
    if (xrIsPresenting(this.sceneEl)) return;
    if (this.mode === 'normal') {
      // Touch gets its own explicit FIRE button (routed through
      // onSemanticAction's 'activate' fallback below) rather than a raw
      // tap here: the touch look-area covers most of the screen for
      // free-look dragging, and a raw pointerdown fires at the very start
      // of every drag, before touch-controls' own tap-vs-drag
      // disambiguation has a chance to rule it out — so a tap-to-fire here
      // would also fire on every look-drag, not just a deliberate tap.
      if (evt.pointerType === 'mouse' && evt.button === 0) this.emitTriggerFallback();
      else if (evt.pointerType === 'mouse' && evt.button === 2) {
        // Toggle mode only reacts to the press -- release is a no-op,
        // handled below in onPointerUp.
        this._aimKeyHeld = this.preferences.aimMode === 'toggle' ? !this._aimKeyHeld : true;
        this.updateAiming();
      }
      return;
    }
    if (!this.activePointerHand) return;
    if (evt.pointerType === 'touch') {
      if (this.mode === 'watch' && evt.target !== this.sceneEl.canvas) return;
    } else if (evt.pointerType === 'mouse' && evt.button !== 0) {
      return;
    }
    evt.preventDefault();
    this.activateMenuSelection();
  },

  // No pointerup listener existed in this file before ADS needed one --
  // every other mouse/touch interaction here is a one-shot tap, not a
  // hold. Right mouse button only; left-button release needs no handling
  // since fire is already a tap (emitTriggerFallback), not a hold.
  onPointerUp: function (evt) {
    if (evt.pointerType === 'mouse' && evt.button === 2 && this.preferences.aimMode !== 'toggle') {
      this._aimKeyHeld = false;
      this.updateAiming();
    }
  },

  // Right-click drives ADS (see onPointerDown/onPointerUp) instead of the
  // browser's own context menu while playing.
  onContextMenu: function (evt) {
    evt.preventDefault();
  },

  // Combines mouse (onPointerDown/onPointerUp) and touch/gamepad
  // (onSemanticAction's 'aim' branch) into one flag per hand, mirroring
  // how sprint is already split between this file's own key-polling and
  // locomotion.js's separate gamepadSprinting. Every hand gets the same
  // flag rather than just the dominant one, since a drawn firearm can end
  // up in either hand (see core-equip.js's hotbar system) and each
  // hand's own placeHeldHand only acts on it while actually holding one.
  updateAiming: function () {
    this.isAiming = Boolean(this._aimKeyHeld || this._aimActionHeld);
    var aiming = this.isAiming;
    ['left', 'right'].forEach(function (side) {
      var hand = this.hands[side];
      if (hand) hand.setAiming(aiming);
    }, this);
  },

  // The 'normal' mode mirror of emitGrabFallback: no menu/mounted/watch
  // interaction is active, so a primary click/tap here isn't claimed by
  // anything in this file. Left deliberately non-preventDefault()'d so
  // A-Frame's own `cursor` component (the reticle+.shootable click
  // fallback some games use) keeps working exactly as before for anyone
  // not listening for this.
  // Both hands, not just the dominant one: a weapon can now end up in
  // either hand (Pistols' numbered holster keys draw the left hip
  // holster into the left hand specifically, regardless of handedness
  // preference — see core-equip.js's activateHotbarSlot), so firing
  // can't assume it's always the dominant hand holding something.
  // Whichever hand's own listener actually has a firearm decides for
  // itself; the other silently no-ops, the same way it already does
  // for an empty-handed dominant hand today.
  emitTriggerFallback: function () {
    var self = this;
    ['left', 'right'].forEach(function (side) {
      var hand = self.hands[side];
      if (hand) hand.el.emit('desktop-trigger-attempt', { source: 'desktop' }, false);
    });
  },

  // Mobile's look-drag area (common/input-router.js's touch-controls)
  // covers most of the screen so the player can still drag it to look
  // around while checking the watch — which means it also swallows a
  // plain tap before it ever reaches the canvas, including taps on an
  // always-open fixed panel (STYLE 1 in the showcase) that isn't part of
  // watch/mounted mode at all and would otherwise only ever be reachable
  // through the native mouse click A-Frame's own cursor component
  // already handles on desktop. touch-controls tells short,
  // near-stationary presses apart from real drags and re-emits those as
  // this scene-level event instead.
  onSemanticTap: function () {
    if (xrIsPresenting(this.sceneEl)) return;
    if (this.mode !== 'watch' && this.mode !== 'normal') return;
    this.activateMenuSelection();
  },

  // Watch mode always goes through the real fingertip laser/cursor —
  // wireUpFingertipPointing (watch-menu.js), the exact mechanism VR uses,
  // now made reliable because the pointer hand is actually posed and
  // aimed correctly (see placeWatchPointer, which aims it the same way
  // placeMountedPointer aims at a wall panel — at wherever the fixed
  // center reticle currently lands). data-ray-target is set by that same
  // physical raycaster whenever it's currently hitting something
  // (interaction-hints.js); if it hasn't settled yet (the ~180ms
  // point-gesture delay after gripdown — see openWatch) or isn't hitting
  // anything, the click is simply a no-op, same as VR.
  activateMenuSelection: function () {
    if (xrIsPresenting(this.sceneEl)) return false;
    if (this.mode === 'normal') return this.clickNormalModeMenuTarget();
    if (!this.activePointerHand) return false;
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
    // 'aim' is a hold, not a one-shot tap -- it needs the 'start'/'cancel'
    // phases the blanket perform-only guard below exists to ignore for
    // every other (one-shot) action here, so it's handled before that
    // guard, the same way semantic-punch-controls' own onIntent reacts to
    // phases other than 'perform' on this identical event.
    if (detail.action === 'aim') {
      if (!xrIsPresenting(this.sceneEl)) {
        if (this.preferences.aimMode === 'toggle') {
          if (detail.phase === 'start') this._aimActionHeld = !this._aimActionHeld;
        } else {
          this._aimActionHeld = detail.phase === 'start';
        }
        this.updateAiming();
      }
      return;
    }
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
      // activateMenuSelection() claims this in 'watch'/'mounted' mode, or
      // in 'normal' mode for a game that actually has .menu-target
      // elements (the Showcase's always-open panel). Nothing here claims
      // it for Pistols, so it falls through to the same trigger-fallback
      // mechanism the mouse-click path uses (onPointerDown) — this is what
      // gives gamepad's primary button and touch's FIRE button a working
      // shot, for free, via the exact same desktop-trigger-attempt event.
      if (!this.activateMenuSelection()) this.emitTriggerFallback();
    } else if (detail.action === 'hotbar1') {
      this.emitHotbarFallback(1, source);
    } else if (detail.action === 'hotbar2') {
      this.emitHotbarFallback(2, source);
    } else if (detail.action === 'hotbar3') {
      this.emitHotbarFallback(3, source);
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

  // 'normal' mode has no scripted pointer hand and no single tracked
  // "active menu" the way mounted/watch do — an always-open fixed panel
  // (STYLE 1 in the showcase) just sits there, driven by the plain
  // gaze-cursor raycaster, so the nearest .menu-target to the fixed
  // center reticle is searched for document-wide rather than within a
  // scope. On desktop this duplicates what A-Frame's own cursor
  // component already does for that raycaster's native mouse click; it
  // only matters for mobile, where onSemanticTap is the sole way a tap
  // ever reaches it (see that comment).
  clickNormalModeMenuTarget: function () {
    var target = this.findNearestMenuTarget(this.sceneEl, 0.055);
    if (!target) return false;
    target.emit('click', null, false);
    return true;
  },

  getActiveMenuScope: function () {
    if (this.mode === 'mounted' && this.activeMounted) {
      var menu = this.activeMounted.el.components['projected-menu'];
      return menu && menu.panelEl;
    }
    if (this.mode === 'watch' && this.activeWatchHand) {
      var watch = this.activeWatchHand.el.components['hand-with-watch'];
      return watch && watch.projectedMenu && watch.projectedMenu.panelEl;
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
    if (!this.manualCrouched) {
      var shoulderYOffset = this.data.crouchHeight - this.cameraEl.object3D.position.y;
      var crouchCandidate = this.hintSystem.getDesktopCrouchCandidate('grab', shoulderYOffset);
      if (crouchCandidate) {
        this.beginAutoCrouch(crouchCandidate, source);
        return;
      }
    }
    this.emitGrabFallback(source);
  },

  // Nothing in the hint-zone/simple-grabbable candidate system claimed this
  // grab. This file has no idea what a physically-grabbed prop (a
  // Pistols-style holsterable gun, say) looks like — that's game-specific —
  // so it just announces "a grab was attempted by this hand" on the hand
  // element itself and leaves it to whoever else is listening. A no-op for
  // any scene where nothing listens for it.
  emitGrabFallback: function (source) {
    var dominant = this.getDominantHand();
    if (dominant) dominant.el.emit('desktop-grab-attempt', { source: source || 'desktop' }, false);
  },

  // The numbered-holster equivalent of emitGrabFallback. Unlike grab/
  // trigger there's no per-hand ambiguity to resolve here (the whole point
  // of a fixed slot is that it already says which hand it wants), so this
  // fires once at the scene level rather than on a specific hand element —
  // this file still has no idea what slot 1/2/3 mean, only Pistols does
  // (see core-equip.js's activateHotbarSlot).
  emitHotbarFallback: function (slot, source) {
    this.sceneEl.emit('desktop-hotbar-attempt', { slot: slot, source: source || 'desktop' }, false);
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
    this.setMode('watch');
    // Snapshot the reference direction the watch face gets held up along
    // (see captureWatchAnchor/watchViewQuaternion) instead of freezing the
    // camera onto it. The camera stays free the whole time watch mode is
    // open, exactly like a mounted panel — placeWatchPointer aims the
    // pointer hand at wherever the fixed center reticle currently lands
    // on the now-stationary watch face, the same way placeMountedPointer
    // aims at a wall panel, so turning your head (or your phone) picks
    // out a different part of the watch instead of dragging the whole
    // thing around with your view.
    this.captureWatchAnchor();
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

  clampedCameraPitch: function () {
    return THREE.MathUtils.clamp(
      this.getCameraLocalPitch(),
      THREE.MathUtils.degToRad(-20),
      THREE.MathUtils.degToRad(30)
    );
  },

  // The reference direction every watch-mode placement below is built
  // from — see openWatch/watchViewQuaternion for why this is captured
  // once on open rather than read live every tick.
  captureWatchAnchor: function () {
    var pitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), this.clampedCameraPitch());
    this.watchAnchorQuaternion = this.cameraYawQuaternion().multiply(pitchQuat);
  },

  // Snapshotted once when the watch opens (see captureWatchAnchor) and
  // held fixed for as long as it stays open, rather than read live off
  // the camera every tick like it used to be. The camera is free to move
  // the whole time now (see setMode) — freezing this direction, not the
  // camera, is what lets you turn your head to aim your finger at a
  // different part of a *fixed* watch face, the same way turning it aims
  // at a different part of a fixed wall panel (see currentAimDirection),
  // while the watch face itself still stays in front of you as you walk
  // or crouch (placeWatchHand/placeWatchPointer read the camera's
  // position live, just not its orientation).
  watchViewQuaternion: function () {
    return this.watchAnchorQuaternion;
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
    this.mountedTransition = null;
    // Reaching the trigger and stepping back to a comfortable framing
    // distance (see mounted-interaction's getFramedInteractionDistance,
    // which can put that distance well past normal arm's reach) used to
    // both start right here, at the same time — meaning the pointer
    // hand's own reach toward the trigger and the rig's own step-back
    // were racing each other, and a wide enough framing distance let the
    // step-back win, leaving the hand stranded short of the trigger for
    // the whole poke window. Stashing the step-back instead of starting
    // it fixes that by construction: the poke below runs first, from
    // wherever the player is already standing (necessarily within the
    // hint-zone's own reach check, so always close), and only once the
    // panel has actually opened does startMountedPoke kick off the
    // step-back — see beginMountedStepBack.
    this._pendingMountedTransition = {
      duration: duration,
      startPosition: this.el.object3D.position.clone(),
      targetPosition: targetRigPosition,
      startYaw: startYaw,
      yawDelta: yawDelta,
      startPitch: startPitch,
      pitchDelta: pitchDelta,
    };
    this.setMode('mounted');
    this.startMountedPoke();
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
      self.beginMountedStepBack();
    }, 400);
  },

  beginMountedStepBack: function () {
    if (!this._pendingMountedTransition) return;
    this.mountedTransition = this._pendingMountedTransition;
    this.mountedTransition.startedAt = performance.now();
    this._pendingMountedTransition = null;
    this.el.setAttribute('data-mounted-transition', 'moving');
  },

  exitInteraction: function (restoreMode) {
    if (this.mountedOpenTimer) clearTimeout(this.mountedOpenTimer);
    this.mountedOpenTimer = null;
    this.mountedTransition = null;
    this._pendingMountedTransition = null;
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
    this.watchAnchorQuaternion = null;
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

  // A held firearm's aim direction should track where the camera is
  // actually looking, not just its yaw (that's cameraYawQuaternion, used
  // for every other held/resting pose) -- otherwise a desktop/mobile
  // player can never aim up or down at all. Clamped to a plausible aim
  // cone rather than the camera's full look-controls-clamped pitch range
  // (enforcePitchLimit's own ~89deg is a gimbal-lock guard, not a
  // "can your wrist actually point this far" one), and roll is always
  // dropped -- a gun doesn't twist with a mobile magic-window wobble.
  aimLookQuaternion: function () {
    this.cameraEl.object3D.getWorldQuaternion(this._cameraQuaternion);
    var euler = new THREE.Euler().setFromQuaternion(this._cameraQuaternion, 'YXZ');
    var pitchLimit = THREE.MathUtils.degToRad(AIM_PITCH_LIMIT_DEG);
    var pitch = THREE.MathUtils.clamp(euler.x, -pitchLimit, pitchLimit);
    return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, euler.y, 0, 'YXZ'));
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
    var firearm = hand.heldEl && hand.heldEl.components && hand.heldEl.components.firearm;
    if (firearm && hand.isAiming) return this.placeAimedHand(hand, firearm);
    var sideX = hand.data.hand === 'left' ? -0.2 : 0.2;
    var position = this.cameraOffsetToWorld(new THREE.Vector3(sideX, -0.25, -0.48), true);
    var orientation = firearm ? this.firearmAimQuaternion(hand.heldEl) : this.cameraYawQuaternion();
    hand.setWorldTransform(position, orientation, 'Hold');
  },

  // The hand orientation that makes a held firearm's muzzle point exactly
  // along the camera's look direction (aimLookQuaternion) -- used for
  // both loose hip-fire tracking above and precise ADS below, since the
  // target DIRECTION is identical in both; only the hand's target
  // position (hip-level vs. near the eye) and how much wobble rides on
  // top of it differ. The held item is a rigid child of the hand's grip
  // point at a fixed local heldRotation (holsterable's own per-weapon
  // correction -- see items-guns.js's comment above the pistol's
  // declaration: it's tuned against a REAL tracked controller's own raw
  // grip-pose convention, which does NOT put "forward" on the hand's own
  // local -Z, so this has to invert it rather than skip it). Pointing the
  // muzzle at camera-forward means solving for the one hand orientation
  // that, once heldRotation is applied on top of it, lands exactly there:
  // hand = cameraLook * heldRotation^-1.
  firearmAimQuaternion: function (heldEl) {
    var heldRotation = heldEl.components.holsterable.data.heldRotation;
    var heldRotationQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(heldRotation.x),
      THREE.MathUtils.degToRad(heldRotation.y),
      THREE.MathUtils.degToRad(heldRotation.z)
    ));
    var quat = this.aimLookQuaternion();
    quat.multiply(heldRotationQuat.invert());
    return quat;
  },

  // ADS: same aim direction as hip-fire (firearmAimQuaternion), but the
  // hand itself moves to a near-eye position (per weapon --
  // firearm.aimOffset) instead of staying at hip level. Wobble (hand-
  // rig's grip child) still rides on top of this every tick, same as any
  // other pose -- this only computes the base, steadied-but-not-zeroed
  // target.
  //
  // Dual-wielding is the one case that keeps the old side offset: two
  // pistols held symmetrically out to each side, both pointed at
  // camera-forward, already reads as a natural akimbo aim ("works
  // beautifully" per the request) and both hands are equally busy, so
  // there's no third hand to bring in. Single-wielding centers the gun
  // instead -- the camera should look straight over the top of it,
  // through the sights, not off to one side -- and brings the idle off
  // hand in close (placeSupportingHand) for a supported-looking stance.
  placeAimedHand: function (hand, firearm) {
    var otherHand = hand.data.hand === 'left' ? this.hands.right : this.hands.left;
    var dualWielding = Boolean(otherHand && otherHand.heldEl && otherHand.heldEl.components.firearm);
    var aimOffset = firearm.data.aimOffset;
    var sideX = dualWielding ? (hand.data.hand === 'left' ? -ADS_HAND_OFFSET.x : ADS_HAND_OFFSET.x) : 0;
    var position = this.cameraOffsetToWorld(new THREE.Vector3(
      sideX + aimOffset.x,
      ADS_HAND_OFFSET.y + aimOffset.y,
      ADS_HAND_OFFSET.z + aimOffset.z
    ), true);
    var quat = this.firearmAimQuaternion(hand.heldEl);
    hand.setWorldTransform(position, quat, 'Hold');

    if (!dualWielding && otherHand && !otherHand.heldEl) this.placeSupportingHand(otherHand, position, quat);
  },

  // Cosmetic only -- see findCosmeticSupportHand for why. Cups in close
  // to the shooting hand roughly where a real supporting hand would sit,
  // rather than actually attaching to anything.
  placeSupportingHand: function (hand, primaryPosition, primaryQuat) {
    var side = hand.data.hand === 'left' ? -1 : 1;
    var offset = new THREE.Vector3(side * 0.035, -0.03, 0.05).applyQuaternion(primaryQuat);
    hand.setWorldTransform(primaryPosition.clone().add(offset), primaryQuat, 'Hold');
  },

  // A real two-handed grip: the gun's own orientation is entirely
  // derived (by holsterable.applyTwoHandedPose, core-equip.js) from the
  // vector between the dominant hand's grip and the support hand's grip,
  // so getting the aim right here means placing the SUPPORT hand along
  // the desired barrel direction from the dominant hand, not computing
  // any quaternion for the gun directly -- that math already exists and
  // this only has to feed it correct hand positions. Both hands share
  // one orientation (aiming direction, yaw-only at rest) so their
  // averaged "up" -- what applyTwoHandedPose reads for roll -- comes out
  // level, matching "looking down the sights, across the top."
  placeTwoHandedFirearm: function (dominantHand, supportHand, heldEl) {
    var holsterable = heldEl.components.holsterable;
    var aiming = dominantHand.isAiming;
    var handQuat = aiming ? this.aimLookQuaternion() : this.cameraYawQuaternion();

    var dominantPosition;
    if (aiming) {
      var firearm = heldEl.components.firearm;
      var aimOffset = firearm.data.aimOffset;
      dominantPosition = this.cameraOffsetToWorld(new THREE.Vector3(
        aimOffset.x,
        ADS_HAND_OFFSET.y + aimOffset.y,
        ADS_HAND_OFFSET.z + aimOffset.z
      ), true);
    } else {
      dominantPosition = this.cameraOffsetToWorld(new THREE.Vector3(0, -0.25, -0.48), true);
    }
    dominantHand.setWorldTransform(dominantPosition, handQuat, 'Hold');

    var hp = holsterable.data.heldPosition;
    var sg = holsterable.data.supportGrip;
    var handSpan = Math.hypot(sg.x - hp.x, sg.y - hp.y, sg.z - hp.z) || TWO_HAND_SPAN_FALLBACK;
    var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(handQuat);
    var supportPosition = dominantPosition.clone().addScaledVector(forward, handSpan);
    supportHand.setWorldTransform(supportPosition, handQuat, 'Hold');
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
  // the watch stays open — its facing direction is pinned to the
  // snapshotted watchViewQuaternion rather than the live camera, so it
  // doesn't spin around with your view). This is the pose real VR
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
  // wherever the fixed center reticle currently lands on the watch face —
  // exactly like placeMountedPointer aims at a wall panel.
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
    this.activePointerHand.setPointPose(fingertip, this.currentAimDirection(fingertip), 'Point');
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
    var twoHanded = this.findTwoHandedFirearm();
    if (twoHanded) {
      this.placeTwoHandedFirearm(twoHanded.dominant, twoHanded.support, twoHanded.heldEl);
      return;
    }

    var cosmeticSupport = this.findCosmeticSupportHand();
    var candidate = this.autoCrouch && this.autoCrouch.phase === 'down'
      ? this.autoCrouch.candidate
      : this.hintSystem.desktopCandidate;
    ['left', 'right'].forEach(function (side) {
      var hand = this.hands[side];
      if (!hand) return;
      // Already placed by placeAimedHand below, as part of the hand it's
      // supporting -- see findCosmeticSupportHand/placeSupportingHand.
      if (cosmeticSupport === hand) return;
      if (hand.heldEl) this.placeHeldHand(hand);
      else if (candidate && candidate.hand === hand) this.placeCandidatePreview(candidate);
      else this.placeRestHand(hand);
    }, this);
  },

  // A real two-handed grip (holsterable.supportHand actually set — see
  // core-hand-rig.js's autoGrabSupport, the desktop/mobile equivalent of
  // a VR player physically reaching to a shotgun's forend): both hands
  // need to be positioned as a pair every tick, since the gun's own
  // orientation is entirely derived from the vector between them
  // (holsterable.applyTwoHandedPose, core-equip.js) — placing them
  // independently the way a single-hand weapon's hands are placed would
  // fight that derivation instead of feeding it.
  findTwoHandedFirearm: function () {
    var hands = [this.hands.left, this.hands.right];
    for (var i = 0; i < hands.length; i++) {
      var hand = hands[i];
      if (!hand || !hand.heldEl) continue;
      var holsterable = hand.heldEl.components.holsterable;
      if (!holsterable || !holsterable.supportHand || !holsterable.data.supportAims) continue;
      var otherHand = hands[1 - i];
      if (!otherHand || otherHand.el !== holsterable.supportHand) continue;
      return { dominant: hand, support: otherHand, heldEl: hand.heldEl };
    }
    return null;
  },

  // No real two-handed grab exists for a single pistol (holsterable.
  // supportRadius is 0 by schema default, and no pistol overrides it) —
  // per the request, bringing the idle off hand in close while aiming
  // one-handed is purely cosmetic. Only when NOT dual-wielding (the
  // other hand isn't also holding a firearm, which already has its own
  // good-looking symmetric aim -- see placeAimedHand) and the other hand
  // is otherwise completely empty.
  findCosmeticSupportHand: function () {
    var hands = [this.hands.left, this.hands.right];
    for (var i = 0; i < hands.length; i++) {
      var hand = hands[i];
      if (!hand || !hand.heldEl || !hand.isAiming) continue;
      if (!hand.heldEl.components.firearm) continue;
      var holsterable = hand.heldEl.components.holsterable;
      if (holsterable && holsterable.supportHand) continue; // real two-handed grip already covers this
      var otherHand = hands[1 - i];
      if (!otherHand || otherHand.heldEl) continue;
      return otherHand;
    }
    return null;
  },

  applyMovement: function (delta) {
    if (this.autoCrouch) return;
    var x = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    var z = (this.keys.KeyS ? 1 : 0) - (this.keys.KeyW ? 1 : 0);
    if (!x && !z) return;
    var locomotion = this.el.components['locomotion-demo'];
    var sprint = this.data.sprintEnabled && Boolean(this.keys.ShiftLeft || this.keys.ShiftRight);
    if (locomotion && locomotion.applyDesktopMove) locomotion.applyDesktopMove(x, z, delta, sprint, this.isAiming);
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
      // Movement and crouch still work while checking the watch, per
      // spec (see onKeyDown/onSemanticAction) — look stays free too, same
      // as mounted mode (see setMode/captureWatchAnchor).
      this.applyMovement(delta);
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
    document.removeEventListener('pointerup', this.onPointerUp, true);
    document.removeEventListener('contextmenu', this.onContextMenu, true);
    this.sceneEl.removeEventListener('mounted-interaction-request', this.onMountedRequest);
    this.sceneEl.removeEventListener('menu-option-change', this.onPreferenceChange);
    this.sceneEl.removeEventListener('watch-menu-ready', this.onWatchReady);
    this.sceneEl.removeEventListener('control-mode-changed', this.onControlModeChanged);
    this.sceneEl.removeEventListener('semantic-tap', this.onSemanticTap);
    this.el.removeEventListener('semantic-action-intent', this.onSemanticAction);
  },
});
