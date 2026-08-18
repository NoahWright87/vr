(function () {
  'use strict';

  // Pistols at Dawn owns only its menu choices and the adapter from generic
  // option events to its current gallery. Menu UI and interaction stay shared.
  registerComponent('pistols-watch-menu', {
    init: function () {
      this.settings = { kind: 'spinner', count: 4, speed: 45, distance: 5 };
      this.targetsPaused = false;
      this.galleryHost = document.querySelector('#target-gallery');
      this.activeGalleryEl = null;
      this.onSelection = this.onSelection.bind(this);
      this.onOptionChange = this.onOptionChange.bind(this);
      this.el.addEventListener('menu-item-select', this.onSelection);
      this.el.addEventListener('menu-option-change', this.onOptionChange);
      this.el.addEventListener('watch-menu-ready', this.updateControls.bind(this));
      this.rebuildGallery();
    },

    onSelection: function (evt) {
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
  });
})();
