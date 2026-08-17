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
      this.el.addEventListener('menu-item-select', this.onSelection);
      this.el.addEventListener('watch-menu-ready', this.updateSpinnerLabels.bind(this));
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
