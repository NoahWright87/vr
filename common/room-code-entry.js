// A 4-square room-code picker for entering a multiplayer room code
// in VR — the alternative to triggering the device's on-screen
// keyboard, which is clunky mid-game. Tapping a digit opens a compact
// grid of every character in ROOM_CODE_CHARS (worker/src/signal-rooms.js,
// the same alphabet room codes are actually generated from) right
// there beside it — pick any letter in one more tap, rather than
// cycling through up to 31 steps to reach it. Mirrors
// common/menus.js's menu-option popup (open/closePopup, suppressing
// the underlying targets while a popup is open, dismissing on
// menu-dismiss-popovers so opening one digit's popup closes any
// other), just a grid instead of a vertical list — a 32-item vertical
// list would be far too tall to stay glanceable next to a small
// square. Interaction goes through the same
// menu-item/.pm-target/.menu-target machinery every other menu
// control uses, so poke and laser both just work with no new input
// plumbing.
//
// Exposes its current 4-character value directly via getValue()
// (`.components['room-code-entry'].getValue()`) rather than emitting
// a bubbling event — it has exactly one consumer, the JOIN button.
// A plain method, not a `get value()` accessor: AFRAME.registerComponent
// touches every property on the definition object at registration
// time (once, for the whole page), before any component instance —
// and therefore `this.indices` — exists; an accessor would throw
// right there, a method just sits unread until something calls it.

import { ROOM_CODE_CHARS } from '../worker/src/signal-rooms.js';

var DIGIT_COUNT = 4;
var DIGIT_GAP = 0.015;
var GRID_COLUMNS = 8;
var GRID_ROWS = Math.ceil(ROOM_CODE_CHARS.length / GRID_COLUMNS);

AFRAME.registerComponent('room-code-entry', {
  schema: {
    width: { default: 0.78 },
  },

  init: function () {
    this.indices = new Array(DIGIT_COUNT).fill(0);
    this.digitEls = [];
    this.popupEl = null;
    this.openDigit = -1;
    this.onSelect = this.onSelect.bind(this);
    this.onDismissPopovers = this.closePopup.bind(this);
    this.el.addEventListener('menu-item-select', this.onSelect);
    this.el.addEventListener('menu-dismiss-popovers', this.onDismissPopovers);
    this.buildRow();
  },

  getValue: function () {
    return this.indices.map(function (index) { return ROOM_CODE_CHARS[index]; }).join('');
  },

  makeTarget: function (width, height, value, label, x, y, parent) {
    var target = document.createElement('a-entity');
    target.classList.add('pm-target', 'menu-target');
    target.setAttribute('geometry', 'primitive: plane; width: ' + width + '; height: ' + height);
    target.setAttribute('material', 'color: #182238');
    target.setAttribute('menu-item', 'value: ' + value + '; label: ' + label);
    target.setAttribute('position', x + ' ' + y + ' 0');
    (parent || this.el).appendChild(target);
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
    var digitWidth = (this.data.width - DIGIT_GAP * (DIGIT_COUNT - 1)) / DIGIT_COUNT;
    var digitHeight = 0.18;

    for (var i = 0; i < DIGIT_COUNT; i++) {
      var x = -this.data.width / 2 + digitWidth / 2 + i * (digitWidth + DIGIT_GAP);
      var digitEl = this.makeTarget(digitWidth, digitHeight, 'code-digit-' + i, 'Character ' + (i + 1), x, 0);
      this.digitEls.push(this.addText(digitEl, ROOM_CODE_CHARS[this.indices[i]], 2.6, '#eee'));
    }

    var self = this;
    setTimeout(function () {
      if (self.el.parentNode) self.el.emit('menu-targets-changed', null, true);
    }, 0);
  },

  onSelect: function (evt) {
    if (evt.target === this.el || !this.el.contains(evt.target)) return;
    var value = evt.detail.value;
    var digitMatch = /^code-digit-(\d)$/.exec(value);
    var pickMatch = /^code-pick-(\d+)$/.exec(value);
    if (digitMatch) {
      evt.stopPropagation();
      var index = parseInt(digitMatch[1], 10);
      if (this.openDigit === index) this.closePopup();
      else this.openPopup(index);
    } else if (pickMatch && this.openDigit >= 0) {
      evt.stopPropagation();
      var charIndex = parseInt(pickMatch[1], 10);
      this.indices[this.openDigit] = charIndex;
      this.digitEls[this.openDigit].setAttribute('text', 'value', ROOM_CODE_CHARS[charIndex]);
      this.closePopup();
    }
  },

  openPopup: function (digitIndex) {
    this.closePopup();
    this.el.emit('menu-dismiss-popovers', { except: this.el }, true);
    // A popup is a modal interaction layer, same reasoning as
    // menu-option's own popup: pull every OTHER target on the page (not
    // just this control's own digit squares — the HOST/JOIN buttons
    // below are just as reachable through an angled ray) out of raycast
    // selection while it's open, so nothing visually covered by the grid
    // can still be hit.
    var scope = this.el.closest('[data-menu-page]') || this.el.parentNode;
    this.suppressedTargets = Array.prototype.slice.call(scope.querySelectorAll('.menu-target'));
    this.suppressedTargets.forEach(function (target) { target.classList.remove('menu-target'); });

    var gap = 0.012;
    var cellSize = 0.1;
    var gridWidth = GRID_COLUMNS * cellSize + (GRID_COLUMNS - 1) * gap;
    var gridHeight = GRID_ROWS * cellSize + (GRID_ROWS - 1) * gap;

    var digitWidth = (this.data.width - DIGIT_GAP * (DIGIT_COUNT - 1)) / DIGIT_COUNT;
    var digitX = -this.data.width / 2 + digitWidth / 2 + digitIndex * (digitWidth + DIGIT_GAP);

    var popup = document.createElement('a-entity');
    popup.classList.add('room-code-popup');
    popup.setAttribute('position', digitX + ' ' + -(0.09 + 0.03 + gridHeight / 2) + ' 0.04');

    var background = document.createElement('a-plane');
    background.setAttribute('width', gridWidth + 0.03);
    background.setAttribute('height', gridHeight + 0.03);
    background.setAttribute('material', 'color: #0b1220; shader: flat');
    background.setAttribute('position', '0 0 -0.01');
    popup.appendChild(background);

    for (var c = 0; c < ROOM_CODE_CHARS.length; c++) {
      var col = c % GRID_COLUMNS;
      var row = Math.floor(c / GRID_COLUMNS);
      var cellX = -gridWidth / 2 + cellSize / 2 + col * (cellSize + gap);
      var cellY = gridHeight / 2 - cellSize / 2 - row * (cellSize + gap);
      var isCurrent = c === this.indices[digitIndex];
      var cell = this.makeTarget(cellSize, cellSize, 'code-pick-' + c, ROOM_CODE_CHARS[c], cellX, cellY, popup);
      cell.setAttribute('material', 'color', isCurrent ? '#2a4a5c' : '#182238');
      this.addText(cell, ROOM_CODE_CHARS[c], 3.2, '#eee');
    }

    this.el.appendChild(popup);
    this.popupEl = popup;
    this.openDigit = digitIndex;

    var self = this;
    setTimeout(function () {
      if (self.popupEl) self.el.emit('menu-targets-changed', null, true);
    }, 0);
  },

  closePopup: function (evt) {
    if (evt && evt.detail && evt.detail.except === this.el) return;
    if (!this.popupEl) return;
    this.popupEl.parentNode.removeChild(this.popupEl);
    this.popupEl = null;
    this.openDigit = -1;
    (this.suppressedTargets || []).forEach(function (target) { target.classList.add('menu-target'); });
    this.suppressedTargets = [];
    this.el.emit('menu-targets-changed', null, true);
  },

  remove: function () {
    this.closePopup();
    this.el.removeEventListener('menu-item-select', this.onSelect);
    this.el.removeEventListener('menu-dismiss-popovers', this.onDismissPopovers);
  },
});
