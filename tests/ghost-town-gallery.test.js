import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gallery = readFileSync(new URL('../games/pistols-at-dawn/js/world-ghost-town-gallery.js', import.meta.url), 'utf8');
const targets = readFileSync(new URL('../games/pistols-at-dawn/js/world-targets.js', import.meta.url), 'utf8');

test('the indoor Ghost Town gallery uses resettable existing target groups', () => {
  assert.match(gallery, /registerComponent\('ghost-town-gallery'/);
  assert.match(gallery, /registerComponent\('shooting-gallery-interior'/);
  assert.match(gallery, /target-group', 'count: 5; distance: 12/);
  assert.match(gallery, /shooting-gallery-exit-door/);
  assert.match(targets, /registerComponent\('target-group'/);
  assert.match(targets, /registerComponent\('pop-target'/);
  assert.match(targets, /standUp\(\)/);
});
