import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseProjectedMenuMode } from '../common/projected-menu-mode.js';

const options = {
  faceupThreshold: 0.6,
  facecamThreshold: 0.45,
  hysteresis: 0.12,
};

test('laser mode does not flap near the face-up threshold', () => {
  assert.equal(chooseProjectedMenuMode('laser', 0.55, 0.8, options), 'laser');
  assert.equal(chooseProjectedMenuMode('laser', 0.49, 0.8, options), 'laser');
  assert.equal(chooseProjectedMenuMode('laser', 0.47, 0.8, options), 'poke');
});

test('poke mode does not flap near the face-camera threshold', () => {
  assert.equal(chooseProjectedMenuMode('poke', 0.4, 0.4, options), 'poke');
  assert.equal(chooseProjectedMenuMode('poke', 0.71, 0.8, options), 'poke');
  assert.equal(chooseProjectedMenuMode('poke', 0.73, 0.8, options), 'laser');
});

test('a closed menu still uses the configured entry thresholds', () => {
  assert.equal(chooseProjectedMenuMode('closed', 0.61, 0.2, options), 'laser');
  assert.equal(chooseProjectedMenuMode('closed', 0.2, 0.46, options), 'poke');
  assert.equal(chooseProjectedMenuMode('closed', 0.2, 0.3, options), null);
});
