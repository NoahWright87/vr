import './interaction-hints.js';

var THREE = AFRAME.THREE;
var PREFERENCES_KEY = 'vr-showcase-player-preferences-v1';

function xrIsPresenting(sceneEl) {
  return Boolean(sceneEl && sceneEl.renderer && sceneEl.renderer.xr && sceneEl.renderer.xr.isPresenting);
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
  },

  init: function () {
    var self = this;
    this.sceneEl = this.el.sceneEl;
    this.cameraEl = this.data.camera || this.el.querySelector('a-camera') || document.querySelector('a-camera');
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
    this.mountedPokingUntil = 0;
    this._worldPosition = new THREE.Vector3();
    this._worldQuaternion = new THREE.Quaternion();
    this._cameraQuaternion = new THREE.Quaternion();
    this._cameraPosition = new THREE.Vector3();
    this._targetPosition = new THREE.Vector3();
    this._normal = new THREE.Vector3();
    this._direction = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMountedRequest = this.onMountedRequest.bind(this);
    this.onActiveMenuClosed = this.onActiveMenuClosed.bind(this);
    this.onPreferenceChange = this.onPreferenceChange.bind(this);
    this.onWatchReady = this.syncPreferenceControls.bind(this);
    document.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('keyup', this.onKeyUp, true);
    document.addEventListener('mousedown', this.onMouseDown, true);
    this.sceneEl.addEventListener('mounted-interaction-request', this.onMountedRequest);
    this.sceneEl.addEventListener('menu-option-change', this.onPreferenceChange);
    this.sceneEl.addEventListener('watch-menu-ready', this.onWatchReady);
    this.sceneEl.addEventListener('enter-vr', function () { self.exitInteraction(false); });
    this.sceneEl.addEventListener('exit-vr', function () { self.setMode('normal'); });

    this.setMode('normal');
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
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(evt.code) !== -1) {
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
    } else if (evt.code === 'KeyF') {
      evt.preventDefault();
      if (this.mode !== 'normal') return;
      var heldHand = this.findHeldHand();
      if (heldHand) {
        var held = heldHand.heldEl.components['simple-grabbable'];
        if (held) held.release(heldHand.el);
        return;
      }
      var grabCandidate = this.hintSystem.getDesktopCandidate('grab');
      if (grabCandidate) {
        grabCandidate.hand.setPointPose(
          grabCandidate.zone.getWorldPosition(new THREE.Vector3()),
          grabCandidate.zone.getWorldPosition(new THREE.Vector3()).sub(this.cameraWorldPosition()).normalize(),
          'Hold',
          true
        );
        this.hintSystem.activateForHand('grab', grabCandidate.hand.el, 'start', 'desktop');
      }
    }
  },

  onKeyUp: function (evt) {
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].indexOf(evt.code) !== -1) {
      this.keys[evt.code] = false;
      evt.preventDefault();
    }
  },

  onMouseDown: function (evt) {
    if (evt.button !== 0 || this.mode === 'normal' || !this.activePointerHand || xrIsPresenting(this.sceneEl)) return;
    evt.preventDefault();
    var handEl = this.activePointerHand.el;
    if (handEl.hasAttribute('data-ray-target')) {
      handEl.emit('triggerdown', null, false);
      requestAnimationFrame(function () { handEl.emit('triggerup', null, false); });
      return;
    }
    this.clickDesktopMenuTarget();
  },

  clickDesktopMenuTarget: function () {
    if (!this.activePointerHand) return false;
    var best = null;
    var scope = this.getActiveMenuScope();
    if (!scope) return false;
    Array.prototype.forEach.call(scope.querySelectorAll('.menu-target'), function (targetEl) {
      if (!targetEl.object3D || !visibleInHierarchy(targetEl.object3D)) return;
      var projected = new THREE.Vector3();
      targetEl.object3D.getWorldPosition(projected);
      projected.project(this.sceneEl.camera);
      if (projected.z < -1 || projected.z > 1) return;
      var distance = this.cursorNdc.distanceToSquared(projected);
      if (!best || distance < best.distance) best = { el: targetEl, distance: distance };
    }, this);
    if (!best || best.distance > 0.055) return false;
    var menuItem = best.el.getAttribute('menu-item');
    this.activePointerHand.el.setAttribute('data-ray-target', (menuItem && (menuItem.value || menuItem.label)) || best.el.id || 'target');
    best.el.emit('click', null, false);
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
    if (evt.detail.source !== 'desktop' || this.mode !== 'normal') return;
    this.beginMounted(evt.detail.component, evt.detail.handEl.components['semantic-hand']);
  },

  setMode: function (mode) {
    this.mode = mode;
    this.cursorNdc.set(0, 0);
    this.el.setAttribute('data-desktop-mode', mode);
    this.hintSystem.setTargetingEnabled(mode === 'normal');
    this.setLookEnabled(true);
    this.setGazeEnabled(mode === 'normal');
    this.setMenuCursorHidden(mode !== 'normal');
  },

  setMenuCursorHidden: function (hidden) {
    var canvas = this.sceneEl.canvas;
    if (!canvas) return;
    if (hidden && !this.cursorStyleEl) {
      this.cursorStyleEl = document.createElement('style');
      this.cursorStyleEl.textContent = 'canvas.desktop-menu-aiming { cursor: none !important; }';
      document.head.appendChild(this.cursorStyleEl);
    }
    canvas.classList.toggle('desktop-menu-aiming', hidden);
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
    this.setMode('watch');
    this.ensureMouseLookCapture();
    watch.projectedMenu.openInMode('laser');
    this.placeWatchHand(true);
    this.placeWatchPointer(true);
    pointerHand.el.emit('gripdown', null, false);
    var self = this;
    setTimeout(function () {
      if (self.mode !== 'watch' || self.activeWatchHand !== watchHand) return;
      self.placeWatchPointer(true);
    }, 350);
  },

  beginMounted: function (component, hand) {
    if (!component || !hand || xrIsPresenting(this.sceneEl)) return;
    var anchor = component.getAnchorWorldPosition(new THREE.Vector3());
    if (anchor) {
      this.cameraEl.object3D.getWorldPosition(this._cameraPosition);
      this.el.object3D.position.x += anchor.x - this._cameraPosition.x;
      this.el.object3D.position.z += anchor.z - this._cameraPosition.z;
      this.el.object3D.updateMatrixWorld(true);
    }
    this.activeMounted = component;
    this.activePointerHand = hand;
    this.trackActiveMenu(component.el);
    this.mountedPokingUntil = performance.now() + 220;
    this.setMode('mounted');
    this.ensureMouseLookCapture();
    this.placeMountedPoke(true);
    hand.el.emit('gripdown', null, false);
    var self = this;
    setTimeout(function () {
      if (self.activeMounted !== component) return;
      component.open();
    }, 140);
  },

  exitInteraction: function (restoreMode) {
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
    var position = this.cameraOffsetToWorld(new THREE.Vector3(sideX, -0.38, -0.42), false);
    hand.setWorldTransform(position, this.cameraYawQuaternion(), hand.heldEl ? 'Hold' : 'Open', true);
  },

  placeHeldHand: function (hand) {
    var sideX = hand.data.hand === 'left' ? -0.2 : 0.2;
    var position = this.cameraOffsetToWorld(new THREE.Vector3(sideX, -0.25, -0.48), true);
    hand.setWorldTransform(position, this.cameraYawQuaternion(), 'Hold', true);
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

  placeWatchHand: function (snap) {
    var watchSideX = this.activeWatchHand.data.hand === 'left' ? -0.2 : 0.2;
    var watchPosition = this.cameraOffsetToWorld(new THREE.Vector3(watchSideX, -0.08, -0.64), true);
    var watchQuaternion = this.cameraYawQuaternion().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, 0, watchSideX < 0 ? -0.2 : 0.2)));
    this.activeWatchHand.setWorldTransform(watchPosition, watchQuaternion, 'Open', snap);
  },

  placeWatchPointer: function (snap) {
    var pointerSideX = this.activePointerHand.data.hand === 'left' ? -0.26 : 0.26;
    var fingertip = this.cameraOffsetToWorld(new THREE.Vector3(pointerSideX, -0.26, -0.43), true);
    this.activePointerHand.setPointPose(fingertip, this.currentAimDirection(fingertip), 'Point', snap !== false);
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
    this.activePointerHand.setPointPose(fingertip, this.currentAimDirection(fingertip), 'Point', true);
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
    var candidate = this.hintSystem.desktopCandidate;
    ['left', 'right'].forEach(function (side) {
      var hand = this.hands[side];
      if (!hand) return;
      if (hand.heldEl) this.placeHeldHand(hand);
      else if (candidate && candidate.hand === hand) this.placeCandidatePreview(candidate);
      else this.placeRestHand(hand);
    }, this);
  },

  applyMovement: function (delta) {
    var x = (this.keys.KeyD ? 1 : 0) - (this.keys.KeyA ? 1 : 0);
    var z = (this.keys.KeyS ? 1 : 0) - (this.keys.KeyW ? 1 : 0);
    if (!x && !z) return;
    var locomotion = this.el.components['locomotion-demo'];
    if (locomotion && locomotion.applyDesktopMove) locomotion.applyDesktopMove(x, z, delta);
  },

  tick: function (time, delta) {
    if (xrIsPresenting(this.sceneEl)) return;
    this.closeUnrequestedDesktopWatches();
    if (this.mode === 'normal') {
      this.applyMovement(delta);
      this.updateNormalHands();
    } else if (this.mode === 'watch') {
      this.placeWatchPointer();
    } else if (this.mode === 'mounted') {
      if (performance.now() < this.mountedPokingUntil) this.placeMountedPoke();
      else this.placeMountedPointer();
    }
  },

  remove: function () {
    this.trackActiveMenu(null);
    this.setMenuCursorHidden(false);
    document.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('keyup', this.onKeyUp, true);
    document.removeEventListener('mousedown', this.onMouseDown, true);
    this.sceneEl.removeEventListener('mounted-interaction-request', this.onMountedRequest);
    this.sceneEl.removeEventListener('menu-option-change', this.onPreferenceChange);
    this.sceneEl.removeEventListener('watch-menu-ready', this.onWatchReady);
    if (this.cursorStyleEl) this.cursorStyleEl.remove();
  },
});
