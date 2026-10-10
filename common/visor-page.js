// ============================================================
// VISOR PAGE — the rows every visor has.
//
// A game registers its visor with registerVisorPage, giving only its own
// rows; this adds what every visor carries after them, in every game, so
// a player who has found them once can find them anywhere:
//
//   Settings ▸   the visor's own layout and look, and Activation ▸ for
//                the temple gesture — all live, with every value in the
//                sidecar while you are in there.
//   Exit VR      in a headset only.
//
// It also owns what those rows do (they are the visor's, not the game's)
// and reads their values back from the visor as it opens, so a page
// never has to repeat the defaults.
// ============================================================

import { registerMenuPage, findMenuItem } from './menu-crossbar.js';

var DEG = function (value) { return value + '°'; };
var CM = function (value) { return value + 'cm'; };
var SEC = function (value) { return (Math.round(value * 100) / 100) + 's'; };

// Menu units (cm, seconds) to the system's (metres, ms).
var ACTIVATION = {
  'visor-zone-radius': function (v) { return { radius: v / 100 }; },
  'visor-zone-side': function (v) { return { side: v / 100 }; },
  'visor-zone-forward': function (v) { return { forward: v / 100 }; },
  'visor-open-ms': function (v) { return { openMs: v * 1000 }; },
  'visor-close-ms': function (v) { return { closeMs: v * 1000 }; },
};
var LAYOUT = {
  'visor-position': 'position', 'visor-lift': 'lift', 'visor-width': 'width',
  'visor-height': 'height', 'visor-curve': 'curve', 'visor-crumbs': 'crumbs',
};

function sceneEl() { return document.querySelector('a-scene'); }
function visor() { var scene = sceneEl(); return scene && scene.systems['visor-menu']; }
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
      // Where the selected row sits, in degrees from straight ahead.
      { kind: 'number', id: 'visor-position', label: 'Position', value: 8, min: 0, max: 30, step: 1, format: DEG },
      // Up (+) or down (-) from eye level.
      { kind: 'number', id: 'visor-lift', label: 'Lift', value: -2, min: -20, max: 20, step: 1, format: DEG },
      // How wide, which is also how big the text is.
      { kind: 'number', id: 'visor-width', label: 'Width', value: 30, min: 16, max: 50, step: 1, format: DEG },
      // Top row to bottom row.
      { kind: 'number', id: 'visor-height', label: 'Height', value: 34, min: 20, max: 90, step: 2, format: DEG },
      // How much further in the selected row reaches.
      { kind: 'number', id: 'visor-curve', label: 'Curve', value: 10, min: 0, max: 25, step: 0.5, format: DEG },
      // Where a submenu's title goes: under the menu title, or up its
      // inner or outer edge.
      {
        kind: 'select', id: 'visor-crumbs', label: 'Titles', value: 'title',
        options: [{ value: 'title', label: 'Top' }, { value: 'inside', label: 'Inner' }, { value: 'outside', label: 'Outer' }],
      },
      {
        kind: 'select', id: 'visor-eyes', label: 'Eyes', value: 'both',
        options: [{ value: 'both', label: 'Both' }, { value: 'inboard', label: 'One' }],
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
  set('visor-position', s.position);
  set('visor-lift', s.lift);
  set('visor-width', s.width);
  set('visor-height', s.height);
  set('visor-curve', s.curve);
  set('visor-crumbs', s.crumbs);
  set('visor-eyes', system.eyesMode);
  set('visor-draw', system.drawMode);
  set('visor-scrim', system.scrim > 0 ? 'on' : 'off');
  set('visor-zone-radius', Math.round(a.radius * 100));
  set('visor-zone-side', Math.round(a.side * 100));
  set('visor-zone-forward', Math.round(a.forward * 100));
  set('visor-open-ms', Math.round(a.openMs / 100) / 10);
  set('visor-close-ms', Math.round(a.closeMs / 50) * 0.05);
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
    if (LAYOUT[id]) {
      var change = {};
      change[LAYOUT[id]] = value;
      system.setLayout(change);
    }
    if (id === 'visor-draw') system.setDraw(value);
    if (id === 'visor-eyes') system.setEyes(value);
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
    var key = LAYOUT[evt.detail.id];
    if (!key) return;
    var change = {};
    change[key] = evt.detail.value;
    system.setLayout(change);
  });
  document.addEventListener('menu-action', function (evt) {
    var scene = sceneEl();
    if (evt.detail.id === 'visor-exit' && scene && scene.is('vr-mode')) scene.exitVR();
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
  var exit = { kind: 'action', id: 'visor-exit', label: 'Exit VR' };
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
  return registerMenuPage(name, full);
}
