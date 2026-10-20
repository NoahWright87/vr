import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveContact, guardPoint, DEFAULT_DEFENSE } from '../common/attacks.js';

const v = (x, y, z) => ({ x, y, z });
const BODY = { head: { c: v(0, 1.6, 0), r: 0.13 }, torso: { a: v(0, 1.3, 0.05), b: v(0, 0.85, 0.05), r: 0.17 } };
// A thrust from a dummy 1 m in front (at -Z), its fist now 20 cm from your face.
const thrust = (tipZ, progress = 0.5) => ({ base: v(0.2, 1.4, -1), tip: v(0.05, 1.58, tipZ), radius: 0.05, progress });
const still = (p) => ({ side: 'right', position: p, velocity: v(0, 0, 0), speed: 0 });

test('nothing in the way and not there yet: no outcome', () => {
  assert.equal(resolveContact(thrust(-0.4), [still(v(0.3, 1.0, -0.2))], BODY).outcome, null);
});

test('the fist reaching your head is a hit', () => {
  const r = resolveContact(thrust(-0.05), [], BODY);
  assert.equal(r.outcome, 'hit');
  assert.equal(r.zone, 'head');
});

test('a hand on the line blocks before the fist arrives', () => {
  const r = resolveContact(thrust(-0.2), [still(v(0.07, 1.56, -0.25))], BODY);
  assert.equal(r.outcome, 'block');
});

test('a hand that is near but not on the line does not block', () => {
  const far = DEFAULT_DEFENSE.blockRadius + 0.05 + 0.03;
  assert.equal(resolveContact(thrust(-0.4), [still(v(0.15 + far, 1.5, -0.5))], BODY).outcome, null);
});

test('a fast hand moving into the attack early is a parry; late, only a block', () => {
  const hand = { side: 'left', position: v(0.07, 1.56, -0.3), velocity: v(0, 0, -2.5), speed: 2.5 };
  assert.equal(resolveContact(thrust(-0.25, 0.3), [hand], BODY).outcome, 'parry');
  assert.equal(resolveContact(thrust(-0.25, 0.9), [hand], BODY).outcome, 'block');
  // Fast but moving away from it: a block.
  const away = Object.assign({}, hand, { velocity: v(0, 0, 2.5) });
  assert.equal(resolveContact(thrust(-0.25, 0.3), [away], BODY).outcome, 'block');
});

test('the torso counts as well as the head', () => {
  const low = { base: v(0.2, 1.2, -1), tip: v(0, 1.05, -0.1), radius: 0.05, progress: 0.8 };
  assert.equal(resolveContact(low, [], BODY).zone, 'torso');
});

test('guardPoint pulls a nearby hand onto the attack line, and ignores far hands', () => {
  const base = v(0, 1.4, -1), aim = v(0, 1.6, 0);
  const p = guardPoint(base, aim, v(0.2, 1.5, -0.4), 0.35);
  assert.ok(p && Math.abs(p.x) < 1e-9, JSON.stringify(p));
  assert.equal(guardPoint(base, aim, v(0.6, 1.5, -0.4), 0.35), null);
  // Not behind the attacker.
  assert.equal(guardPoint(base, aim, v(0, 1.4, -1.2), 0.35), null);
});
