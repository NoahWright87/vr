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
  createElement(tagName) {
    const entity = new FakeEntity();
    entity.tagName = tagName;
    return entity;
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
  assert.equal(wheel.hub.children.length, 2); // axle + one spinning layer
});

test('speed changes are read live by the spinner tick', () => {
  const wheel = createWheel();
  wheel.data.speed = 90;
  wheel.tick(0, 1000);
  assert.ok(Math.abs(wheel.layerEls[0].object3D.rotation.z - Math.PI * 0.025) < 0.0001);
});

test('large spinners use three concentric counter-rotating layers', () => {
  const wheel = createWheel();
  wheel.data.spokeCount = 24;
  wheel.update({ spokeCount: 4 });

  assert.equal(wheel.targets.length, 24);
  assert.equal(wheel.layerEls.length, 3);
  assert.deepEqual(wheel.layerEls.map((layer) => layer._spinDirection), [1, -1, 1]);
  const radii = wheel.targets.map((target) => Math.hypot(
    target.attributes.position.x,
    target.attributes.position.y
  ));
  assert.equal(new Set(radii.map((radius) => radius.toFixed(2))).size, 3);
});

test('bullseye scoring zones are non-overlapping rings on one depth plane', () => {
  const wheel = createWheel();
  const face = wheel.targets[0].children[0];
  const zones = face.children.slice(1);

  assert.deepEqual(zones.map((zone) => zone.tagName), ['a-ring', 'a-ring', 'a-ring', 'a-ring', 'a-circle']);
  assert.equal(new Set(zones.map((zone) => zone.attributes.position.z)).size, 1);
});

test('distance changes reposition the existing spinner', () => {
  const wheel = createWheel();
  const originalHub = wheel.hub;
  wheel.data.distance = 45;
  wheel.update({ spokeCount: 4, distance: 6, angle: 0 });

  assert.equal(wheel.el.object3D.position.z, -45);
  assert.equal(wheel.hub, originalHub);
  assert.equal(wheel.targets.length, 4);
});

test('large stationary galleries stagger targets across depth and height', () => {
  const group = Object.assign(Object.create(definitions['target-group']), {});
  const layout = group.buildLayout(24, 5);

  assert.equal(layout.length, 24);
  assert.ok(new Set(layout.map((spot) => spot.z)).size > 1);
  assert.ok(new Set(layout.map((spot) => spot.standHeight)).size > 2);
  assert.ok(Math.max(...layout.map((spot) => spot.x)) - Math.min(...layout.map((spot) => spot.x)) > 8);
  const angles = layout.map((spot) => Math.atan2(spot.x, -spot.z) * 180 / Math.PI);
  assert.ok(Math.min(...angles) <= -59.9);
  assert.ok(Math.max(...angles) >= 59.9);
});

test('maximum conveyors split into four alternating directions', () => {
  const component = Object.assign(Object.create(definitions['conveyor-target']), {
    el: new FakeEntity(),
    data: {
      count: 24, conveyorCount: 4, length: 6, speed: 0.45, direction: 1,
      height: 1.3, targetScale: 1, angle: 0, distance: 30,
    },
  });
  component.init();

  assert.equal(component.targets.length, 24);
  assert.deepEqual([...new Set(component.targets.map((target) => target._conveyorDirection))], [1, -1]);
  assert.equal(new Set(component.targets.map((target) => target.attributes.position.y)).size, 4);
});

test('pop-up targets span a 120-degree arc at staggered distances', () => {
  const component = Object.assign(Object.create(definitions['popper-target']), {
    el: new FakeEntity(),
    data: {
      count: 24, spacing: 0.8, upHeight: 1.1, downHeight: -0.5,
      targetScale: 1, cycleMinMs: 2000, cycleMaxMs: 4500,
      upDurationMs: 2200, angle: 0, distance: 30,
    },
  });
  component.init();

  const angles = component.poppers.map((popper) => Math.atan2(popper.x, -popper.z) * 180 / Math.PI);
  const distances = component.poppers.map((popper) => Math.round(Math.hypot(popper.x, popper.z)));
  assert.ok(Math.min(...angles) <= -59.9);
  assert.ok(Math.max(...angles) >= 59.9);
  assert.deepEqual([...new Set(distances)].sort(), [29, 30, 31]);
});
