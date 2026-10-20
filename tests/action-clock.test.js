import assert from 'node:assert/strict';
import test from 'node:test';

import { createClock, advanceClock, setTimeScale, hitStop, isStopped, scaledDt } from '../common/action-clock.js';

test('world time runs at the time scale; the player always runs at real time', () => {
  const clock = createClock();
  setTimeScale(clock, 0.25, 0);
  assert.equal(advanceClock(clock, 16), 4);
  assert.equal(scaledDt(clock, 16, 'enemy', false), 4);
  assert.equal(scaledDt(clock, 16, 'hand', true), 16);
});

test('a time-scale ramp eases from the old scale to the new one', () => {
  const clock = createClock();
  setTimeScale(clock, 0.2, 200);
  advanceClock(clock, 100); // halfway
  assert.ok(clock.timeScale < 1 && clock.timeScale > 0.2, String(clock.timeScale));
  advanceClock(clock, 100);
  assert.equal(clock.timeScale, 0.2);
  advanceClock(clock, 100);
  assert.equal(clock.timeScale, 0.2);
});

test('hit-stop freezes only the stopped key, and only for its duration', () => {
  const clock = createClock();
  hitStop(clock, 'dummy', 50);
  assert.equal(scaledDt(clock, 16, 'dummy'), 0);
  assert.equal(scaledDt(clock, 16, 'other'), 16);
  advanceClock(clock, 40);
  assert.ok(isStopped(clock, 'dummy'));
  advanceClock(clock, 20);
  assert.equal(isStopped(clock, 'dummy'), false);
  assert.equal(scaledDt(clock, 16, 'dummy'), 16);
});

test('a shorter hit-stop never cuts a longer one short', () => {
  const clock = createClock();
  hitStop(clock, 'dummy', 100);
  hitStop(clock, 'dummy', 10);
  advanceClock(clock, 50);
  assert.ok(isStopped(clock, 'dummy'));
});
