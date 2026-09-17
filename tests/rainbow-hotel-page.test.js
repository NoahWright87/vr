import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/rainbow-hotel/index.html', import.meta.url), 'utf8');
const experience = readFileSync(new URL('../games/rainbow-hotel/js/hotel-experience.js', import.meta.url), 'utf8');
const architecture = readFileSync(new URL('../games/rainbow-hotel/js/hotel-architecture.js', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const landing = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('the prototype is wired into the build and the landing page', () => {
  assert.match(viteConfig, /rainbowHotel: resolve\(root, 'games\/rainbow-hotel\/index\.html'\)/);
  assert.match(landing, /href="\/games\/rainbow-hotel\/"/);
  assert.match(page, /AFRAME_CDN_ROOT = '\.\.\/\.\.\/vendor\/aframe-1\.6\.0\/'/);
  assert.match(page, /src="\.\.\/\.\.\/vendor\/aframe-1\.6\.0\/aframe-v1\.6\.0\.min\.js"/);
});

test('lighting cannot betray the rise: ambient and directional only, no shadows', () => {
  // A point light near the shaft would shade the hallway's walls
  // differently at every height it passed through, which is the single
  // cue this whole design exists to withhold. Same for a shadow.
  assert.match(page, /light="type: ambient/);
  assert.match(page, /light="type: directional/);
  assert.doesNotMatch(page, /type: point/);
  assert.doesNotMatch(page, /type: spot/);
  assert.doesNotMatch(page, /castShadow: true/);
  assert.doesNotMatch(architecture, /type: point/);
  assert.doesNotMatch(architecture, /type: spot/);
  // The hallway's own lighting is an emissive surface, not a light.
  assert.match(architecture, /hotel-hallway-lamp/);
  assert.match(architecture, /hotel-hallway-sconce/);
});

test('the rise is driven by walked distance, never by a clock', () => {
  // A timed rise would keep climbing while the player stood still, and
  // would reach the far doorway out of step with them.
  assert.match(experience, /floorHeight \* state\.rise/);
  assert.match(experience, /hallwayProgress\(plan, x, z\)/);
  assert.doesNotMatch(experience, /setInterval/);
  assert.doesNotMatch(experience, /Date\.now\(\)/);
  // tick() must not feed the head's height back into the thing that
  // sets the head's height.
  assert.match(experience, /this\.step\(this\.headLocal\.x, this\.headLocal\.z\)/);
});

test('the player rig and the hallway are moved together, from one number', () => {
  assert.match(experience, /applyFloorY: function \(floorY\)[\s\S]*?hallway\.object3D\.position\.y = floorY;[\s\S]*?rigEl\.object3D\.position\.y = floorY;/);
});

test('the shared checkerboard and Guardian modules are reused, not re-implemented', () => {
  assert.match(architecture, /import '\.\.\/\.\.\/\.\.\/common\/checkerboard\.js'/);
  assert.match(experience, /from '\.\.\/\.\.\/\.\.\/common\/guardian-bounds\.js'/);
  assert.match(architecture, /checkerboard: 'color: ' \+ floor\.wall/);
  // No second copy of "make a canvas, fill two rects, tile it".
  assert.doesNotMatch(architecture, /fillRect\(0, 0, 64, 64\)[\s\S]{0,200}fillRect\(32, 32/);
});

test('the settings panel is built from the same list the runtime reads', () => {
  assert.match(experience, /export var TUNABLES/);
  assert.match(page, /TUNABLES\.forEach/);
  for (const key of ['floorHeight', 'baffles', 'laneWidth', 'stubDepth', 'passGap', 'doorWidth']) {
    assert.match(experience, new RegExp(`key: '${key}'`));
  }
  // Settings persist locally, which is how they can be set on the flat
  // page of a Quest and still be there after Enter VR.
  assert.match(experience, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(experience, /localStorage\.getItem\(STORAGE_KEY/);
});

test('the in-headset readout is off by default', () => {
  // The question being asked is whether the *windows* tell you which
  // floor you are on. A caption saying "Green, floor 4" answers it for
  // the player and invalidates the test.
  assert.match(experience, /debug: \{ default: false \}/);
  assert.match(page, /id="debug"/);
});

test('the POC really does stop at walking: no interactions are wired up', () => {
  // Explicitly out of scope per the spec -- hand tracking, grabbing,
  // doors, anything to trigger. Checked against the scene markup alone,
  // since the flat page around it is allowed its own buttons.
  const scene = page.slice(page.indexOf('<a-scene'), page.indexOf('</a-scene>'));
  assert.ok(scene.length > 100, 'found the scene markup');
  for (const absent of ['hand-controls', 'oculus-touch-controls', 'laser-controls', 'raycaster', 'cursor', 'grab']) {
    assert.doesNotMatch(scene, new RegExp(absent), `${absent} should not be in the scene`);
  }
});
