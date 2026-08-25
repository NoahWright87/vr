var MODE_ALIASES = {
  desktop: 'desktop',
  keyboard: 'desktop',
  'mouse-keyboard': 'desktop',
  'non-xr': 'desktop',
  xr: 'xr',
  vr: 'xr',
};

export function normalizeControlMode(mode) {
  return MODE_ALIASES[String(mode || '').trim().toLowerCase()] || null;
}

export function parseControlModes(value) {
  var modes = String(value || '')
    .split(/[|,\s]+/)
    .map(normalizeControlMode)
    .filter(Boolean);
  return Array.from(new Set(modes));
}

export function controlModeMatches(currentMode, acceptedModes) {
  var current = normalizeControlMode(currentMode);
  return Boolean(current && parseControlModes(acceptedModes).indexOf(current) !== -1);
}

if (typeof AFRAME !== 'undefined') {
  AFRAME.registerSystem('control-mode', {
    init: function () {
      this.mode = null;
      // A-Frame emits enter-vr for both a real XR session and ordinary
      // browser fullscreen. Only the renderer's active XR session should
      // disable keyboard/gamepad desktop controls.
      this.onEnterXr = this.syncModeFromRenderer.bind(this);
      this.onExitXr = this.setMode.bind(this, 'desktop');
      this.sceneEl.addEventListener('enter-vr', this.onEnterXr);
      this.sceneEl.addEventListener('exit-vr', this.onExitXr);

      this.syncModeFromRenderer();
    },

    syncModeFromRenderer: function () {
      var self = this;
      requestAnimationFrame(function () {
        var renderer = self.sceneEl.renderer;
        var presenting = Boolean(renderer && renderer.xr && renderer.xr.isPresenting);
        self.setMode(presenting ? 'xr' : 'desktop');
      });
    },

    setMode: function (mode) {
      var nextMode = normalizeControlMode(mode) || 'desktop';
      if (nextMode === this.mode) return;
      var previousMode = this.mode;
      this.mode = nextMode;
      this.sceneEl.setAttribute('data-control-mode', nextMode);
      document.documentElement.setAttribute('data-control-mode', nextMode);
      this.sceneEl.emit('control-mode-changed', {
        mode: nextMode,
        previousMode: previousMode,
      }, false);
    },

    getMode: function () {
      return this.mode;
    },

    isMode: function (mode) {
      return normalizeControlMode(mode) === this.mode;
    },

    matches: function (modes) {
      return controlModeMatches(this.mode, modes);
    },

    remove: function () {
      this.sceneEl.removeEventListener('enter-vr', this.onEnterXr);
      this.sceneEl.removeEventListener('exit-vr', this.onExitXr);
    },
  });

  // Generic visibility gate for menu rows, device-specific hints, world
  // props, controller models, or any other entity whose relevance depends
  // on the active input family. The central system owns mode detection;
  // instances only react when that shared state changes.
  AFRAME.registerComponent('control-mode-visibility', {
    schema: {
      modes: { default: 'desktop|xr' },
    },

    init: function () {
      this.modeSystem = this.el.sceneEl.systems['control-mode'];
      this.authoredVisible = this.el.getAttribute('visible') !== false;
      this.onModeChanged = this.applyVisibility.bind(this);
      this.el.sceneEl.addEventListener('control-mode-changed', this.onModeChanged);
      this.applyVisibility();
    },

    update: function () {
      if (this.modeSystem) this.applyVisibility();
    },

    applyVisibility: function () {
      var mode = this.modeSystem.getMode();
      var visible = this.authoredVisible && this.modeSystem.matches(this.data.modes);
      this.el.object3D.visible = visible;
      this.el.setAttribute('data-control-mode-visible', visible ? 'true' : 'false');
      this.el.setAttribute('data-visible-control-mode', mode);
      this.el.emit('control-mode-visibility-changed', {
        mode: mode,
        visible: visible,
      }, true);
      this.el.emit('menu-targets-changed', null, true);
    },

    remove: function () {
      this.el.sceneEl.removeEventListener('control-mode-changed', this.onModeChanged);
      this.el.object3D.visible = this.authoredVisible;
      this.el.removeAttribute('data-control-mode-visible');
      this.el.removeAttribute('data-visible-control-mode');
    },
  });

  // Optionally collapse menu rows after mode-specific entries are filtered.
  // This is event-driven as well: it only runs when a gate changes or when
  // the component's authored spacing changes, never once per row per frame.
  AFRAME.registerComponent('control-mode-layout', {
    schema: {
      // Excludes .menu-chrome-item: a page's close/help/automatic
      // buttons (see common/menus.js's buildMenuChrome) carry
      // menu-item too, for the same click handling every row uses,
      // but belong in the fixed title bar, not this component's
      // vertical row stack.
      rowSelector: { default: '[menu-item]:not(.menu-chrome-item),[menu-option]' },
      startY: { default: 0 },
      spacing: { default: 0.26 },
    },

    init: function () {
      this.authoredPositions = new Map();
      this.onVisibilityChanged = this.reflow.bind(this);
      this.el.addEventListener('control-mode-visibility-changed', this.onVisibilityChanged);
      this.captureRows();
    },

    update: function () {
      this.captureRows();
      this.reflow();
    },

    captureRows: function () {
      var self = this;
      this.rows = Array.prototype.filter.call(this.el.children, function (row) {
        return row.matches(self.data.rowSelector);
      });
      this.rows.forEach(function (row) {
        if (self.authoredPositions.has(row)) return;
        self.authoredPositions.set(row, {
          x: row.object3D.position.x,
          y: row.object3D.position.y,
          z: row.object3D.position.z,
        });
      });
    },

    reflow: function () {
      var visibleIndex = 0;
      var self = this;
      this.rows.forEach(function (row) {
        if (row.getAttribute('data-control-mode-visible') === 'false') return;
        var authored = self.authoredPositions.get(row);
        row.object3D.position.set(
          authored.x,
          self.data.startY - visibleIndex * self.data.spacing,
          authored.z
        );
        visibleIndex += 1;
      });
    },

    remove: function () {
      this.el.removeEventListener('control-mode-visibility-changed', this.onVisibilityChanged);
      var self = this;
      this.authoredPositions.forEach(function (position, row) {
        row.object3D.position.set(position.x, position.y, position.z);
      });
    },
  });
}
