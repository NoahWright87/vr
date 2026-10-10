import './control-mode.js';
import './menus.js';
import { pulseHaptics } from './haptics.js';
import { findMenuItem } from './menu-model.js';

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

  // A raycaster line draws all the way to `far` whenever nothing's in its
  // way — including a miss against a real .menu-target, which reads as
  // the laser piercing straight through the panel and out the other
  // side. Rather than a beam stretching all the way to the finger, this
  // draws a small glowing dot at wherever the raycaster's own closest hit
  // currently is (see the 'pm-surface' class menus.js tags each panel's
  // background with, so a hit registers anywhere on the panel, not just
  // squarely on a button) plus a short trail growing out of the surface
  // toward the finger and fading to nothing about a quarter of the way
  // there — a hint for aiming without the old beam's full-length reach.
  // Both are hidden entirely once nothing's in range, and both scale
  // with the hit panel's own current size (read live off its object3D,
  // since projected-menu already scales the whole panel uniformly) so a
  // big wall panel's dot doesn't look tiny next to a watch's.
  var TRAIL_SEGMENTS = 8;
  var TRAIL_FRACTION = 0.25;
  var TRAIL_START_OPACITY = 0.85;
  var DOT_RADIUS = 0.006;
  var REFERENCE_SCALE = 0.12; // the watch's own pokeScale -- what DOT_RADIUS was tuned to look right at.

  AFRAME.registerComponent('fingertip-laser-indicator', {
    init: function () {
      var dot = document.createElement('a-entity');
      dot.setAttribute('geometry', 'primitive: sphere; radius: ' + DOT_RADIUS + '; segmentsWidth: 10; segmentsHeight: 8');
      dot.setAttribute('material', 'color: #8ff; shader: flat; opacity: 0.9');
      dot.object3D.visible = false;
      this.el.sceneEl.appendChild(dot);
      this.dot = dot;

      this.trail = [];
      for (var i = 0; i < TRAIL_SEGMENTS; i++) {
        var segment = document.createElement('a-entity');
        segment.setAttribute('line', { start: '0 0 0', end: '0 0 0', color: '#8ff', opacity: 0 });
        this.el.sceneEl.appendChild(segment);
        this.trail.push(segment);
      }

      this._point = new AFRAME.THREE.Vector3();
      this._segmentStart = new AFRAME.THREE.Vector3();
      this._segmentEnd = new AFRAME.THREE.Vector3();
    },
    tick: function () {
      var raycaster = this.el.components.raycaster;
      var intersection = raycaster && raycaster.data.enabled && raycaster.intersections[0];
      this.dot.object3D.visible = Boolean(intersection);
      this.trail.forEach(function (segment) { segment.object3D.visible = Boolean(intersection); });
      if (!intersection) return;

      var panelEl = intersection.object.el.closest('.pm-panel');
      var panelScale = panelEl ? panelEl.object3D.scale.x : REFERENCE_SCALE;
      this.dot.object3D.position.copy(intersection.point);
      this.dot.object3D.scale.setScalar(panelScale / REFERENCE_SCALE);

      var ray = raycaster.raycaster.ray;
      var trailLength = intersection.distance * TRAIL_FRACTION;
      for (var i = 0; i < TRAIL_SEGMENTS; i++) {
        var t0 = i / TRAIL_SEGMENTS;
        var t1 = (i + 1) / TRAIL_SEGMENTS;
        this._segmentStart.copy(ray.direction).multiplyScalar(-trailLength * t0).add(intersection.point);
        this._segmentEnd.copy(ray.direction).multiplyScalar(-trailLength * t1).add(intersection.point);
        // Plain object literals, not the reused scratch vectors above --
        // line's own attribute diffing compares data.start to the
        // *previous* parsed value by x/y/z, which only works if this
        // call's value isn't the very same (already-mutated) object
        // instance still sitting there from last tick.
        this.trail[i].setAttribute('line', {
          start: { x: this._segmentStart.x, y: this._segmentStart.y, z: this._segmentStart.z },
          end: { x: this._segmentEnd.x, y: this._segmentEnd.y, z: this._segmentEnd.z },
          opacity: TRAIL_START_OPACITY * (1 - t0),
        });
      }
    },
    remove: function () {
      if (this.dot.parentNode) this.dot.parentNode.removeChild(this.dot);
      this.trail.forEach(function (segment) {
        if (segment.parentNode) segment.parentNode.removeChild(segment);
      });
    },
  });

  function wireUpFingertipPointing(rawEl, fingertipEl, handComp, direction) {
    fingertipEl.setAttribute('raycaster', {
      objects: '.menu-target, .pm-surface', far: 10, enabled: false, direction: direction, showLine: false,
    });
    fingertipEl.setAttribute('cursor', { fuse: false, downEvents: ACTIVATE_DOWN_EVENTS, upEvents: ACTIVATE_UP_EVENTS });
    fingertipEl.setAttribute('fingertip-laser-indicator', '');
    var gripHeld = false;
    var activationCount = 0;
    var settleTimer = null;
    var releaseTimer = null;
    function enableLaser() {
      handComp.isPointing = true;
      handComp.laserActive = true;
      fingertipEl.setAttribute('raycaster', 'enabled', true);
    }
    function disableLaser() {
      if (gripHeld || activationCount > 0) return;
      handComp.isPointing = false;
      handComp.laserActive = false;
      fingertipEl.setAttribute('raycaster', 'enabled', false);
    }
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

  // Both watch panels sit the same way on the wrist: flat on the face
  // when poking, pushed a little off it so a fingertip meets the panel
  // rather than the band.
  function poseLikeWatchFace(pm, side) {
    pm.pokeQuat = new AFRAME.THREE.Quaternion().setFromEuler(new AFRAME.THREE.Euler(
      -Math.PI / 2, 0, side * Math.PI / 2, 'XYZ'
    ));
    var outward = new AFRAME.THREE.Vector3(0, 0, 1).applyQuaternion(pm.pokeQuat);
    pm.data.offset = { x: outward.x * 0.045, y: outward.y * 0.045, z: outward.z * 0.045 };
  }

  // Shared wrist hardware and interaction. Applications provide only a
  // menu template and react to its bubbling menu-item-select events.
  AFRAME.registerComponent('hand-with-watch', {
    schema: {
      hand: { default: 'left', oneOf: ['left', 'right'] },
      menuTemplate: { type: 'selector', default: '#watch-menu-template' },
      // The same watch drawn by the shared crossbar menu instead of a
      // hand-built page stack. Only built when the page provides the
      // template, so a game that has not moved over yet gets exactly the
      // watch it always had.
      crossbarTemplate: { type: 'selector', default: '#watch-crossbar-template' },
      // Which of the two answers the wrist. Switchable at runtime with
      // setMenuStyle, so the two can be compared on the same hand.
      menuStyle: { default: 'classic', oneOf: ['classic', 'crossbar'] },
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

      // The classic watch: hand-built pages from a template. A page that
      // has moved onto the crossbar watch provides no template, and gets
      // only the crossbar one below.
      if (this.data.menuTemplate) this.buildClassicWatch(face, side);
      if (this.data.crossbarTemplate) this.buildCrossbarWatch(wrapper, face, side);
    },

    buildClassicWatch: function (face, side) {
      var self = this;
      var el = this.el;
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
        self.classicMenu = pm;
        poseLikeWatchFace(pm, side);
        if (pm.chromes[0]) {
          self.classicTimeEl = pm.chromes[0].titleEl;
          self.classicTimeEl.setAttribute('font', 'sourcecodepro');
          self.panelTimeEl = self.classicTimeEl;
        }
        face.addEventListener('projected-menu-opened', function () { face.setAttribute('visible', false); });
        face.addEventListener('projected-menu-closed', function () {
          if (!self.crossbarMenu || !self.crossbarMenu.visible) face.setAttribute('visible', true);
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
        self.setMenuStyle(self.data.menuStyle);
      }
      if (face.hasLoaded) finishMenuSetup();
      else face.addEventListener('loaded', finishMenuSetup);
    },

    // The crossbar copy of the watch. It gets its own trigger rather than
    // sharing the face, because projected-menu owns its trigger outright
    // (collider, open/close events, panel placement) — so this is a
    // second, undrawn face in exactly the same place, carrying a second
    // projected-menu whose panel holds a crossbar-menu instead of pages.
    // Everything about *when* the watch opens (raising your wrist, a
    // poke, palm-up for the larger layout, Tab off a headset) is still
    // projected-menu's, unchanged; only what you see once it is open
    // differs.
    buildCrossbarWatch: function (wrapper, face, side) {
      var self = this;
      var trigger = document.createElement('a-entity');
      trigger.classList.add('watch-face-crossbar');
      trigger.setAttribute('geometry', 'primitive: box; width: 0.032; height: 0.007; depth: 0.032');
      // Not drawn — the classic face above is the one you see, clock and
      // all — but still a real mesh, so the poke collider sizes itself
      // from it exactly as it does for the face.
      trigger.setAttribute('material', 'visible: false');
      // Exactly where the face is, from the same constants. Not read back
      // off the face: it has not loaded yet at this point, so its position
      // read back as the origin — the middle of the hand — which put this
      // watch's panel (and its poke collider) 10 cm up the hand and 3.5 cm
      // low compared with the classic one.
      trigger.setAttribute('position', side * WATCH_OFFSET.x + ' ' + FACE_Y_OFFSET + ' ' + WATCH_OFFSET.z);
      trigger.setAttribute('projected-menu', {
        template: this.data.crossbarTemplate,
        mode: 'auto',
        automatic: true,
        pokeScale: 0.12,
        laserScale: 0.26,
        enabled: false,
      });
      trigger.setAttribute('projected-crossbar', '');
      wrapper.appendChild(trigger);
      this.crossbarTriggerEl = trigger;

      // projected-crossbar joins the panel and the menu (open, close,
      // poke targets, the keys off a headset); what is left here is what
      // makes it a watch.
      trigger.addEventListener('projected-crossbar-ready', function (evt) {
        var pm = evt.detail.projectedMenu;
        var component = evt.detail.menu;
        var menuEl = evt.detail.menuEl;
        self.crossbarMenu = pm;
        self.crossbarComponent = component;
        poseLikeWatchFace(pm, side);
        // The hand wearing the watch is the one you raised to read it;
        // the other hand's stick drives it.
        component.ignoreHand = self.el;
        self.crossbarTimeEl = component.titleEl;
        self.crossbarTimeEl.setAttribute('font', 'sourcecodepro');
        // The sidecar goes toward the middle of your view: right of a
        // left-wrist watch, left of a right-wrist one, so it is never the
        // half that ends up outside your field of view.
        component.setLayout({ sidecar: side === 1 ? 'right' : 'left' });

        // The drawn face, clock and all, steps aside for the panel, as it
        // does for the classic one. Its own settings are read back first,
        // before the menu opens and draws them.
        trigger.addEventListener('projected-menu-opened', function () {
          face.setAttribute('visible', false);
        });
        trigger.addEventListener('projected-menu-closed', function () {
          face.setAttribute('visible', true);
        });
        component.menu.on('open', function () { self.syncCrossbarValues(); });
        menuEl.addEventListener('menu-item-select', function (evt2) {
          if (evt2.detail.value === 'haptics') self.triggerHaptics();
        });
        menuEl.addEventListener('menu-commit', function (evt2) {
          if (evt2.detail.id === 'watch-automatic') pm.setAutomatic(evt2.detail.value);
        });
        self.setMenuStyle(self.data.menuStyle);
        if (!self.classicMenu) self.el.emit('watch-menu-ready', { panelEl: pm.panelEl, projectedMenu: pm }, true);
        self.el.emit('watch-crossbar-ready', { panelEl: pm.panelEl, projectedMenu: pm, menu: component }, true);
      });
    },

    // The one value that belongs to this particular watch rather than to
    // the page: whether raising it opens it. Both watches share the page,
    // so it is read back from whichever one is opening. Everything else
    // the page reads for itself (see crossbar-menu's onOpen).
    syncCrossbarValues: function () {
      var component = this.crossbarComponent;
      if (!component) return;
      var automatic = findMenuItem(component.menu.page.items, 'watch-automatic');
      if (automatic) automatic.value = Boolean(this.crossbarMenu.data.automatic);
    },

    // Classic or crossbar. Whichever is not chosen is switched off rather
    // than removed, so flipping back and forth costs nothing and loses no
    // state. Everything outside that reaches for "the watch's menu" —
    // desktop-controls' Tab, the clock — follows projectedMenu.
    setMenuStyle: function (style) {
      this.data.menuStyle = style;
      // With only one of the two built, that one is the watch whatever
      // was asked for.
      var crossbar = Boolean(this.crossbarComponent) && (style === 'crossbar' || !this.data.menuTemplate);
      var on = !this.suppressed;
      if (this.classicMenu) this.classicMenu.data.enabled = on && !crossbar;
      if (this.crossbarMenu) this.crossbarMenu.data.enabled = on && crossbar;
      this.projectedMenu = crossbar ? this.crossbarMenu : (this.classicMenu || null);
      this.panelTimeEl = crossbar ? this.crossbarTimeEl : this.classicTimeEl;
      this.updateDisplay();
    },

    // Keep this watch shut, whatever its pose says. Desktop and touch
    // script both hands into poses (one pointing at the other's watch,
    // one at your temple), and a scripted pose can happen to face this
    // watch at the camera — which in a headset would mean you raised it
    // on purpose, and here means nothing. Whoever scripts the hand says
    // so; see desktop-controls' setMode.
    setSuppressed: function (suppressed) {
      if (this.suppressed === Boolean(suppressed)) return;
      this.suppressed = Boolean(suppressed);
      this.setMenuStyle(this.data.menuStyle);
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

    triggerHaptics: function (intensity, durationMs) {
      var self = this;
      var level = intensity === undefined ? 1 : intensity;
      var duration = durationMs === undefined ? 200 : durationMs;
      return pulseHaptics(this.el, level, duration).then(function (result) {
        self.el.emit('haptics-pulse-result', {
          hand: self.data.hand,
          intensity: level,
          durationMs: duration,
          status: result.status,
          api: result.api || null,
          error: result.error || null,
        }, true);
        return result;
      });
    },

    // The classic watch flashes the project name over its About row. The
    // crossbar watch needs nothing here: its About row's text is in the
    // sidecar whenever the row is selected.
    showAbout: function () {
      if (this.projectedMenu === this.crossbarMenu) return;
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
