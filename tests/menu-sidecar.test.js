import assert from 'node:assert/strict';
import test from 'node:test';

const components = {};
globalThis.AFRAME = { THREE: {}, registerComponent: (name, definition) => { components[name] = definition; }, registerSystem() {} };
await import('../common/menu-crossbar.js');

function entity() {
  return { attributes: {}, object3D: { position: { set(x,y,z) { Object.assign(this,{x,y,z}); } } },
    setAttribute(key,value) { this.attributes[key]=value; } };
}
function sidecar(contentHeight = 0) {
  const component = Object.assign(Object.create(components['crossbar-menu']), {
    data: { width: 1.2, rowHeight: 0.2, sidecarWidth: 0.8, sidecarChars: 24, sidecar: 'right', sidecarAlign: 'top', sidecarContentHeight: contentHeight, curve: 0 },
    metrics: { titleY: 0.7 }, outward: -1, crumbs: [], sidecarEl: entity(), sidecarContentEl: entity(), sidecarTextEl: entity(), sidecarPlateEl: entity(), sidecarEdgeEl: entity(),
  });
  component.sidecarTextEl.getObject3D = () => null;
  return component;
}

test('an optional non-interactive preview slot reserves space above sidecar text', () => {
  const plain=sidecar(), preview=sidecar(0.6);plain.layoutSidecar();preview.layoutSidecar();
  assert.ok(Math.abs(preview.sidecarPlateEl.attributes.height-plain.sidecarPlateEl.attributes.height-0.6)<1e-9);
  assert.ok(Math.abs(preview.sidecarTextEl.object3D.position.y-plain.sidecarTextEl.object3D.position.y+0.6)<1e-9);
  assert.ok(Math.abs(preview.sidecarContentEl.object3D.position.y+preview.sidecarMetrics.pad+0.3)<1e-9);
});

test('omitting preview content preserves existing sidecar sizing', () => {
  const component=sidecar();component.layoutSidecar();
  assert.equal(component.sidecarPlateEl.attributes.height,component.data.rowHeight+2*component.sidecarMetrics.pad);
  assert.equal(component.sidecarTextEl.object3D.position.y,-component.sidecarMetrics.pad);
});
