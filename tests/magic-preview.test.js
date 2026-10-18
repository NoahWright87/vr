import test from 'node:test';
import assert from 'node:assert/strict';
import { extractHand, farsightPose, shieldScore, SpellGestures } from '../common/hand-gestures.js';

// Only the vector operations used to construct joint fixtures. Rendering is
// intentionally excluded: these tests exercise the actual desktop pose builder
// against the actual recognizer instead of duplicating its synthetic joints.
class Vector {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { Object.assign(this, { x, y, z }); return this; }
  clone() { return new Vector(this.x, this.y, this.z); }
  copy(v) { return this.set(v.x, v.y, v.z); }
  add(v) { return this.set(this.x + v.x, this.y + v.y, this.z + v.z); }
  multiplyScalar(n) { return this.set(this.x * n, this.y * n, this.z * n); }
  lerp(v, t) { return this.set(this.x + (v.x - this.x) * t, this.y + (v.y - this.y) * t, this.z + (v.z - this.z) * t); }
}
globalThis.AFRAME = { THREE: { Vector3: Vector } };
const { previewJoints } = await import('../games/magic-hands/hand-input.js');
const head = { position: new Vector(0, 1.6, 0), forward: new Vector(0, 0, -1), up: new Vector(0, 1, 0) };
function pose(mode, side, bent, depth = .4) {
  const joints = previewJoints(mode, side, bent, .20);
  const x = (side === 'left' ? -1 : 1) * (mode === 'farsight' ? .075 : .18);
  for (const joint of Object.values(joints)) {
    if (mode === 'lightning') joint.set(joint.x, joint.z, -joint.y);
    joint.add(new Vector(x, mode === 'farsight' ? 1.597 : 1.42, -depth));
  }
  const hand = extractHand(joints, new Vector(0, 0, -1));
  assert.ok(hand, `${mode}/${side} must yield valid features`);
  return { ...hand, side };
}
test('actual desktop thumb poses fire independently on both hands through the full recognizer', () => {
  const engine = new SpellGestures();
  for (let t = 0; t <= 300; t += 10) engine.update({ left: pose('lightning', 'left', false), right: pose('lightning', 'right', false) }, head, t);
  let result;
  for (let t = 310; t <= 330; t += 10) result = engine.update({ left: pose('lightning', 'left', true), right: pose('lightning', 'right', true) }, head, t);
  assert.deepEqual(result.casts, ['left', 'right']);
});
test('actual desktop heel/fingertip window reaches 10x near and 2x far without changing its opening', () => {
  const lens = depth => farsightPose(pose('farsight', 'left', false, depth), pose('farsight', 'right', false, depth), head);
  assert.ok(lens(.12).zoom > 9.9); assert.equal(lens(.65).zoom, 2);
  assert.equal(lens(.12).radius, lens(.65).radius);
});
test('actual desktop shield pose activates only when extended on either side', () => {
  for (const side of ['left', 'right']) {
    assert.equal(shieldScore(pose('shield', side, false, .65), head), 1);
    assert.equal(shieldScore(pose('shield', side, false, .20), head), 0);
  }
});
