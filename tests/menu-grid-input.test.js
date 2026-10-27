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

// The real system's stick and hold code, on a clock the test turns.
function stick(component) {
  const system = Object.create(systems['menu-stick-control']);
  system.holders = [];
  let clock = 0;
  system.now = () => clock;
  const state = { menu: component, axes: [0, 0, 0, 0], armed: true, armedX: true, repeatAt: 0 };
  return {
    system, state,
    // Push the stick to (x, y) at `time`, and let the hold wheel run.
    push(x, y, time) { clock = time; state.axes = [0, 0, x, y]; system.pumpStick(state, time); system.updateHolds(time); },
    wait(time) { clock = time; system.updateHolds(time); },
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
  s.push(-1, 0, 2000);
  assert.equal(component.menu.depth(), 1);
  // A fresh push off the first column is back, held until the wheel fills.
  s.push(0, 0, 2100);
  s.push(-1, 0, 2200);
  assert.equal(component.menu.depth(), 1);
  s.push(-1, 0, 2200 + component.menu.holds.back + 10);
  assert.equal(component.menu.depth(), 0);
});

test('going in is a hold: let go early and nothing happens; hold on and it happens once', () => {
  const sub = { kind: 'submenu', id: 'sub', label: 'Sub', items: [{ kind: 'submenu', id: 'deeper', label: 'Deeper', items: items(2) }] };
  const component = grid({ title: 'L', items: [sub, ...items(2)] });
  assert.equal(component.horizontalRepeats(), false);
  const s = stick(component);
  const enter = component.menu.holds.enter;
  s.push(1, 0, 0);
  s.push(1, 0, enter / 2);
  assert.equal(component.menu.depth(), 0);
  s.push(0, 0, enter / 2 + 10); // let go: cancelled
  s.push(0, 0, enter * 3);
  assert.equal(component.menu.depth(), 0);
  s.push(1, 0, 1000);
  s.push(1, 0, 1000 + enter + 1);
  assert.equal(component.menu.depth(), 1);
  // Still held: it does not go on into the next level.
  s.push(1, 0, 1000 + enter * 4);
  assert.equal(component.menu.depth(), 1);
});

test('a drifting stick moves nothing', () => {
  const component = grid({ title: 'L', items: [{ kind: 'submenu', id: 'sub', label: 'Sub', items: items(3) }, ...items(4)] });
  const s = stick(component);
  for (let t = 0; t < 5000; t += 100) s.push(0.45, 0.5, t);
  assert.equal(component.menu.depth(), 0);
  assert.equal(focus(component), 'sub');
});

test('moving the focus during a hold drops it', () => {
  const component = grid({ title: 'L', items: [{ kind: 'action', id: 'a', label: 'A' }, { kind: 'action', id: 'b', label: 'B' }] });
  const actions = [];
  component.menu.on('action', e => actions.push(e.id));
  const s = stick(component);
  s.system.beginHold(s.state, component, 'activate', 'activate-button');
  s.wait(100);
  component.menu.moveFocus(1);
  s.wait(5000);
  assert.deepEqual(actions, []);
  // A fresh press on B, held through, fires B once.
  s.system.beginHold(s.state, component, 'activate', 'activate-button');
  s.wait(5000 + component.menu.holds.action + 1);
  s.wait(9000);
  assert.deepEqual(actions, ['b']);
  s.system.endHold(s.state, 'activate-button');
});

test('a serious item needs the long hold; releasing a different input does not cancel it', () => {
  const component = grid({ title: 'L', items: [{ kind: 'action', id: 'wipe', label: 'Wipe', hold: 'long' }] });
  const actions = [];
  component.menu.on('action', e => actions.push(e.id));
  const s = stick(component);
  s.system.beginHold(s.state, component, 'activate', 'activate-button');
  s.system.endHold(s.state, 'back-button');
  s.wait(component.menu.holds.action + 50);
  assert.deepEqual(actions, []);
  s.wait(component.menu.holds.long + 1);
  assert.deepEqual(actions, ['wipe']);
});

test('a crossbar is unchanged but held: right goes in, once', () => {
  const crossbar = Object.create(components['crossbar-menu']);
  crossbar.menu = createMenu({ title: 'C', items: [{ kind: 'submenu', id: 'sub', label: 'Sub', items: [{ kind: 'submenu', id: 'deeper', label: 'D', items: items(1) }] }] });
  crossbar.menu.open();
  assert.equal(crossbar.horizontal, undefined);
  const s = stick(crossbar);
  s.push(1, 0, 0);
  s.push(1, 0, 600);
  s.push(1, 0, 2000);
  assert.equal(crossbar.menu.depth(), 1);
});
