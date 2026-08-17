import { chooseProjectedMenuMode } from './projected-menu-mode.js';

  AFRAME.registerComponent('menu-item', {
    schema: {
      value: { type: 'string' },
      label: { type: 'string' },
      hoverColor: { type: 'color', default: '#2a3a5c' },
    },

    init: function () {
      this.baseColor = this.el.getAttribute('material').color;
      this.onMouseEnter = this.onMouseEnter.bind(this);
      this.onMouseLeave = this.onMouseLeave.bind(this);
      this.onClick = this.onClick.bind(this);
      this.flashTimer = null;
      this.hovered = false;
      this.flashing = false;
      this.el.addEventListener('mouseenter', this.onMouseEnter);
      this.el.addEventListener('mouseleave', this.onMouseLeave);
      this.el.addEventListener('click', this.onClick);
    },

    onMouseEnter: function () {
      this.hovered = true;
      // The clickable mesh is also the raycast surface. Transforming it as
      // feedback can invalidate the cursor's current intersection and cause
      // enter/leave to alternate, especially with a tracked hand near an edge.
      if (!this.flashing) this.el.setAttribute('material', 'color', this.data.hoverColor);
    },

    onMouseLeave: function () {
      this.hovered = false;
      if (!this.flashing) this.el.setAttribute('material', 'color', this.baseColor);
    },

    onClick: function () {
      var self = this;
      this.flashing = true;
      this.el.setAttribute('material', 'color', '#ffd54a');
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(function () {
        if (!self.el.parentNode) return;
        self.flashing = false;
        self.el.setAttribute('material', 'color', self.hovered ? self.data.hoverColor : self.baseColor);
      }, 140);
      this.el.emit('menu-item-select', { value: this.data.value, label: this.data.label }, true);
    },

    remove: function () {
      clearTimeout(this.flashTimer);
      this.el.removeEventListener('mouseenter', this.onMouseEnter);
      this.el.removeEventListener('mouseleave', this.onMouseLeave);
      this.el.removeEventListener('click', this.onClick);
    },
  });

  AFRAME.registerComponent('menu-feedback', {
    init: function () {
      this.feedbackText = this.el.querySelector('.menu-feedback-text');
      this.el.addEventListener('menu-item-select', (evt) => {
        this.feedbackText.setAttribute('text', 'value', 'Selected: ' + evt.detail.label);
      });
    },
  });

  AFRAME.registerComponent('menu-pages', {
    schema: {
      defaultPage: { default: 'main' },
    },

    init: function () {
      this.pages = Array.prototype.slice.call(this.el.querySelectorAll('[data-menu-page]'));
      this.currentPage = null;
      this.pageOffsets = {
        main: 0,
        help: 0.01,
        controls: 0.02,
      };
      this.showPage(this.data.defaultPage);
    },

    showPage: function (pageName) {
      var nextPage = pageName || this.data.defaultPage;
      var pageOffsets = this.pageOffsets;
      this.pages.forEach(function (page) {
        var matches = page.getAttribute('data-menu-page') === nextPage;
        page.setAttribute('visible', matches);
        if (matches) page.object3D.position.z = pageOffsets[nextPage] || 0;
      });
      this.currentPage = nextPage;
    },
  });

  function isVisibleInHierarchy(object3D) {
    var node = object3D;
    while (node) {
      if (!node.visible) return false;
      node = node.parent;
    }
    return true;
  }

  export function buildMenuChrome(containerEl, opts) {
    var width = opts.width || 1;
    var barY = opts.barY;
    var barHeight = 0.18;
    var btnSize = 0.15;
    var margin = 0.05;
    var gap = 0.02;

    var bar = document.createElement('a-plane');
    bar.classList.add('menu-chrome-bar');
    bar.setAttribute('width', width);
    bar.setAttribute('height', barHeight);
    bar.setAttribute('material', 'color: #0b1220; shader: flat');
    bar.setAttribute('position', '0 ' + barY + ' -0.001');
    containerEl.appendChild(bar);

    var rightOccupiedEdge = width / 2 - margin;
    function addButton(value, label, glyph, glyphColor, hoverColor) {
      var x = rightOccupiedEdge - btnSize / 2;
      rightOccupiedEdge -= btnSize + gap;
      var btn = document.createElement('a-entity');
      btn.classList.add('pm-target');
      btn.setAttribute('geometry', 'primitive: plane; width: ' + btnSize + '; height: ' + btnSize);
      btn.setAttribute('material', 'color: #182238');
      btn.setAttribute('menu-item', 'value: ' + value + '; label: ' + label + '; hoverColor: ' + hoverColor);
      btn.setAttribute('position', x + ' ' + barY + ' 0');
      var glyphEl = document.createElement('a-text');
      glyphEl.setAttribute('value', glyph);
      glyphEl.setAttribute('align', 'center');
      glyphEl.setAttribute('color', glyphColor);
      glyphEl.setAttribute('width', 6);
      glyphEl.setAttribute('position', '0 0 0.01');
      btn.appendChild(glyphEl);
      containerEl.appendChild(btn);
      return btn;
    }

    var closeBtn = opts.showClose ? addButton(opts.closeValue || 'close', 'Close', 'X', '#f66', '#5c2a2a') : null;
    var helpBtn = opts.showHelp ? addButton(opts.helpValue || 'help', 'Help', '?', '#7cf', '#2a4a5c') : null;
    var titleLeftEdge = -width / 2 + margin;
    var titleAvailableWidth = Math.max(0.25, rightOccupiedEdge - titleLeftEdge);
    var titleEl = document.createElement('a-text');
    titleEl.classList.add('menu-chrome-title');
    titleEl.setAttribute('value', opts.title || '');
    titleEl.setAttribute('align', 'left');
    titleEl.setAttribute('color', '#9ad');
    titleEl.setAttribute('width', titleAvailableWidth);
    titleEl.setAttribute('wrap-count', 20);
    titleEl.setAttribute('position', titleLeftEdge + ' ' + barY + ' 0');
    containerEl.appendChild(titleEl);
    return { titleEl: titleEl, closeBtn: closeBtn, helpBtn: helpBtn };
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
      this.suppressPointing = false;
      this.cameraEl = document.querySelector('a-camera');

      var panel = this.data.template.content.cloneNode(true).firstElementChild;
      el.parentNode.appendChild(panel);
      this.pokeQuat = panel.object3D.quaternion.clone();
      panel.object3D.scale.setScalar(this.scale);
      this.panelEl = panel;
      this.chromes = Array.prototype.slice.call(panel.querySelectorAll('.menu-chrome-slot')).map(function (slot) {
        var chrome = buildMenuChrome(slot.parentNode, {
          title: slot.getAttribute('data-title') || '',
          showHelp: slot.getAttribute('data-help') !== 'false',
          showClose: slot.getAttribute('data-close') !== 'false',
          helpValue: slot.getAttribute('data-help-value') || 'help',
          closeValue: slot.getAttribute('data-close-value') || 'close',
          width: parseFloat(slot.getAttribute('data-width')) || 1,
          barY: parseFloat(slot.getAttribute('data-bar-y')),
        });
        slot.parentNode.removeChild(slot);
        return chrome;
      });
      this.updatePanelPosition();

      el.setAttribute('obb-collider', '');
      el.addEventListener('obbcollisionstarted', function (evt) {
        var poker = evt.detail.withEl;
        if (poker.handComponent && poker.handComponent.isPointing && !self.active) self.open();
      });

      this.pmTargets = Array.prototype.slice.call(panel.querySelectorAll('.pm-target'));
      this.pmTargets.forEach(function (item) {
        item.setAttribute('obb-collider', 'size: 0.035');
        item._lastPokeAt = 0;
        item.addEventListener('obbcollisionstarted', function (evt) {
          var poker = evt.detail.withEl;
          var now = performance.now();
          if (
            self.mode === 'poke' && !self.suppressPointing &&
            poker.handComponent && poker.handComponent.isPointing &&
            isVisibleInHierarchy(item.object3D) &&
            now - item._lastPokeAt > self.data.pokeCooldown
          ) {
            item._lastPokeAt = now;
            item.emit('click');
          }
        });
      });

      panel.addEventListener('menu-item-select', function (evt) {
        if (evt.detail.value === 'close') self.close();
        else if (evt.detail.value === 'help') el.emit('projected-menu-help');
      });
    },

    updatePanelPosition: function () {
      var t = this.el.object3D.position;
      var o = this.data.offset;
      this.panelEl.object3D.position.set(t.x + o.x, t.y + o.y, t.z + o.z);
    },

    tick: function () {
      if (this.active) {
        var mode = this.computeMode();
        if (!mode) this.active = false;
        this.mode = mode || 'closed';
      } else {
        this.mode = 'closed';
      }
      this.applyState();
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

    applyState: function () {
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
      this.scale += (targetScale - this.scale) * this.data.lerp;
      this.panelEl.object3D.scale.setScalar(this.scale);
      if (targetQuat) this.panelEl.object3D.quaternion.slerp(targetQuat, this.data.lerp);
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

    setItemsMode: function (mode) {
      if (this.suppressPointing) mode = 'closed';
      if (mode === this.lastItemsMode) return;
      this.lastItemsMode = mode;
      this.pmTargets.forEach(function (item) {
        if (mode === 'closed') item.classList.remove('menu-target');
        else item.classList.add('menu-target');
      });
    },

    open: function () { this.active = true; },
    close: function () { this.active = false; },
  });
