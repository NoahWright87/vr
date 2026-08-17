(function () {
  'use strict';

  // Pistols at Dawn owns only its menu choices. The watch, projection,
  // nested page navigation, pointing, poking, and menu chrome all live in
  // common/menus.js and common/watch-menu.js and are shared with the
  // primitive showcase.
  registerComponent('pistols-watch-menu', {
    init: function () {
      this.spinnerPaused = false;
      this.onSelection = this.onSelection.bind(this);
      this.onOptionChange = this.onOptionChange.bind(this);
      this.el.addEventListener('menu-item-select', this.onSelection);
      this.el.addEventListener('menu-option-change', this.onOptionChange);
      this.el.addEventListener('watch-menu-ready', this.updateSpinnerControls.bind(this));
    },

    onSelection: function (evt) {
      if (evt.detail.value !== 'toggle-spinner') return;
      var spinnerEl = document.querySelector('#spinner-target');
      var spinner = spinnerEl && spinnerEl.components['wheel-target'];
      if (!spinner) return;
      this.spinnerPaused = !this.spinnerPaused;
      spinner.setPaused(this.spinnerPaused);
      this.updateSpinnerLabels();
    },

    onOptionChange: function (evt) {
      var spinnerEl = document.querySelector('#spinner-target');
      var spinner = spinnerEl && spinnerEl.components['wheel-target'];
      if (!spinner) return;
      var numberValue = Number(evt.detail.value);
      if (evt.detail.key === 'spinner-count') {
        spinnerEl.setAttribute('wheel-target', 'spokeCount', numberValue);
      } else if (evt.detail.key === 'spinner-speed') {
        spinnerEl.setAttribute('wheel-target', 'speed', numberValue);
      } else if (evt.detail.key === 'spinner-distance') {
        spinnerEl.setAttribute('wheel-target', 'distance', numberValue);
      } else {
        return;
      }
      this.updateSpinnerControls();
    },

    updateSpinnerControls: function () {
      var spinnerEl = document.querySelector('#spinner-target');
      var spinner = spinnerEl && spinnerEl.components['wheel-target'];
      if (!spinner) return;
      this.updateSpinnerLabels();
      this.syncOption('.spinner-count-option', spinner.data.spokeCount);
      this.syncOption('.spinner-speed-option', spinner.data.speed);
      this.syncOption('.spinner-distance-option', spinner.data.distance);
    },

    syncOption: function (selector, value) {
      Array.prototype.forEach.call(document.querySelectorAll(selector), function (optionEl) {
        var option = optionEl.components['menu-option'];
        if (option) option.setValue(value);
      });
    },

    updateSpinnerLabels: function () {
      var label = this.spinnerPaused ? 'Start spinner' : 'Pause spinner';
      Array.prototype.forEach.call(document.querySelectorAll('.spinner-toggle-label'), function (labelEl) {
        labelEl.setAttribute('text', 'value', label);
        var row = labelEl.closest('[menu-item]');
        if (row) row.setAttribute('menu-item', 'label', label);
      });
    },
  });
})();
