import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/pistols-at-dawn/index.html', import.meta.url), 'utf8');

// A-Frame inits an entity's attribute components in source order, and
// semantic-hand's init() (common/interaction-hints.js) looks up
// hand-with-watch's wrapperEl synchronously to parent its desktop-only
// cosmetic hand inside the watch's corrective rotation. Declared the other
// way around, semantic-hand falls back to parenting directly on the hand
// entity with the wrong orientation -- half of the "two hands, one
// misaligned" bug seen in real VR. primitives/menus/index.html already has
// the correct order; Pistols must match it.
test('hand-with-watch is declared before semantic-hand on both hands', () => {
  const leftHand = page.match(/<a-entity id="left-hand"[^>]*>/)[0];
  const rightHand = page.match(/<a-entity id="right-hand"[^>]*>/)[0];
  [leftHand, rightHand].forEach((tag) => {
    const watchIndex = tag.indexOf('hand-with-watch');
    const semanticIndex = tag.indexOf('semantic-hand');
    assert.ok(watchIndex !== -1 && semanticIndex !== -1, `expected both components on ${tag}`);
    assert.ok(watchIndex < semanticIndex, `expected hand-with-watch before semantic-hand in ${tag}`);
  });
});
