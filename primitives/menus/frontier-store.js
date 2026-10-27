// ============================================================
// THE GENERAL STORE — the Frontier demo's shop, on the grid menu.
//
// What a shop needs that a crossbar does not have room for, all from
// page data (see common/menu-model.js GRIDS, CURRENCIES, DETAILS):
//
//   - many things visible at once, each with a picture: a 3 x 3 grid of
//     tiles, the pictures drawn from the HUD's own icons;
//   - a details pane for stats and flavour text, so nothing needs
//     hovering one by one to find out what it is;
//   - a wallet that is always in view: the dollars you earn shooting
//     bottles (the HUD's bounty), and gold nuggets;
//   - prices that go red when you are short, and a purchase you cannot
//     afford refused by the menu itself (menu-denied), not by the game.
//
// The same page reads as a list on any crossbar — it is only drawn as a
// grid where a surface can draw one.
// ============================================================

import { registerMenuPage } from '../../common/menu-crossbar.js';
import '../../common/menu-grid.js';
import { drawIcon } from '../../common/hud-draw.js';

// One canvas per icon, drawn once and shared by every tile that shows it.
var ICON_CANVASES = {};
function icon(name, color) {
  var key = name + '|' + color;
  if (ICON_CANVASES[key]) return ICON_CANVASES[key];
  var canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  drawIcon(canvas.getContext('2d'), name, 64, 64, 104, { color: color, outlineWidth: 40 });
  ICON_CANVASES[key] = canvas;
  return canvas;
}

var GOODS = {
  guns: { label: 'Guns', icon: 'revolver', color: '#e8c27a', info: 'Iron for the road.', items: [
    { id: 'peacemaker', label: 'Peacemaker', icon: 'revolver', color: '#d9d9e0', price: 40, unique: true,
      subtitle: 'Revolver', stats: [{ label: 'Damage', value: 34, max: 50 }, { label: 'Range', value: 22, max: 40 }, { label: 'Rounds', text: '6' }],
      text: 'The gun that won the West, or so the man who sold it to me said.' },
    { id: 'derringer', label: 'Derringer', icon: 'pistol-gun', color: '#c9b08a', price: 15, unique: true,
      subtitle: 'Hideout pistol', stats: [{ label: 'Damage', value: 20, max: 50, delta: -14 }, { label: 'Range', value: 8, max: 40, delta: -14 }, { label: 'Rounds', text: '2' }],
      text: 'Fits in a boot. Not much use past the end of a card table.' },
    { id: 'longbow', label: 'Hunting Bow', icon: 'bow-arrow', color: '#b58a5a', price: 25, unique: true,
      subtitle: 'Quiet', stats: [{ label: 'Damage', value: 28, max: 50, delta: -6 }, { label: 'Range', value: 34, max: 40, delta: 12 }, { label: 'Reload', text: 'Slow' }],
      text: 'For when you would rather nobody in town heard you coming.' },
    { id: 'knives', label: 'Throwing Knives', icon: 'thrown-knife', color: '#cfd6dd', price: 10,
      subtitle: 'Set of three', stats: [{ label: 'Damage', value: 18, max: 50 }, { label: 'Range', value: 10, max: 40 }],
      text: 'Balanced for the hand. Mind the barman\'s mirror.' },
    { id: 'ammo', label: 'Box of Cartridges', icon: 'ammo-box', color: '#e0b060', price: 5,
      subtitle: '.45, fifty count', stats: [{ label: 'Rounds', text: '50' }],
      text: 'You can never have too many. You can, however, have too few.' },
  ] },
  saloon: { label: 'Saloon', icon: 'beer-stein', color: '#f0c050', info: 'Courage, by the glass.', items: [
    { id: 'whisky', label: 'Whisky', icon: 'brandy-bottle', color: '#c9792f', price: 3,
      subtitle: 'Bottle', stats: [{ label: 'Courage', value: 30, max: 50 }, { label: 'Aim', value: -10, max: 50, text: '-10' }],
      text: 'Steadies the nerves. Unsteadies everything else.' },
    { id: 'beer', label: 'Beer', icon: 'beer-stein', color: '#f2c94c', price: 1,
      subtitle: 'Stein', stats: [{ label: 'Courage', value: 10, max: 50 }],
      text: 'Warm, flat, and the best thing for fifty miles.' },
    { id: 'tonic', label: 'Doc\'s Tonic', icon: 'health-potion', color: '#ff6a6a', price: { dollars: 20, nuggets: 1 },
      subtitle: 'Cures what ails you', stats: [{ label: 'Health', value: 40, max: 50 }],
      text: 'Bought off Doc Hollow before he skipped town. Probably fine.' },
  ] },
  outfitting: { label: 'Outfitting', icon: 'compass', color: '#9fd3ff', info: 'For the trail.', items: [
    { id: 'compass', label: 'Compass', icon: 'compass', color: '#9fd3ff', price: 8, unique: true,
      subtitle: 'Brass', text: 'Points north. Usually.' },
    { id: 'watch', label: 'Pocket Watch', icon: 'pocket-watch', color: '#f0d27a', price: 30, unique: true,
      subtitle: 'Railroad grade', text: 'Keeps better time than the stage line does.' },
    { id: 'map', label: 'Map of the County', icon: 'treasure-map', color: '#e8d6a0', unique: true,
      subtitle: 'Free', text: 'The storekeeper drew it himself. Take one, it is on the house.' },
    { id: 'vest', label: 'Iron Vest', icon: 'breastplate', color: '#aab4c0', price: { nuggets: 3 }, unique: true,
      subtitle: 'Heavy', stats: [{ label: 'Armor', value: 40, max: 50 }, { label: 'Speed', value: -8, max: 50, text: '-8' }],
      text: 'Stops a bullet. Also stops you climbing onto your horse.' },
    { id: 'boots', label: 'Riding Boots', icon: 'running-shoe', color: '#a8774a', price: 12, unique: true,
      subtitle: 'Spurred', stats: [{ label: 'Speed', value: 12, max: 50 }],
      text: 'Jingle jangle.' },
    { id: 'key', label: 'Hotel Key', icon: 'key', color: '#f0d27a', price: 6,
      subtitle: 'Room 4', text: 'A bed, a basin, and a door that locks. Mostly.' },
  ] },
};

export function registerFrontierStore(state) {
  state.nuggets = state.nuggets === undefined ? 2 : state.nuggets;
  state.owned = state.owned || {};

  function item(good) {
    return {
      kind: 'action', id: 'store-buy-' + good.id, label: good.label, actionLabel: good.price ? 'Buy' : 'Take',
      thumbnail: icon(good.icon, good.color),
      // Things you only need one of stop being for sale once you own
      // them; the rest count up.
      price: function () { return good.unique && state.owned[good.id] ? undefined : good.price; },
      badge: function () {
        var n = state.owned[good.id] || 0;
        if (!n) return '';
        return good.unique ? 'Owned' : 'x' + n;
      },
      details: function () {
        return { subtitle: good.subtitle, stats: good.stats || [], text: good.text };
      },
      good: good,
    };
  }

  return registerMenuPage('general-store', {
    title: 'General Store',
    layout: 'grid',
    info: ['Shoot bottles for dollars,', 'then spend them here.'],
    currencies: [
      { id: 'dollars', label: 'Dollars', value: function () { return state.bounty; }, format: function (v) { return '$' + v; } },
      { id: 'nuggets', label: 'Nuggets', value: function () { return state.nuggets; }, icon: icon('coins', '#ffd34d') },
    ],
    items: Object.keys(GOODS).map(function (id) {
      var shelf = GOODS[id];
      return {
        kind: 'submenu', id: 'store-shelf-' + id, label: shelf.label, layout: 'grid', info: shelf.info,
        thumbnail: icon(shelf.icon, shelf.color), subtitle: shelf.items.length + ' items',
        // Everything you can buy on one shelf, as tiles: the point of the
        // grid is that you can see them all at once.
        items: function () { return shelf.items.map(item); },
      };
    }),
  });
}

// What buying does. The menu has already refused anything you cannot
// afford, so this only has to take the money.
export function buyFromStore(state, menuItem) {
  var good = menuItem && menuItem.good;
  if (!good) return false;
  if (good.unique && state.owned[good.id]) return false;
  var price = good.price || 0;
  var dollars = typeof price === 'number' ? price : (price.dollars || 0);
  var nuggets = typeof price === 'number' ? 0 : (price.nuggets || 0);
  state.bounty -= dollars;
  state.nuggets -= nuggets;
  state.owned[good.id] = (state.owned[good.id] || 0) + 1;
  return true;
}
