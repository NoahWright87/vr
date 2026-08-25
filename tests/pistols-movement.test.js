import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/pistols-at-dawn/index.html', import.meta.url), 'utf8');
const locomotion = readFileSync(new URL('../common/locomotion.js', import.meta.url), 'utf8');
const desktopInput = readFileSync(new URL('../common/desktop-input.js', import.meta.url), 'utf8');
const desktopControls = readFileSync(new URL('../common/desktop-controls.js', import.meta.url), 'utf8');

test('Pistols at Dawn doubles its walk speed and supports 1.5x sprinting', () => {
  assert.match(page, /locomotion-demo="speed: 3; sprintMultiplier: 1\.5"/);
  assert.match(page, /gamepad-input="[^\"]*sprintAction: sprint"/);
  assert.match(page, /desktop-controls="[^\"]*sprintEnabled: true"/);
  assert.match(page, /hold Shift to run/);
  assert.match(locomotion, /sprintMultiplier: \{ default: 1\.5 \}/);
  assert.match(locomotion, /this\.data\.speed \* this\.data\.speedMultiplier \* \(sprint \? this\.data\.sprintMultiplier : 1\)/);
  assert.match(desktopInput, /sprint: Boolean\(this\.keys\.ShiftLeft \|\| this\.keys\.ShiftRight \|\| this\.keys\.Shift\)/);
  assert.match(desktopControls, /var sprint = this\.data\.sprintEnabled && Boolean\(this\.keys\.ShiftLeft \|\| this\.keys\.ShiftRight\)/);
});
