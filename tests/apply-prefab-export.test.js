import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { applyPrefabExport } from '../scripts/apply-prefab-export.mjs';
import { formatJson } from '../common/prefab-core.js';

// A tiny repo: the two model catalogs and an empty prefab library.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'prefab-export-'));
  mkdirSync(join(dir, 'assets/prefabs'), { recursive: true });
  mkdirSync(join(dir, 'assets/models/kenney'), { recursive: true });
  writeFileSync(join(dir, 'assets/models/kenney/catalog.json'), JSON.stringify([
    { id: 'kenney-blaster-kit-blaster-a', pack: 'blaster-kit' },
    { id: 'kenney-furniture-kit-chair', pack: 'furniture-kit' },
  ]));
  writeFileSync(join(dir, 'assets/models/catalog.js'), "export const models = [{ id: 'pistol' }];\n");
  writeFileSync(join(dir, 'assets/prefabs/hand-poses.json'), '{ "open": { "fingers": {} } }\n');
  writeFileSync(join(dir, 'assets/prefabs/blaster-kit.prefabs.json'), '{}\n');
  return { dir, root: pathToFileURL(`${dir}/`) };
}

const gun = { name: 'Rifle', model: 'kenney-blaster-kit-blaster-a', massKg: 3.2,
  interactions: [{ id: 'grip', hands: 'either', occupants: [{ pose: 'pistol-grip', pos: [0, 0, 0], rot: [90, 0, 0] }] }] };
const exportOf = (prefabs, poses = {}) => JSON.stringify({ format: 'prefab-export/1', prefabs, poses });

test('formatJson keeps what fits on a line on a line, and expands the rest', () => {
  assert.equal(formatJson({ pos: [0, 0.5, -1], rot: [0, 0, 0] }), '{ "pos": [0, 0.5, -1], "rot": [0, 0, 0] }');
  const long = formatJson({ a: { list: Array.from({ length: 30 }, (_, i) => i * 1000) }, b: 1 }, 60);
  assert.ok(long.split('\n').length > 3);
  assert.deepEqual(JSON.parse(long).b, 1);
  assert.equal(formatJson({}), '{}');
  assert.equal(formatJson([]), '[]');
  assert.equal(formatJson('a "quoted" [string]'), '"a \\"quoted\\" [string]"');
});

test('an export is written to the file of its model\'s pack, and poses to the pose file', async () => {
  const { dir, root } = fixture();
  try {
    const pistolGrip = { fingers: { index: 0.4, thumb: [0.5, 0.6, { curl: 0.4, spread: 8 }] } };
    const pistol = { name: 'Pistol', model: 'pistol' };
    const result = await applyPrefabExport({
      root, write: true,
      exportText: exportOf({ 'rifle-a': gun, pistol }, { 'pistol-grip': pistolGrip }),
    });
    assert.deepEqual(result.errors, []);
    const blasters = JSON.parse(readFileSync(join(dir, 'assets/prefabs/blaster-kit.prefabs.json'), 'utf8'));
    assert.deepEqual(Object.keys(blasters), ['rifle-a']);
    assert.equal(blasters['rifle-a'].massKg, 3.2);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'assets/prefabs/originals.prefabs.json'), 'utf8')), { pistol });
    const poses = JSON.parse(readFileSync(join(dir, 'assets/prefabs/hand-poses.json'), 'utf8'));
    assert.deepEqual(Object.keys(poses), ['open', 'pistol-grip']);
    assert.deepEqual(poses['pistol-grip'], pistolGrip);

    const again = await applyPrefabExport({ root, write: true, exportText: exportOf({ 'rifle-a': gun, pistol }, { 'pistol-grip': pistolGrip }) });
    assert.deepEqual(again.changes.filter(line => line.startsWith('update') || line.startsWith('create')), [], 'applying the same export twice changes no files');

    const removed = await applyPrefabExport({ root, write: true, exportText: exportOf({ pistol: null, 'rifle-a': { ...gun, massKg: 4 } }) });
    assert.deepEqual(removed.errors, []);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'assets/prefabs/originals.prefabs.json'), 'utf8')), {});
    assert.equal(JSON.parse(readFileSync(join(dir, 'assets/prefabs/blaster-kit.prefabs.json'), 'utf8'))['rifle-a'].massKg, 4);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a prefab that moves to a model in another pack moves files', async () => {
  const { dir, root } = fixture();
  try {
    await applyPrefabExport({ root, write: true, exportText: exportOf({ thing: gun }, { 'pistol-grip': { fingers: {} } }) });
    const result = await applyPrefabExport({ root, write: true, exportText: exportOf({ thing: { ...gun, model: 'kenney-furniture-kit-chair' } }) });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'assets/prefabs/blaster-kit.prefabs.json'), 'utf8')), {});
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'assets/prefabs/furniture-kit.prefabs.json'), 'utf8'))), ['thing']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('nothing is written if anything in the export is wrong, and every problem is listed', async () => {
  const { dir, root } = fixture();
  try {
    const before = readFileSync(join(dir, 'assets/prefabs/blaster-kit.prefabs.json'), 'utf8');
    const bad = await applyPrefabExport({
      root, write: true,
      exportText: exportOf(
        { ok: { name: 'Fine', model: 'pistol' }, broken: { name: 'Broken', model: 'no-such-model', massKg: -2 }, 'rifle-a': gun },
        { 'bad-pose': { fingers: { index: 9 } } },
      ),
    });
    assert.ok(bad.errors.some(e => /prefab "broken": model: "no-such-model" is not in the model catalogs/.test(e)));
    assert.ok(bad.errors.some(e => /prefab "broken": massKg/.test(e)));
    assert.ok(bad.errors.some(e => /pose "bad-pose": index\.curl: 9 is outside/.test(e)));
    assert.ok(bad.errors.some(e => /prefab "rifle-a".*unknown pose "pistol-grip"/.test(e)), 'a prefab may only use poses that exist');
    assert.equal(readFileSync(join(dir, 'assets/prefabs/blaster-kit.prefabs.json'), 'utf8'), before);
    const notAnExport = await applyPrefabExport({ root, exportText: '{"hello": 1}' });
    assert.match(notAnExport.errors[0], /Not a prefab export/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
