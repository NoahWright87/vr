import assert from 'node:assert/strict';
import test from 'node:test';

const definitions = {};
globalThis.AFRAME = {
  registerComponent(name, definition) {
    definitions[name] = definition;
  },
};

await import('../common/menus.js');

function projectedMenu(props) {
  return Object.assign(Object.create(definitions['projected-menu']), props);
}

test('an explicit close suppresses automatic reopening until the activation pose ends', () => {
  const component = projectedMenu({
    active: true,
    automaticDismissed: false,
    data: { automatic: true },
  });

  component.close();
  assert.equal(component.active, false);
  assert.equal(component.automaticDismissed, true);

  component.open();
  assert.equal(component.active, true);
  assert.equal(component.automaticDismissed, false);
});

test('a disabled projected menu cannot be opened', () => {
  const component = projectedMenu({ active: false, automaticDismissed: true, data: { automatic: true, enabled: false } });

  component.open();
  assert.equal(component.active, false);
  assert.equal(component.automaticDismissed, true);
});

test('only targets visible all the way up the hierarchy can be selected', () => {
  const shown = { visible: true, parent: null };
  const hiddenParent = { visible: false, parent: null };
  const visibleRow = { object3D: { visible: true, parent: shown } };
  const rowUnderHiddenParent = { object3D: { visible: true, parent: hiddenParent } };
  const hiddenRow = { object3D: { visible: false, parent: shown } };
  const component = projectedMenu({});

  assert.equal(component.isMenuTargetInteractive(visibleRow), true);
  assert.equal(component.isMenuTargetInteractive(rowUnderHiddenParent), false);
  assert.equal(component.isMenuTargetInteractive(hiddenRow), false);
});
