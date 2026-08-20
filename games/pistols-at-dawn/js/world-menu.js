(function () {
  'use strict';

  // Opt-in and intentionally low frequency: useful numbers in-headset without
  // turning the measurement UI into its own source of frame-time noise.
  registerComponent('performance-monitor', {
    schema: {
      enabled: { type: 'boolean', default: false },
      intervalMs: { type: 'number', default: 500 },
    },

    init: function () {
      this.elapsed = 0;
      this.frames = 0;
      this.lastValue = '';
    },

    update: function () {
      this.el.setAttribute('visible', this.data.enabled);
      if (this.data.enabled) {
        this.elapsed = 0;
        this.frames = 0;
      }
    },

    tick: function (time, dt) {
      if (!this.data.enabled) return;
      this.elapsed += dt || 16;
      this.frames++;
      if (this.elapsed < this.data.intervalMs) return;

      var renderer = this.el.sceneEl.renderer;
      var info = renderer && renderer.info;
      var render = info && info.render;
      var memory = info && info.memory;
      var fps = this.frames * 1000 / this.elapsed;
      var frameMs = this.elapsed / this.frames;
      var value =
        'FPS ' + Math.round(fps) + '   ' + frameMs.toFixed(1) + 'ms\n' +
        'Draw ' + (render ? render.calls : 0) + '   Tri ' + (render ? Math.round(render.triangles / 1000) + 'k' : '0') +
        '   Geo ' + (memory ? memory.geometries : 0) + '   Tex ' + (memory ? memory.textures : 0);
      if (value !== this.lastValue) {
        this.lastValue = value;
        this.el.setAttribute('text', 'value', value);
      }
      this.elapsed = 0;
      this.frames = 0;
    },
  });

  // Pistols at Dawn owns only its menu choices and the adapter from generic
  // option events to its current gallery. Menu UI and interaction stay shared.
  registerComponent('pistols-watch-menu', {
    init: function () {
      this.settings = { kind: 'spinner', count: 4, speed: 45, distance: 5 };
      this.targetsPaused = false;
      this.hudVisible = true;
      this.performanceVisible = false;
      this.galleryHost = null;
      this.activeGalleryEl = null;
      this.onSelection = this.onSelection.bind(this);
      this.onOptionChange = this.onOptionChange.bind(this);
      this.onAreaLoaded = this.onAreaLoaded.bind(this);
      this.onAreaUnloading = this.onAreaUnloading.bind(this);
      this.onWatchReady = this.updateControls.bind(this);
      this.el.addEventListener('menu-item-select', this.onSelection);
      this.el.addEventListener('menu-option-change', this.onOptionChange);
      this.el.addEventListener('watch-menu-ready', this.onWatchReady);
      this.el.addEventListener('area-loaded', this.onAreaLoaded);
      this.el.addEventListener('area-unloading', this.onAreaUnloading);
    },

    remove: function () {
      this.el.removeEventListener('menu-item-select', this.onSelection);
      this.el.removeEventListener('menu-option-change', this.onOptionChange);
      this.el.removeEventListener('watch-menu-ready', this.onWatchReady);
      this.el.removeEventListener('area-loaded', this.onAreaLoaded);
      this.el.removeEventListener('area-unloading', this.onAreaUnloading);
    },

    onAreaLoaded: function (evt) {
      if (evt.detail.id !== 'range') return;
      this.galleryHost = evt.detail.root.querySelector('#target-gallery');
      this.rebuildGallery();
      this.updateControls();
    },

    onAreaUnloading: function (evt) {
      if (evt.detail.id !== 'range') return;
      this.activeGalleryEl = null;
      this.galleryHost = null;
    },

    onSelection: function (evt) {
      if (evt.detail.value === 'toggle-hud') {
        this.hudVisible = !this.hudVisible;
        PLAYER_HUD_VISIBLE = this.hudVisible;
        var hud = document.querySelector('#player-hud');
        if (hud) hud.setAttribute('visible', this.hudVisible);
        if (this.hudVisible) {
          var vices = document.querySelector('#vices');
          var viceMeter = vices && vices.components['vice-meter'];
          if (viceMeter) viceMeter.updateHud();
        }
        this.updateHudLabels();
        return;
      }
      if (evt.detail.value === 'toggle-performance') {
        this.performanceVisible = !this.performanceVisible;
        var performanceEl = document.querySelector('#performance-text');
        if (performanceEl) performanceEl.setAttribute('performance-monitor', 'enabled', this.performanceVisible);
        this.updatePerformanceLabels();
        return;
      }
      if (evt.detail.value !== 'toggle-target-motion') return;
      this.targetsPaused = !this.targetsPaused;
      this.applyPausedState();
      this.updateMotionLabels();
    },

    onOptionChange: function (evt) {
      var numberValue = Number(evt.detail.value);
      if (evt.detail.key === 'target-kind') this.settings.kind = evt.detail.value;
      else if (evt.detail.key === 'spinner-count') this.settings.count = numberValue;
      else if (evt.detail.key === 'spinner-speed') this.settings.speed = numberValue;
      else if (evt.detail.key === 'spinner-distance') this.settings.distance = numberValue;
      else return;
      this.rebuildGallery();
      this.updateControls();
    },

    componentForKind: function (kind) {
      if (kind === 'stationary') return 'target-group';
      if (kind === 'conveyor') return 'conveyor-target';
      if (kind === 'popper') return 'popper-target';
      return 'wheel-target';
    },

    dataForKind: function (kind) {
      var settings = this.settings;
      // Distance is a ground-plane translation only. Keeping scale fixed also
      // keeps spinner hubs, conveyor rows, and pop-up travel at the same
      // physical height when the selected range changes.
      var targetScale = 0.65;
      if (kind === 'stationary') return { count: settings.count, distance: settings.distance };
      if (kind === 'conveyor') {
        var conveyorCount = settings.count <= 6 ? 1 : settings.count <= 12 ? 2 : settings.count <= 18 ? 3 : 4;
        return {
          count: settings.count,
          conveyorCount: conveyorCount,
          length: Math.round(Math.max(3, Math.ceil(settings.count / conveyorCount)) * 10) / 10,
          speed: settings.speed / 100,
          direction: 1,
          targetScale: targetScale,
          angle: 0,
          distance: settings.distance,
        };
      }
      if (kind === 'popper') {
        var timingScale = 45 / settings.speed;
        return {
          count: settings.count,
          cycleMinMs: Math.round(2000 * timingScale),
          cycleMaxMs: Math.round(4500 * timingScale),
          upDurationMs: Math.round(2200 * timingScale),
          targetScale: targetScale,
          angle: 0,
          distance: settings.distance,
        };
      }
      return {
        spokeCount: settings.count,
        wheelRadius: 0.9,
        speed: settings.speed,
        targetScale: targetScale,
        angle: 0,
        distance: settings.distance,
      };
    },

    rebuildGallery: function () {
      if (!this.galleryHost) return;
      if (this.activeGalleryEl && this.activeGalleryEl.parentNode) {
        this.activeGalleryEl.parentNode.removeChild(this.activeGalleryEl);
      }
      var kind = this.settings.kind;
      var componentName = this.componentForKind(kind);
      var galleryEl = document.createElement('a-entity');
      galleryEl.id = 'active-target-gallery';
      galleryEl.setAttribute('data-target-kind', kind);
      galleryEl.setAttribute(componentName, this.dataForKind(kind));
      this.galleryHost.appendChild(galleryEl);
      this.activeGalleryEl = galleryEl;
      var self = this;
      function finishSetup() { self.applyPausedState(); }
      if (galleryEl.hasLoaded) finishSetup();
      else galleryEl.addEventListener('loaded', finishSetup, { once: true });
    },

    applyPausedState: function () {
      if (!this.activeGalleryEl) return;
      var componentName = this.componentForKind(this.settings.kind);
      var component = this.activeGalleryEl.components[componentName];
      if (component && component.setPaused) component.setPaused(this.targetsPaused);
    },

    updateControls: function () {
      this.updateMotionLabels();
      this.updateHudLabels();
      this.updatePerformanceLabels();
      this.syncOption('.target-kind-option', this.settings.kind);
      this.syncOption('.target-count-option', this.settings.count);
      this.syncOption('.target-speed-option', this.settings.speed);
      this.syncOption('.target-distance-option', this.settings.distance);
    },

    syncOption: function (selector, value) {
      Array.prototype.forEach.call(document.querySelectorAll(selector), function (optionEl) {
        var option = optionEl.components['menu-option'];
        if (option) option.setValue(value);
      });
    },

    updateMotionLabels: function () {
      var label = this.targetsPaused ? 'Resume targets' : 'Pause targets';
      Array.prototype.forEach.call(document.querySelectorAll('.target-motion-toggle-label'), function (labelEl) {
        labelEl.setAttribute('text', 'value', label);
        var row = labelEl.closest('[menu-item]');
        if (row) row.setAttribute('menu-item', 'label', label);
      });
    },

    updateHudLabels: function () {
      var label = this.hudVisible ? 'Hide HUD' : 'Show HUD';
      Array.prototype.forEach.call(document.querySelectorAll('.hud-toggle-label'), function (labelEl) {
        labelEl.setAttribute('text', 'value', label);
        var row = labelEl.closest('[menu-item]');
        if (row) row.setAttribute('menu-item', 'label', label);
      });
    },

    updatePerformanceLabels: function () {
      var label = this.performanceVisible ? 'Hide Performance' : 'Show Performance';
      Array.prototype.forEach.call(document.querySelectorAll('.performance-toggle-label'), function (labelEl) {
        labelEl.setAttribute('text', 'value', label);
        var row = labelEl.closest('[menu-item]');
        if (row) row.setAttribute('menu-item', 'label', label);
      });
    },
  });
})();
