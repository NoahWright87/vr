import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../assets/models/kenney/', import.meta.url);
const catalog = JSON.parse(readFileSync(new URL('catalog.json', root)));
const sources = JSON.parse(readFileSync(new URL('sources.json', root)));

test('all four Kenney collections retain original source and license information', () => {
  assert.equal(catalog.length, 228);
  assert.equal(new Set(catalog.map(a => a.id)).size, 228);
  assert.deepEqual(sources.packs.map(p => p.count), [140,40,30,18]);
  assert.ok(existsSync(new URL('logo.png', root)));
  for (const pack of sources.packs) {
    assert.match(pack.archive, /^https:\/\/kenney.nl\/media\/pages\/assets\//);
    assert.match(pack.sha256, /^[a-f0-9]{64}$/);
    const license = readFileSync(new URL(`${pack.id}/License.txt`,root),'utf8');
    assert.match(license,/Creative Commons Zero, CC0/);
    assert.match(license,/Kenney/);
  }
});

test('every imported GLB and texture dependency is local and present', () => {
  for (const asset of catalog) {
    assert.equal(asset.creator,'Kenney'); assert.equal(asset.license,'CC0-1.0');
    const path = new URL(`..${asset.file.slice('/assets/models'.length)}`, root);
    const bytes = readFileSync(path);
    assert.equal(bytes.toString('utf8',0,4),'glTF'); assert.equal(bytes.readUInt32LE(4),2);
    assert.equal(bytes.readUInt32LE(8),bytes.length);
    const gltf = JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    assert.ok(gltf.meshes?.length,`${asset.id} has no meshes`);
    for (const resource of [...(gltf.images || []),...(gltf.buffers || [])]) {
      if (!resource.uri || resource.uri.startsWith('data:')) continue;
      assert.doesNotMatch(resource.uri,/^\w+:|\.\./);
      assert.ok(existsSync(new URL(resource.uri,path)),`${asset.id}: missing ${resource.uri}`);
    }
  }
});
