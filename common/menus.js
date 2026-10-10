// ============================================================
// PROJECTED MENU — the trigger half of a menu you summon.
//
// Put it on anything with geometry (a watch face, a wall button, a
// pedestal button) with a <template> of panel content, and it decides
// when that panel is up: a fingertip poke, a raised and turned wrist
// ('auto' — small poke layout facing up at you, larger pointing layout
// palm-up), desktop's mounted mode, walking away or looking away. It
// places, scales and animates the panel and makes its poke targets
// pokeable.
//
// What is ON the panel is a crossbar menu (common/menu-crossbar.js),
// joined to this by projected-crossbar. The hand-built pages, rows and
// title bars that used to live in this file are gone; every menu in the
// repo is page data now.
// ============================================================
import { chooseAutomaticMenuIntent, chooseProjectedMenuMode } from './projected-menu-mode.js';
// A panel's poke targets each get a collider; this keeps hidden ones
// from costing a frame. See the module for numbers.
import './obb-collider-visibility.js';

  function isVisibleInHierarchy(object3D) {
    var node = object3D;
    while (node) {
      if (!node.visible) return false;
      node = node.parent;
    }
    return true;
  }

  // Turns any collider-bearing trigger into a menu projected from a
  // template. This is shared by watches and fixed world-space controls.
  AFRAME.registerComponent('projected-menu', {
    schema: {
      template: { type: 'selector' },
      mode: { default: 'auto', oneOf: ['auto', 'poke', 'laser'] },
      pokeScale: { default: 0.3 },
      laserScale: { default: 0.6 },
      offset: { type: 'vec3' },
      lerp: { default: 0.15 },
      closeDistance: { default: 2.5 },
      faceupThreshold: { default: 0.6 },
      facecamThreshold: { default: 0.45 },
      lookAwayThreshold: { default: 0.3 },
      lookAwayDelay: { default: 2500 },
      pokeCooldown: { default: 400 },
      modeHysteresis: { default: 0.12 },
      orientationGrace: { default: 250 },
      automaticOpenDelay: { default: 320 },
      automatic: { default: false },
      // A switched-off menu stays shut whatever the pose or a poke says:
      // desktop and touch pose hands for other things (pointing at the
      // other wrist, held to your temple), and a scripted pose must not
      // read as a raised watch. See hand-with-watch's setSuppressed.
      enabled: { default: true },
    },

    init: function () {
      var self = this;
      var el = this.el;
      this.active = false;
      this.mode = 'closed';
      this.scale = 0.0001;
      this.visible = false;
      this.lastItemsMode = null;
      this.lookAwaySince = null;
      this.orientationLostSince = null;
      this.automaticDismissed = false;
      this.automaticOpenSince = null;
      this.cameraEl = document.querySelector('a-camera');

      var panel = this.data.template.content.cloneNode(true).firstElementChild;
      el.parentNode.appendChild(panel);
      this.pokeQuat = panel.object3D.quaternion.clone();
      panel.object3D.scale.setScalar(this.scale);
      this.panelEl = panel;
      // pm-panel marks the panel root itself, so a fingertip raycaster hit
      // anywhere inside it (see fingertip-laser-indicator in watch-menu.js)
      // can walk back up to this same object3D and read its live scale —
      // projected-menu scales the whole panel uniformly (see applyState
      // below), so that one number is enough to size the laser dot/trail
      // to match this particular panel, watch-sized or wall-sized alike.
      panel.classList.add('pm-panel');
      // A hit anywhere on the panel's backing (crossbar-menu tags it
      // pm-surface) registers for the fingertip laser, which draws a dot
      // there instead of a beam that runs through the panel — see
      // fingertip-laser-indicator in watch-menu.js.
      this.updatePanelPosition();

      el.setAttribute('obb-collider', '');
      el.addEventListener('obbcollisionstarted', function (evt) {
        var poker = evt.detail.withEl;
        if (poker.handComponent && poker.handComponent.isPointing && !self.active) self.open();
      });

      this.pmTargets = [];
      this.registerMenuTarget = function (item) {
        if (item._projectedMenuOwner === self) return;
        item._projectedMenuOwner = self;
        item.setAttribute('obb-collider', 'size: 0.035');
        item._lastPokeAt = 0;
        item.addEventListener('obbcollisionstarted', function (evt) {
          var poker = evt.detail.withEl;
          var now = performance.now();
          if (
            self.mode === 'poke' &&
            poker.handComponent && poker.handComponent.isPointing &&
            self.isMenuTargetInteractive(item) &&
            now - item._lastPokeAt > self.data.pokeCooldown
          ) {
            item._lastPokeAt = now;
            item.emit('click');
          }
        });
      };
      this.refreshMenuTargets = function () {
        self.pmTargets = Array.prototype.slice.call(panel.querySelectorAll('.pm-target'));
        self.pmTargets.forEach(self.registerMenuTarget);
        self.setItemsMode(self.lastItemsMode || 'closed', true);
      };
      this.refreshMenuTargets();
      panel.addEventListener('menu-targets-changed', function () {
        self.refreshMenuTargets();
      });

    },

    updatePanelPosition: function () {
      var t = this.el.object3D.position;
      var o = this.data.offset;
      this.panelEl.object3D.position.set(t.x + o.x, t.y + o.y, t.z + o.z);
    },

    tick: function (time, delta) {
      if (this.data.enabled === false) {
        this.active = false;
        this.automaticOpenSince = null;
      } else if (this.data.automatic) {
        var automaticIntent = this.computeAutomaticIntent();
        if (automaticIntent !== 'open') {
          this.automaticDismissed = false;
          this.automaticOpenSince = null;
        }
        if (automaticIntent === 'open' && !this.automaticDismissed) {
          // A hand mid-transition to some unrelated pose (reaching for a
          // button elsewhere, say) can swing through this same pose
          // window for a single-digit number of frames on its way past.
          // Real intent to check a watch holds the pose; requiring it to
          // hold briefly here before committing to open is what tells the
          // two apart, the same way orientationGrace already tells a
          // real, deliberate look-away from a brief flicker on exit.
          if (!this.automaticOpenSince) this.automaticOpenSince = time;
          if (time - this.automaticOpenSince >= this.data.automaticOpenDelay) this.active = true;
        } else if (automaticIntent === 'close') {
          this.active = false;
        }
      }
      if (this.active) {
        var mode = this.computeMode();
        if (!mode) this.active = false;
        this.mode = mode || 'closed';
      } else {
        this.mode = 'closed';
      }
      this.applyState(delta);
    },

    computeMode: function () {
      var THREE = AFRAME.THREE;
      var camPos = new THREE.Vector3();
      this.cameraEl.object3D.getWorldPosition(camPos);
      var pos = new THREE.Vector3();
      this.el.object3D.getWorldPosition(pos);
      if (this.data.mode === 'poke' || this.data.mode === 'laser') {
        if (camPos.distanceTo(pos) > this.data.closeDistance) return null;
        if (this.isLookedAwayTooLong(camPos)) return null;
        return this.data.mode;
      }

      var worldQuat = new THREE.Quaternion();
      this.el.object3D.getWorldQuaternion(worldQuat);
      var normal = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
      var toCam = camPos.clone().sub(pos).normalize();
      var dotUp = normal.dot(new THREE.Vector3(0, 1, 0));
      var dotCam = normal.dot(toCam);
      // Tracked wrists naturally wobble around the boundary between the poke
      // and laser poses. Keep the current layout through a deadband so the
      // panel cannot move out from under a live raycast every other frame.
      var nextMode = chooseProjectedMenuMode(this.mode, dotUp, dotCam, {
        faceupThreshold: this.data.faceupThreshold,
        facecamThreshold: this.data.facecamThreshold,
        hysteresis: this.data.modeHysteresis,
      });
      if (nextMode) {
        this.orientationLostSince = null;
        return nextMode;
      }
      if (this.mode === 'laser' || this.mode === 'poke') {
        var now = performance.now();
        if (!this.orientationLostSince) this.orientationLostSince = now;
        if (now - this.orientationLostSince < this.data.orientationGrace) return this.mode;
      }
      return null;
    },

    computeAutomaticIntent: function () {
      var THREE = AFRAME.THREE;
      var camPos = new THREE.Vector3();
      this.cameraEl.object3D.getWorldPosition(camPos);
      var pos = new THREE.Vector3();
      this.el.object3D.getWorldPosition(pos);
      var worldQuat = new THREE.Quaternion();
      this.el.object3D.getWorldQuaternion(worldQuat);
      var normal = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQuat);
      var toCam = camPos.clone().sub(pos).normalize();
      return chooseAutomaticMenuIntent(this.data.mode, {
        distance: camPos.distanceTo(pos),
        dotUp: normal.dot(new THREE.Vector3(0, 1, 0)),
        dotCam: normal.dot(toCam),
      }, {
        closeDistance: this.data.closeDistance,
        faceupThreshold: this.data.faceupThreshold,
        facecamThreshold: this.data.facecamThreshold,
      });
    },

    isLookedAwayTooLong: function (camPos) {
      var THREE = AFRAME.THREE;
      var camQuat = new THREE.Quaternion();
      this.cameraEl.object3D.getWorldQuaternion(camQuat);
      var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
      var panelPos = new THREE.Vector3();
      this.panelEl.object3D.getWorldPosition(panelPos);
      var toPanel = panelPos.clone().sub(camPos).normalize();
      var now = performance.now();
      if (forward.dot(toPanel) < this.data.lookAwayThreshold) {
        if (!this.lookAwaySince) this.lookAwaySince = now;
        return now - this.lookAwaySince > this.data.lookAwayDelay;
      }
      this.lookAwaySince = null;
      return false;
    },

    computeLaserLocalQuat: function () {
      var THREE = AFRAME.THREE;
      this.panelEl.object3D.updateMatrixWorld(true);
      var camPos = new THREE.Vector3();
      this.cameraEl.object3D.getWorldPosition(camPos);
      var savedQuat = this.panelEl.object3D.quaternion.clone();
      this.panelEl.object3D.lookAt(camPos);
      var lookQuat = this.panelEl.object3D.quaternion.clone();
      this.panelEl.object3D.quaternion.copy(savedQuat);
      return lookQuat;
    },

    applyState: function (delta) {
      this.updatePanelPosition();
      var targetScale;
      var targetQuat;
      if (this.mode === 'poke') {
        targetScale = this.data.pokeScale;
        targetQuat = this.pokeQuat;
      } else if (this.mode === 'laser') {
        targetScale = this.data.laserScale;
        targetQuat = this.computeLaserLocalQuat();
      } else {
        targetScale = 0.0001;
        targetQuat = null;
      }
      // data.lerp is calibrated as "fraction covered per ~16.7ms frame"
      // (60fps). Reapplying it that many times over whatever this tick's
      // actual delta was, rather than once flat, keeps the open/close
      // animation's wall-clock duration constant regardless of frame
      // rate — a slow frame (or a sustained low frame rate) no longer
      // stretches it out; it converges in the same real time either way.
      var t = 1 - Math.pow(1 - this.data.lerp, Math.min(delta || 16.667, 1000) / 16.667);
      this.scale += (targetScale - this.scale) * t;
      this.panelEl.object3D.scale.setScalar(this.scale);
      if (targetQuat) this.panelEl.object3D.quaternion.slerp(targetQuat, t);
      if (this.mode === 'closed') {
        if (this.scale < 0.005 && this.visible) {
          this.panelEl.setAttribute('visible', false);
          this.visible = false;
          this.setItemsMode('closed');
          this.el.emit('projected-menu-closed');
        }
      } else {
        if (!this.visible) {
          this.panelEl.setAttribute('visible', true);
          this.visible = true;
          this.el.emit('projected-menu-opened');
        }
        this.setItemsMode(this.mode);
      }
    },

    setItemsMode: function (mode, force) {
      this.lastItemsMode = mode;
      var self = this;
      this.pmTargets.forEach(function (item) {
        var interactive = mode !== 'closed' && self.isMenuTargetInteractive(item);
        if (interactive && !item.classList.contains('menu-target')) item.classList.add('menu-target');
        else if (!interactive && item.classList.contains('menu-target')) item.classList.remove('menu-target');
      });
    },

    // You can only poke what you can see: a crossbar hides the rows it
    // has nothing to put in.
    isMenuTargetInteractive: function (item) {
      return isVisibleInHierarchy(item.object3D);
    },

    setAutomatic: function (automatic) {
      this.data.automatic = Boolean(automatic);
      this.automaticDismissed = false;
      this.el.emit('projected-menu-automatic-changed', { automatic: this.data.automatic });
    },

    open: function () {
      if (this.data.enabled === false) return;
      this.automaticDismissed = false;
      this.active = true;
    },
    close: function () {
      this.automaticDismissed = this.data.automatic;
      this.active = false;
    },
  });
