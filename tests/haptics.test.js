import assert from 'node:assert/strict';
import test from 'node:test';

import { getHapticOutput, pulseHaptics } from '../common/haptics.js';

function handWith(gamepad) {
  return {
    components: { 'tracked-controls': { controller: gamepad } },
    getAttribute(name) {
      return name === 'hand-with-watch' ? { hand: 'left' } : null;
    },
  };
}

test('uses the modern vibration actuator with a clamped dual-rumble effect', async () => {
  let received;
  const output = getHapticOutput(handWith({
    vibrationActuator: {
      playEffect(type, options) {
        received = { type, options };
        return Promise.resolve('complete');
      },
    },
  }));

  assert.equal(output.type, 'vibration-actuator');
  const result = await pulseHaptics(handWith({ vibrationActuator: output.actuator }), 4, 250.4);
  assert.deepEqual(result, { status: 'sent', api: 'vibration-actuator' });
  assert.deepEqual(received, {
    type: 'dual-rumble',
    options: { duration: 250, startDelay: 0, strongMagnitude: 1, weakMagnitude: 1 },
  });
});

test('falls back to the legacy WebXR haptic actuator', async () => {
  let received;
  const result = await pulseHaptics(handWith({
    hapticActuators: [{
      pulse(intensity, duration) {
        received = { intensity, duration };
        return Promise.resolve(true);
      },
    }],
  }), 0.2, 250);

  assert.deepEqual(result, { status: 'sent', api: 'haptic-actuator' });
  assert.deepEqual(received, { intensity: 0.2, duration: 250 });
});

test('reports unavailable and rejected hardware requests without throwing', async () => {
  assert.deepEqual(await pulseHaptics(handWith({}), 0.6, 250), { status: 'unavailable' });
  assert.deepEqual(await pulseHaptics(handWith({
    hapticActuators: [{ pulse() { return Promise.resolve(false); } }],
  }), 0.6, 250), { status: 'rejected', api: 'haptic-actuator' });
});
