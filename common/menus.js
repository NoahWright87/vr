import { chooseAutomaticMenuIntent, chooseProjectedMenuMode } from './projected-menu-mode.js';
import { cycleMenuOptionIndex, parseMenuOptions } from './menu-options.js';

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
      this.hovered = false;
      this.el.addEventListener('mouseenter', this.onMouseEnter);
      this.el.addEventListener('mouseleave', this.onMouseLeave);
      this.el.addEventListener('click', this.onClick);
    },

    onMouseEnter: function () {
      this.hovered = true;
      // The clickable mesh is also the raycast surface. Transforming it as
      // feedback can invalidate the cursor's current intersection and cause
      // enter/leave to alternate, especially with a tracked hand near an edge.
      this.el.setAttribute('material', 'color', this.data.hoverColor);
    },

    onMouseLeave: function () {
      this.hovered = false;
      this.el.setAttribute('material', 'color', this.baseColor);
    },

    onClick: function () {
      this.el.emit('menu-item-select', { value: this.data.value, label: this.data.label }, true);
    },

    remove: function () {
      this.el.removeEventListener('mouseenter', this.onMouseEnter);
      this.el.removeEventListener('mouseleave', this.onMouseLeave);
      this.el.removeEventListener('click', this.onClick);
    },
  });

  // A reusable multi-value row. Its left/right thirds cycle through the
  // supplied values; the center opens a compact list of every choice.
  AFRAME.registerComponent('menu-option', {
    schema: {
      key: { type: 'string' },
      label: { type: 'string' },
      values: { type: 'string' },
      labels: { type: 'string', default: '' },
      value: { type: 'string' },
      width: { default: 0.78 },
      height: { default: 0.2 },
    },

    init: function () {
      this.options = parseMenuOptions(this.data.values, this.data.labels);
      this.index = Math.max(0, this.options.findIndex(function (option) {
        return option.value === this.data.value;
      }, this));
      this.popupEl = null;
      this.suppressedTargets = [];
      this.onInternalSelection = this.onInternalSelection.bind(this);
      this.onDismissPopovers = this.closePopup.bind(this);
      this.el.addEventListener('menu-item-select', this.onInternalSelection);
      this.el.addEventListener('menu-dismiss-popovers', this.onDismissPopovers);
      this.buildRow();
    },

    makeTarget: function (width, value, label, x) {
      var target = document.createElement('a-entity');
      target.classList.add('pm-target', 'menu-target');
      target.setAttribute('geometry', 'primitive: plane; width: ' + width + '; height: ' + this.data.height);
      target.setAttribute('material', 'color: #182238');
      target.setAttribute('menu-item', 'value: ' + value + '; label: ' + label);
      target.setAttribute('position', x + ' 0 0');
      this.el.appendChild(target);
      return target;
    },

    addText: function (target, value, width, color) {
      var text = document.createElement('a-text');
      text.setAttribute('value', value);
      text.setAttribute('align', 'center');
      text.setAttribute('color', color || '#eee');
      text.setAttribute('width', width);
      text.setAttribute('position', '0 0 0.01');
      target.appendChild(text);
      return text;
    },

    buildRow: function () {
      var arrowWidth = this.data.height;
      var gap = 0.01;
      var centerWidth = this.data.width - arrowWidth * 2 - gap * 2;
      this.previousEl = this.makeTarget(arrowWidth, 'menu-option-previous', 'Previous ' + this.data.label, -(centerWidth + arrowWidth) / 2 - gap);
      this.addText(this.previousEl, '<', 3.5, '#9ad');
      this.centerEl = this.makeTarget(centerWidth, 'menu-option-open', this.data.label, 0);
      this.valueTextEl = this.addText(this.centerEl, '', 2.4, '#eee');
      this.nextEl = this.makeTarget(arrowWidth, 'menu-option-next', 'Next ' + this.data.label, (centerWidth + arrowWidth) / 2 + gap);
      this.addText(this.nextEl, '>', 3.5, '#9ad');
      this.renderValue();
      var self = this;
      setTimeout(function () {
        if (self.el.parentNode) self.el.emit('menu-targets-changed', null, true);
      }, 0);
    },

    onInternalSelection: function (evt) {
      if (evt.target === this.el || !this.el.contains(evt.target)) return;
      var value = evt.detail.value;
      if (value === 'menu-option-previous') {
        evt.stopPropagation();
        this.cycle(-1);
      } else if (value === 'menu-option-next') {
        evt.stopPropagation();
        this.cycle(1);
      } else if (value === 'menu-option-open') {
        evt.stopPropagation();
        if (this.popupEl) this.closePopup();
        else this.openPopup();
      } else if (value.indexOf('menu-option-choice-') === 0) {
        evt.stopPropagation();
        this.selectIndex(parseInt(value.slice('menu-option-choice-'.length), 10), true);
        this.closePopup();
      }
    },

    cycle: function (delta) {
      this.selectIndex(cycleMenuOptionIndex(this.options.length, this.index, delta), true);
    },

    selectIndex: function (index, emitChange) {
      if (index < 0 || index >= this.options.length) return;
      this.index = index;
      this.data.value = this.options[index].value;
      this.renderValue();
      if (emitChange) {
        this.el.emit('menu-option-change', {
          key: this.data.key,
          controlLabel: this.data.label,
          value: this.options[index].value,
          label: this.options[index].label,
          index: index,
        }, true);
      }
    },

    setValue: function (value) {
      var stringValue = String(value);
      var index = this.options.findIndex(function (option) { return option.value === stringValue; });
      if (index >= 0) this.selectIndex(index, false);
    },

    renderValue: function () {
      var option = this.options[this.index];
      if (!option || !this.valueTextEl) return;
      this.valueTextEl.setAttribute('text', 'value', this.data.label + ': ' + option.label);
    },

    openPopup: function () {
      if (!this.options.length) return;
      var scope = this.el.closest('[data-menu-page]') || this.el.parentNode;
      Array.prototype.forEach.call(scope.querySelectorAll('[menu-option]'), function (item) {
        if (item === this.el) return;
        var component = item.components['menu-option'];
        if (component) component.closePopup();
      }, this);
      this.el.emit('menu-dismiss-popovers', { except: this.el }, true);
      // A popup is a modal interaction layer. Removing the underlying rows
      // from the raycaster selector prevents a slightly angled ray from
      // selecting a visually covered control on another depth plane.
      this.suppressedTargets = Array.prototype.slice.call(scope.querySelectorAll('.menu-target'));
      this.suppressedTargets.forEach(function (target) {
        target.classList.remove('menu-target');
      });
      var popup = document.createElement('a-entity');
      popup.classList.add('menu-option-popup');
      popup.setAttribute('position', '0 0 0.04');
      var optionHeight = 0.17;
      var popupHeight = this.options.length * optionHeight + 0.06;
      var background = document.createElement('a-plane');
      background.setAttribute('width', this.data.width * 0.82);
      background.setAttribute('height', popupHeight);
      background.setAttribute('material', 'color: #0b1220; shader: flat');
      background.setAttribute('position', '0 0 -0.01');
      popup.appendChild(background);
      var self = this;
      this.options.forEach(function (option, index) {
        var target = document.createElement('a-entity');
        target.classList.add('pm-target', 'menu-target');
        target.setAttribute('geometry', 'primitive: plane; width: ' + (self.data.width * 0.72) + '; height: 0.14');
        target.setAttribute('material', 'color: ' + (index === self.index ? '#2a4a5c' : '#182238'));
        target.setAttribute('menu-item', 'value: menu-option-choice-' + index + '; label: ' + option.label);
        target.setAttribute('position', '0 ' + (((self.options.length - 1) / 2 - index) * optionHeight) + ' 0');
        self.addText(target, option.label, 2.3, '#eee');
        popup.appendChild(target);
      });
      this.el.appendChild(popup);
      this.popupEl = popup;
      setTimeout(function () {
        if (self.popupEl) self.el.emit('menu-targets-changed', null, true);
      }, 0);
    },

    closePopup: function (evt) {
      if (evt && evt.detail && evt.detail.except === this.el) return;
      if (!this.popupEl) return;
      this.popupEl.parentNode.removeChild(this.popupEl);
      this.popupEl = null;
      this.suppressedTargets.forEach(function (target) {
        if (target.parentNode && isVisibleInHierarchy(target.object3D)) target.classList.add('menu-target');
      });
      this.suppressedTargets = [];
      this.el.emit('menu-targets-changed', null, true);
    },

    remove: function () {
      this.closePopup();
      this.el.removeEventListener('menu-item-select', this.onInternalSelection);
      this.el.removeEventListener('menu-dismiss-popovers', this.onDismissPopovers);
    },
  });

  AFRAME.registerComponent('menu-feedback', {
    init: function () {
      this.feedbackText = this.el.querySelector('.menu-feedback-text');
      this.el.addEventListener('menu-item-select', (evt) => {
        this.feedbackText.setAttribute('text', 'value', 'Selected: ' + evt.detail.label);
      });
      this.el.addEventListener('menu-option-change', (evt) => {
        this.feedbackText.setAttribute('text', 'value', 'Selected: ' + evt.detail.controlLabel + ': ' + evt.detail.label);
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
      // menu-chrome-item, not just pm-target: it's the marker
      // control-mode-layout's default rowSelector excludes, so a
      // page using both control-mode-layout AND chrome buttons
      // (only "main" does today) doesn't sweep close/help/automatic
      // into its vertical row stack — they carry menu-item too (for
      // the same click handling every row uses), so rowSelector
      // alone can't otherwise tell them apart from a real row.
      btn.classList.add('pm-target', 'menu-chrome-item');
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
    var automaticBtn = opts.showAutomaticToggle
      ? addButton('projected-menu-automatic', opts.automatic ? 'Automatic open' : 'Manual open', opts.automatic ? 'A' : 'M', '#7fd', '#2a5c50')
      : null;
    if (automaticBtn) automaticBtn.classList.add('menu-automatic-toggle');
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
    return { titleEl: titleEl, closeBtn: closeBtn, automaticBtn: automaticBtn, helpBtn: helpBtn };
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
      automatic: { default: false },
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
      this.suppressPointing = false;
      this.forcedMode = null;
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
          showAutomaticToggle: slot.getAttribute('data-automatic-toggle') !== 'false',
          automatic: self.data.automatic,
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
            self.mode === 'poke' && !self.suppressPointing &&
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

      panel.addEventListener('menu-item-select', function (evt) {
        if (evt.detail.value === 'close') self.close();
        else if (evt.detail.value === 'projected-menu-automatic') self.setAutomatic(!self.data.automatic);
        else if (evt.detail.value === 'help') el.emit('projected-menu-help');
      });
    },

    updatePanelPosition: function () {
      var t = this.el.object3D.position;
      var o = this.data.offset;
      this.panelEl.object3D.position.set(t.x + o.x, t.y + o.y, t.z + o.z);
    },

    tick: function () {
      if (this.data.automatic && !this.forcedMode) {
        var automaticIntent = this.computeAutomaticIntent();
        if (automaticIntent !== 'open') this.automaticDismissed = false;
        if (automaticIntent === 'open' && !this.automaticDismissed) this.active = true;
        else if (automaticIntent === 'close') this.active = false;
      }
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
      if (this.forcedMode === 'poke' || this.forcedMode === 'laser') return this.forcedMode;
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
          Array.prototype.forEach.call(this.panelEl.querySelectorAll('[menu-option]'), function (item) {
            var option = item.components['menu-option'];
            if (option) option.closePopup();
          });
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
      if (this.suppressPointing) mode = 'closed';
      this.lastItemsMode = mode;
      var self = this;
      this.pmTargets.forEach(function (item) {
        var interactive = mode !== 'closed' && self.isMenuTargetInteractive(item);
        if (interactive && !item.classList.contains('menu-target')) item.classList.add('menu-target');
        else if (!interactive && item.classList.contains('menu-target')) item.classList.remove('menu-target');
      });
    },

    isMenuTargetInteractive: function (item) {
      if (!isVisibleInHierarchy(item.object3D)) return false;
      // Any open modal popup layer (menu-option's own list, or
      // room-code-entry's character grid — common/room-code-entry.js)
      // suppresses everything outside itself. Both popup types re-fire
      // menu-targets-changed when they open (so the raycaster picks up
      // their new cells), which lands here too — this needs to recognize
      // either class or that refresh silently re-enables whatever the
      // popup just suppressed.
      var popup = this.panelEl.querySelector('.menu-option-popup, .room-code-popup');
      return !popup || popup.contains(item);
    },

    updateAutomaticChrome: function () {
      var automatic = this.data.automatic;
      this.chromes.forEach(function (chrome) {
        var button = chrome.automaticBtn;
        if (!button) return;
        var glyph = button.querySelector('a-text');
        if (glyph) glyph.setAttribute('text', 'value', automatic ? 'A' : 'M');
        button.setAttribute('menu-item', 'label', automatic ? 'Automatic open' : 'Manual open');
      });
    },

    setAutomatic: function (automatic) {
      this.data.automatic = Boolean(automatic);
      this.automaticDismissed = false;
      this.updateAutomaticChrome();
      this.el.emit('projected-menu-automatic-changed', { automatic: this.data.automatic });
    },

    open: function () {
      this.automaticDismissed = false;
      this.active = true;
    },
    // Semantic input can ask for the same projected menu in a known
    // interaction layout without pretending to be a tracked controller.
    // Physical XR input continues to derive the mode from the prop pose.
    openInMode: function (mode) {
      this.forcedMode = mode === 'poke' ? 'poke' : 'laser';
      this.open();
    },
    close: function () {
      this.automaticDismissed = this.data.automatic;
      this.active = false;
      this.forcedMode = null;
    },
  });
