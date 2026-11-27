import assert from 'node:assert/strict';
import test from 'node:test';
import { STORAGE_KEY, createStore } from '../primitives/prefabs/store.js';

const baseline = () => ({
  poses: { open: { fingers: {} }, fist: { fingers: { index: 1 } } },
  prefabs: { rock: { name: 'Rock', model: 'rock', massKg: 5 }, crate: { name: 'Crate', model: 'crate' } },
});

const memory = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v; }, removeItem: k => { delete data[k]; } };
};

test('a fresh store has nothing changed, with every entry written out in full', () => {
  const store = createStore({ baseline: baseline(), storage: memory() });
  assert.equal(store.changedCount(), 0);
  assert.deepEqual(store.library.prefabs.rock.fit, { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 });
  assert.equal(store.library.poses.fist.fingers.index.length, 3);
});

test('changes are measured against the baseline, so putting a value back is no change', () => {
  const store = createStore({ baseline: baseline(), storage: memory() });
  store.update(lib => { lib.prefabs.rock.massKg = 9; });
  assert.equal(store.changedCount(), 1);
  assert.ok(store.isPrefabChanged('rock'));
  assert.ok(!store.isPrefabChanged('crate'));
  store.update(lib => { lib.prefabs.rock.massKg = 5; });
  assert.equal(store.changedCount(), 0);
});

test('new, deleted and reverted entries', () => {
  const store = createStore({ baseline: baseline(), storage: memory() });
  store.update(lib => {
    lib.prefabs.log = { name: 'Log', model: 'log', fit: { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 }, interactions: [], emitters: [], attachments: [], stats: {}, massKg: null };
    delete lib.prefabs.crate;
    lib.poses.pinch = { fingers: { thumb: [{ curl: 0.5, spread: 0, twist: 0 }, { curl: 0.5, spread: 0, twist: 0 }, { curl: 0.5, spread: 0, twist: 0 }] } };
  });
  const out = store.changes();
  assert.deepEqual(Object.keys(out.prefabs).sort(), ['crate', 'log']);
  assert.equal(out.prefabs.crate, null);
  assert.deepEqual(Object.keys(out.poses), ['pinch']);
  store.revertPrefab('crate');
  store.revertPrefab('log');
  store.revertPose('pinch');
  assert.equal(store.changedCount(), 0);
  assert.equal(store.library.prefabs.crate.name, 'Crate');
  assert.ok(!store.library.prefabs.log);
});

test('subscribers hear about every change, and can stop listening', () => {
  const store = createStore({ baseline: baseline(), storage: memory() });
  const heard = [];
  const stop = store.subscribe(what => heard.push(what));
  store.update(lib => { lib.prefabs.rock.massKg = 1; }, 'drag');
  store.revertPrefab('rock');
  stop();
  store.update(lib => { lib.prefabs.rock.massKg = 2; });
  assert.deepEqual(heard, ['drag', 'revert']);
});

test('edits are saved a moment later and come back after a reload; undone edits leave nothing behind', async () => {
  const storage = memory();
  const store = createStore({ baseline: baseline(), storage, saveDelayMs: 5 });
  store.update(lib => { lib.prefabs.rock.massKg = 12; });
  assert.equal(storage.data[STORAGE_KEY], undefined, 'not saved until the delay passes');
  await new Promise(done => setTimeout(done, 20));
  assert.ok(storage.data[STORAGE_KEY]);
  assert.equal(JSON.parse(storage.data[STORAGE_KEY]).prefabs.rock.massKg, 12);

  const reloaded = createStore({ baseline: baseline(), storage });
  assert.equal(reloaded.library.prefabs.rock.massKg, 12);
  assert.equal(reloaded.changedCount(), 1);

  reloaded.update(lib => { lib.prefabs.rock.massKg = 5; });
  reloaded.flush();
  assert.equal(storage.data[STORAGE_KEY], undefined);
});

test('flush saves at once; broken or missing storage never breaks editing', () => {
  const storage = memory();
  const store = createStore({ baseline: baseline(), storage, saveDelayMs: 100000 });
  store.update(lib => { lib.prefabs.rock.massKg = 3; });
  store.flush();
  assert.ok(storage.data[STORAGE_KEY]);

  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); }, removeItem: () => {} };
  const safe = createStore({ baseline: baseline(), storage: broken, saveDelayMs: 1 });
  safe.update(lib => { lib.prefabs.rock.massKg = 4; });
  safe.flush();
  assert.equal(safe.library.prefabs.rock.massKg, 4);
  assert.equal(safe.storageWorks, false);

  const none = createStore({ baseline: baseline(), storage: null });
  none.update(lib => { lib.prefabs.rock.massKg = 4; });
  assert.equal(none.changedCount(), 1);
  assert.equal(none.storageWorks, false);

  const garbage = createStore({ baseline: baseline(), storage: memory({ [STORAGE_KEY]: '{not json' }) });
  assert.equal(garbage.changedCount(), 0);
});

test('importing an export applies it on top; discarding goes back to the baseline', () => {
  const store = createStore({ baseline: baseline(), storage: memory() });
  store.update(lib => { lib.prefabs.rock.massKg = 7; });
  store.importChanges({ prefabs: { crate: { name: 'Big crate', model: 'crate' }, rock: null }, poses: {} });
  assert.equal(store.library.prefabs.crate.name, 'Big crate');
  assert.ok(!store.library.prefabs.rock);
  store.discardAll();
  assert.equal(store.changedCount(), 0);
  assert.equal(store.library.prefabs.rock.massKg, 5);
});
