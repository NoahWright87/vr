// ==============================================================
// MENU PAGES — every menu in Pistols at Dawn, as data.
//
// An ES module, unlike the plain scripts around it: it registers pages
// with the shared crossbar menu (common/menu-crossbar.js), which is a
// module. It reads the plain scripts' globals (TOWN_LOCATIONS,
// LASER_SIGHT, the MOTION_* tunables) through window, and only ever
// when a menu opens — by then every script on the page has loaded.
//
// What the rows do lives with what they change, keyed on row ids:
//
//   pistols-watch-menu (world-menu.js)  menu-commit: HUD, performance,
//                                       pause, target settings, laser,
//                                       motion tunables
//   teleport-hub (world-town.js)        menu-action: teleport-<id>
//   carriage-ticket-stall               menu-action: carriage-<id>
//   below                               menu-commit: pistols-aim, the
//                                       desktop-controls preference
//   profile (this file, over PROFILE)   menu-commit: pistols-name-*;
//                                       menu-action: pistols-backup-*
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
    // A toggle says which state you are in, not which one you would get.
    { kind: 'toggle', id: 'pistols-targets-paused', label: 'Paused', value: false },
    {
      kind: 'select', id: 'pistols-target-kind', label: 'Type', value: 'spinner',
      options: options(['stationary', 'spinner', 'conveyor', 'popper'], ['Stationary', 'Spinner', 'Conveyor', 'Pop-up']),
    },
    { kind: 'select', id: 'pistols-target-count', label: 'Targets', value: 4, options: options([2, 4, 6, 8, 12, 16, 24]) },
    {
      kind: 'select', id: 'pistols-target-speed', label: 'Speed', value: 45,
      options: options([15, 30, 45, 60, 90], ['Very slow', 'Slow', 'Normal', 'Fast', 'Very fast']),
    },
    {
      kind: 'select', id: 'pistols-target-distance', label: 'Distance', value: 5,
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

var hud = { kind: 'toggle', id: 'pistols-hud', label: 'HUD', value: true };

// Shared by the wrist watch and visor. Environment state belongs to the
// persistent scene, never to a destination or a particular menu instance.
var environment = {
  kind: 'submenu', id: 'pistols-environment', label: 'Environment',
  items: [
    { kind: 'select', id: 'pistols-shadow-mode', label: 'Shadows', value: 'environment', options: options(['off', 'environment', 'all'], ['None', 'Environment', 'All']) },
    { kind: 'toggle', id: 'pistols-sun-shadows', label: 'Sun shadows', value: true },
    { kind: 'toggle', id: 'pistols-moon-shadows', label: 'Moon shadows', value: false },
    { kind: 'select', id: 'pistols-cloud-quality', label: 'Clouds', value: 'sprites', options: options(['off', 'sprites', '3d'], ['Off', 'Sprites', '3D']) },
    { kind: 'action', id: 'pistols-wait-hour', label: 'Wait one hour' },
  ],
};

function syncEnvironment() {
  var scene = sceneEl();
  if (!scene) return;
  var cycle = scene.components['day-night-cycle'];
  var weather = scene.components['weather-clouds'];
  var set = function (id, value) { findMenuItem(environment.items, id).value = value; };
  if (cycle) {
    set('pistols-shadow-mode', cycle.shadowMode);
    set('pistols-sun-shadows', cycle.sunShadows);
    set('pistols-moon-shadows', cycle.moonShadows);
  }
  if (weather) set('pistols-cloud-quality', weather.quality);
}

var motion = {
  // Live tunables for the scripted gun draw/holster/twirl flourish
  // (core-hand-rig.js's buildFlourishedKeyframe). Precision motions
  // (watch pointing, mounted interactions) never read these.
  kind: 'submenu', id: 'pistols-motion', label: 'Motion',
  items: [
    { kind: 'select', id: 'pistols-motion-arc', label: 'Arc', value: 0.35, options: options([0, 0.15, 0.35, 0.6, 0.9], ['Off', 'Subtle', 'Normal', 'Wide', 'Wild']) },
    { kind: 'select', id: 'pistols-motion-ease', label: 'Ease', value: 2.4, options: options([1, 1.5, 2.4, 3.5, 5], ['Linear', 'Soft', 'Normal', 'Snappy', 'Sharp']) },
    { kind: 'select', id: 'pistols-motion-overshoot', label: 'Overshoot', value: 0.045, options: options([0, 0.02, 0.045, 0.09, 0.16], ['Off', 'Subtle', 'Normal', 'Playful', 'Bouncy']) },
    { kind: 'select', id: 'pistols-motion-settle', label: 'Settle', value: 9, options: options([4, 6, 9, 14], ['Slow', 'Normal', 'Fast', 'Snap']) },
  ],
};

var debug = {
  kind: 'submenu', id: 'pistols-debug', label: 'Debug',
  items: [
    { kind: 'toggle', id: 'pistols-performance', label: 'Performance', value: false },
    // A translucent line and impact dot out of any held firearm's muzzle,
    // for judging hand wobble without firing (core.js).
    { kind: 'select', id: 'pistols-laser', label: 'Laser', value: 'none', options: options(['none', 'red', 'green'], ['Off', 'Red', 'Green']) },
    motion,
  ],
};

// Hold vs. toggle to aim down sights (desktop-controls' aimMode
// preference). Toggle is the default: no button has to be held for the
// whole time you are aiming.
var aim = { kind: 'select', id: 'pistols-aim', label: 'Aim', value: 'toggle', options: options(['toggle', 'hold'], ['Toggle', 'Hold']) };

// ---------- the player profile ----------

// Name entry. There is no multi-slot letter control yet (TODO.md), so a
// name is NAME_MAX single-letter selects: crude, but it works on every
// input family and nothing waits on the nicer control. A "Quick pick"
// row skips the typing. Saving, money and the backup code live in
// profile.js / profile-core.js; this is only the menu over them.
var NAME_SLOTS = 10;
var NAME_ALPHABET = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-\''.split('');
var NAME_PRESETS = ['DUSTY', 'LUCKY', 'SUNDOWN', 'BISCUIT', 'MAVERICK', 'CALAMITY', 'TUMBLEWEED', 'WIDOWMAKER'];

function profileApi() { return window.PROFILE; }

var nameSlots = [];
for (var slotIndex = 0; slotIndex < NAME_SLOTS; slotIndex++) {
  nameSlots.push({
    kind: 'select', id: 'pistols-name-' + slotIndex, label: 'Letter ' + (slotIndex + 1), value: ' ',
    options: options(NAME_ALPHABET, NAME_ALPHABET.map(function (ch) { return ch === ' ' ? '(blank)' : ch; })),
  });
}
var namePreset = {
  kind: 'select', id: 'pistols-name-preset', label: 'Quick pick', value: '',
  options: options([''].concat(NAME_PRESETS), ['Choose one'].concat(NAME_PRESETS)),
};
var nameMenu = {
  kind: 'submenu', id: 'pistols-name', label: 'Name',
  items: [namePreset].concat(nameSlots, [{ kind: 'action', id: 'pistols-name-clear', label: 'Clear name' }]),
};
var moneyRow = { kind: 'info', id: 'pistols-profile-money', label: 'Money', info: ['MONEY', 'What you have to', 'spend at the shops.'] };
var savingRow = { kind: 'info', id: 'pistols-profile-saving', label: 'Saving', info: ['SAVING', 'Your name and money', 'are kept on this device.'] };
var backupMenu = {
  kind: 'submenu', id: 'pistols-backup', label: 'Backup',
  items: [
    { kind: 'action', id: 'pistols-backup-export', label: 'Show backup code' },
    { kind: 'action', id: 'pistols-backup-import', label: 'Restore backup' },
    {
      kind: 'info', id: 'pistols-backup-about', label: 'About',
      info: ['BACKUP', 'A text code for your', 'profile. Browser data', 'can be cleared, so', 'keep one somewhere.'],
    },
  ],
};
var profile = {
  kind: 'submenu', id: 'pistols-profile', label: 'Profile',
  items: [nameMenu, moneyRow, savingRow, backupMenu],
};

function syncProfile() {
  var api = profileApi();
  if (!api) return;
  var name = api.name || '';
  nameMenu.label = 'Name: ' + (name || '(none)');
  var chars = (name + '          ').slice(0, NAME_SLOTS).split('');
  nameSlots.forEach(function (slot, i) { slot.value = chars[i]; });
  namePreset.value = '';
  moneyRow.label = 'Money: $' + api.money;
  savingRow.label = 'Saving: ' + (api.persistent ? 'On' : 'Off');
  savingRow.info = api.persistent
    ? ['SAVING', 'Your name and money', 'are kept on this device.']
    : ['SAVING', 'Off: this browser is', 'blocking storage. Make a', 'backup to keep progress.'];
}

document.addEventListener('menu-commit', function (evt) {
  var api = profileApi();
  var id = evt.detail.id;
  if (!api || typeof id !== 'string' || id.indexOf('pistols-name-') !== 0) return;
  if (id === 'pistols-name-preset') {
    if (!evt.detail.value) return;
    api.setName(evt.detail.value);
    syncProfile();
    return;
  }
  api.setName(nameSlots.map(function (slot) { return slot.value; }).join(''));
  nameMenu.label = 'Name: ' + (api.name || '(none)');
});

document.addEventListener('menu-action', function (evt) {
  var api = profileApi();
  var id = evt.detail.id;
  if (!api) return;
  if (id === 'pistols-name-clear') { api.setName(''); syncProfile(); }
  else if (id === 'pistols-backup-export') api.showBackupPanel('export');
  else if (id === 'pistols-backup-import') api.showBackupPanel('import');
});

registerMenuPage('pistols-watch', {
  // The clock: hand-with-watch writes the time into the title.
  title: '',
  items: [targets, teleport, profile, hud, environment, debug, aim],
  // Every value is read fresh as the watch opens: the target settings
  // and toggles belong to pistols-watch-menu, the tunables are globals,
  // and either watch (or the keyboard) may have changed any of them.
  onOpen: function () {
    syncEnvironment();
    syncProfile();
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

// Aim is desktop-controls' preference, shared with every game.
document.addEventListener('menu-commit', function (evt) {
  if (evt.detail.id !== 'pistols-aim') return;
  var rig = document.querySelector('#player-rig');
  var desktop = rig && rig.components['desktop-controls'];
  if (desktop) desktop.setPreference('aimMode', evt.detail.value);
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

// The same environment controls, followed by shared visor settings and Exit VR.
registerVisorPage('visor', { title: 'PISTOLS AT DAWN', items: [environment], onOpen: syncEnvironment });
