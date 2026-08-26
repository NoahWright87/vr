import './control-mode.js';
import './menus.js';

  var WATCH_OFFSET = { x: -0.009, y: -0.006, z: 0.100 };
  var FACE_Y_OFFSET = 0.0345;
  var FINGERTIP_OFFSET = { x: 0.038, y: 0.026, z: -0.089 };
  var FINGER_POINT_DIR = { x: 0.0649, y: 0.0816, z: -0.9946 };
  var CONTROL_COMPONENTS = [
    'magicleap-controls', 'vive-controls', 'oculus-touch-controls',
    'pico-controls', 'windows-motion-controls', 'hp-mixed-reality-controls',
    'oculus-go-controls', 'vive-focus-controls', 'valve-index-controls',
    'generic-tracked-controller-controls',
  ];
  var ACTIVATE_DOWN_EVENTS = ['triggerdown', 'abuttondown', 'bbuttondown', 'xbuttondown', 'ybuttondown'];
  var ACTIVATE_UP_EVENTS = ['triggerup', 'abuttonup', 'bbuttonup', 'xbuttonup', 'ybuttonup'];

  function wireUpFingertipPointing(rawEl, fingertipEl, handComp, direction) {
    fingertipEl.setAttribute('raycaster', { objects: '.menu-target', far: 10, enabled: false, direction: direction });
    fingertipEl.setAttribute('cursor', { fuse: false, downEvents: ACTIVATE_DOWN_EVENTS, upEvents: ACTIVATE_UP_EVENTS });
    var hasIntersection = false;
    var gripHeld = false;
    var activationCount = 0;
    var settleTimer = null;
    var releaseTimer = null;
    function updateShowLine() {
      var controlMode = rawEl.sceneEl.systems['control-mode'];
      var isDesktop = controlMode && controlMode.isMode('desktop');
      fingertipEl.setAttribute('raycaster', 'showLine', handComp.laserActive && (hasIntersection || isDesktop));
    }
    function enableLaser() {
      handComp.isPointing = true;
      handComp.laserActive = true;
      fingertipEl.setAttribute('raycaster', 'enabled', true);
      updateShowLine();
    }
    function disableLaser() {
      if (gripHeld || activationCount > 0) return;
      handComp.isPointing = false;
      handComp.laserActive = false;
      fingertipEl.setAttribute('raycaster', 'enabled', false);
      hasIntersection = false;
      updateShowLine();
    }
    fingertipEl.addEventListener('raycaster-intersection', function () { hasIntersection = true; updateShowLine(); });
    fingertipEl.addEventListener('raycaster-intersection-cleared', function () { hasIntersection = false; updateShowLine(); });
    rawEl.addEventListener('gripdown', function () {
      gripHeld = true;
      handComp.isPointing = true;
      clearTimeout(settleTimer);
      clearTimeout(releaseTimer);
      settleTimer = setTimeout(function () {
        enableLaser();
      }, 180);
    });
    rawEl.addEventListener('gripup', function () {
      gripHeld = false;
      clearTimeout(settleTimer);
      disableLaser();
    });
    ACTIVATE_DOWN_EVENTS.forEach(function (name) {
      rawEl.addEventListener(name, function () {
        activationCount++;
        clearTimeout(releaseTimer);
        enableLaser();
        fingertipEl.emit(name, null, false);
      });
    });
    ACTIVATE_UP_EVENTS.forEach(function (name) {
      rawEl.addEventListener(name, function () {
        activationCount = Math.max(0, activationCount - 1);
        fingertipEl.emit(name, null, false);
        clearTimeout(releaseTimer);
        releaseTimer = setTimeout(disableLaser, 250);
      });
    });
  }

  // Shared wrist hardware and interaction. Applications provide only a
  // menu template and react to its bubbling menu-item-select events.
  AFRAME.registerComponent('hand-with-watch', {
    schema: {
      hand: { default: 'left', oneOf: ['left', 'right'] },
      menuTemplate: { type: 'selector', default: '#watch-menu-template' },
      gazeCursor: { type: 'selector', default: '#gaze-cursor' },
    },

    init: function () {
      var el = this.el;
      var self = this;
      var side = this.data.hand === 'left' ? 1 : -1;
      var wrapper = document.createElement('a-entity');
      wrapper.classList.add('hand-space');
      wrapper.setAttribute('rotation', (el.sceneEl.hasWebXR ? -90 : 0) + ' 0 ' + (side === 1 ? 90 : -90));
      el.appendChild(wrapper);
      this.wrapperEl = wrapper;

      var band = document.createElement('a-entity');
      band.classList.add('watch-band');
      band.setAttribute('geometry', 'primitive: torus; radius: 0.030; radiusTubular: 0.005; segmentsRadial: 24; segmentsTubular: 12');
      band.setAttribute('material', 'color: #ccc; metalness: 0.6; roughness: 0.4');
      band.setAttribute('position', side * WATCH_OFFSET.x + ' ' + WATCH_OFFSET.y + ' ' + WATCH_OFFSET.z);
      wrapper.appendChild(band);

      var face = document.createElement('a-entity');
      face.classList.add('watch-face');
      face.setAttribute('geometry', 'primitive: box; width: 0.032; height: 0.007; depth: 0.032');
      face.setAttribute('material', 'color: #111');
      face.setAttribute('position', side * WATCH_OFFSET.x + ' ' + FACE_Y_OFFSET + ' ' + WATCH_OFFSET.z);
      wrapper.appendChild(face);
      var textEl = document.createElement('a-text');
      textEl.classList.add('watch-text');
      textEl.setAttribute('value', '00:00:00');
      textEl.setAttribute('font', 'sourcecodepro');
      textEl.setAttribute('align', 'center');
      textEl.setAttribute('color', '#0F0');
      textEl.setAttribute('width', '0.09');
      textEl.setAttribute('position', '0 0.0045 0');
      textEl.setAttribute('rotation', '-90 0 ' + side * 90);
      face.appendChild(textEl);
      this.textEl = textEl;
      this.faceEl = face;

      this.isPointing = false;
      this.laserActive = false;
      CONTROL_COMPONENTS.forEach(function (name) { el.setAttribute(name, { hand: self.data.hand, model: false }); });
      el.addEventListener('controllerconnected', function () {
        var gaze = self.data.gazeCursor;
        if (!gaze) return;
        gaze.setAttribute('raycaster', 'enabled', false);
        gaze.setAttribute('visible', false);
      });

      var fingertip = document.createElement('a-entity');
      fingertip.setAttribute('position', side * FINGERTIP_OFFSET.x + ' ' + FINGERTIP_OFFSET.y + ' ' + FINGERTIP_OFFSET.z);
      fingertip.setAttribute('obb-collider', 'size: 0.03');
      fingertip.handComponent = this;
      wrapper.appendChild(fingertip);
      this.fingertipEl = fingertip;
      wireUpFingertipPointing(el, fingertip, this, new AFRAME.THREE.Vector3(
        side * FINGER_POINT_DIR.x, FINGER_POINT_DIR.y, FINGER_POINT_DIR.z
      ));

      face.setAttribute('projected-menu', {
        template: this.data.menuTemplate,
        mode: 'auto',
        automatic: true,
        pokeScale: 0.12,
        laserScale: 0.26,
      });
      function finishMenuSetup() {
        var pm = face.components['projected-menu'];
        self.projectedMenu = pm;
        pm.pokeQuat = new AFRAME.THREE.Quaternion().setFromEuler(new AFRAME.THREE.Euler(
          -Math.PI / 2, 0, side * Math.PI / 2, 'XYZ'
        ));
        var outward = new AFRAME.THREE.Vector3(0, 0, 1).applyQuaternion(pm.pokeQuat);
        pm.data.offset = { x: outward.x * 0.045, y: outward.y * 0.045, z: outward.z * 0.045 };
        if (pm.chromes[0]) {
          self.panelTimeEl = pm.chromes[0].titleEl;
          self.panelTimeEl.setAttribute('font', 'sourcecodepro');
        }
        face.addEventListener('projected-menu-opened', function () { face.setAttribute('visible', false); });
        face.addEventListener('projected-menu-closed', function () {
          face.setAttribute('visible', true);
          var pages = pm.panelEl.components['menu-pages'];
          if (pages) pages.showPage('main');
        });
        pm.panelEl.setAttribute('menu-pages', { defaultPage: 'main' });
        self.helpPageIndex = 0;
        self.helpPages = [
          'Point with your other hand (hold grip), then poke the watch face to open its menu.',
          'Tilt the watch toward you to poke, or turn it palm-up for a larger pointing menu.',
        ];
        self.updateHelpPage = function () {
          var helpText = pm.panelEl.querySelector('.watch-help-page-text');
          var helpIndicator = pm.panelEl.querySelector('.watch-help-page-indicator');
          if (helpText) helpText.setAttribute('text', 'value', self.helpPages[self.helpPageIndex]);
          if (helpIndicator) helpIndicator.setAttribute('text', 'value', (self.helpPageIndex + 1) + ' / ' + self.helpPages.length);
        };
        pm.panelEl.addEventListener('menu-item-select', function (evt) {
          var value = evt.detail.value;
          var pages = pm.panelEl.components['menu-pages'];
          if (pages && value.indexOf('page-') === 0) pages.showPage(value.slice(5));
          else if (pages && (value === 'help-close' || /-close$/.test(value))) pages.showPage('main');
          else if (pages && value === 'help') {
            self.helpPageIndex = 0;
            self.updateHelpPage();
            pages.showPage('help');
          } else if (value === 'help-prev') {
            self.helpPageIndex = Math.max(0, self.helpPageIndex - 1);
            self.updateHelpPage();
          } else if (value === 'help-next') {
            self.helpPageIndex = Math.min(self.helpPages.length - 1, self.helpPageIndex + 1);
            self.updateHelpPage();
          }
          if (value === 'haptics') self.triggerHaptics();
          if (value === 'about') self.showAbout();
        });
        el.emit('watch-menu-ready', { panelEl: pm.panelEl, projectedMenu: pm }, true);
      }
      if (face.hasLoaded) finishMenuSetup();
      else face.addEventListener('loaded', finishMenuSetup);
    },

    // Back-solves the hand root's world transform from a desired world
    // pose for the watch face, using the actual live local transforms of
    // wrapperEl/faceEl (wrapper has a fixed local rotation off the hand
    // root and zero local position; face has a fixed local position off
    // wrapper and zero local rotation of its own). Reading those live
    // rather than hardcoding the rotation constants above keeps this
    // correct regardless of hand side or the hasWebXR branch in init().
    // Desktop/mobile use this to script the hand into a real "watch held
    // up to your face" pose instead of faking the menu's position.
    computeHandPoseForFace: function (faceWorldPosition, faceWorldQuaternion) {
      var wrapperLocalQuat = this.wrapperEl.object3D.quaternion;
      var faceLocalPos = this.faceEl.object3D.position;
      var quaternion = faceWorldQuaternion.clone().multiply(wrapperLocalQuat.clone().invert());
      var position = faceWorldPosition.clone().sub(faceLocalPos.clone().applyQuaternion(faceWorldQuaternion));
      return { position: position, quaternion: quaternion };
    },

    triggerHaptics: function () {
      var tracked = this.el.components['tracked-controls'];
      var actuators = tracked && tracked.controller && tracked.controller.hapticActuators;
      if (actuators && actuators[0]) actuators[0].pulse(1.0, 200);
    },

    showAbout: function () {
      var label = this.projectedMenu.panelEl.querySelector('.watch-menu-about-label');
      if (!label) return;
      var original = label.getAttribute('text').value;
      label.setAttribute('text', 'value', 'WebXR Primitives');
      setTimeout(function () { label.setAttribute('text', 'value', original); }, 1500);
    },

    updateDisplay: function () {
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var d = new Date();
      var value = pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      this.textEl.setAttribute('text', 'value', value);
      if (this.panelTimeEl) this.panelTimeEl.setAttribute('text', 'value', value);
    },

    tick: function () {
      var second = Math.floor(Date.now() / 1000);

      if (second === this.lastDisplaySecond) return;
      this.lastDisplaySecond = second;
      this.updateDisplay();
    },
  });
