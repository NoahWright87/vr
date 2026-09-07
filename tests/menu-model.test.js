import test from 'node:test';
import assert from 'node:assert/strict';

import { createMenu, MENU_DEFAULTS } from '../common/menu-model.js';

// A stand-in for the kind of page a game registers: one of every item
// kind, so the drill behaviour of each is exercised against the same
// menu rather than against six bespoke fixtures.
function samplePage(overrides) {
  return Object.assign({
    title: 'MAIN',
    items: [
      { kind: 'action', id: 'resume', label: 'Resume' },
      { kind: 'toggle', id: 'hud', label: 'HUD', value: true },
      {
        kind: 'select', id: 'targets', label: 'Targets', value: 6,
        options: [
          { value: 4, label: '4' },
          { value: 6, label: '6' },
          { value: 8, label: '8' },
          { value: 12, label: '12' },
        ],
      },
      { kind: 'number', id: 'speed', label: 'Speed', value: 1, min: 0, max: 2, step: 0.1 },
      {
        kind: 'submenu', id: 'comfort', label: 'Comfort',
        items: [
          { kind: 'toggle', id: 'vignette', label: 'Vignette', value: false },
          { kind: 'action', id: 'recenter', label: 'Recenter' },
        ],
      },
    ],
  }, overrides);
}

function labels(menu) {
  return menu.getWindow().map(function (row) { return row.label; });
}

function focusLabel(menu) {
  return menu.focusedRow().label;
}

// ------------------------------------------------------------
// Windowing
// ------------------------------------------------------------

test('focus starts at the first row and the window is centred on it', () => {
  const menu = createMenu(samplePage());
  assert.equal(focusLabel(menu), 'Resume');
  const window = menu.getWindow();
  const focused = window.find((row) => row.focused);
  assert.equal(focused.offset, 0);
  assert.equal(focused.index, 0);
});

test('a list shorter than the window draws only the rows it has', () => {
  const menu = createMenu({ title: 'SHORT', items: [
    { kind: 'action', id: 'a', label: 'A' },
    { kind: 'action', id: 'b', label: 'B' },
    { kind: 'action', id: 'c', label: 'C' },
  ] });
  // Focus on A: B and C sit below it, the two slots above stay empty.
  assert.deepEqual(labels(menu), ['A', 'B', 'C']);
  assert.deepEqual(menu.getWindow().map((row) => row.offset), [0, 1, 2]);
  assert.equal(menu.hasOverflow(), false);
});

test('a short list does not wrap, or the same row would show twice', () => {
  const menu = createMenu({ title: 'SHORT', items: [
    { kind: 'action', id: 'a', label: 'A' },
    { kind: 'action', id: 'b', label: 'B' },
    { kind: 'action', id: 'c', label: 'C' },
  ] });
  menu.moveFocus(-1);
  assert.equal(focusLabel(menu), 'A', 'clamps at the top instead of wrapping to C');
  menu.moveFocus(5);
  assert.equal(focusLabel(menu), 'C', 'clamps at the bottom');
  assert.equal(new Set(labels(menu)).size, labels(menu).length, 'no row appears twice');
});

test('a list longer than the window wraps around', () => {
  const items = ['Ghost Town', 'The Range', 'The Saloon', "Sheriff's Office", 'The Bank', 'The Farm']
    .map((label, i) => ({ kind: 'action', id: 'loc-' + i, label: label }));
  const menu = createMenu({ title: 'TELEPORT', items });
  assert.equal(menu.hasOverflow(), true);
  // Focused on the first row, the two rows "above" are the last two.
  assert.deepEqual(labels(menu), ['The Bank', 'The Farm', 'Ghost Town', 'The Range', 'The Saloon']);
  menu.moveFocus(-1);
  assert.equal(focusLabel(menu), 'The Farm', 'stepping up from the first row lands on the last');
});

test('wrapping can be switched off for a long list', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ kind: 'action', id: 'i' + i, label: 'Item ' + i }));
  const menu = createMenu({ title: 'LONG', items }, { wrap: false });
  menu.moveFocus(-1);
  assert.equal(focusLabel(menu), 'Item 0');
});

test('an even window size is rounded up so there is always a centre row', () => {
  const menu = createMenu(samplePage(), { windowSize: 4 });
  assert.equal(menu.windowSize, 5);
});

// ------------------------------------------------------------
// The four inward behaviours
// ------------------------------------------------------------

test('an action fires without changing level', () => {
  const menu = createMenu(samplePage());
  const fired = [];
  menu.on('action', (detail) => fired.push(detail.id));
  menu.activate();
  assert.deepEqual(fired, ['resume']);
  assert.equal(menu.depth(), 0);
});

test('an action can close the menu on activation', () => {
  const menu = createMenu({ title: 'T', items: [
    { kind: 'action', id: 'go', label: 'Go', closeOnActivate: true },
  ] });
  menu.open();
  menu.activate();
  assert.equal(menu.isOpen, false);
});

test('a toggle flips in place rather than opening a submenu', () => {
  const menu = createMenu(samplePage());
  const commits = [];
  menu.on('commit', (detail) => commits.push(detail.value));
  menu.moveFocus(1);
  assert.equal(focusLabel(menu), 'HUD: On');
  menu.activate();
  assert.equal(menu.depth(), 0, 'stayed on the same level');
  assert.equal(focusLabel(menu), 'HUD: Off');
  assert.deepEqual(commits, [false]);
});

test('a submenu pushes a level and back pops it', () => {
  const menu = createMenu(samplePage());
  menu.moveFocus(4);
  assert.equal(focusLabel(menu), 'Comfort');
  menu.activate();
  assert.equal(menu.depth(), 1);
  assert.deepEqual(labels(menu), ['Vignette: Off', 'Recenter']);
  menu.back();
  assert.equal(menu.depth(), 0);
  assert.equal(focusLabel(menu), 'Comfort');
});

// ------------------------------------------------------------
// Values as submenus
// ------------------------------------------------------------

test('a select drills into its options and the label loses its value', () => {
  const menu = createMenu(samplePage());
  menu.moveFocus(2);
  assert.equal(focusLabel(menu), 'Targets: 6');
  menu.activate();
  assert.deepEqual(menu.getBreadcrumbs().map((crumb) => crumb.title), ['Targets']);
  assert.deepEqual(labels(menu), ['4', '6', '8', '12']);
  assert.equal(focusLabel(menu), '6', 'opens on the current value');
});

test('scrolling a select previews, and backing out commits', () => {
  const menu = createMenu(samplePage());
  const previews = [];
  const commits = [];
  menu.on('preview', (detail) => previews.push(detail.value));
  menu.on('commit', (detail) => commits.push(detail.value));

  menu.moveFocus(2);
  menu.activate();
  menu.moveFocus(1);
  menu.moveFocus(1);
  assert.deepEqual(previews, [8, 12], 'each step applies live');
  assert.deepEqual(commits, [], 'nothing committed while still choosing');

  menu.back();
  assert.deepEqual(commits, [12]);
  assert.equal(menu.depth(), 0);
  assert.equal(focusLabel(menu), 'Targets: 12', 'the value slides back into the label');
});

test('inward on a value row commits too, so either direction takes it', () => {
  const menu = createMenu(samplePage());
  menu.moveFocus(2);
  menu.activate();
  menu.moveFocus(-1);
  menu.activate();
  assert.equal(menu.depth(), 0);
  assert.equal(focusLabel(menu), 'Targets: 4');
});

test('applyOn select waits for the commit instead of previewing', () => {
  const page = samplePage();
  page.items[2].applyOn = 'select';
  const menu = createMenu(page);
  const previews = [];
  const commits = [];
  menu.on('preview', (detail) => previews.push(detail.value));
  menu.on('commit', (detail) => commits.push(detail.value));
  menu.moveFocus(2);
  menu.activate();
  menu.moveFocus(1);
  assert.deepEqual(previews, [], 'expensive settings do not fire on every step');
  menu.back();
  assert.deepEqual(commits, [8]);
});

// ------------------------------------------------------------
// Numbers
// ------------------------------------------------------------

test('a number renders like a list without materialising every value', () => {
  const menu = createMenu(samplePage());
  menu.moveFocus(3);
  assert.equal(focusLabel(menu), 'Speed: 1.0');
  menu.activate();
  assert.deepEqual(labels(menu), ['0.8', '0.9', '1.0', '1.1', '1.2']);
});

test('a number clamps at its bounds and never wraps', () => {
  const menu = createMenu(samplePage());
  menu.moveFocus(3);
  menu.activate();
  menu.moveFocus(-100);
  assert.equal(focusLabel(menu), '0.0');
  assert.deepEqual(labels(menu), ['0.0', '0.1', '0.2'], 'nothing above the minimum');
  menu.moveFocus(100);
  assert.equal(focusLabel(menu), '2.0');
});

test('stepping a fractional number does not accumulate float drift', () => {
  const menu = createMenu(samplePage());
  menu.moveFocus(3);
  menu.activate();
  for (let i = 0; i < 7; i++) menu.moveFocus(1);
  assert.equal(focusLabel(menu), '1.7');
  menu.back();
  assert.equal(samplePage().items[3].value, 1, 'fixture untouched');
  assert.equal(focusLabel(menu), 'Speed: 1.7');
});

test('a number can format its own value', () => {
  const menu = createMenu({ title: 'T', items: [
    { kind: 'number', id: 'vol', label: 'Volume', value: 0.5, min: 0, max: 1, step: 0.25,
      format: (value) => Math.round(value * 100) + '%' },
  ] });
  assert.equal(focusLabel(menu), 'Volume: 50%');
  menu.activate();
  assert.deepEqual(labels(menu), ['0%', '25%', '50%', '75%', '100%']);
});

// ------------------------------------------------------------
// Breadcrumbs
// ------------------------------------------------------------

test('breadcrumbs are nearest-first and exclude the root title', () => {
  const menu = createMenu({ title: 'MAIN', items: [
    { kind: 'submenu', id: 'options', label: 'Options', items: [
      { kind: 'submenu', id: 'audio', label: 'Audio', items: [
        { kind: 'number', id: 'music', label: 'Music', value: 5, min: 0, max: 10, step: 1 },
      ] },
    ] },
  ] });
  assert.deepEqual(menu.getBreadcrumbs(), []);
  assert.equal(menu.getTitle(), 'MAIN');
  menu.activate();
  menu.activate();
  menu.activate();
  assert.deepEqual(menu.getBreadcrumbs().map((crumb) => crumb.title), ['Music', 'Audio', 'Options']);
});

test('breadcrumb depth caps what a cramped surface has to draw', () => {
  const menu = createMenu({ title: 'MAIN', items: [
    { kind: 'submenu', id: 'a', label: 'A', items: [
      { kind: 'submenu', id: 'b', label: 'B', items: [
        { kind: 'submenu', id: 'c', label: 'C', items: [
          { kind: 'action', id: 'd', label: 'D' },
        ] },
      ] },
    ] },
  ] }, { breadcrumbDepth: 1 });
  menu.activate();
  menu.activate();
  menu.activate();
  assert.deepEqual(menu.getBreadcrumbs().map((crumb) => crumb.title), ['C']);
});

// ------------------------------------------------------------
// Closing and memory
// ------------------------------------------------------------

// ------------------------------------------------------------
// The title bar, and closing on purpose
// ------------------------------------------------------------

test('back at the root moves onto the close button rather than closing', () => {
  const menu = createMenu(samplePage());
  menu.open();
  const closes = [];
  menu.on('close', () => closes.push(true));
  menu.back();
  assert.equal(menu.isOpen, true, 'one press too many must not dismiss the menu');
  assert.equal(menu.inChrome(), true);
  assert.equal(menu.getChromeFocus().id, 'close');
  assert.deepEqual(closes, []);
});

test('confirming the close button closes', () => {
  const menu = createMenu(samplePage());
  menu.open();
  const closes = [];
  menu.on('close', () => closes.push(true));
  menu.back();
  menu.activate();
  assert.equal(menu.isOpen, false);
  assert.deepEqual(closes, [true]);
});

test('back again from the close button stays put', () => {
  const menu = createMenu(samplePage());
  menu.open();
  menu.back();
  menu.back();
  menu.back();
  assert.equal(menu.isOpen, true);
  assert.equal(menu.inChrome(), true);
});

test('forward from the close button returns to the list without firing it', () => {
  const menu = createMenu(samplePage());
  menu.open();
  const closes = [];
  menu.on('close', () => closes.push(true));
  menu.back();
  menu.forward();
  assert.equal(menu.inChrome(), false);
  assert.equal(focusLabel(menu), 'Resume');
  assert.deepEqual(closes, [], 'moving back into the list is not confirming');
});

test('stepping off a single close button drops back into the list', () => {
  const menu = createMenu(samplePage());
  menu.open();
  menu.back();
  menu.moveFocus(1);
  assert.equal(menu.inChrome(), false, 'never swallow input with no visible effect');
  assert.equal(focusLabel(menu), 'HUD: On');
});

test('back inside a submenu still pops a level, not to the close button', () => {
  const menu = createMenu(samplePage());
  menu.open();
  menu.moveFocus(4);
  menu.activate();
  assert.equal(menu.depth(), 1);
  menu.back();
  assert.equal(menu.depth(), 0);
  assert.equal(menu.inChrome(), false);
});

test('forward in the list still enters a submenu', () => {
  const menu = createMenu(samplePage());
  menu.moveFocus(4);
  menu.forward();
  assert.equal(menu.depth(), 1);
});

test('closing clears the title-bar focus for next time', () => {
  const menu = createMenu(samplePage(), { memory: 'permanent' });
  menu.open();
  menu.back();
  menu.activate();
  menu.open();
  assert.equal(menu.inChrome(), false);
});

test('a menu can be given extra title-bar controls', () => {
  const menu = createMenu(samplePage(), {
    chrome: [{ id: 'pin', label: 'Pin' }, { id: 'close', label: 'Close' }],
  });
  menu.open();
  const fired = [];
  menu.on('chrome-action', (detail) => fired.push(detail.id));
  menu.back();
  assert.equal(menu.getChromeFocus().id, 'pin');
  menu.moveFocus(1);
  assert.equal(menu.getChromeFocus().id, 'close', 'steps between controls when there is more than one');
  assert.equal(menu.inChrome(), true);
  menu.activate();
  assert.deepEqual(fired, ['close']);
  assert.equal(menu.isOpen, false);
});

test('memory none always reopens at the root', () => {
  const menu = createMenu(samplePage(), { memory: 'none' });
  menu.open();
  menu.moveFocus(4);
  menu.activate();
  menu.close();
  menu.open();
  assert.equal(menu.depth(), 0);
  assert.equal(focusLabel(menu), 'Resume');
});

test('memory permanent reopens where you left off', () => {
  const menu = createMenu(samplePage(), { memory: 'permanent' });
  menu.open();
  menu.moveFocus(4);
  menu.activate();
  menu.moveFocus(1);
  menu.close();
  menu.open();
  assert.equal(menu.depth(), 1);
  assert.equal(focusLabel(menu), 'Recenter');
});

test('memory temporary keeps your place briefly and resets after a while', () => {
  let clock = 1000;
  const menu = createMenu(samplePage(), { memory: 'temporary', memoryMs: 60000, now: () => clock });
  menu.open();
  menu.moveFocus(4);
  menu.activate();
  menu.close();

  clock += 5000; // ducked out to defend yourself
  menu.open();
  assert.equal(menu.depth(), 1, 'picks up where it left off');
  menu.close();

  clock += 120000; // came back much later
  menu.open();
  assert.equal(menu.depth(), 0, 'reset to the root');
});

test('the default memory mode is temporary', () => {
  assert.equal(MENU_DEFAULTS.memory, 'temporary');
});

// ------------------------------------------------------------
// Pointing
// ------------------------------------------------------------

test('pointing at an off-centre row scrolls to it rather than selecting', () => {
  const menu = createMenu(samplePage());
  const fired = [];
  menu.on('action', (detail) => fired.push(detail.id));
  menu.focusOffset(2);
  assert.equal(focusLabel(menu), 'Targets: 6');
  assert.deepEqual(fired, [], 'a tap on a distant row never activates it');
});

test('dynamic item lists are resolved when their level opens', () => {
  let towns = ['Ghost Town', 'The Range'];
  const menu = createMenu({ title: 'MAIN', items: [
    { kind: 'submenu', id: 'teleport', label: 'Teleport',
      items: () => towns.map((label, i) => ({ kind: 'action', id: 't' + i, label: label })) },
  ] });
  menu.activate();
  assert.deepEqual(labels(menu), ['Ghost Town', 'The Range']);
  menu.back();
  towns = towns.concat('The Farm');
  menu.activate();
  assert.deepEqual(labels(menu), ['Ghost Town', 'The Range', 'The Farm'], 'picked up the new destination');
});
