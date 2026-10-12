// ============================================================
// MOTION LAB — the Action Lab's first station.
//
// Shows what common/motion-sense.js reads from your body, live, and
// makes every one of its numbers a visor row. It's for tuning by feel:
// stand still and watch energy stay down, throw a jab and watch it
// jump, reach for the visor and check it doesn't.
// ============================================================

import { describeMotion, DEFAULT_MOTION_SETTINGS } from '../../common/motion-sense.js';
import { registerVisorPage } from '../../common/visor-page.js';

var THREE = AFRAME.THREE;
var STORAGE_KEY = 'action-lab:motion-settings';

// ---------- the panel ----------

var PANEL_W = 1.3;
var BAR_W = 0.8;
var BAR_H = 0.05;
var REST_COLOR = '#8aa0c8';
var PRESENTED_COLOR = '#5fe08a';

function makeBar(parent, y, label, color) {
  var row = document.createElement('a-entity');
  row.setAttribute('position', '0 ' + y + ' 0.01');
  var text = document.createElement('a-text');
  text.setAttribute('value', label);
  text.setAttribute('align', 'right');
  text.setAttribute('color', '#cfe0ff');
  text.setAttribute('width', 0.9);
  text.setAttribute('position', (-BAR_W / 2 - 0.03) + ' 0 0');
  var track = document.createElement('a-plane');
  track.setAttribute('width', BAR_W);
  track.setAttribute('height', BAR_H);
  track.setAttribute('color', '#1b2233');
  track.setAttribute('shader', 'flat');
  var fill = document.createElement('a-plane');
  fill.setAttribute('width', BAR_W);
  fill.setAttribute('height', BAR_H);
  fill.setAttribute('color', color);
  fill.setAttribute('shader', 'flat');
  fill.setAttribute('position', '0 0 0.002');
  row.appendChild(text);
  row.appendChild(track);
  row.appendChild(fill);
  parent.appendChild(row);
  return { fill: fill, row: row };
}

// A thin vertical line on a bar, for a threshold.
function makeTick(bar, color) {
  var tick = document.createElement('a-plane');
  tick.setAttribute('width', 0.006);
  tick.setAttribute('height', BAR_H * 1.6);
  tick.setAttribute('color', color);
  tick.setAttribute('shader', 'flat');
  tick.setAttribute('position', '0 0 0.004');
  bar.row.appendChild(tick);
  return tick;
}

function setBar(bar, value) {
  var v = Math.max(0, Math.min(1, value));
  var o = bar.fill.object3D;
  o.scale.x = Math.max(v, 0.0001);
  o.position.x = -BAR_W / 2 + (BAR_W * v) / 2;
}

function setTick(tick, value) {
  tick.object3D.position.x = -BAR_W / 2 + BAR_W * Math.max(0, Math.min(1, value));
}

AFRAME.registerComponent('motion-lab', {
  schema: {
    rig: { type: 'selector' },
    textHz: { default: 10 },
  },

  init: function () {
    var el = this.el;
    var plate = document.createElement('a-plane');
    plate.setAttribute('width', PANEL_W);
    plate.setAttribute('height', 0.95);
    plate.setAttribute('color', '#0b1020');
    plate.setAttribute('opacity', 0.85);
    plate.setAttribute('shader', 'flat');
    plate.setAttribute('position', '0.1 -0.2 0');
    el.appendChild(plate);

    // Speed bars run to 2x "full" so a hard punch still shows headroom;
    // extension bars to 120% so full reach isn't pinned at the end.
    this.bars = {
      energy: makeBar(el, 0.18, 'Energy', '#ffb547'),
      leftSpeed: makeBar(el, 0.08, 'L speed', '#7fb2ff'),
      rightSpeed: makeBar(el, 0.0, 'R speed', '#7fb2ff'),
      leftForward: makeBar(el, -0.1, 'L reach', '#b58cff'),
      rightForward: makeBar(el, -0.18, 'R reach', '#b58cff'),
    };
    this.ticks = {
      leftOn: makeTick(this.bars.leftForward, PRESENTED_COLOR),
      rightOn: makeTick(this.bars.rightForward, PRESENTED_COLOR),
      leftFull: makeTick(this.bars.leftSpeed, '#ffffff'),
      rightFull: makeTick(this.bars.rightSpeed, '#ffffff'),
    };

    this.text = document.createElement('a-text');
    this.text.setAttribute('align', 'left');
    this.text.setAttribute('color', '#ffd27a');
    this.text.setAttribute('width', 1.1);
    this.text.setAttribute('wrap-count', 60);
    this.text.setAttribute('anchor', 'left');
    this.text.setAttribute('baseline', 'top');
    this.text.setAttribute('position', '-0.5 -0.27 0.01');
    el.appendChild(this.text);

    this.hud = document.querySelector('#motion-hud');
    this.markers = {
      left: document.querySelector('#left-hand .hand-marker'),
      right: document.querySelector('#right-hand .hand-marker'),
    };
    this.presented = { left: null, right: null };
    this.sinceText = Infinity;
  },

  sense: function () {
    var rig = this.data.rig;
    return rig && rig.components['motion-sense'];
  },

  tick: function (time, dt) {
    var sense = this.sense();
    if (!sense) return;
    var state = sense.state;
    var s = state.settings;
    var speedScale = 2 * s.handFull;

    setBar(this.bars.energy, state.energy);
    setBar(this.bars.leftSpeed, state.left.relativeSpeed / speedScale);
    setBar(this.bars.rightSpeed, state.right.relativeSpeed / speedScale);
    setBar(this.bars.leftForward, state.left.extension.forward / 1.2);
    setBar(this.bars.rightForward, state.right.extension.forward / 1.2);
    setTick(this.ticks.leftOn, s.presentOn / 1.2);
    setTick(this.ticks.rightOn, s.presentOn / 1.2);
    setTick(this.ticks.leftFull, s.handFull / speedScale);
    setTick(this.ticks.rightFull, s.handFull / speedScale);

    ['left', 'right'].forEach(function (side) {
      var presented = state[side].presented;
      var marker = this.markers[side];
      if (marker && presented !== this.presented[side]) {
        marker.setAttribute('color', presented ? PRESENTED_COLOR : REST_COLOR);
      }
      this.presented[side] = presented;
    }, this);

    // Text is an SDF mesh rebuild, so not every frame.
    this.sinceText += dt || 0;
    if (this.sinceText < 1000 / this.data.textHz) return;
    this.sinceText = 0;
    var text = describeMotion(state);
    this.text.setAttribute('value', text);
    if (this.hud && this.hud.getAttribute('visible')) this.hud.setAttribute('value', text);
  },
});

// ---------- the visor page: every motion-sense number, live ----------

function senseComponent() {
  var rig = document.querySelector('#rig');
  return rig && rig.components['motion-sense'];
}

function currentSettings() {
  var sense = senseComponent();
  return sense ? sense.state.settings : DEFAULT_MOTION_SETTINGS;
}

// Visor rows fit 14 characters, so rows carry bare numbers and short
// labels; the sidecar summary spells out the units.
var MS = function (v) { return v + 'ms'; };
var MPS = function (v) { return String(Math.round(v * 100) / 100); };
var CM = function (v) { return v + 'cm'; };
var PCT = function (v) { return v + '%'; };

// Rows in menu units, with the conversion to and from the settings'.
var ROWS = [
  { id: 'hand-deadzone', key: 'handDeadzone', label: 'Hand min', unit: 'm/s', min: 0, max: 2, step: 0.05, format: MPS },
  { id: 'hand-full', key: 'handFull', label: 'Hand max', unit: 'm/s', min: 0.5, max: 8, step: 0.25, format: MPS },
  { id: 'head-deadzone', key: 'headDeadzone', label: 'Head min', unit: 'm/s', min: 0, max: 1, step: 0.05, format: MPS },
  { id: 'head-full', key: 'headFull', label: 'Head max', unit: 'm/s', min: 0.3, max: 4, step: 0.1, format: MPS },
  { id: 'energy-rise', key: 'energyRiseMs', label: 'Rise', min: 10, max: 400, step: 10, format: MS },
  { id: 'energy-fall', key: 'energyFallMs', label: 'Fall', min: 100, max: 3000, step: 50, format: MS },
  { id: 'present-on', key: 'presentOn', label: 'Present', min: 20, max: 100, step: 5, format: PCT, scale: 100 },
  { id: 'present-off', key: 'presentOff', label: 'Lower', min: 10, max: 100, step: 5, format: PCT, scale: 100 },
  { id: 'reach-forward', key: 'reachForward', label: 'Reach', min: 30, max: 100, step: 1, format: CM, scale: 100 },
  { id: 'torso-drop', key: 'torsoDrop', label: 'Torso', min: 10, max: 60, step: 1, format: CM, scale: 100 },
];
var ROW_BY_ID = {};
ROWS.forEach(function (row) { ROW_BY_ID['motion-' + row.id] = row; });

function toMenu(row, value) { return Math.round(value * (row.scale || 1) * 1000) / 1000; }
function fromMenu(row, value) { return value / (row.scale || 1); }

function settingsSummary() {
  var s = currentSettings();
  return ROWS.map(function (row) { return row.label + ' ' + row.format(toMenu(row, s[row.key])) + (row.unit ? ' ' + row.unit : ''); }).join('\n');
}

function save() {
  try {
    var s = currentSettings();
    var out = {};
    ROWS.forEach(function (row) { out[row.key] = s[row.key]; });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
  } catch (e) { /* private window or blocked storage: settings just don't persist */ }
}

function load() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function applyRow(id, value, persist) {
  var row = ROW_BY_ID[id];
  var sense = senseComponent();
  if (!row || !sense) return;
  var change = {};
  change[row.key] = fromMenu(row, value);
  sense.setSettings(change);
  if (persist) save();
}

function motionItems() {
  var s = currentSettings();
  return ROWS.map(function (row) {
    return {
      kind: 'number', id: 'motion-' + row.id, label: row.label,
      value: toMenu(row, s[row.key]), min: row.min, max: row.max, step: row.step, format: row.format,
    };
  }).concat([{ kind: 'action', id: 'motion-reset', label: 'Defaults' }]);
}

registerVisorPage('visor', {
  title: 'ACTION LAB',
  items: function () {
    var hud = document.querySelector('#motion-hud');
    return [
      { kind: 'toggle', id: 'lab-hud', label: 'HUD', value: Boolean(hud && hud.getAttribute('visible')) },
      {
        kind: 'submenu', id: 'lab-motion', label: 'Motion',
        // The sidecar re-reads this as the menu redraws (scrolling a row),
        // not every frame — the live view is the lab panel and the HUD.
        info: function () { return describeMotion(senseComponent().state) + '\n\n' + settingsSummary(); },
        items: motionItems,
      },
    ];
  },
});

document.addEventListener('menu-preview', function (evt) { applyRow(evt.detail.id, evt.detail.value, false); });
document.addEventListener('menu-commit', function (evt) {
  if (evt.detail.id === 'lab-hud') {
    var hud = document.querySelector('#motion-hud');
    if (hud) hud.setAttribute('visible', Boolean(evt.detail.value));
    return;
  }
  applyRow(evt.detail.id, evt.detail.value, true);
});
document.addEventListener('menu-action', function (evt) {
  if (evt.detail.id !== 'motion-reset') return;
  var sense = senseComponent();
  if (!sense) return;
  sense.setSettings(DEFAULT_MOTION_SETTINGS);
  save();
});

// Saved settings, once the rig's motion-sense exists.
var scene = document.querySelector('a-scene');
function restore() {
  var saved = load();
  var sense = senseComponent();
  if (saved && sense) sense.setSettings(saved);
}
if (scene.hasLoaded) restore(); else scene.addEventListener('loaded', restore);
