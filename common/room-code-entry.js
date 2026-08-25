// A compact 4-character up/down picker for entering a multiplayer
// room code one-handed in VR — the alternative to triggering the
// device's on-screen keyboard, which is clunky mid-game. Reuses
// cycleMenuOptionIndex (common/menu-options.js) — the same wrap-around
// index math common/menus.js's menu-option uses for its full-width
// rows — and ROOM_CODE_CHARS (worker/src/signal-rooms.js), the same
// alphabet room codes are actually generated from. Interaction goes
// through the same menu-item/.pm-target/.menu-target machinery every
// other menu control uses, so poke and laser both just work with no
// new input plumbing.
//
// Exposes its current 4-character value directly via getValue()
// (`.components['room-code-entry'].getValue()`) rather than emitting
// a bubbling event — it has exactly one consumer, the JOIN button.
// A plain method, not a `get value()` accessor: AFRAME.registerComponent
// touches every property on the definition object at registration
// time (once, for the whole page), before any component instance —
// and therefore `this.indices` — exists; an accessor would throw
// right there, a method just sits unread until something calls it.

import { cycleMenuOptionIndex } from './menu-options.js';
import { ROOM_CODE_CHARS } from '../worker/src/signal-rooms.js';

var DIGIT_COUNT = 4;

AFRAME.registerComponent('room-code-entry', {
  schema: {
    width: { default: 0.78 },
  },

  init: function () {
    this.indices = new Array(DIGIT_COUNT).fill(0);
    this.digitEls = [];
    this.onSelect = this.onSelect.bind(this);
    this.el.addEventListener('menu-item-select', this.onSelect);
    this.buildRow();
  },

  getValue: function () {
    return this.indices.map(function (index) { return ROOM_CODE_CHARS[index]; }).join('');
  },

  makeTarget: function (width, height, value, label, x, y) {
    var target = document.createElement('a-entity');
    target.classList.add('pm-target', 'menu-target');
    target.setAttribute('geometry', 'primitive: plane; width: ' + width + '; height: ' + height);
    target.setAttribute('material', 'color: #182238');
    target.setAttribute('menu-item', 'value: ' + value + '; label: ' + label);
    target.setAttribute('position', x + ' ' + y + ' 0');
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
    var gap = 0.015;
    var digitWidth = (this.data.width - gap * (DIGIT_COUNT - 1)) / DIGIT_COUNT;
    var upHeight = 0.09;
    var charHeight = 0.16;
    var downHeight = 0.09;
    var vGap = 0.01;
    var upY = charHeight / 2 + vGap + upHeight / 2;
    var downY = -(charHeight / 2 + vGap + downHeight / 2);

    for (var i = 0; i < DIGIT_COUNT; i++) {
      var x = -this.data.width / 2 + digitWidth / 2 + i * (digitWidth + gap);

      var upEl = this.makeTarget(digitWidth, upHeight, 'code-digit-' + i + '-up', 'Next character', x, upY);
      this.addText(upEl, '^', 3, '#9ad');

      var charEl = document.createElement('a-entity');
      charEl.classList.add('room-code-digit');
      charEl.setAttribute('geometry', 'primitive: plane; width: ' + digitWidth + '; height: ' + charHeight);
      charEl.setAttribute('material', 'color: #101827');
      charEl.setAttribute('position', x + ' 0 0');
      this.el.appendChild(charEl);
      this.digitEls.push(this.addText(charEl, ROOM_CODE_CHARS[this.indices[i]], 3.4, '#eee'));

      var downEl = this.makeTarget(digitWidth, downHeight, 'code-digit-' + i + '-down', 'Previous character', x, downY);
      this.addText(downEl, 'v', 3, '#9ad');
    }

    var self = this;
    setTimeout(function () {
      if (self.el.parentNode) self.el.emit('menu-targets-changed', null, true);
    }, 0);
  },

  onSelect: function (evt) {
    if (evt.target === this.el || !this.el.contains(evt.target)) return;
    var match = /^code-digit-(\d)-(up|down)$/.exec(evt.detail.value);
    if (!match) return;
    evt.stopPropagation();
    var index = parseInt(match[1], 10);
    var delta = match[2] === 'up' ? 1 : -1;
    this.indices[index] = cycleMenuOptionIndex(ROOM_CODE_CHARS.length, this.indices[index], delta);
    this.digitEls[index].setAttribute('text', 'value', ROOM_CODE_CHARS[this.indices[index]]);
  },

  remove: function () {
    this.el.removeEventListener('menu-item-select', this.onSelect);
  },
});
