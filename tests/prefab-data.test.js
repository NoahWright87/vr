import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { validatePose } from '../common/hand-pose-core.js';
import { compactPrefab, formatJson, validatePrefab } from '../common/prefab-core.js';
import { models as originals } from '../assets/models/catalog.js';

const here = path => new URL(`../${path}`, import.meta.url);
const readJson = path => JSON.parse(readFileSync(here(path), 'utf8'));
const kenney = readJson('assets/models/kenney/catalog.json');
const poses = readJson('assets/prefabs/hand-poses.json');
const files = readdirSync(here('assets/prefabs')).filter(name => name.endsWith('.prefabs.json'));
const packOf = id => kenney.find(m => m.id === id)?.pack ?? (originals.some(m => m.id === id) ? 'originals' : null);

test('every committed pose is valid, and the two the hand model needs are there', () => {
  for (const [name, pose] of Object.entries(poses)) {
    assert.match(name, /^[a-z0-9][a-z0-9-]*$/, `pose name "${name}"`);
    assert.deepEqual(validatePose(pose), [], `pose "${name}"`);
  }
  assert.ok(poses.open && poses.fist, 'open and fist are the ends every other pose is measured from');
});

test('every committed prefab is valid, uses real poses and real models, and lives in its model\'s pack file', () => {
  const ids = new Set();
  for (const name of files) {
    const pack = name.replace('.prefabs.json', '');
    const prefabs = readJson(`assets/prefabs/${name}`);
    for (const [id, prefab] of Object.entries(prefabs)) {
      assert.ok(!ids.has(id), `prefab id "${id}" is in two files`);
      ids.add(id);
      assert.deepEqual(validatePrefab(prefab, { poses, hasModel: m => packOf(m) !== null }), [], `prefab "${id}"`);
      assert.equal(packOf(prefab.model), pack, `prefab "${id}" is for a ${packOf(prefab.model)} model but is in ${name}`);
    }
  }
  assert.ok(ids.size > 0, 'there are prefabs to check');
});

test('the files are exactly what the apply script writes, so a re-export never shows noise', () => {
  const sortKeys = o => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  for (const name of files) {
    const prefabs = readJson(`assets/prefabs/${name}`);
    const expected = `${formatJson(sortKeys(Object.fromEntries(Object.entries(prefabs).map(([id, p]) => [id, compactPrefab(p)]))))}\n`;
    assert.equal(readFileSync(here(`assets/prefabs/${name}`), 'utf8'), expected, name);
  }
});

test('shooter prefabs face -Z: the muzzle is ahead of the grip, in front of the model\'s middle', () => {
  const blasters = readJson('assets/prefabs/blaster-kit.prefabs.json');
  for (const id of ['smg-d', 'rifle-a', 'pistol-h']) {
    const prefab = blasters[id];
    const muzzle = prefab.emitters.find(e => e.role === 'muzzle');
    const grip = prefab.interactions.find(i => i.id === 'grip').occupants[0];
    assert.ok(muzzle, `${id} has a muzzle`);
    assert.ok(muzzle.pos[2] < grip.pos[2] - 0.15, `${id}: the muzzle is well forward (-Z) of the grip`);
    assert.deepEqual(muzzle.rot, [0, 0, 0], `${id}: -Z is the muzzle's own forward`);
  }
});

test('the workshop is built and linked from the home page', () => {
  assert.match(readFileSync(here('vite.config.js'), 'utf8'), /prefabWorkshop: resolve\(root, 'primitives\/prefabs\/index.html'\)/);
  assert.match(readFileSync(here('src/App.jsx'), 'utf8'), /href: '\/primitives\/prefabs\/'/);
});
