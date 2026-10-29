import assert from 'node:assert/strict';
import test from 'node:test';

import { scrimAlpha, scrimWanted, readMotion, cleanScrim, SCRIM_DEFAULTS } from '../common/comfort-scrim.js';

test('the wash is the same on both sides', () => {
  const s = cleanScrim(SCRIM_DEFAULTS);
  for (const x of [0.5, 0.7, 0.8, 0.9, 1]) {
    assert.equal(scrimAlpha(-x, 0, s), scrimAlpha(x, 0, s));
  }
});

test('clear in the middle, solid at the edge, a smooth fade between', () => {
  const s = cleanScrim({ size: 0.4, darkness: 0.8, softness: 0.5 });
  assert.equal(scrimAlpha(0, 0, s), 0);
  assert.equal(scrimAlpha(0.6, 0, s), 0); // the inner edge
  assert.equal(scrimAlpha(0.8, 0, s), 0.8); // solid from 0.6 + 0.4 * 0.5
  assert.equal(scrimAlpha(1, 0, s), 0.8);
  let last = 0;
  for (let x = 0.6; x <= 0.8; x += 0.02) {
    const a = scrimAlpha(x, 0, s);
    assert.ok(a >= last - 1e-12);
    last = a;
  }
});

test('sides leave the top and bottom alone; a tunnel does not', () => {
  const sides = cleanScrim({ shape: 'sides', size: 0.3 });
  const tunnel = cleanScrim({ shape: 'tunnel', size: 0.3 });
  assert.equal(scrimAlpha(0, 0.95, sides), 0);
  assert.ok(scrimAlpha(0, 0.95, tunnel) > 0);
  // Bigger reaches further in; darker is darker.
  assert.ok(scrimAlpha(0.6, 0, cleanScrim({ size: 0.6 })) > scrimAlpha(0.6, 0, cleanScrim({ size: 0.3 })));
  assert.ok(scrimAlpha(1, 0, cleanScrim({ darkness: 1 })) > scrimAlpha(1, 0, cleanScrim({ darkness: 0.4 })));
});

test('when it shows', () => {
  const none = { menu: false, moving: false };
  const menu = { menu: true, moving: false };
  const moving = { menu: false, moving: true };
  assert.equal(scrimWanted('never', { menu: true, moving: true }), 0);
  assert.equal(scrimWanted('always', none), 1);
  assert.equal(scrimWanted('menus', menu), 1);
  assert.equal(scrimWanted('menus', moving), 0);
  assert.equal(scrimWanted('moving', moving), 1);
  assert.equal(scrimWanted('moving', menu), 0);
  assert.equal(scrimWanted('menus-moving', menu), 1);
  assert.equal(scrimWanted('menus-moving', moving), 1);
  assert.equal(scrimWanted('menus-moving', none), 0);
});

test('moving means the rig is moved smoothly; jumps and stillness are not', () => {
  const at = (x, z, yaw, t) => ({ x, y: 0, z, yaw, t });
  // Walking with the stick: 1.5 m/s.
  assert.equal(readMotion(at(0, 0, 0, 0), at(0, 0.021, 0, 14), {}).moving, true);
  // Standing still (your head moving does not move the rig).
  assert.equal(readMotion(at(0, 0, 0, 0), at(0, 0.001, 0, 14), {}).moving, false);
  // A teleport: two metres in one frame.
  assert.equal(readMotion(at(0, 0, 0, 0), at(0, 2, 0, 14), {}).moving, false);
  // Smooth turning, ~1.25 rad/s.
  assert.equal(readMotion(at(0, 0, 0, 0), at(0, 0, 0.0175, 14), {}).moving, true);
  // ...unless turning does not count (the mouse, off a headset).
  assert.equal(readMotion(at(0, 0, 0, 0), at(0, 0, 0.0175, 14), { turns: false }).moving, false);
  // A 30 degree snap turn in one frame.
  assert.equal(readMotion(at(0, 0, 0, 0), at(0, 0, Math.PI / 6, 14), {}).moving, false);
  // Turning across the +-pi seam is still small.
  assert.equal(readMotion(at(0, 0, Math.PI - 0.005, 0), at(0, 0, -Math.PI + 0.005, 14), {}).turn < 1, true);
});

test('settings are kept in range', () => {
  const s = cleanScrim({ show: 'sometimes', shape: 'blob', size: 5, darkness: -1, softness: 'x' });
  assert.equal(s.show, SCRIM_DEFAULTS.show);
  assert.equal(s.shape, SCRIM_DEFAULTS.shape);
  assert.equal(s.size, 0.9);
  assert.equal(s.darkness, 0.1);
  assert.equal(s.softness, SCRIM_DEFAULTS.softness);
});
