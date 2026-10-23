// ============================================================
// THE TOUR — one menu in front of you that shows off the menu system.
//
// Its top level is a list of demos. Pick one and the visor's HUD becomes
// that demo's, a small scene appears behind you (turn round, or set
// Facing to Back), and the menu becomes that demo's list of features —
// each with its own text in the sidecar — plus whatever the demo can do
// from here (Take a hit, Reset the car). "Back to demos" returns.
//
// No walking: everything is within reach of where you stand or sit, and
// the thumbsticks do not move you. Facing turns you round instead.
//
// Every demo is a module (demo-*.js) exporting
//   { id, label, title, blurb, rows(), onAction(id), enter(), exit(),
//     hud(display), tick(time, delta), clearHints?(display) }
// and owning a <a-entity id="set-<id>"> scene in index.html.
// ============================================================

import { registerMenuPage } from '../../common/menu-crossbar.js';
import { registerVisorPage } from '../../common/visor-page.js';
import { tour, hud, sceneEl } from './tour-core.js';
import basics from './demo-basics.js';
import shooter from './demo-shooter.js';
import racing from './demo-racing.js';
import fantasy from './demo-fantasy.js';
import frontier from './demo-frontier.js';

var DEMOS = [basics, shooter, racing, fantasy, frontier];
var TITLE = 'MENUS & HUD';

var facing = 'front';
var menuFont = 'b612';

var FACING_OPTIONS = [{ value: 'front', label: 'Front' }, { value: 'back', label: 'Back' }];
var FONT_OPTIONS = [
  { value: 'b612', label: 'B612' }, { value: 'b612-regular', label: 'B612 Regular' },
  { value: 'roboto', label: 'Roboto' }, { value: 'wright', label: 'Wright Sans' },
];

function facingRow() {
  return {
    kind: 'select', id: 'tour-facing', label: 'Facing', value: facing, options: FACING_OPTIONS,
    info: ['FACING', 'Turns you round, so you', 'need not: the demo\'s', 'scene is behind you, the', 'menu in front.'],
  };
}

// ---------- the tour menu ----------

registerMenuPage('tour', {
  title: TITLE,
  items: function () {
    var demo = tour.active;
    if (demo) {
      return demo.rows().concat([
        facingRow(),
        { kind: 'action', id: 'tour-back', label: 'Back to demos' },
      ]);
    }
    return DEMOS.map(function (d) {
      return { kind: 'action', id: 'tour-demo-' + d.id, label: d.label, info: d.blurb };
    }).concat([
      facingRow(),
      {
        kind: 'info', id: 'tour-about', label: 'About this tour',
        info: ['MENUS & HUD', 'Pick a demo: the HUD on', 'your visor changes, and', 'a scene appears behind', 'you with things to try.', 'Nothing needs walking', 'to.'],
      },
    ]);
  },
});

function panel() {
  var el = document.querySelector('#tour-panel');
  return el && el.components['crossbar-menu'];
}

// Every menu in the tour, for the menu-font row.
function allMenus() {
  var list = Array.prototype.map.call(document.querySelectorAll('[crossbar-menu]'), function (el) {
    return el.components['crossbar-menu'];
  }).filter(Boolean);
  var visor = sceneEl().systems['visor-menu'];
  if (visor && visor.component && list.indexOf(visor.component) === -1) list.push(visor.component);
  return list;
}

function applyMenuFont() {
  allMenus().forEach(function (menu) {
    // The watch keeps its monospace clock as its title.
    var title = menu.data.titleFont === 'sourcecodepro' ? 'sourcecodepro' : 'wright';
    menu.setFont(menuFont, title);
  });
}

function showMenu(title) {
  var menu = panel();
  if (!menu) return;
  menu.setTitle(title);
  menu.menu.reset();
  menu.menu.open();
  menu.render();
}

function setActive(demo) {
  var display = hud();
  var current = tour.active;
  if (current) {
    current.exit();
    if (current.clearHints) current.clearHints(display);
    document.querySelector('#set-' + current.id).object3D.visible = false;
  }
  display.clear();
  tour.active = demo || null;
  if (demo) {
    document.querySelector('#set-' + demo.id).object3D.visible = true;
    demo.enter();
    demo.hud(display);
  }
  showMenu(demo ? demo.title : TITLE);
  // The panel on the far side when you turn round.
  sceneEl().setAttribute('data-tour-demo', demo ? demo.id : '');
}

function setFacing(value) {
  facing = value === 'back' ? 'back' : 'front';
  document.querySelector('#rig').object3D.rotation.y = facing === 'back' ? Math.PI : 0;
}

function onAction(evt) {
  var id = evt.detail.id;
  if (id.indexOf('tour-demo-') === 0) {
    var demo = DEMOS.filter(function (d) { return 'tour-demo-' + d.id === id; })[0];
    if (demo) setActive(demo);
  } else if (id === 'tour-back') {
    setActive(null);
  } else if (tour.active && tour.active.onAction) {
    tour.active.onAction(id);
  }
}

function onCommit(evt) {
  var id = evt.detail.id;
  if (id === 'tour-facing') setFacing(evt.detail.value);
  else if (id === 'tour-menu-font') { menuFont = evt.detail.value; applyMenuFont(); }
}

// ---------- the visor and the watch: real settings only ----------

var visorFacing = { kind: 'select', id: 'tour-facing', label: 'Facing', value: facing, options: FACING_OPTIONS };
var visorFont = {
  kind: 'select', id: 'tour-menu-font', label: 'Menu font', value: menuFont, options: FONT_OPTIONS,
  info: ['MENU FONT', 'Rows in B612, made for', 'cockpit displays; titles', 'in Wright Sans. Try the', 'others here.'],
};
registerVisorPage('visor', {
  title: 'VISOR',
  items: [visorFacing, visorFont],
  onOpen: function () { visorFacing.value = facing; visorFont.value = menuFont; },
});

var watchHand = {
  kind: 'select', id: 'watch-handedness', label: 'Hand', value: 'right',
  options: [{ value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }],
};
var watchHints = {
  kind: 'select', id: 'watch-hints', label: 'Hints', value: 'delayed',
  options: [{ value: 'always', label: 'Always' }, { value: 'delayed', label: 'Delayed' }, { value: 'never', label: 'Never' }],
};
registerMenuPage('watch', {
  // The clock: hand-with-watch writes the time into the title.
  title: '',
  items: [
    watchHand,
    watchHints,
    { kind: 'toggle', id: 'watch-automatic', label: 'Auto-open', value: true },
    {
      kind: 'info', id: 'watch-about', label: 'About',
      info: ['THE WATCH', 'Settings you reach for', 'mid-play, on your wrist.', 'Raise it to open; the', 'other hand drives it.'],
    },
  ],
  onOpen: function () {
    var desktop = document.querySelector('#rig').components['desktop-controls'];
    if (desktop && desktop.preferences) {
      watchHand.value = desktop.preferences.handedness;
      watchHints.value = desktop.preferences.hintMode;
    }
  },
});

function onWatchRow(evt) {
  var desktop = document.querySelector('#rig').components['desktop-controls'];
  if (!desktop) return;
  if (evt.detail.id === 'watch-handedness') desktop.setPreference('handedness', evt.detail.value);
  if (evt.detail.id === 'watch-hints') desktop.setPreference('hintMode', evt.detail.value);
}

// ---------- the scene component ----------

AFRAME.registerComponent('menu-tour', {
  init: function () {
    var scene = this.el;
    scene.addEventListener('menu-action', onAction);
    scene.addEventListener('menu-commit', onCommit);
    scene.addEventListener('menu-commit', onWatchRow);
    // Fonts once every menu exists; the visor and watch build theirs late.
    var fontsLater = function () { applyMenuFont(); };
    var start = function () {
      var rig = document.querySelector('#rig');
      // No walking and no turning: the tour is all within reach.
      var locomotion = rig.components['locomotion-demo'];
      if (locomotion) { locomotion.setMoveMode('disabled'); locomotion.setTurnMode('disabled'); }
      DEMOS.forEach(function (d) { document.querySelector('#set-' + d.id).object3D.visible = false; });
      setActive(null);
      setTimeout(fontsLater, 500);
      setTimeout(fontsLater, 2500);
    };
    if (scene.hasLoaded) start();
    else scene.addEventListener('loaded', start);
    scene.addEventListener('visor-menu-opened', fontsLater);
  },

  tick: function (time, delta) {
    if (tour.active) tour.active.tick(time, delta);
  },
});

window.__tour = { tour: tour, setActive: setActive, demos: DEMOS, setFacing: setFacing };
