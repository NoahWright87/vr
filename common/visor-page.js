// ============================================================
// VISOR PAGE — the rows every visor has.
//
// A game registers its visor with registerVisorPage, giving only its own
// rows; this adds what every visor carries after them, in every game, so
// a player who has found them once can find them anywhere:
//
//   Visor ▸      Adjust ▸ (the frame the menu and HUD fit in, with
//                every HUD slot drawn while you are in there), HUD ▸,
//                Targeting ▸ (the aim rings drawn while you are in
//                there), the menu's own look, and Activation ▸ for the
//                temple gesture — all live, with every value in the
//                sidecar while you are in there.
//   Exit VR      in a headset only.
//
// It also owns what those rows do (they are the visor's, not the game's)
// and reads their values back from the visor as it opens, so a page
// never has to repeat the defaults.
// ============================================================

import { registerMenuPage, findMenuItem } from './menu-crossbar.js';
import { STICK_DRIFT, getStickDriftName, setStickDrift } from './stick-drift.js';

var DEG = function (value) { return value + '°'; };
var CM = function (value) { return value + 'cm'; };
var SEC = function (value) { return (Math.round(value * 100) / 100) + 's'; };
var PCT = function (value) { return Math.round(value * 100) + '%'; };
var METRES = function (value) { return value.toFixed(1) + 'm'; };

// Menu units (cm, seconds) to the system's (metres, ms).
var ACTIVATION = {
  'visor-zone-radius': function (v) { return { radius: v / 100 }; },
  'visor-zone-side': function (v) { return { side: v / 100 }; },
  'visor-zone-forward': function (v) { return { forward: v / 100 }; },
  'visor-open-ms': function (v) { return { openMs: v * 1000 }; },
  'visor-close-ms': function (v) { return { closeMs: v * 1000 }; },
};
var LAYOUT = { 'visor-crumbs': 'crumbs' };
// The frame (common/visor-frame.js), held by the HUD system.
var FRAME = {
  'visor-frame-width': 'width', 'visor-frame-height': 'height', 'visor-frame-lift': 'lift',
  'visor-frame-bend': 'bend', 'visor-frame-bend-y': 'bendY', 'visor-frame-distance': 'distance',
};
var RINGS = { 'visor-ring-inner': 0, 'visor-ring-middle': 1, 'visor-ring-outer': 2 };

function sceneEl() { return document.querySelector('a-scene'); }
function visor() { var scene = sceneEl(); return scene && scene.systems['visor-menu']; }
function hud() { var scene = sceneEl(); return scene && scene.systems['visor-hud']; }
function inXR() {
  var scene = sceneEl();
  var mode = scene && scene.systems['control-mode'];
  return Boolean(mode ? mode.isMode('xr') : scene && scene.is('vr-mode'));
}

// The visor's whole setup as text, for its sidecar. Read on every draw,
// so it follows each setting as you change it.
function visorSummary() {
  var system = visor();
  return system ? system.describe() : '';
}

function settingsItem() {
  return {
    kind: 'submenu', id: 'visor-settings', label: 'Visor',
    // Every setting at once in the sidecar while you are in here, so a
    // tuned layout goes out as one screenshot.
    info: visorSummary,
    items: [
      // The one rectangle the menu and the HUD fit in. While you are in
      // here every HUD slot is drawn as a grey box, and the menu's place
      // on both sides, so you can see what you are fitting.
      {
        kind: 'submenu', id: 'visor-adjust', label: 'Adjust', info: visorSummary, frame: true,
        items: [
          { kind: 'number', id: 'visor-frame-width', label: 'Width', value: 72, min: 30, max: 100, step: 2, format: DEG },
          { kind: 'number', id: 'visor-frame-height', label: 'Height', value: 42, min: 20, max: 80, step: 2, format: DEG },
          // Up (+) or down (-) from looking straight ahead.
          { kind: 'number', id: 'visor-frame-lift', label: 'Eye level', value: -2, min: -20, max: 20, step: 1, format: DEG },
          // Flat (0%) to wrapped round your head (100%).
          { kind: 'number', id: 'visor-frame-bend', label: 'Bend', value: 0.8, min: 0, max: 1, step: 0.05, format: PCT },
          { kind: 'number', id: 'visor-frame-bend-y', label: 'Bend vertical', value: 0, min: 0, max: 1, step: 0.05, format: PCT },
          { kind: 'number', id: 'visor-frame-distance', label: 'Distance', value: 1.8, min: 0.8, max: 4, step: 0.1, format: METRES },
          // Every game shares one calibration unless this one has its own.
          {
            kind: 'select', id: 'visor-frame-scope', label: 'Saved for', value: 'shared',
            options: [{ value: 'shared', label: 'All games' }, { value: 'game', label: 'This game' }],
          },
          { kind: 'action', id: 'visor-frame-reset', label: 'Reset' },
        ],
      },
      {
        kind: 'submenu', id: 'visor-hud', label: 'HUD', info: visorSummary,
        items: [
          { kind: 'toggle', id: 'visor-hud-on', label: 'Show HUD', value: true },
          { kind: 'number', id: 'visor-hud-opacity', label: 'Opacity', value: 0.9, min: 0.1, max: 1, step: 0.05, format: PCT },
          // Readouts that have not changed for a few seconds dim, and
          // light up again when they do.
          { kind: 'toggle', id: 'visor-hud-fade', label: 'Dim when idle', value: true },
        ],
      },
      // What you are aiming at. The three rings are drawn while you are in
      // here; the rest of the time the brackets on targets stand for them.
      {
        kind: 'submenu', id: 'visor-targeting', label: 'Targeting', info: visorSummary, rings: true,
        items: [
          {
            kind: 'select', id: 'visor-target-mode', label: 'Brackets', value: 'asked',
            options: [{ value: 'off', label: 'Off' }, { value: 'asked', label: 'When asked' }, { value: 'always', label: 'Always' }],
          },
          // How many other targets get a faint bracket besides the locked one.
          { kind: 'number', id: 'visor-target-others', label: 'Others', value: 5, min: 0, max: 10, step: 1 },
          {
            kind: 'select', id: 'visor-target-shape', label: 'Shape', value: 'square',
            options: [
              { value: 'square', label: '[ ]' }, { value: 'angle', label: '< >' },
              { value: 'triangle', label: 'Triangle' }, { value: 'quad', label: 'Corners' },
            ],
          },
          { kind: 'number', id: 'visor-ring-inner', label: 'Inner ring', value: 3, min: 0.5, max: 30, step: 0.5, format: DEG },
          { kind: 'number', id: 'visor-ring-middle', label: 'Middle ring', value: 7, min: 0.5, max: 30, step: 0.5, format: DEG },
          { kind: 'number', id: 'visor-ring-outer', label: 'Outer ring', value: 14, min: 0.5, max: 30, step: 0.5, format: DEG },
        ],
      },
      // Where a submenu's title goes: under the menu title, or up its
      // inner or outer edge.
      {
        kind: 'select', id: 'visor-crumbs', label: 'Titles', value: 'title',
        options: [{ value: 'title', label: 'Top' }, { value: 'inside', label: 'Inner' }, { value: 'outside', label: 'Outer' }],
      },
      // World: a real object drawn over everything, so both eyes converge
      // where it actually is. Screen: painted onto the display.
      {
        kind: 'select', id: 'visor-draw', label: 'Draw', value: 'world',
        options: [{ value: 'world', label: 'World' }, { value: 'screen', label: 'Screen' }],
      },
      {
        kind: 'select', id: 'visor-scrim', label: 'Scrim', value: 'off',
        options: [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }],
      },
      // How far a thumbstick has to be pushed before it walks you, turns
      // you or moves a menu — for every game, since it is about your
      // controllers (common/stick-drift.js).
      {
        kind: 'select', id: 'visor-stick-drift', label: 'Stick dead zone', value: getStickDriftName(),
        options: Object.keys(STICK_DRIFT).map(function (name) { return { value: name, label: STICK_DRIFT[name].label }; }),
        info: ['STICK DEAD ZONE', 'How far a thumbstick has', 'to be pushed before it', 'walks you or moves a', 'menu. Larger if yours', 'drifts on its own.'],
      },
      // How the temple gesture triggers. While you are in here the two
      // spheres and your hands are drawn as maps beside the menu, since
      // you can never see the real ones.
      {
        kind: 'submenu', id: 'visor-activation', label: 'Activation', info: visorSummary, zones: true,
        items: [
          { kind: 'number', id: 'visor-zone-radius', label: 'Radius', value: 15, min: 4, max: 40, step: 1, format: CM },
          // How far out from the middle of your head.
          { kind: 'number', id: 'visor-zone-side', label: 'Side', value: 22, min: 4, max: 50, step: 1, format: CM },
          // Forward (+) or back (-) from your eyes.
          { kind: 'number', id: 'visor-zone-forward', label: 'Forward', value: -6, min: -30, max: 30, step: 1, format: CM },
          { kind: 'number', id: 'visor-open-ms', label: 'Open', value: 1.2, min: 0.2, max: 3, step: 0.1, format: SEC },
          { kind: 'number', id: 'visor-close-ms', label: 'Close', value: 0.4, min: 0.1, max: 2, step: 0.05, format: SEC },
        ],
      },
    ],
  };
}

// The rows' values, read from the visor itself.
function syncSettings(page) {
  var system = visor();
  if (!system) return;
  var s = system.settings;
  var a = system.activation;
  var set = function (id, value) { var item = findMenuItem(page.items, id); if (item) item.value = value; };
  set('visor-stick-drift', getStickDriftName());
  var display = hud();
  if (display) {
    for (var id in FRAME) set(id, display.frame[FRAME[id]]);
    set('visor-frame-scope', display.scope);
    var p = display.prefs;
    set('visor-hud-on', p.hud);
    set('visor-hud-opacity', p.opacity);
    set('visor-hud-fade', p.idleFade);
    set('visor-target-mode', p.targeting);
    set('visor-target-others', p.others);
    set('visor-target-shape', p.bracket);
    for (var ring in RINGS) set(ring, p.rings[RINGS[ring]]);
  }
  set('visor-crumbs', s.crumbs);
  set('visor-draw', system.drawMode);
  set('visor-scrim', system.scrim > 0 ? 'on' : 'off');
  set('visor-zone-radius', Math.round(a.radius * 100));
  set('visor-zone-side', Math.round(a.side * 100));
  set('visor-zone-forward', Math.round(a.forward * 100));
  set('visor-open-ms', Math.round(a.openMs / 100) / 10);
  set('visor-close-ms', Math.round(a.closeMs / 50) * 0.05);
}

// Every visor page registered, so a change that moves several values at
// once (switching scope, Reset) can show them all.
var pages = [];
function resync() {
  pages.forEach(syncSettings);
  var system = visor();
  if (system && system.component) system.component.render();
}

// A HUD preference from a row: `save: false` while it is being scrolled.
function applyPreference(display, id, value, save) {
  var options = { save: save };
  if (id === 'visor-hud-on') display.setPreferences({ hud: value }, options);
  else if (id === 'visor-hud-opacity') display.setPreferences({ opacity: value }, options);
  else if (id === 'visor-hud-fade') display.setPreferences({ idleFade: value }, options);
  else if (id === 'visor-target-mode') display.setPreferences({ targeting: value }, options);
  else if (id === 'visor-target-others') display.setPreferences({ others: value }, options);
  else if (id === 'visor-target-shape') display.setPreferences({ bracket: value }, options);
  else if (id in RINGS) {
    var rings = display.prefs.rings.slice();
    rings[RINGS[id]] = value;
    display.setPreferences({ rings: rings }, options);
  } else return false;
  return true;
}

var wired = false;
function wireHandlers() {
  if (wired) return;
  wired = true;
  // On the document rather than a scene that may not exist yet: menu
  // events bubble all the way up.
  document.addEventListener('menu-commit', function (evt) {
    var system = visor();
    if (!system) return;
    var id = evt.detail.id;
    var value = evt.detail.value;
    if (id === 'visor-stick-drift') { setStickDrift(value); return; }
    var display = hud();
    if (display) {
      if (FRAME[id]) { var frame = {}; frame[FRAME[id]] = value; display.setFrame(frame); }
      if (id === 'visor-frame-scope') { display.setScope(value); resync(); }
      if (applyPreference(display, id, value, true)) system.refreshInfo();
    }
    if (LAYOUT[id]) {
      var change = {};
      change[LAYOUT[id]] = value;
      system.setLayout(change);
    }
    if (id === 'visor-draw') system.setDraw(value);
    if (id === 'visor-scrim') system.setScrim(value === 'on' ? 0.7 : 0);
    if (ACTIVATION[id]) system.setActivation(ACTIVATION[id](value));
  });
  // Number rows preview while you scroll them, so the visor moves as you
  // change its size or position rather than only when you back out —
  // which is the only way to find the right value by eye.
  document.addEventListener('menu-preview', function (evt) {
    var system = visor();
    if (!system) return;
    if (ACTIVATION[evt.detail.id]) { system.setActivation(ACTIVATION[evt.detail.id](evt.detail.value)); return; }
    var display = hud();
    if (display && FRAME[evt.detail.id]) {
      var frame = {};
      frame[FRAME[evt.detail.id]] = evt.detail.value;
      display.setFrame(frame, { save: false });
      system.refreshInfo();
      return;
    }
    if (display && applyPreference(display, evt.detail.id, evt.detail.value, false)) { system.refreshInfo(); return; }
    var key = LAYOUT[evt.detail.id];
    if (!key) return;
    var change = {};
    change[key] = evt.detail.value;
    system.setLayout(change);
  });
  document.addEventListener('menu-action', function (evt) {
    var scene = sceneEl();
    if (evt.detail.id === 'visor-exit' && scene && scene.is('vr-mode')) scene.exitVR();
    if (evt.detail.id === 'visor-frame-reset' && hud()) { hud().resetFrame(); resync(); }
  });
  // Exit VR comes and goes with the headset, under an open menu too.
  var refresh = function () {
    var system = visor();
    if (system && system.component) system.component.menu.refresh();
  };
  document.addEventListener('enter-vr', refresh);
  document.addEventListener('exit-vr', refresh);
  document.addEventListener('control-mode-changed', refresh);
}

// page: { title?, items: [...] | () => [...], onOpen?, info? }
export function registerVisorPage(name, page) {
  wireHandlers();
  var own = page.items || [];
  var settings = settingsItem();
  // Leaving the headset is not something to do by brushing a button.
  var exit = { kind: 'action', id: 'visor-exit', label: 'Exit VR', hold: 'long' };
  var full = {
    title: page.title || 'VISOR',
    info: page.info,
    items: function () {
      var mine = typeof own === 'function' ? own() : own;
      return mine.concat([settings]).concat(inXR() ? [exit] : []);
    },
    onOpen: function (component) {
      syncSettings(full);
      if (typeof page.onOpen === 'function') page.onOpen.call(full, component);
    },
  };
  pages.push(full);
  return registerMenuPage(name, full);
}
