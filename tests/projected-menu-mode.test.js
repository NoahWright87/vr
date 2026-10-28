import assert from 'node:assert/strict';
import test from 'node:test';

import { chooseAutomaticMenuIntent, chooseProjectedMenuMode, chooseAutoClose, resolveAutoClose } from '../common/projected-menu-mode.js';

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

test('watch automatic mode opens, holds, and closes at the three wrist poses', () => {
  const automaticOptions = { ...options, closeDistance: 2.5 };
  assert.equal(chooseAutomaticMenuIntent('auto', { distance: 0.4, dotUp: 0.2, dotCam: 0.7 }, automaticOptions), 'open');
  assert.equal(chooseAutomaticMenuIntent('auto', { distance: 0.4, dotUp: 0.7, dotCam: 0.5 }, automaticOptions), 'hold');
  assert.equal(chooseAutomaticMenuIntent('auto', { distance: 0.4, dotUp: 0.2, dotCam: 0.2 }, automaticOptions), 'close');
});

test('fixed menus use automatic mode as proximity open and close', () => {
  const automaticOptions = { ...options, closeDistance: 2.5 };
  assert.equal(chooseAutomaticMenuIntent('laser', { distance: 2, dotUp: 0, dotCam: 0 }, automaticOptions), 'open');
  assert.equal(chooseAutomaticMenuIntent('laser', { distance: 3, dotUp: 0, dotCam: 0 }, automaticOptions), 'close');
});

test('auto-close waits for the hand to stay away, and restarts when it comes back', () => {
  const o = { distance: 0.3, delay: 350 };
  let s = chooseAutoClose(null, 0.1, 0, o);
  assert.deepEqual(s, { awaySince: null, close: false });
  s = chooseAutoClose(s.awaySince, 0.5, 100, o);
  assert.deepEqual(s, { awaySince: 100, close: false });
  s = chooseAutoClose(s.awaySince, 0.5, 300, o);
  assert.equal(s.close, false);
  // back in range before the delay: the clock resets
  s = chooseAutoClose(s.awaySince, 0.2, 400, o);
  assert.equal(s.awaySince, null);
  s = chooseAutoClose(s.awaySince, 0.6, 500, o);
  s = chooseAutoClose(s.awaySince, 0.6, 849, o);
  assert.equal(s.close, false);
  s = chooseAutoClose(s.awaySince, 0.6, 850, o);
  assert.equal(s.close, true);
});

test('the player preference overrides each menu\'s own auto-close default', () => {
  assert.equal(resolveAutoClose(true, 'menu'), true);
  assert.equal(resolveAutoClose(false, 'menu'), false);
  assert.equal(resolveAutoClose(true, 'stay'), false);
  assert.equal(resolveAutoClose(false, 'close'), true);
  assert.equal(resolveAutoClose(true, undefined), true);
});
