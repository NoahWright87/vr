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

test('hover and click feedback never transform the raycast target', async () => {
  const { component, writes } = createMenuItem();

  component.onMouseEnter();
  component.onClick();
  await new Promise((resolve) => setTimeout(resolve, 160));

  assert.equal(writes.some((write) => write.name === 'scale'), false);
  assert.deepEqual(writes.filter((write) => write.name === 'material').map((write) => write.value), [
    '#2a3a5c',
    '#ffd54a',
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
