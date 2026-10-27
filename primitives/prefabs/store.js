// ============================================================
// WORKSHOP STORE — the library being edited, what differs from the
// committed one, and keeping that across reloads. No DOM here, so
// tests/prefab-workshop-store.test.js can run it.
//
// The library is { poses, prefabs }, every entry normalized so an editor
// can reach into it without checking for holes. Edits are made in place
// through `update`, and the store works out what changed against the
// committed `baseline` rather than keeping a list of edits: an edit that
// is undone by hand stops being a change. What differs is what gets
// saved to the browser (in the export format) and what gets copied out.
// ============================================================

import { normalizePose } from '../../common/hand-pose-core.js';
import {
  applyExport, cloneLibrary, diffLibraries, isEmptyExport, normalizePrefab, parseExport,
} from '../../common/prefab-core.js';

export const STORAGE_KEY = 'prefab-workshop-edits-v1';

function normalizeLibrary(library) {
  const out = { poses: {}, prefabs: {} };
  for (const [name, pose] of Object.entries(library.poses ?? {})) out.poses[name] = normalizePose(pose);
  for (const [id, prefab] of Object.entries(library.prefabs ?? {})) out.prefabs[id] = normalizePrefab(prefab);
  return out;
}

export function browserStorage() {
  try {
    const storage = globalThis.localStorage;
    storage.getItem(STORAGE_KEY);
    return storage;
  } catch { return null; }
}

export function createStore({ baseline, storage = browserStorage(), saveDelayMs = 300 }) {
  const base = normalizeLibrary(baseline);
  let library = cloneLibrary(base);
  let version = 0;
  let cached = null;
  let saveTimer = null;
  let storageFailed = false;
  const listeners = new Set();

  try {
    const saved = storage?.getItem(STORAGE_KEY);
    const parsed = saved ? parseExport(saved) : null;
    if (parsed?.value) library = normalizeLibrary(applyExport(base, parsed.value));
  } catch { /* unreadable saved edits are the same as none */ }

  function changes() {
    if (!cached || cached.version !== version) cached = { version, value: diffLibraries(base, library) };
    return cached.value;
  }

  function save() {
    saveTimer = null;
    if (!storage) return;
    try {
      if (isEmptyExport(changes())) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, JSON.stringify(changes()));
      storageFailed = false;
    } catch { storageFailed = true; }
  }

  function changed(what) {
    version++;
    if (saveTimer === null) saveTimer = setTimeout(save, saveDelayMs);
    for (const listener of listeners) listener(what);
  }

  return {
    get library() { return library; },
    get baseline() { return base; },
    get storageWorks() { return Boolean(storage) && !storageFailed; },

    // Change the library in place: update(lib => { lib.prefabs.smg.massKg = 3; })
    update(mutator, what = 'edit') {
      mutator(library);
      changed(what);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    changes,
    changedCount() {
      const c = changes();
      return Object.keys(c.prefabs).length + Object.keys(c.poses).length;
    },
    isPrefabChanged: id => id in changes().prefabs,
    isPoseChanged: name => name in changes().poses,

    revertPrefab(id) {
      this.update(lib => {
        if (base.prefabs[id]) lib.prefabs[id] = JSON.parse(JSON.stringify(base.prefabs[id]));
        else delete lib.prefabs[id];
      }, 'revert');
    },
    revertPose(name) {
      this.update(lib => {
        if (base.poses[name]) lib.poses[name] = JSON.parse(JSON.stringify(base.poses[name]));
        else delete lib.poses[name];
      }, 'revert');
    },
    discardAll() {
      library = cloneLibrary(base);
      changed('revert');
    },

    // Apply a pasted export on top of what's here.
    importChanges(exported) {
      library = normalizeLibrary(applyExport(library, exported));
      changed('import');
    },

    // Write to the browser now, e.g. as the page is closing.
    flush() {
      if (saveTimer !== null) { clearTimeout(saveTimer); save(); }
    },
  };
}
