import assert from 'node:assert/strict';
import test from 'node:test';

let boxUpdates = 0;
class Collider {
  tick() { boxUpdates++; }
}
const system = {
  colliderEls: [],
  resetCollisions() { this.reset = true; this.pairs = []; },
  registerCollision(a, b) { this.pairs.push([a, b]); },
  clearCollisions() { this.cleared = true; },
};
const scene = { systems: { 'obb-collider': system }, addEventListener() {} };
globalThis.AFRAME = { components: { 'obb-collider': { Component: Collider } } };
globalThis.document = { querySelector: () => scene };
await import('../common/obb-collider-visibility.js');

function collider(parent, size = 1) {
  const component = new Collider();
  component.el = { object3D: { visible: true, parent }, components: { 'obb-collider': component } };
  component.obb = { halfSize: { x: size, y: size, z: size }, intersectsOBB: () => true };
  return component;
}

test('hidden ancestors skip box updates and all collision pairs', () => {
  boxUpdates = 0;
  const hiddenPanel = { visible: false }, a = collider(), b = collider();
  const hidden = Array.from({ length: 250 }, () => collider(hiddenPanel));
  system.colliderEls = [a, b, ...hidden].map(c => c.el);
  for (const c of [a, b, ...hidden]) c.tick();
  system.tick();
  assert.equal(boxUpdates, 2);
  assert.deepEqual(system.pairs, [[a, b]]);
  assert.ok(system.reset && system.cleared);
});

test('new popups retain pruning when A-Frame reassigns the system tick', () => {
  const a = collider(), b = collider(), hidden = collider({ visible: false });
  system.colliderEls = [a, b, hidden].map(c => c.el);
  system.tick = system.detectCollisions;
  system.tick();
  assert.deepEqual(system.pairs, [[a, b]]);
});

test('opening a page resumes box updates and collisions; closing clears old contacts', () => {
  boxUpdates = 0;
  const panel = { visible: false }, a = collider(), b = collider(panel);
  system.colliderEls = [a.el, b.el];
  b.tick(); system.tick();
  assert.equal(boxUpdates, 0); assert.deepEqual(system.pairs, []);
  panel.visible = true;
  b.tick(); system.tick();
  assert.equal(boxUpdates, 1); assert.deepEqual(system.pairs, [[a, b]]);
  panel.visible = false; system.cleared = false;
  system.tick();
  assert.deepEqual(system.pairs, []); assert.equal(system.cleared, true);
});

test('uninitialized zero-size colliders remain excluded', () => {
  const a = collider(), b = collider(), zero = collider(undefined, 0);
  system.colliderEls = [a, b, zero].map(c => c.el);
  system.tick(); assert.deepEqual(system.pairs, [[a, b]]);
});
