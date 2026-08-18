import assert from 'node:assert/strict';
import test from 'node:test';

const definitions = {};
globalThis.registerComponent = function (name, definition) {
  definitions[name] = definition;
};

await import('../games/pistols-at-dawn/js/world-menu.js');

function createAdapter() {
  return Object.assign(Object.create(definitions['pistols-watch-menu']), {
    settings: { kind: 'spinner', count: 6, speed: 45, distance: 50 },
  });
}

test('every restored target kind maps to its original gallery component', () => {
  const adapter = createAdapter();
  assert.equal(adapter.componentForKind('stationary'), 'target-group');
  assert.equal(adapter.componentForKind('spinner'), 'wheel-target');
  assert.equal(adapter.componentForKind('conveyor'), 'conveyor-target');
  assert.equal(adapter.componentForKind('popper'), 'popper-target');
});

test('current settings are adapted for each target kind', () => {
  const adapter = createAdapter();

  assert.deepEqual(adapter.dataForKind('stationary'), { count: 6, distance: 50 });
  assert.deepEqual(adapter.dataForKind('spinner'), {
    spokeCount: 6,
    wheelRadius: 0.9,
    speed: 45,
    targetScale: 0.5,
    angle: 0,
    distance: 50,
  });
  assert.deepEqual(adapter.dataForKind('conveyor'), {
    count: 6,
    length: 4.8,
    speed: 0.45,
    direction: 1,
    angle: 0,
    distance: 50,
  });
  assert.deepEqual(adapter.dataForKind('popper'), {
    count: 6,
    cycleMinMs: 2000,
    cycleMaxMs: 4500,
    upDurationMs: 2200,
    angle: 0,
    distance: 50,
  });
});
