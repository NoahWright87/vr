import assert from 'node:assert/strict';
import test from 'node:test';

import { angleBetween, turnToward, shotsDue, AIM_CONES } from '../common/autofire-core.js';

const DEG = Math.PI / 180;
const v = (x, y, z) => ({ x, y, z });

test('turnToward reaches the target direction when within the cap', () => {
  const out = turnToward(v(0, 0, -1), v(1, 0, 0), 100 * DEG);
  assert.ok(angleBetween(out, v(1, 0, 0)) < 1e-6);
});

test('turnToward stops at the cap, partway, still a unit vector', () => {
  const out = turnToward(v(0, 0, -1), v(1, 0, 0), 30 * DEG);
  assert.ok(Math.abs(angleBetween(out, v(0, 0, -1)) - 30 * DEG) < 1e-6);
  assert.ok(Math.abs(Math.hypot(out.x, out.y, out.z) - 1) < 1e-9);
  assert.ok(out.x > 0);
});

test('shotsDue fires at the rate, carries the remainder, and caps a hitch', () => {
  const state = { cooldown: 0 };
  assert.equal(shotsDue(state, 16, 4), 1); // first shot is immediate
  let total = 1;
  for (let i = 0; i < 62; i++) total += shotsDue(state, 16, 4); // ~1 s more
  assert.equal(total, 5);
  assert.equal(shotsDue({ cooldown: 0 }, 5000, 20), 4);
});

test('aim cones get narrower from wide to tight', () => {
  assert.ok(AIM_CONES.wide > AIM_CONES.soft && AIM_CONES.soft > AIM_CONES.tight);
});
