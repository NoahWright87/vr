import test from 'node:test';
import assert from 'node:assert/strict';

import { createMenu } from '../common/menu-model.js';

// Ten numbered items: a grid of 3 columns is rows [0 1 2] [3 4 5]
// [6 7 8] [9], which covers the full rows, a short last row, and more
// rows than a 3-row window shows.
function items(count, extra) {
  const list = [];
  for (let i = 0; i < count; i++) list.push(Object.assign({ kind: 'action', id: 'item-' + i, label: 'Item ' + i }, extra && extra(i)));
  return list;
}

function shop(overrides) {
  return Object.assign({ title: 'SHOP', layout: 'grid', items: items(10) }, overrides);
}

function focusId(menu) {
  return menu.focusedRow().item.id;
}

test('a grid page is a list on a surface that cannot draw grids', () => {
  const menu = createMenu(shop());
  assert.equal(menu.isGrid(), false);
  assert.equal(menu.levelColumns(), 1);
  // moveGrid falls back to the crossbar's verbs.
  menu.moveGrid(0, 1);
  assert.equal(focusId(menu), 'item-1');
});

test('up and down move a row, left and right a column', () => {
  const menu = createMenu(shop(), { gridColumns: 3 });
  assert.equal(menu.isGrid(), true);
  menu.moveGrid(1, 0);
  assert.equal(focusId(menu), 'item-1');
  menu.moveGrid(0, 1);
  assert.equal(focusId(menu), 'item-4');
  menu.moveGrid(0, -1);
  assert.equal(focusId(menu), 'item-1');
  menu.moveGrid(-1, 0);
  assert.equal(focusId(menu), 'item-0');
});

test('right stops at the end of a row instead of wrapping onto the next', () => {
  const menu = createMenu(shop(), { gridColumns: 3 });
  menu.moveGrid(1, 0);
  menu.moveGrid(1, 0);
  assert.equal(focusId(menu), 'item-2');
  assert.equal(menu.moveGrid(1, 0), false);
  assert.equal(focusId(menu), 'item-2');
});

test('down into a short last row lands on its last cell', () => {
  const menu = createMenu(shop(), { gridColumns: 3 });
  menu.focusIndex(8);
  assert.equal(menu.moveGrid(0, 1), true);
  assert.equal(focusId(menu), 'item-9');
  assert.equal(menu.moveGrid(0, 1), false);
  // and right from there is the end of the list, not a blank cell
  assert.equal(menu.moveGrid(1, 0), false);
});

test('left off the first column is back, which at the root reaches the close button', () => {
  const menu = createMenu(shop(), { gridColumns: 3 });
  menu.open();
  menu.focusIndex(3);
  menu.moveGrid(-1, 0);
  assert.equal(menu.inChrome(), true);
  assert.equal(menu.getChromeFocus().id, 'close');
  // any move from the title bar drops back into the grid
  menu.moveGrid(0, 1);
  assert.equal(menu.inChrome(), false);
});

test('left off the first column of a submenu grid goes up a level', () => {
  const menu = createMenu({
    title: 'ROOT', items: [{ kind: 'submenu', id: 'guns', label: 'Guns', layout: 'grid', items: items(6) }],
  }, { gridColumns: 3 });
  assert.equal(menu.isGrid(), false); // the root did not ask for a grid
  menu.forward();
  assert.equal(menu.isGrid(), true);
  assert.equal(menu.depth(), 1);
  menu.moveGrid(-1, 0);
  assert.equal(menu.depth(), 0);
});

test('a submenu can ask for its own column count', () => {
  const menu = createMenu({ title: 'R', layout: 'grid', columns: 4, items: items(9) }, { gridColumns: 3 });
  assert.equal(menu.levelColumns(), 4);
  menu.moveGrid(0, 1);
  assert.equal(focusId(menu), 'item-4');
});

test('the grid window shows whole rows and scrolls with a row of context', () => {
  const menu = createMenu(shop(), { gridColumns: 3, gridRows: 3 });
  let grid = menu.getGrid();
  assert.equal(grid.columns, 3);
  assert.equal(grid.rowCount, 4);
  assert.equal(grid.firstRow, 0);
  assert.deepEqual(grid.cells.map(c => c.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(grid.cells.filter(c => c.focused).length, 1);
  // Row 1 has a row below it in view: no scroll yet.
  menu.moveGrid(0, 1);
  assert.equal(menu.getGrid().firstRow, 0);
  // Row 2 is the last in view with a row 3 still to come: scroll by one.
  menu.moveGrid(0, 1);
  grid = menu.getGrid();
  assert.equal(grid.firstRow, 1);
  assert.deepEqual(grid.cells.map(c => c.index), [3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(grid.cells.find(c => c.focused), Object.assign({}, grid.cells.find(c => c.index === 6)));
  // Never scrolls past the last row.
  menu.moveGrid(0, 1);
  assert.equal(menu.getGrid().firstRow, 1);
  // Back up: the focus row keeps a row above it in view.
  menu.moveGrid(0, -1);
  menu.moveGrid(0, -1);
  assert.equal(menu.getGrid().firstRow, 0);
});

test('pointing at a tile focuses it, and the scroll follows', () => {
  const menu = createMenu(shop(), { gridColumns: 3, gridRows: 2 });
  assert.equal(menu.focusIndex(9), true);
  assert.equal(focusId(menu), 'item-9');
  assert.equal(menu.getGrid().firstRow, 2);
  assert.equal(menu.focusIndex(9), false);
});

test('a tile pointed at is focused where it is, without scrolling it away', () => {
  const menu = createMenu(shop(), { gridColumns: 3, gridRows: 3 });
  menu.focusIndex(9);
  assert.equal(menu.getGrid().firstRow, 1);
  // Row 1 is the top row in view: a stick move onto it would scroll to
  // show the row above, but a pointer's tap leaves the grid still...
  menu.focusIndex(3, { keepScroll: true });
  assert.equal(focusId(menu), 'item-3');
  assert.equal(menu.getGrid().firstRow, 1);
  // ...and the next stick move scrolls as usual.
  menu.moveGrid(0, -1);
  assert.equal(menu.getGrid().firstRow, 0);
});

test('a list level in a grid surface scrolls as one column', () => {
  const menu = createMenu({ title: 'L', items: items(8) }, { gridColumns: 3, gridRows: 3 });
  const grid = menu.getGrid();
  assert.equal(grid.grid, false);
  assert.equal(grid.columns, 1);
  assert.deepEqual(grid.cells.map(c => c.index), [0, 1, 2]);
  menu.moveGrid(0, 1);
  menu.moveGrid(0, 1);
  assert.deepEqual(menu.getGrid().cells.map(c => c.index), [1, 2, 3]);
});

test('refresh keeps a shrinking grid in range', () => {
  let count = 10;
  const menu = createMenu({ title: 'S', layout: 'grid', items: () => items(count) }, { gridColumns: 3 });
  menu.focusIndex(9);
  count = 4;
  menu.refresh();
  assert.equal(focusId(menu), 'item-3');
  assert.equal(menu.getGrid().firstRow, 0);
});

test('tiles carry thumbnails, subtitles and badges, resolving functions', () => {
  const menu = createMenu(shop({
    items: items(2, i => ({ thumbnail: i ? (item => '/thumb/' + item.id + '.png') : { src: '/atlas.png', rect: [0, 0.5, 0.5, 0.5] }, subtitle: 'x' + i, badge: i ? 'NEW' : '' })),
  }), { gridColumns: 3 });
  const [first, second] = menu.getGrid().cells;
  assert.deepEqual(first.thumbnail, { src: '/atlas.png', rect: [0, 0.5, 0.5, 0.5] });
  assert.equal(second.thumbnail, '/thumb/item-1.png');
  assert.equal(second.subtitle, 'x1');
  assert.equal(second.badge, 'NEW');
  assert.equal(first.badge, '');
});

test('a select laid out as a grid shows its options as tiles', () => {
  const menu = createMenu({ title: 'W', items: [{
    kind: 'select', id: 'hat', label: 'Hat', value: 'b', layout: 'grid', columns: 2,
    options: [{ value: 'a', label: 'Bowler', thumbnail: '/a.png' }, { value: 'b', label: 'Stetson', thumbnail: '/b.png' }, { value: 'c', label: 'Top hat' }],
  }] }, { gridColumns: 3 });
  menu.forward();
  assert.equal(menu.isGrid(), true);
  assert.equal(menu.levelColumns(), 2);
  assert.equal(menu.focusedRow().label, 'Stetson');
  const cells = menu.getGrid().cells;
  assert.equal(cells[1].thumbnail, '/b.png');
  menu.moveGrid(0, 1);
  assert.equal(menu.focusedRow().label, 'Top hat');
});

// ------------------------------------------------------------
// Currencies and prices
// ------------------------------------------------------------

function store(wallet) {
  return {
    title: 'STORE', layout: 'grid',
    currencies: [
      { id: 'gold', label: 'Gold', value: () => wallet.gold },
      { id: 'gems', label: 'Gems', value: () => wallet.gems, format: v => v + ' gems' },
    ],
    items: [
      { kind: 'action', id: 'rope', label: 'Rope', price: 5 },
      { kind: 'action', id: 'crown', label: 'Crown', price: { gold: 100, gems: 2 } },
      { kind: 'action', id: 'map', label: 'Map' },
      { kind: 'action', id: 'odd', label: 'Odd', price: { tickets: 1 } },
    ],
  };
}

test('the wallet is read live from the innermost level that has one', () => {
  const wallet = { gold: 20, gems: 1 };
  const menu = createMenu(store(wallet), { gridColumns: 3 });
  assert.deepEqual(menu.getCurrencies().map(c => [c.id, c.value, c.text]), [['gold', 20, '20'], ['gems', 1, '1 gems']]);
  wallet.gold = 7;
  assert.equal(menu.getCurrencies()[0].value, 7);

  const nested = createMenu({ title: 'TOWN', currencies: [{ id: 'gold', value: 3 }], items: [
    { kind: 'submenu', id: 'bank', label: 'Bank', currencies: [{ id: 'notes', label: 'Notes', value: 50 }], items: items(1) },
  ] });
  assert.deepEqual(nested.getCurrencies().map(c => c.id), ['gold']);
  nested.forward();
  assert.deepEqual(nested.getCurrencies().map(c => c.id), ['notes']);
});

test('prices resolve against the wallet, a bare number in the first currency', () => {
  const wallet = { gold: 20, gems: 1 };
  const menu = createMenu(store(wallet), { gridColumns: 3 });
  const page = store(wallet);
  assert.deepEqual(menu.priceOf(page.items[0]).map(p => [p.id, p.amount, p.affordable]), [['gold', 5, true]]);
  assert.deepEqual(menu.priceOf(page.items[1]).map(p => [p.id, p.amount, p.affordable, p.text]),
    [['gold', 100, false, '100 Gold'], ['gems', 2, false, '2 gems']]);
  assert.deepEqual(menu.priceOf(page.items[2]), []);
  assert.equal(menu.canAfford(page.items[2]), true);
  // A currency the menu does not list is a no, not a freebie.
  assert.equal(menu.canAfford(page.items[3]), false);
  const cells = menu.getGrid().cells;
  assert.equal(cells[0].affordable, true);
  assert.equal(cells[1].affordable, false);
});

test('confirming something you cannot afford is denied instead of acted on', () => {
  const wallet = { gold: 20, gems: 5 };
  const menu = createMenu(store(wallet), { gridColumns: 3 });
  const actions = [], denied = [];
  menu.on('action', e => actions.push(e.id));
  menu.on('denied', e => denied.push([e.id, e.reason]));
  menu.open();
  menu.activate();
  assert.deepEqual(actions, ['rope']);
  menu.moveGrid(1, 0);
  menu.activate();
  assert.deepEqual(actions, ['rope']);
  assert.deepEqual(denied, [['crown', 'price']]);
  wallet.gold = 150;
  menu.activate();
  assert.deepEqual(actions, ['rope', 'crown']);
});

// ------------------------------------------------------------
// Details
// ------------------------------------------------------------

test('details come from the focused item, with stats normalised', () => {
  const menu = createMenu({ title: 'ARMORY', layout: 'grid', currencies: [{ id: 'gold', value: 10 }], items: [
    { kind: 'action', id: 'colt', label: 'Colt', price: 25, actionLabel: 'Buy', details: {
      subtitle: 'Revolver', text: ['Six rounds.', 'Reliable.'],
      stats: [{ label: 'Damage', value: 34, max: 50, delta: 4 }, { label: 'Rounds', text: '6' }],
    } },
    { kind: 'action', id: 'rope', label: 'Rope', info: 'Thirty feet of it.', details: item => ({ title: item.label.toUpperCase() }) },
    { kind: 'submenu', id: 'more', label: 'More', info: 'Other stock.', items: items(1) },
  ] }, { gridColumns: 3 });
  let details = menu.getDetails();
  assert.equal(details.title, 'Colt');
  assert.equal(details.subtitle, 'Revolver');
  assert.equal(details.text, 'Six rounds.\nReliable.');
  assert.deepEqual(details.stats[0], { label: 'Damage', value: 34, max: 50, delta: 4, text: '34' });
  assert.deepEqual(details.stats[1], { label: 'Rounds', value: null, max: null, delta: 0, text: '6' });
  assert.equal(details.actionLabel, 'Buy');
  assert.equal(details.affordable, false);
  assert.equal(details.price[0].amount, 25);

  menu.moveGrid(1, 0);
  details = menu.getDetails();
  assert.equal(details.title, 'ROPE');
  assert.equal(details.actionLabel, 'Select');

  // No details: the info stands in, titled by the row.
  menu.moveGrid(1, 0);
  details = menu.getDetails();
  assert.equal(details.title, 'More');
  assert.equal(details.text, 'Other stock.');
  assert.equal(details.actionLabel, 'Open');
});

test('an item with nothing of its own is titled by its label over the level\'s info', () => {
  const menu = createMenu({ title: 'SHOP', layout: 'grid', info: 'Welcome.', items: items(3) }, { gridColumns: 3 });
  const details = menu.getDetails();
  assert.equal(details.title, 'Item 0');
  assert.equal(details.text, 'Welcome.');
});

test('on the title bar the details fall back to the level', () => {
  const menu = createMenu({ title: 'SHOP', layout: 'grid', info: 'Welcome.', items: items(3) }, { gridColumns: 3 });
  menu.open();
  menu.back();
  const details = menu.getDetails();
  assert.equal(details.text, 'Welcome.');
  assert.equal(details.title, '');
  assert.equal(details.item.title, 'SHOP');
});

// ------------------------------------------------------------
// Hold to confirm
// ------------------------------------------------------------

test('holds: going in is quick, back slower, actions slower, and items can ask for long', () => {
  const menu = createMenu({ title: 'M', items: [
    { kind: 'submenu', id: 'sub', label: 'Sub', items: [{ kind: 'action', id: 'x', label: 'X' }] },
    { kind: 'action', id: 'go', label: 'Go' },
    { kind: 'action', id: 'wipe', label: 'Wipe save', hold: 'long' },
    { kind: 'action', id: 'now', label: 'Now', hold: false },
    { kind: 'action', id: 'slow', label: 'Slow', hold: 2500 },
    { kind: 'info', id: 'about', label: 'About', info: 'Hi' },
    { kind: 'select', id: 'size', label: 'Size', value: 1, options: [{ value: 1, label: 'S' }, { value: 2, label: 'L' }] },
  ] });
  menu.open();
  const h = menu.holds;
  assert.ok(h.enter < h.back && h.enter < h.action && h.action < h.long);
  assert.equal(menu.holdFor('forward'), h.enter);
  assert.equal(menu.holdFor('back'), h.enter); // root: onto the title bar
  menu.moveFocus(1); assert.equal(menu.holdFor('activate'), h.action);
  menu.moveFocus(1); assert.equal(menu.holdFor('activate'), h.long); assert.equal(menu.holdIsSerious('activate'), true);
  menu.moveFocus(1); assert.equal(menu.holdFor('activate'), 0);
  menu.moveFocus(1); assert.equal(menu.holdFor('activate'), 2500);
  menu.moveFocus(1); assert.equal(menu.holdFor('activate'), 0); // info rows do nothing
  menu.moveFocus(1); assert.equal(menu.holdFor('forward'), h.enter);
  menu.forward(); // into the select
  assert.equal(menu.holdFor('activate'), h.pick);
  assert.equal(menu.holdFor('back'), h.back);
  menu.back(); menu.moveFocus(-6); menu.forward();
  assert.equal(menu.depth(), 1);
  assert.equal(menu.holdFor('back'), h.back);
});

test('holds: the title bar, a menu with no close, and page-wide timings', () => {
  const menu = createMenu({ title: 'M', holds: { action: 900 }, items: [{ kind: 'action', id: 'go', label: 'Go' }] });
  menu.open();
  assert.equal(menu.holdFor('activate'), 900);
  menu.back();
  assert.equal(menu.inChrome(), true);
  assert.equal(menu.holdFor('activate'), menu.holds.close);
  assert.equal(menu.holdFor('forward'), 0);
  assert.equal(menu.holdFor('back'), 0);
  const fixture = createMenu({ title: 'F', items: [{ kind: 'action', id: 'go', label: 'Go' }] }, { chrome: [] });
  assert.equal(fixture.holdFor('back'), 0);
});
