import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/pistols-at-dawn/index.html', import.meta.url), 'utf8');
const core = readFileSync(new URL('../games/pistols-at-dawn/js/core.js', import.meta.url), 'utf8');
const hands = readFileSync(new URL('../games/pistols-at-dawn/js/core-hand-rig.js', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../games/pistols-at-dawn/js/world-menu.js', import.meta.url), 'utf8');
const dayNight = readFileSync(new URL('../games/pistols-at-dawn/js/world-day-night.js', import.meta.url), 'utf8');

const definitions = {};
globalThis.registerComponent = (name, definition) => { definitions[name] = definition; };
await import('../games/pistols-at-dawn/js/world-menu.js');

test('hot interaction lists use the mutation-invalidated scene index', () => {
  assert.match(page, /<a-scene pistols-watch-menu area-manager scene-index day-night-cycle weather-clouds hotbar-equip light="defaultLightsEnabled: false" shadow="enabled: true; type: pcfsoft">/);
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

test('environment lighting replaces A-Frame defaults and shadows only world geometry', () => {
  assert.match(page, /light="defaultLightsEnabled: false"/);
  assert.match(dayNight, /this\.findOwnerElement\(object\)/);
  assert.match(dayNight, /this\.sun\.visible = sunAboveHorizon/);
  assert.match(dayNight, /this\.moon\.visible = moonAboveHorizon/);
  assert.match(dayNight, /owner\.closest\('#player-rig'\)/);
  assert.match(dayNight, /object\.castShadow = any && this\.shouldCastShadow/);
  assert.match(dayNight, /object\.receiveShadow = any && this\.shouldReceiveShadow/);
  assert.match(dayNight, /tag === 'A-PLANE' \|\| tag === 'A-TEXT'/);
  assert.match(dayNight, /this\.hasTransparentMaterial\(object\)/);
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

test('weather clouds default to one alpha-tested sprite card per group', () => {
  assert.match(dayNight, /quality: \{ type: 'string', default: 'sprites' \}/);
  assert.match(dayNight, /this\.cloudSpriteGeometry = new THREE\.BufferGeometry\(\)/);
  assert.match(dayNight, /var vertexCount = groupCount \* 6/);
  assert.match(dayNight, /alphaTest: 0\.2/);
  assert.match(dayNight, /transparent: false/);
  assert.match(dayNight, /geometry\.setDrawRange\(0, visibleCount \* 6\)/);
  assert.match(dayNight, /this\.cloudSpriteMesh\.castShadow = false/);
  assert.match(dayNight, /this\.cloudSpriteMesh\.receiveShadow = false/);
  assert.match(page, /menu-option="key: cloud-quality; label: Clouds; values: off\|sprites\|3d; labels: Off\|Sprites\|3D; value: sprites"/);
  assert.match(menu, /weather\.setQuality\(evt\.detail\.value\)/);
});

test('optional 3D clouds remain one opaque, very-low-poly instanced batch', () => {
  assert.match(dayNight, /new THREE\.DodecahedronGeometry\(0\.5, 0\)/);
  assert.match(dayNight, /this\.cloudMesh = new THREE\.InstancedMesh/);
  assert.match(dayNight, /maxCloudSlots = this\.data\.groupCount \* this\.data\.maxCloudsPerGroup/);
  assert.doesNotMatch(dayNight, /instanceOpacity|cloudOpacity/);
  assert.doesNotMatch(dayNight, /new THREE\.MeshLambertMaterial\(\{[\s\S]{0,160}transparent: true/);
  assert.doesNotMatch(dayNight, /cloudMeshes/);
});

test('Pistols texture assets stay within the standalone-headset budget', () => {
  const textureDirectory = new URL('../games/pistols-at-dawn/assets/textures/', import.meta.url);
  for (const filename of readdirSync(textureDirectory).filter(name => name.endsWith('.png'))) {
    const png = readFileSync(new URL(filename, textureDirectory));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert.ok(width <= 1024 && height <= 512, `${filename} is ${width}x${height}`);
    if (filename === 'weather-cloud-underside-atlas-v1.png') {
      assert.equal(png[25], 6, 'cloud atlas must preserve RGBA transparency');
    }
  }
});
