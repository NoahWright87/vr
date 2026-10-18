import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const definitions = {};
const context = vm.createContext({
  AFRAME: { registerShader() {} },
  registerComponent(name, definition) { definitions[name] = definition; },
});
for (const file of ['world-day-night.js', 'world-menu.js']) {
  vm.runInContext(readFileSync(new URL('../games/pistols-at-dawn/js/' + file, import.meta.url), 'utf8'), context);
}

function mesh(radius = 1) {
  return { isMesh: true, userData: {}, material: {}, geometry: { boundingSphere: { radius } }, scale: { x: 1, y: 1, z: 1 } };
}
function owner(player = false, menu = false) {
  return { tagName: 'A-BOX', closest(selector) { return selector === '#player-rig' ? player : menu; } };
}

test('environment excludes hands and small props; all includes them but never menus', () => {
  const cycle = Object.assign(Object.create(definitions['day-night-cycle']), { shadowMode: 'environment', lowPowerShadows: false });
  assert.equal(cycle.shouldCastShadow(mesh(), owner()), true);
  assert.equal(cycle.shouldCastShadow(mesh(), owner(true)), false);
  assert.equal(cycle.shouldCastShadow(mesh(0.05), owner()), false);
  cycle.shadowMode = 'all';
  assert.equal(cycle.shouldCastShadow(mesh(), owner(true)), true);
  assert.equal(cycle.shouldReceiveShadow(mesh(), owner(true)), true);
  assert.equal(cycle.shouldCastShadow(mesh(0.05), owner()), true);
  assert.equal(cycle.shouldCastShadow(mesh(), owner(true, true)), false);
});

test('none disables shadow maps and world casters/receivers', () => {
  const object = mesh();
  object.el = owner();
  const writes = [];
  const cycle = Object.assign(Object.create(definitions['day-night-cycle']), {
    sunShadows: true, moonShadows: true,
    sun: { castShadow: false }, moon: { castShadow: false },
    el: { renderer: { shadowMap: { enabled: true } }, systems: { shadow: { setShadowMapEnabled(value) { writes.push(value); } } } },
    scene: { traverse(callback) { callback(object); } },
  });
  cycle.applyShadowState(true);
  assert.equal(cycle.el.renderer.shadowMap.enabled, false);
  assert.equal(object.castShadow, false);
  assert.equal(object.receiveShadow, false);
  assert.deepEqual(writes, [false]);
});

test('changing shadow mode forces reassignment even when a light stays above the horizon', () => {
  const calls = [];
  const cycle = Object.assign(Object.create(definitions['day-night-cycle']), {
    applyLighting() { calls.push('lighting'); },
    applyShadowState(force) { calls.push(force); },
  });
  cycle.setShadowMode('all');
  assert.equal(cycle.shadowMode, 'all');
  assert.deepEqual(calls, ['lighting', true]);
  cycle.setShadowMode('invalid');
  assert.equal(calls.length, 2);
});

test('new menu events route environment choices and wait to persistent components', () => {
  const calls = [];
  const menu = Object.assign(Object.create(definitions['pistols-watch-menu']), {
    el: { components: {
      'day-night-cycle': {
        setShadowMode(v) { calls.push(['mode', v]); },
        setShadow(body, v) { calls.push([body, v]); },
        waitOneHour() { calls.push(['wait']); },
      },
      'weather-clouds': { setQuality(v) { calls.push(['clouds', v]); } },
    } },
  });
  for (const [id, value] of [['pistols-shadow-mode', 'off'], ['pistols-sun-shadows', false], ['pistols-moon-shadows', true], ['pistols-cloud-quality', '3d']]) {
    menu.onCommit({ detail: { id, value } });
  }
  menu.onAction({ detail: { id: 'pistols-wait-hour' } });
  assert.deepEqual(calls, [['mode', 'off'], ['sun', false], ['moon', true], ['clouds', '3d'], ['wait']]);
});
