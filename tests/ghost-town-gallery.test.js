import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const gallery = readFileSync(new URL('../games/pistols-at-dawn/js/world-ghost-town-gallery.js', import.meta.url), 'utf8');
const targets = readFileSync(new URL('../games/pistols-at-dawn/js/world-targets.js', import.meta.url), 'utf8');

test('Ghost Town gallery uses resettable existing target groups', () => {
  assert.match(gallery, /registerComponent\('ghost-town-gallery'/);
  assert.match(gallery, /target-group', 'count: 3; distance: 2\.4'/);
  assert.match(targets, /registerComponent\('target-group'/);
  assert.match(targets, /registerComponent\('pop-target'/);
  assert.match(targets, /standUp\(\)/);
});
