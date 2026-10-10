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
      this.onCommit = this.onCommit.bind(this);
      this.onAreaLoaded = this.onAreaLoaded.bind(this);
      this.onAreaUnloading = this.onAreaUnloading.bind(this);
      this.el.addEventListener('menu-commit', this.onCommit);
      this.el.addEventListener('area-loaded', this.onAreaLoaded);
      this.el.addEventListener('area-unloading', this.onAreaUnloading);
    },

    remove: function () {
      this.el.removeEventListener('menu-commit', this.onCommit);
      this.el.removeEventListener('area-loaded', this.onAreaLoaded);
      this.el.removeEventListener('area-unloading', this.onAreaUnloading);
    },

    onAreaLoaded: function (evt) {
      if (evt.detail.id !== 'range') return;
      this.galleryHost = evt.detail.root.querySelector('#target-gallery');
      this.rebuildGallery();
    },

    onAreaUnloading: function (evt) {
      if (evt.detail.id !== 'range') return;
      this.activeGalleryEl = null;
      this.galleryHost = null;
    },

    setHudVisible: function (visible) {
      this.hudVisible = Boolean(visible);
      PLAYER_HUD_VISIBLE = this.hudVisible;
      var hud = document.querySelector('#player-hud');
      if (hud) hud.setAttribute('visible', this.hudVisible);
      if (this.hudVisible) {
        var vices = document.querySelector('#vices');
        var viceMeter = vices && vices.components['vice-meter'];
        if (viceMeter) viceMeter.updateHud();
      }
    },

    setPerformanceVisible: function (visible) {
      this.performanceVisible = Boolean(visible);
      var performanceEl = document.querySelector('#performance-text');
      if (performanceEl) performanceEl.setAttribute('performance-monitor', 'enabled', this.performanceVisible);
    },

    // The watch's rows (js/menu-pages.js), by id. A toggle commits the
    // state it now shows, so these set rather than flip.
    onCommit: function (evt) {
      var id = evt.detail.id;
      var value = evt.detail.value;
      if (id === 'pistols-hud') { this.setHudVisible(value); return; }
      if (id === 'pistols-performance') { this.setPerformanceVisible(value); return; }
      if (id === 'pistols-targets-paused') {
        this.targetsPaused = Boolean(value);
        this.applyPausedState();
        return;
      }
      // Debug-only and unrelated to the gallery -- handled here anyway
      // since the rest of the watch's rows are.
      if (id === 'pistols-laser') { LASER_SIGHT = value; return; }
      // Debug > Motion: live tunables for the scripted gun draw/holster/
      // twirl flourish (core-hand-rig.js's buildFlourishedKeyframe) --
      // same "debug-only global reassigned from the watch" pattern as
      // the laser above, just numeric instead of a string enum.
      if (id === 'pistols-motion-arc') { MOTION_ARC_FRACTION = Number(value); return; }
      if (id === 'pistols-motion-ease') { MOTION_EASE_POWER = Number(value); return; }
      if (id === 'pistols-motion-overshoot') { MOTION_OVERSHOOT = Number(value); return; }
      if (id === 'pistols-motion-settle') { MOTION_SETTLE_RATE = Number(value); return; }
      if (id === 'pistols-target-kind') this.settings.kind = value;
      else if (id === 'pistols-target-count') this.settings.count = Number(value);
      else if (id === 'pistols-target-speed') this.settings.speed = Number(value);
      else if (id === 'pistols-target-distance') this.settings.distance = Number(value);
      else return;
      this.rebuildGallery();
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
  });
})();
