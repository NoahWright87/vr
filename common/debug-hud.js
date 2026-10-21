// ============================================================
// DEBUG HUD — live readouts, head-locked, and an action event log.
//
// Systems register readouts (a label and a function returning text);
// whichever are switched on are shown together, low in view, refreshed
// ~10 times a second. The point is a screenshot that answers "what was
// it thinking", taken without leaving the headset.
//
//   import { registerReadout, logAction } from '../common/debug-hud.js';
//   registerReadout('gun', 'Gun', function () { return 'target: ' + ...; });
//   logAction('hit silhouette-3 head (score 0.82)');
//
// The scene gets a `debug-hud` system; it finds the active camera and
// hangs one text entity off it. Readout toggles persist per page.
// ============================================================

var readouts = {}; // id -> { id, label, fn }
var readoutOrder = [];
var LOG_SIZE = 12;
var log = [];
var listeners = [];
var STORAGE_KEY = 'debug-hud:readouts';
var enabled = loadEnabled();

function loadEnabled() {
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch (e) { return {}; }
}

function saveEnabled() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(enabled)); } catch (e) { /* not persisted */ }
}

export function registerReadout(id, label, fn) {
  if (!readouts[id]) readoutOrder.push(id);
  readouts[id] = { id: id, label: label, fn: fn };
}

export function listReadouts() { return readoutOrder.map(function (id) { return readouts[id]; }); }
export function isReadoutOn(id) { return Boolean(enabled[id]); }

export function setReadout(id, on) {
  enabled[id] = Boolean(on);
  saveEnabled();
}

// The last few things the action systems did, newest last. Timestamped
// in seconds since the page loaded so a screenshot shows the order.
export function logAction(text) {
  var t = typeof performance !== 'undefined' ? performance.now() / 1000 : 0;
  log.push(t.toFixed(1) + ' ' + text);
  if (log.length > LOG_SIZE) log.shift();
  listeners.forEach(function (fn) { fn(text); });
}

export function actionLog() { return log.slice(); }
export function onAction(fn) { listeners.push(fn); }

registerReadout('log', 'Log', function () { return log.length ? log.join('\n') : '(nothing yet)'; });

// All enabled readouts as one block of text.
export function hudText() {
  var parts = [];
  readoutOrder.forEach(function (id) {
    if (!enabled[id]) return;
    var text = '';
    try { text = readouts[id].fn() || ''; } catch (e) { text = '(error: ' + e.message + ')'; }
    parts.push('- ' + readouts[id].label.toUpperCase() + ' -\n' + text);
  });
  return parts.join('\n');
}

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['debug-hud']) {
  AFRAME.registerSystem('debug-hud', {
    init: function () {
      this.textEl = null;
      this.since = Infinity;
      this.last = null;
    },

    ensureText: function () {
      if (this.textEl && this.textEl.parentNode) return this.textEl;
      var camera = this.el.camera && this.el.camera.el;
      if (!camera) return null;
      var text = document.createElement('a-text');
      text.setAttribute('class', 'debug-hud-text');
      text.setAttribute('align', 'left');
      text.setAttribute('anchor', 'left');
      text.setAttribute('baseline', 'top');
      text.setAttribute('color', '#ffd27a');
      text.setAttribute('width', 0.9);
      text.setAttribute('wrap-count', 56);
      // Low and a little left of centre: readable with a glance down,
      // out of the way of what you're hitting.
      text.setAttribute('position', '-0.38 -0.12 -1');
      camera.appendChild(text);
      this.textEl = text;
      return text;
    },

    tick: function (time, dt) {
      this.since += dt || 0;
      if (this.since < 100) return;
      this.since = 0;
      var text = hudText();
      if (text === this.last) return;
      this.last = text;
      var el = this.ensureText();
      if (!el) return;
      el.object3D.visible = Boolean(text);
      if (text) el.setAttribute('value', text);
    },
  });
}
