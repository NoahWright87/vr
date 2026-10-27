import assert from 'node:assert/strict';
import test from 'node:test';

// The headset path, without a headset: menu-stick-control's own stick
// handling (pumpStick) driving grid-menu's own verbs, on a real model.
const components = {};
const systems = {};
globalThis.AFRAME = {
  THREE: {},
  registerComponent: (name, definition) => { components[name] = definition; },
  registerSystem: (name, definition) => { systems[name] = definition; },
};
await import('../common/menu-crossbar.js');
await import('../common/menu-grid.js');
const { createMenu } = await import('../common/menu-model.js');

function items(count) {
  return Array.from({ length: count }, (_, i) => ({ kind: 'action', id: 'item-' + i, label: 'Item ' + i }));
}

// A grid-menu with only what its input verbs touch: the model.
function grid(page) {
  const component = Object.create(components['grid-menu']);
  component.menu = createMenu(page, { gridColumns: 3, gridRows: 3 });
  component.menu.open();
  return component;
}

function stick(component) {
  const system = Object.create(systems['menu-stick-control']);
  const state = { menu: component, axes: [0, 0, 0, 0], armed: true, armedX: true, repeatAt: 0 };
  return {
    push(x, y, time) { state.axes = [0, 0, x, y]; system.pumpStick(state, time); },
  };
}

const focus = component => component.menu.focusedRow().item.id;

test('the stick moves sideways along a grid row, repeating while held', () => {
  const component = grid({ title: 'G', layout: 'grid', items: items(9) });
  const s = stick(component);
  s.push(1, 0, 0);
  assert.equal(focus(component), 'item-1');
  s.push(1, 0, 100); // held, before the repeat delay
  assert.equal(focus(component), 'item-1');
  s.push(1, 0, 500); // past it
  assert.equal(focus(component), 'item-2');
  s.push(0, 0, 600);
  s.push(0, 1, 700);
  assert.equal(focus(component), 'item-5');
});

test('holding left runs to the first column but does not back out of the level', () => {
  const component = grid({ title: 'G', items: [{ kind: 'submenu', id: 'shelf', label: 'Shelf', layout: 'grid', items: items(9) }] });
  component.menu.forward();
  component.menu.focusIndex(2);
  const s = stick(component);
  s.push(-1, 0, 0);
  s.push(-1, 0, 500);
  assert.equal(focus(component), 'item-0');
  // Still held: the repeat stops at the edge rather than leaving.
  s.push(-1, 0, 700);
  s.push(-1, 0, 900);
  assert.equal(component.menu.depth(), 1);
  // A fresh push off the first column is back, as everywhere else.
  s.push(0, 0, 1000);
  s.push(-1, 0, 1100);
  assert.equal(component.menu.depth(), 0);
});

test('on a list level a grid surface keeps the crossbar\'s one-detent in and out', () => {
  const component = grid({ title: 'L', items: [{ kind: 'submenu', id: 'sub', label: 'Sub', items: items(3) }, ...items(2)] });
  assert.equal(component.horizontalRepeats(), false);
  const s = stick(component);
  s.push(1, 0, 0);
  assert.equal(component.menu.depth(), 1);
  s.push(1, 0, 600); // held: no repeat into the row
  assert.equal(component.menu.depth(), 1);
});

test('a crossbar is unchanged: right goes in, once', () => {
  const crossbar = Object.create(components['crossbar-menu']);
  crossbar.menu = createMenu({ title: 'C', items: [{ kind: 'submenu', id: 'sub', label: 'Sub', items: items(3) }] });
  crossbar.menu.open();
  assert.equal(crossbar.horizontal, undefined);
  const s = stick(crossbar);
  s.push(1, 0, 0);
  s.push(1, 0, 600);
  assert.equal(crossbar.menu.depth(), 1);
});
