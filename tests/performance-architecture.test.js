import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/pistols-at-dawn/index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../games/pistols-at-dawn/js/core.js', import.meta.url), 'utf8');
const hands = readFileSync(new URL('../games/pistols-at-dawn/js/core-hand-rig.js', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../games/pistols-at-dawn/js/world-menu.js', import.meta.url), 'utf8');

const definitions = {};
globalThis.registerComponent = (name, definition) => { definitions[name] = definition; };
await import('../games/pistols-at-dawn/js/world-menu.js');

test('hot interaction lists use the mutation-invalidated scene index', () => {
  assert.match(page, /<a-scene pistols-watch-menu area-manager scene-index>/);
  assert.match(core, /registerComponent\('scene-index'/);
  assert.match(core, /function sceneElements\(selector\)/);
  assert.doesNotMatch(hands, /document\.querySelectorAll\('\.grabbable'\)/);
});

test('proximity haptics are throttled and avoid square roots outside range', () => {
  assert.match(hands, /PROXIMITY_HAPTIC_CHECK_MS = 80/);
  assert.match(hands, /distanceToSquared\(this\.targetPos\)/);
});

test('performance counters are opt-in from the watch', () => {
  assert.match(page, /menu-item="value: toggle-performance; label: Show Performance"/);
  assert.match(page, /id="performance-text"[\s\S]*performance-monitor[\s\S]*visible="false"/);
  assert.match(menu, /if \(!this\.data\.enabled\) return/);
  assert.match(menu, /render\.calls/);
});

test('performance monitor stays idle until enabled and then reports renderer counters', () => {
  const writes = [];
  const monitor = Object.assign(Object.create(definitions['performance-monitor']), {
    data: { enabled: false, intervalMs: 500 },
    el: {
      sceneEl: {
        renderer: {
          info: {
            render: { calls: 42, triangles: 27000 },
            memory: { geometries: 80, textures: 12 },
          },
        },
      },
      setAttribute(...args) { writes.push(args); },
    },
  });

  monitor.init();
  monitor.tick(0, 600);
  assert.equal(writes.length, 0);

  monitor.data.enabled = true;
  monitor.update();
  monitor.tick(0, 500);
  const textWrite = writes.find(args => args[0] === 'text');
  assert.ok(textWrite);
  assert.match(textWrite[2], /Draw 42/);
  assert.match(textWrite[2], /Tri 27k/);
});

test('future models use a simple proxy while visual meshes skip raycasts', () => {
  assert.match(core, /registerComponent\('model-prop'/);
  assert.match(core, /classList\.add\('model-hitbox'\)/);
  assert.match(core, /object\.raycast = ignoreModelRaycast/);
});
