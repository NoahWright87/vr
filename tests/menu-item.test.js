import assert from 'node:assert/strict';
import test from 'node:test';

const definitions = {};
globalThis.AFRAME = {
  registerComponent(name, definition) {
    definitions[name] = definition;
  },
};

await import('../common/menus.js');

function createMenuItem() {
  const writes = [];
  const listeners = new Map();
  const element = {
    parentNode: {},
    getAttribute(name) {
      if (name === 'material') return { color: '#182238' };
      return null;
    },
    setAttribute(name, property, value) {
      writes.push({ name, property, value });
    },
    addEventListener(name, listener) {
      listeners.set(name, listener);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    emit(name, detail, bubbles) {
      writes.push({ name: 'emit', property: name, value: { detail, bubbles } });
    },
  };
  const component = Object.assign(Object.create(definitions['menu-item']), {
    el: element,
    data: { value: 'test', label: 'Test', hoverColor: '#2a3a5c' },
  });
  component.init();
  return { component, writes };
}

test('hover feedback is a stable color shift and never transforms the raycast target', () => {
  const { component, writes } = createMenuItem();

  component.onMouseEnter();
  component.onClick();

  assert.equal(writes.some((write) => write.name === 'scale'), false);
  assert.deepEqual(writes.filter((write) => write.name === 'material').map((write) => write.value), [
    '#2a3a5c',
  ]);

  component.onMouseLeave();
  assert.equal(writes.at(-1).value, '#182238');
  component.remove();
});

test('an explicit close suppresses automatic reopening until the activation pose ends', () => {
  const component = Object.assign(Object.create(definitions['projected-menu']), {
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

test('the center of a multi-value row opens its complete option list', () => {
  let opened = 0;
  let propagationStopped = false;
  const component = Object.assign(Object.create(definitions['menu-option']), {
    el: { contains() { return true; } },
    popupEl: null,
    openPopup() { opened += 1; },
  });

  component.onInternalSelection({
    target: {},
    detail: { value: 'menu-option-open' },
    stopPropagation() { propagationStopped = true; },
  });

  assert.equal(opened, 1);
  assert.equal(propagationStopped, true);
});

test('only visible targets on the topmost option layer can be selected', () => {
  const popupChoice = { object3D: { visible: true, parent: null } };
  const coveredRow = { object3D: { visible: true, parent: null } };
  const hiddenRow = { object3D: { visible: false, parent: null } };
  const popup = { contains(item) { return item === popupChoice; } };
  const component = Object.assign(Object.create(definitions['projected-menu']), {
    panelEl: { querySelector() { return popup; } },
  });

  assert.equal(component.isMenuTargetInteractive(popupChoice), true);
  assert.equal(component.isMenuTargetInteractive(coveredRow), false);
  assert.equal(component.isMenuTargetInteractive(hiddenRow), false);
});
