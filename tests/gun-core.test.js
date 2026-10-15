import assert from 'node:assert/strict';
import test from 'node:test';

import { WEAPONS, createFireControl, pressTrigger, releaseTrigger, heldShots, reload, pelletDirections } from '../common/gun-core.js';

const { pistol, smg, shotgun } = WEAPONS;

test('a pistol fires once per pull, as fast as you can pull', () => {
  const fc = createFireControl(pistol);
  let fired = 0;
  // Ten pulls 60 ms apart: faster than the old autofire's 4/s by a mile.
  for (let i = 0; i < 10; i++) {
    fired += pressTrigger(fc, pistol, i * 60).fired;
    releaseTrigger(fc);
    fired += heldShots(fc, pistol, 60, false, i * 60 + 30).fired; // holding a semi-auto does nothing
  }
  assert.equal(fired, 10);
  assert.equal(fc.ammo, 2);
});

test('pulls faster than the minimum interval are ignored, not queued', () => {
  const fc = createFireControl(pistol);
  assert.equal(pressTrigger(fc, pistol, 0).fired, 1);
  assert.equal(pressTrigger(fc, pistol, 10).fired, 0);
  assert.equal(pressTrigger(fc, pistol, 40).fired, 1);
});

test('the shotgun is pump-limited', () => {
  const fc = createFireControl(shotgun);
  assert.equal(pressTrigger(fc, shotgun, 0).fired, 1);
  assert.equal(pressTrigger(fc, shotgun, 150).fired, 0);
  assert.equal(pressTrigger(fc, shotgun, 300).fired, 1);
});

test('an SMG fires on the pull and keeps going while held', () => {
  const fc = createFireControl(smg);
  let fired = pressTrigger(fc, smg, 0).fired;
  for (let t = 16; t <= 1000; t += 16) fired += heldShots(fc, smg, 16, false, t).fired;
  // One on the pull plus ~13 a second.
  assert.ok(fired >= 13 && fired <= 15, String(fired));
  releaseTrigger(fc);
  const after = heldShots(fc, smg, 500, false, 1500).fired;
  assert.equal(after, 0);
});

test('autofire fires at the weapon rate with no trigger', () => {
  const fc = createFireControl(pistol);
  let fired = 0;
  for (let t = 0; t < 1000; t += 16) fired += heldShots(fc, pistol, 16, true, t).fired;
  assert.ok(fired >= 6 && fired <= 7, String(fired));
});

test('an empty gun clicks dry, and infinite ammo never runs out', () => {
  const fc = createFireControl(pistol);
  fc.ammo = 1;
  assert.deepEqual(pressTrigger(fc, pistol, 0), { fired: 1, dry: false });
  assert.deepEqual(pressTrigger(fc, pistol, 100), { fired: 0, dry: true });
  fc.ammo = 0;
  assert.equal(pressTrigger(fc, pistol, 200, true).fired, 1);
  assert.equal(fc.ammo, 0);
  reload(fc, pistol);
  assert.equal(fc.ammo, 12);
});

test('a hitch never fires more than 4 at once', () => {
  const fc = createFireControl(smg);
  pressTrigger(fc, smg, 0);
  assert.equal(heldShots(fc, smg, 5000, false, 5000).fired, 4);
});

test('shotgun pellets: the first goes straight, the rest within the spread', () => {
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const dirs = pelletDirections({ x: 0, y: 0, z: -1 }, shotgun, rand);
  assert.equal(dirs.length, 6);
  assert.deepEqual(dirs[0], { x: 0, y: 0, z: -1 });
  for (const d of dirs) {
    const angle = Math.acos(-d.z) * 180 / Math.PI;
    assert.ok(angle <= shotgun.spreadDeg + 1e-6, String(angle));
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-9);
  }
});
