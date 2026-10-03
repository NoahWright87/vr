import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/boundaries/index.html', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

test('Boundary Lab is built as an experience and starts with shared watch hands', () => {
  assert.match(viteConfig, /boundaries: resolve\(root, 'games\/boundaries\/index\.html'\)/);
  assert.match(page, /src="\.\.\/\.\.\/common\/watch-menu\.js"/);
  assert.match(page, /<template id="watch-menu-template">/);

  ['left-hand', 'right-hand'].forEach((id) => {
    const hand = page.match(new RegExp('<a-entity id="' + id + '"[^>]*>'))[0];
    assert.ok(hand.indexOf('hand-with-watch') < hand.indexOf('semantic-hand'));
  });
});

test('Boundary Lab uses the headset-reported bounded floor rather than a guessed room box', () => {
  assert.match(page, /applyCheckerTexture\(document\.querySelector\('#boundary-floor'\), '#263550', '#1c2940', 15, 15\)/);
  assert.match(page, /requestReferenceSpace\('bounded-floor'\)/);
  assert.match(page, /boundsGeometry/);
  assert.match(page, /frame\.getPose\(this\.boundedSpace, baseSpace\)/);
  assert.match(page, /this\.renderRoot = this\.el\.sceneEl\.object3D/);
  assert.match(page, /Cyan line = exact detected outline/);
});
