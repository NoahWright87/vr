import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLightningTarget } from '../games/magic-hands/lightning-aim.js';
const origin = { x: 0, y: 0, z: 0 }, aim = { x: 0, y: 0, z: -1 };
const target = (id, angle, range, radius = .2) => ({ id, center: { x: Math.sin(angle * Math.PI / 180) * range, y: 0, z: -Math.cos(angle * Math.PI / 180) * range }, radius });
test('assist prefers nearest angular center over the nearer off-center target, with range as tie break', () => {
  const result = selectLightningTarget(origin, aim, [target('near', 6, 3), target('centered', 2, 20)]);
  assert.equal(result.target.id, 'centered'); assert.equal(result.kind, 'assist');
  assert.equal(selectLightningTarget(origin, aim, [target('far', 0, 20), target('close', 0, 5)]).target.id, 'close');
});
test('near misses outside the assist cone can arc, but wide or distant misses cannot', () => {
  assert.equal(selectLightningTarget(origin, aim, [target('arc', 12, 3)]).kind, 'arc');
  assert.equal(selectLightningTarget(origin, aim, [target('wide', 18, 3)]), null);
  assert.equal(selectLightningTarget(origin, aim, [target('distant', 12, 20)]), null);
});
test('hidden/occluded, behind and out-of-range enemies are never acquired', () => {
  const hidden = { ...target('hidden', 0, 4), visible: false };
  assert.equal(selectLightningTarget(origin, aim, [hidden, target('behind', 180, 4), target('far', 0, 80)]), null);
  assert.equal(selectLightningTarget(origin, aim, [hidden, target('visible', 5, 4)]).target.id, 'visible');
});
test('both hand vectors are normalized and independently select mirrored targets', () => {
  const enemies = [target('left', -6, 8), target('right', 6, 8)];
  assert.equal(selectLightningTarget(origin, { x: -.12, y: 0, z: -1 }, enemies).target.id, 'left');
  assert.equal(selectLightningTarget(origin, { x: .24, y: 0, z: -2 }, enemies).target.id, 'right');
});
