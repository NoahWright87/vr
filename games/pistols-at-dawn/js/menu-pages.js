// ==============================================================
// MENU PAGES — every menu in Pistols at Dawn, as data.
//
// An ES module, unlike the plain scripts around it: it registers pages
// with the shared crossbar menu (common/menu-crossbar.js), which is a
// module. It reads the plain scripts' globals (TOWN_LOCATIONS,
// LASER_SIGHT, the MOTION_* tunables) through window, and only ever
// when a menu opens — by then every script on the page has loaded.
//
// The rows re-send the values the old hand-built watch sent
// (emitSelect / emitOption, see crossbar-menu's emitCompatible), so
// the handlers that already exist do the work unchanged:
//
//   pistols-watch-menu (world-menu.js)  HUD, performance, pause, target
//                                       settings, laser, motion tunables
//   teleport-hub (world-town.js)        teleport-<id>
//   desktop-controls                    aim-mode
//   carriage-ticket-stall               carriage-<id>
// ==============================================================

import { registerMenuPage, findMenuItem } from '../../../common/menu-crossbar.js';
import { registerVisorPage } from '../../../common/visor-page.js';

function sceneEl() { return document.querySelector('a-scene'); }
function watchMenu() { var scene = sceneEl(); return scene && scene.components['pistols-watch-menu']; }
function options(values, labels) {
  return values.map(function (value, i) { return { value: value, label: labels ? labels[i] : String(value) }; });
}

// ---------- the watch ----------

var targets = {
  kind: 'submenu', id: 'pistols-targets', label: 'Targets',
  items: [
    // The old row read "Pause targets" / "Resume targets"; a toggle says
    // which state you are in instead of which one you would get.
    { kind: 'toggle', id: 'pistols-targets-paused', label: 'Paused', value: false, emitSelect: 'toggle-target-motion' },
    {
      kind: 'select', id: 'pistols-target-kind', label: 'Type', value: 'spinner', emitOption: 'target-kind',
      options: options(['stationary', 'spinner', 'conveyor', 'popper'], ['Stationary', 'Spinner', 'Conveyor', 'Pop-up']),
    },
    { kind: 'select', id: 'pistols-target-count', label: 'Targets', value: 4, emitOption: 'spinner-count', options: options([2, 4, 6, 8, 12, 16, 24]) },
    {
      kind: 'select', id: 'pistols-target-speed', label: 'Speed', value: 45, emitOption: 'spinner-speed',
      options: options([15, 30, 45, 60, 90], ['Very slow', 'Slow', 'Normal', 'Fast', 'Very fast']),
    },
    {
      kind: 'select', id: 'pistols-target-distance', label: 'Distance', value: 5, emitOption: 'spinner-distance',
      options: options([5, 15, 30, 45], ['5m', '15m', '30m', '45m']),
    },
  ],
};

// One row per destination, straight from the town's own list, so a new
// location needs no menu change at all. The id follows teleport-hub's
// "teleport-<id>" convention.
var teleport = {
  kind: 'submenu', id: 'pistols-teleport', label: 'Teleport',
  items: function () {
    return (window.TOWN_LOCATIONS || []).map(function (loc) {
      return { kind: 'action', id: 'teleport-' + loc.id, label: loc.label };
    });
  },
};

var hud = { kind: 'toggle', id: 'pistols-hud', label: 'HUD', value: true, emitSelect: 'toggle-hud' };

var motion = {
  // Live tunables for the scripted gun draw/holster/twirl flourish
  // (core-hand-rig.js's buildFlourishedKeyframe). Precision motions
  // (watch pointing, mounted interactions) never read these.
  kind: 'submenu', id: 'pistols-motion', label: 'Motion',
  items: [
    { kind: 'select', id: 'pistols-motion-arc', label: 'Arc', value: 0.35, emitOption: 'motion-arc', options: options([0, 0.15, 0.35, 0.6, 0.9], ['Off', 'Subtle', 'Normal', 'Wide', 'Wild']) },
    { kind: 'select', id: 'pistols-motion-ease', label: 'Ease', value: 2.4, emitOption: 'motion-ease', options: options([1, 1.5, 2.4, 3.5, 5], ['Linear', 'Soft', 'Normal', 'Snappy', 'Sharp']) },
    { kind: 'select', id: 'pistols-motion-overshoot', label: 'Overshoot', value: 0.045, emitOption: 'motion-overshoot', options: options([0, 0.02, 0.045, 0.09, 0.16], ['Off', 'Subtle', 'Normal', 'Playful', 'Bouncy']) },
    { kind: 'select', id: 'pistols-motion-settle', label: 'Settle', value: 9, emitOption: 'motion-settle', options: options([4, 6, 9, 14], ['Slow', 'Normal', 'Fast', 'Snap']) },
  ],
};

var debug = {
  kind: 'submenu', id: 'pistols-debug', label: 'Debug',
  items: [
    { kind: 'toggle', id: 'pistols-performance', label: 'Performance', value: false, emitSelect: 'toggle-performance' },
    // A translucent line and impact dot out of any held firearm's muzzle,
    // for judging hand wobble without firing (core.js).
    { kind: 'select', id: 'pistols-laser', label: 'Laser', value: 'none', emitOption: 'laser-sight', options: options(['none', 'red', 'green'], ['Off', 'Red', 'Green']) },
    motion,
  ],
};

// Hold vs. toggle to aim down sights (desktop-controls' aimMode
// preference). Toggle is the default: no button has to be held for the
// whole time you are aiming.
var aim = { kind: 'select', id: 'pistols-aim', label: 'Aim', value: 'toggle', emitOption: 'aim-mode', options: options(['toggle', 'hold'], ['Toggle', 'Hold']) };

registerMenuPage('pistols-watch', {
  // The clock: hand-with-watch writes the time into the title.
  title: '',
  items: [targets, teleport, hud, debug, aim],
  // Every value is read fresh as the watch opens: the target settings
  // and toggles belong to pistols-watch-menu, the tunables are globals,
  // and either watch (or the keyboard) may have changed any of them.
  onOpen: function () {
    var page = this;
    var set = function (id, value) {
      var item = findMenuItem(page.items, id);
      if (item && value !== undefined) item.value = value;
    };
    var menu = watchMenu();
    if (menu) {
      set('pistols-targets-paused', Boolean(menu.targetsPaused));
      set('pistols-target-kind', menu.settings.kind);
      set('pistols-target-count', Number(menu.settings.count));
      set('pistols-target-speed', Number(menu.settings.speed));
      set('pistols-target-distance', Number(menu.settings.distance));
      set('pistols-hud', Boolean(menu.hudVisible));
      set('pistols-performance', Boolean(menu.performanceVisible));
    }
    if (window.LASER_SIGHT !== undefined) set('pistols-laser', window.LASER_SIGHT);
    if (window.MOTION_ARC_FRACTION !== undefined) set('pistols-motion-arc', window.MOTION_ARC_FRACTION);
    if (window.MOTION_EASE_POWER !== undefined) set('pistols-motion-ease', window.MOTION_EASE_POWER);
    if (window.MOTION_OVERSHOOT !== undefined) set('pistols-motion-overshoot', window.MOTION_OVERSHOOT);
    if (window.MOTION_SETTLE_RATE !== undefined) set('pistols-motion-settle', window.MOTION_SETTLE_RATE);
    var rig = document.querySelector('#player-rig');
    var desktop = rig && rig.components['desktop-controls'];
    if (desktop && desktop.preferences) set('pistols-aim', desktop.preferences.aimMode);
  },
});

// ---------- the carriage ticket stall ----------

// Only the out-of-town destinations; the town's own buildings are
// walkable. carriage-ticket-stall turns carriage-<id> into a teleport.
registerMenuPage('carriage', {
  title: 'CARRIAGE TICKETS',
  items: [
    { kind: 'action', id: 'carriage-range', label: 'The Range' },
    { kind: 'action', id: 'carriage-farm', label: 'The Farm' },
    { kind: 'action', id: 'carriage-stable', label: 'The Stable' },
    {
      kind: 'info', id: 'carriage-about', label: 'About',
      info: ['CARRIAGE TICKETS', 'Out-of-town trips. The', 'buildings in town are', 'a short walk away.'],
    },
  ],
});

// ---------- the visor ----------

// Only what every visor has, for now: its settings and Exit VR.
registerVisorPage('visor', { title: 'PISTOLS AT DAWN', items: [] });
