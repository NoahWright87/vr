import test from 'node:test';
import assert from 'node:assert/strict';

import {
  controlModeMatches,
  normalizeControlMode,
  parseControlModes,
} from '../common/control-mode.js';

test('control modes normalize VR and keyboard aliases to two canonical modes', () => {
  assert.equal(normalizeControlMode('vr'), 'xr');
  assert.equal(normalizeControlMode('XR'), 'xr');
  assert.equal(normalizeControlMode('keyboard'), 'desktop');
  assert.equal(normalizeControlMode('mouse-keyboard'), 'desktop');
  assert.equal(normalizeControlMode('non-xr'), 'desktop');
  assert.equal(normalizeControlMode('gamepad'), null);
});

test('control-mode visibility accepts lists without duplicating aliases', () => {
  assert.deepEqual(parseControlModes('vr | xr, keyboard'), ['xr', 'desktop']);
  assert.equal(controlModeMatches('desktop', 'keyboard|vr'), true);
  assert.equal(controlModeMatches('xr', 'keyboard|non-xr'), false);
});
