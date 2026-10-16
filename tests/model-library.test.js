import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { categories, filterModels, models } from '../assets/models/catalog.js';
import { createModel } from '../common/model-library.js';
import { modelToGltf } from '../common/model-gltf.js';

test('asset browsing covers the catalog and combines search with categories', () => {
  assert.equal(new Set(models.map(m => m.id)).size, models.length);
  assert.deepEqual(categories, ['All', 'Weapons', 'Characters', 'Furniture', 'Building', 'Props']);
  assert.deepEqual(filterModels('Furniture', ' CHAIR ').map(m => m.id), ['chair']);
  assert.equal(filterModels('Weapons', 'chair').length, 0);
  assert.equal(filterModels('All', '').length, models.length);
  assert.throws(() => createModel({}, 'missing-model'), /Unknown model/);
});

test('every portable model has self-contained, finite glTF geometry and a license notice', () => {
  for (const model of models) {
    const gltf = JSON.parse(readFileSync(new URL(`../assets/models/starter/${model.id}.gltf`, import.meta.url)));
    assert.equal(gltf.asset.version, '2.0');
    assert.equal(gltf.asset.extras.id, model.id);
    assert.equal(gltf.asset.extras.license, 'BSD-2-Clause');
    assert.match(gltf.asset.copyright, /Copyright \(c\) 2026, Noah Wright/);
    assert.match(gltf.asset.copyright, /Redistributions in binary form/);
    const buffer = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64');
    assert.equal(buffer.length, gltf.buffers[0].byteLength);
    assert.ok(gltf.meshes[0].primitives.length <= 4, `${model.id}: too many materials`);
    for (const primitive of gltf.meshes[0].primitives) {
      const position = gltf.accessors[primitive.attributes.POSITION];
      const normal = gltf.accessors[primitive.attributes.NORMAL];
      assert.equal(position.count, normal.count);
      assert.equal(position.count % 3, 0);
      assert.ok(position.min.every((n, i) => Number.isFinite(n) && n <= position.max[i]));
    }
    for (const accessor of gltf.accessors) {
      const view = gltf.bufferViews[accessor.bufferView];
      assert.equal(view.byteOffset % 4, 0);
      assert.equal(view.byteLength, accessor.count*3*4);
      assert.ok(view.byteOffset + view.byteLength <= buffer.length);
      for (let offset = view.byteOffset; offset < view.byteOffset+view.byteLength; offset += 4)
        assert.ok(Number.isFinite(buffer.readFloatLE(offset)), `${model.id}: invalid vertex`);
    }
  }
});

test('the exporter preserves authored vertices and color without viewer transforms or wireframe', () => {
  const positions = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0]);
  const gltf = modelToGltf({
    name: 'Triangle', userData: { license: 'BSD-2-Clause' }, position: { x: 200 }, scale: { x: 4 },
    children: [{ name: 'steel', material: { color: { r: 0.1, g: 0.2, b: 0.3 }, wireframe: true },
      geometry: { attributes: { position: { array: positions }, normal: { array: new Float32Array([0,0,1,0,0,1,0,0,1]) } } } }],
  });
  assert.deepEqual(gltf.accessors[0].min, [-1, 0, 0]);
  assert.deepEqual(gltf.accessors[0].max, [1, 2, 0]);
  assert.deepEqual(gltf.materials[0].pbrMetallicRoughness.baseColorFactor, [0.1, 0.2, 0.3, 1]);
  assert.equal(gltf.nodes[0].scale, undefined);
  assert.equal(gltf.materials[0].wireframe, undefined);
  const buffer = Buffer.from(gltf.buffers[0].uri.split(',')[1], 'base64');
  assert.equal(buffer.readFloatLE(0), -1);
  assert.equal(buffer.readFloatLE(7*4), 2);
});
