import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/boundaries/index.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const playSpace = readFileSync(new URL('../common/play-space.js', import.meta.url), 'utf8');

test('Boundary Lab is built as an experience and starts with shared watch hands', () => {
  assert.match(viteConfig, /boundaries: resolve\(root, 'games\/boundaries\/index\.html'\)/);
  assert.match(page, /src="\.\.\/\.\.\/common\/watch-menu\.js"/);
  assert.match(page, /<template id="watch-crossbar-template">/);
  assert.doesNotMatch(page, /<template id="watch-menu-template">/);
  assert.match(page, /visor-menu="page: visor"/);

  ['left-hand', 'right-hand'].forEach((id) => {
    const hand = page.match(new RegExp('<a-entity id="' + id + '"[^>]*>'))[0];
    assert.ok(hand.indexOf('hand-with-watch') < hand.indexOf('semantic-hand'));
  });
});

test('Boundary Lab uses the headset-reported bounded floor rather than a guessed room box', () => {
  assert.match(page, /applyCheckerTexture\(document\.querySelector\('#boundary-floor'\), '#263550', '#1c2940', 15, 15\)/);
  // The reading is shared with the menus showcase; the lab draws it.
  assert.match(page, /src="\.\.\/\.\.\/common\/play-space\.js"/);
  assert.match(page, /play-space-outline/);
  assert.match(playSpace, /this\.renderRoot = this\.el\.sceneEl\.object3D/);
  assert.match(playSpace, /requestReferenceSpace\('bounded-floor'\)/);
  assert.match(playSpace, /boundsGeometry/);
  assert.match(playSpace, /frame\.getPose\(this\.boundedSpace, baseSpace\)/);
  assert.match(playSpace, /Cyan line = exact detected outline/);
});

test('Boundary Lab combines haptics controls with a shared grabbable cube', () => {
  assert.match(page, /id="boundary-grab-cube"/);
  assert.match(page, /simple-grabbable=/);
  assert.match(page, /hint-zone="action: grab; radius: 0\.3/);
  assert.match(page, /grabAction: grab; grabLabel: GRAB/);
  assert.match(page, /grabbable-proximity-haptics="intensity: 0\.35; duration: 45"/);
  assert.match(page, /id: 'boundary-haptics'/);
  // Rows are built per hand and level, as haptic-<hand>-<level> actions.
  assert.match(page, /id: 'haptic-' \+ hand \+ '-' \+ level/);
  assert.match(page, /hapticRows\('left'\)\.concat\(hapticRows\('right'\)\)/);
  assert.match(page, /\^haptic-\(left\|right\)-\(low\|medium\|high\)\$/);
});
