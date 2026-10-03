import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInputDeadzone,
  createStandardGamepadButtonBindings,
} from '../common/input-router.js';

test('gamepad deadzones remove drift and rescale useful stick travel', () => {
  assert.equal(applyInputDeadzone(0.1, 0.2), 0);
  assert.equal(applyInputDeadzone(-0.2, 0.2), 0);
  assert.equal(applyInputDeadzone(1, 0.2), 1);
  assert.equal(applyInputDeadzone(-1, 0.2), -1);
  assert.ok(Math.abs(applyInputDeadzone(0.6, 0.2) - 0.5) < 1e-9);
});

test('gamepad deadzones clamp unsafe configuration values', () => {
  assert.equal(applyInputDeadzone(0.5, 2), 0);
  assert.equal(applyInputDeadzone(0.5, -1), 0.5);
});

test('standard gamepad buttons map to semantic actions and triggers remain chargeable', () => {
  const bindings = createStandardGamepadButtonBindings({
    primary: 'jab',
    secondary: 'uppercut',
    interact: 'activate',
    grab: 'grab',
    watch: 'menu',
    back: 'back',
    crouch: 'crouch',
  });

  assert.equal(bindings[0], 'jab'); // A / Cross
  assert.equal(bindings[2], 'activate'); // X / Square
  assert.equal(bindings[4], 'grab'); // LB / L1
  assert.equal(bindings[6], 'uppercut'); // LT / L2
  assert.equal(bindings[7], 'jab'); // RT / R2
  assert.equal(bindings[9], 'menu'); // Start / Options
  assert.equal(bindings[10], 'crouch'); // Left stick click
});

test('a game can reserve left stick click for sprinting', () => {
  const bindings = createStandardGamepadButtonBindings({ sprint: 'sprint', crouch: 'crouch' });
  assert.equal(bindings[10], 'sprint');
});
