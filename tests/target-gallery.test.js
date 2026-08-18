import assert from 'node:assert/strict';
import test from 'node:test';

const definitions = {};
globalThis.registerComponent = function (name, definition) {
  definitions[name] = definition;
};

await import('../games/pistols-at-dawn/js/world-menu.js');

function createAdapter() {
  return Object.assign(Object.create(definitions['pistols-watch-menu']), {
    settings: { kind: 'spinner', count: 24, speed: 45, distance: 30 },
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

  assert.deepEqual(adapter.dataForKind('stationary'), { count: 24, distance: 30 });
  assert.deepEqual(adapter.dataForKind('spinner'), {
    spokeCount: 24,
    wheelRadius: 3.12,
    speed: 45,
    targetScale: 1,
    angle: 0,
    distance: 30,
  });
  assert.deepEqual(adapter.dataForKind('conveyor'), {
    count: 24,
    length: 9.6,
    speed: 0.45,
    direction: 1,
    targetScale: 1,
    angle: 0,
    distance: 30,
  });
  assert.deepEqual(adapter.dataForKind('popper'), {
    count: 24,
    cycleMinMs: 2000,
    cycleMaxMs: 4500,
    upDurationMs: 2200,
    targetScale: 1,
    angle: 0,
    distance: 30,
  });
});
