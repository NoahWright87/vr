// ============================================================
// PREFAB DATA — the committed prefabs and hand poses, loaded.
//
//   import { getPrefab, getPose } from './prefab-data.js';
//   getPrefab('smg-d')     // a normalized prefab (common/prefab-core.js), or undefined
//   getPose('pistol-grip') // a normalized hand pose, or undefined
//
// The data is assets/prefabs/: one hand-poses.json, and one
// <pack>.prefabs.json per model pack, each { prefabId: prefab }. A new
// pack's file is picked up by name. Nobody edits these files by
// hand: the workshop (primitives/prefabs/) copies out what changed and
// scripts/apply-prefab-export.mjs writes it back into the right files.
// ============================================================

import poses from '../assets/prefabs/hand-poses.json';
import { normalizePose } from './hand-pose-core.js';
import { normalizePrefab } from './prefab-core.js';

// pack name -> { prefabId: prefab }, for every assets/prefabs/<pack>.prefabs.json
export const PREFAB_FILES = Object.fromEntries(
  Object.entries(import.meta.glob('../assets/prefabs/*.prefabs.json', { eager: true, import: 'default' }))
    .map(([path, file]) => [path.match(/([^/]+)\.prefabs\.json$/)[1], file]),
);

// The committed library: { poses, prefabs }, every entry normalized.
export function committedLibrary() {
  const library = { poses: {}, prefabs: {} };
  for (const [name, pose] of Object.entries(poses)) library.poses[name] = normalizePose(pose);
  for (const file of Object.values(PREFAB_FILES)) {
    for (const [id, prefab] of Object.entries(file)) library.prefabs[id] = normalizePrefab(prefab);
  }
  return library;
}

const committed = committedLibrary();

export const getPrefab = id => committed.prefabs[id];
export const getPose = name => committed.poses[name];
export const prefabIds = () => Object.keys(committed.prefabs);
