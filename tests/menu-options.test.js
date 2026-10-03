import assert from 'node:assert/strict';
import test from 'node:test';

import { cycleMenuOptionIndex, parseMenuOptions } from '../common/menu-options.js';

test('menu options use explicit labels and fall back to their values', () => {
  assert.deepEqual(parseMenuOptions('15|30|45', 'Slow||Fast'), [
    { value: '15', label: 'Slow' },
    { value: '30', label: '30' },
    { value: '45', label: 'Fast' },
  ]);
});

test('menu option arrows wrap in both directions', () => {
  assert.equal(cycleMenuOptionIndex(4, 3, 1), 0);
  assert.equal(cycleMenuOptionIndex(4, 0, -1), 3);
});
