import assert from 'node:assert/strict';
import test from 'node:test';

const definitions = {};
globalThis.registerComponent = function (name, definition) {
  definitions[name] = definition;
};

class FakeEntity {
  constructor() {
    this.children = [];
    this.parentNode = null;
    this.components = {};
    this.attributes = {};
    this.classList = { add() {} };
    this.object3D = {
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      rotation: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
    };
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
  }

  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.parentNode = null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener() {}
}

globalThis.document = {
  createElement() {
    return new FakeEntity();
  },
};

await import('../games/pistols-at-dawn/js/world-targets.js');

function createWheel() {
  const component = Object.assign(Object.create(definitions['wheel-target']), {
    el: new FakeEntity(),
    data: {
      spokeCount: 4,
      wheelRadius: 0.9,
      speed: 45,
      targetScale: 0.5,
      hubHeight: 1.4,
      angle: 0,
      distance: 6,
    },
  });
  component.init();
  return component;
}

test('the spinner rebuilds its live spokes when target count changes', () => {
  const wheel = createWheel();
  assert.equal(wheel.targets.length, 4);
  assert.equal(wheel.spokeEls.length, 8);

  wheel.data.spokeCount = 6;
  wheel.update({ spokeCount: 4 });

  assert.equal(wheel.targets.length, 6);
  assert.equal(wheel.spokeEls.length, 12);
  assert.equal(wheel.hub.children.length, 13); // axle + six spokes + six targets
});

test('speed changes are read live by the spinner tick', () => {
  const wheel = createWheel();
  wheel.data.speed = 90;
  wheel.tick(0, 1000);
  assert.ok(Math.abs(wheel.hub.object3D.rotation.z - Math.PI * 0.025) < 0.0001);
});

test('distance changes reposition the existing spinner', () => {
  const wheel = createWheel();
  const originalHub = wheel.hub;
  wheel.data.distance = 50;
  wheel.update({ spokeCount: 4, distance: 6, angle: 0 });

  assert.equal(wheel.el.object3D.position.z, -50);
  assert.equal(wheel.hub, originalHub);
  assert.equal(wheel.targets.length, 4);
});
