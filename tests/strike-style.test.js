import assert from 'node:assert/strict';
import test from 'node:test';

import { strikeStyle } from '../common/strike-style.js';

const v = (x, y, z) => ({ x, y, z });
// A target straight ahead (-Z), chest line at 1.1 m.
const base = { axis: 'forward', holdingGun: false, velocity: v(0, 0, -3), toTarget: { x: 0, z: -1 }, pointY: 1.3, zone: 'torso', chestY: 1.1 };

test('a straight punch to the chest or head is a jab', () => {
  assert.equal(strikeStyle(base), 'jab');
  assert.equal(strikeStyle({ ...base, zone: 'head', pointY: 1.5 }), 'jab');
});

test('holding a gun makes it a gun-butt strike, whatever the motion', () => {
  assert.equal(strikeStyle({ ...base, holdingGun: true, axis: 'up' }), 'butt');
});

test('the upward strike is an uppercut', () => {
  assert.equal(strikeStyle({ ...base, axis: 'up', velocity: v(0, 3, -0.5) }), 'uppercut');
});

test('a hand moving sideways across them is a slap, either way', () => {
  assert.equal(strikeStyle({ ...base, axis: 'graze', velocity: v(2.5, 0, -0.4) }), 'slap');
  assert.equal(strikeStyle({ ...base, axis: 'graze', velocity: v(-2.5, 0, -0.4) }), 'slap');
  assert.equal(strikeStyle({ ...base, velocity: v(0.6, 0, 0.1) }), 'jab', 'too slow to be a slap');
});

test("melee's slap is a slap even if it lands head-on", () => {
  assert.equal(strikeStyle({ ...base, axis: 'slap' }), 'slap');
});

test('landing below the chest, or on the legs, is a body shot', () => {
  assert.equal(strikeStyle({ ...base, pointY: 0.95 }), 'body');
  assert.equal(strikeStyle({ ...base, zone: 'legs', pointY: 1.2 }), 'body');
});
