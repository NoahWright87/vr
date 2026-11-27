// Write a prefab workshop export into assets/prefabs/.
//
//   node scripts/apply-prefab-export.mjs export.json [--dry-run]
//
// The workshop's "Copy changed JSON" gives text that is saved to a file
// and given here. Each prefab goes in the file of its model's pack
// (assets/prefabs/<pack>.prefabs.json, "originals" for the hand-made
// models), poses go in hand-poses.json, and a null entry deletes. All of
// it is checked first and nothing is written unless all of it is valid.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compactPose, validatePose } from '../common/hand-pose-core.js';
import { applyExport, compactPrefab, formatJson, parseExport, validatePrefab } from '../common/prefab-core.js';

const readJson = url => JSON.parse(readFileSync(url, 'utf8'));
const sortKeys = object => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));

// Returns { files: { name: text }, changes: [lines], errors: [lines] } for the
// repo at `root` (a file URL ending in a slash); writes only when asked to.
export async function applyPrefabExport({ root, exportText, write = false }) {
  const errors = [];
  const parsed = parseExport(exportText);
  if (parsed.error) return { files: {}, changes: [], errors: [parsed.error] };

  const prefabDir = new URL('assets/prefabs/', root);
  const posesUrl = new URL('hand-poses.json', prefabDir);
  const library = { poses: readJson(posesUrl), prefabs: {} };
  for (const name of readdirSync(prefabDir).filter(n => n.endsWith('.prefabs.json'))) {
    Object.assign(library.prefabs, readJson(new URL(name, prefabDir)));
  }

  const kenney = readJson(new URL('assets/models/kenney/catalog.json', root));
  const { models: originals } = await import(new URL('assets/models/catalog.js', root));
  const packOf = id => kenney.find(m => m.id === id)?.pack ?? (originals.some(m => m.id === id) ? 'originals' : null);

  const result = applyExport(library, parsed.value);
  for (const [name, pose] of Object.entries(result.poses)) {
    for (const message of validatePose(pose)) errors.push(`pose "${name}": ${message}`);
  }
  const context = { poses: result.poses, hasModel: id => packOf(id) !== null };
  const byPack = {};
  for (const [id, prefab] of Object.entries(result.prefabs)) {
    for (const message of validatePrefab(prefab, context)) errors.push(`prefab "${id}": ${message}`);
    const pack = packOf(prefab.model);
    if (pack) (byPack[pack] ??= {})[id] = compactPrefab(prefab);
  }
  if (errors.length) return { files: {}, changes: [], errors };

  const files = {};
  for (const pack of new Set([...Object.keys(byPack), ...readdirSync(prefabDir).filter(n => n.endsWith('.prefabs.json')).map(n => n.replace('.prefabs.json', ''))])) {
    files[`${pack}.prefabs.json`] = `${formatJson(sortKeys(byPack[pack] ?? {}))}\n`;
  }
  files['hand-poses.json'] = `${formatJson(sortKeys(Object.fromEntries(Object.entries(result.poses).map(([n, p]) => [n, compactPose(p)]))))}\n`;

  const changes = [];
  for (const [name, text] of Object.entries(files)) {
    const url = new URL(name, prefabDir);
    const before = existsSync(url) ? readFileSync(url, 'utf8') : null;
    if (before === text) { delete files[name]; continue; }
    changes.push(`${before === null ? 'create' : 'update'} assets/prefabs/${name}`);
    if (write) writeFileSync(url, text);
  }
  const prefabs = Object.entries(parsed.value.prefabs);
  const poses = Object.entries(parsed.value.poses);
  const describe = (kind, entries) => entries.map(([id, v]) => `${v === null ? 'delete' : 'set'} ${kind} ${id}`);
  return { files, changes: [...describe('prefab', prefabs), ...describe('pose', poses), ...changes], errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [file, ...flags] = process.argv.slice(2);
  if (!file) {
    console.error('usage: node scripts/apply-prefab-export.mjs export.json [--dry-run]');
    process.exit(2);
  }
  const root = new URL('../', import.meta.url);
  const { changes, errors } = await applyPrefabExport({
    root, exportText: readFileSync(file, 'utf8'), write: !flags.includes('--dry-run'),
  });
  if (errors.length) {
    console.error(`Nothing written. ${errors.length} problem${errors.length === 1 ? '' : 's'}:`);
    for (const error of errors) console.error(`  ${error}`);
    process.exit(1);
  }
  console.log(`${flags.includes('--dry-run') ? 'Would apply' : 'Applied'}:`);
  for (const line of changes) console.log(`  ${line}`);
}
