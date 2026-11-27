import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProfile, encodeBackup, decodeBackup, migrate, sanitizeName,
  STORAGE_KEY, PROFILE_VERSION, NAME_MAX,
} from '../games/pistols-at-dawn/js/profile-core.js';

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

const blocked = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
};

test('a new profile is empty', () => {
  const p = createProfile({ storage: memoryStorage() });
  assert.equal(p.name, '');
  assert.equal(p.money, 0);
  assert.deepEqual(p.owned, []);
  assert.deepEqual(p.outfit, {});
  assert.deepEqual(p.unlocks, []);
  assert.deepEqual(p.records, {});
});

test('earn adds money and announces it with the reason', () => {
  const p = createProfile({ storage: memoryStorage() });
  const events = [];
  p.on((e) => events.push(e));
  assert.equal(p.earn(25, 'bounty'), true);
  assert.equal(p.money, 25);
  assert.deepEqual(events, [{ type: 'money', delta: 25, money: 25, reason: 'bounty' }]);
});

test('earn ignores nonsense amounts', () => {
  const p = createProfile({ storage: memoryStorage() });
  for (const bad of [0, -5, NaN, Infinity, 'abc', null, undefined, 0.4]) assert.equal(p.earn(bad, 'x'), false);
  assert.equal(p.money, 0);
});

test('spend takes money, and refuses without changing anything when short', () => {
  const p = createProfile({ storage: memoryStorage() });
  p.earn(100, 'start');
  const events = [];
  p.on((e) => events.push(e));
  assert.equal(p.spend(30, 'hat'), true);
  assert.equal(p.money, 70);
  assert.equal(p.spend(71, 'gold toilet'), false);
  assert.equal(p.money, 70);
  assert.equal(p.spend(-5, 'trick'), false);
  assert.equal(p.spend(NaN, 'trick'), false);
  assert.equal(p.money, 70);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { type: 'money', delta: -30, money: 70, reason: 'hat' });
  assert.equal(p.spend(70, 'all of it'), true);
  assert.equal(p.money, 0);
});

test('unlocks: new ids announce, repeats do not, source is carried', () => {
  const p = createProfile({ storage: memoryStorage() });
  const events = [];
  p.on((e) => events.push(e));
  assert.equal(p.has('duel:noon'), false);
  assert.equal(p.unlock('duel:noon'), true);
  assert.equal(p.has('duel:noon'), true);
  assert.equal(p.unlock('duel:noon'), false);
  assert.equal(p.unlock('card:moon', { source: 'room' }), true);
  assert.deepEqual(events, [
    { type: 'unlock', id: 'duel:noon', source: 'local' },
    { type: 'unlock', id: 'card:moon', source: 'room' },
  ]);
  assert.equal(p.unlock(''), false);
  assert.equal(p.unlock(42), false);
});

test('outfit: set, replace, clear, and set several at once', () => {
  const p = createProfile({ storage: memoryStorage() });
  const events = [];
  p.on((e) => events.push(e));
  assert.equal(p.setOutfit('hat', 'sombrero'), true);
  assert.equal(p.setOutfit('hat', 'sombrero'), false);
  assert.equal(p.setOutfit({ boots: 'sparkly', belt: 'big-buckle' }), true);
  assert.deepEqual(p.outfit, { hat: 'sombrero', boots: 'sparkly', belt: 'big-buckle' });
  assert.equal(p.setOutfit('hat', null), true);
  assert.equal(p.setOutfit('hat', null), false);
  assert.deepEqual(p.outfit, { boots: 'sparkly', belt: 'big-buckle' });
  assert.equal(events.length, 3);
  assert.deepEqual(events[0].changes, { hat: 'sombrero' });
});

test('owned items are a collection without repeats', () => {
  const p = createProfile({ storage: memoryStorage() });
  assert.equal(p.own('hat:sombrero'), true);
  assert.equal(p.own('hat:sombrero'), false);
  assert.equal(p.owns('hat:sombrero'), true);
  assert.deepEqual(p.owned, ['hat:sombrero']);
});

test('records keep the best medal, fastest time and highest style', () => {
  const p = createProfile({ storage: memoryStorage() });
  assert.equal(p.recordResult('duel:noon', { medal: 'silver', time: 480, style: 10 }), true);
  assert.equal(p.recordResult('duel:noon', { medal: 'bronze', time: 600, style: 5 }), false);
  assert.equal(p.recordResult('duel:noon', { medal: 'gold', time: 520, style: 30 }), true);
  assert.deepEqual(p.records['duel:noon'], { medal: 'gold', time: 480, style: 30 });
  assert.equal(p.recordResult('duel:noon', { time: 450 }), true);
  assert.equal(p.records['duel:noon'].time, 450);
  assert.equal(p.recordResult('duel:noon', {}), false);
});

test('names are tidied: uppercase, safe characters, capped, trimmed', () => {
  assert.equal(sanitizeName('  dusty   pete '), 'DUSTY PETE');
  assert.equal(sanitizeName('<b>Bob</b>'), 'BBOBB');
  assert.equal(sanitizeName("o'neil-3"), "O'NEIL-3");
  assert.equal(sanitizeName('x'.repeat(40)).length, NAME_MAX);
  assert.equal(sanitizeName(null), '');
  const p = createProfile({ storage: memoryStorage() });
  assert.equal(p.setName('annie'), true);
  assert.equal(p.name, 'ANNIE');
  assert.equal(p.setName('ANNIE'), false);
});

test('everything saves and comes back on the next load', () => {
  const storage = memoryStorage();
  const a = createProfile({ storage });
  a.setName('Annie');
  a.earn(250, 'bounty');
  a.own('hat:sombrero');
  a.unlock('duel:noon');
  a.setOutfit('hat', 'hat:sombrero');
  a.recordResult('duel:noon', { medal: 'gold', time: 400, style: 12 });
  assert.equal(a.persistent, true);
  const saved = JSON.parse(storage.map.get(STORAGE_KEY));
  assert.equal(saved.v, PROFILE_VERSION);

  const b = createProfile({ storage });
  assert.equal(b.name, 'ANNIE');
  assert.equal(b.money, 250);
  assert.deepEqual(b.owned, ['hat:sombrero']);
  assert.deepEqual(b.unlocks, ['duel:noon']);
  assert.deepEqual(b.outfit, { hat: 'hat:sombrero' });
  assert.deepEqual(b.records, { 'duel:noon': { medal: 'gold', time: 400, style: 12 } });
});

test('blocked storage: the profile still works, it just cannot remember', () => {
  const p = createProfile({ storage: blocked });
  assert.equal(p.persistent, false);
  p.earn(10, 'x');
  assert.equal(p.setName('Zed'), true);
  assert.equal(p.money, 10);
  assert.equal(p.name, 'ZED');
  assert.equal(p.persistent, false);
  const q = createProfile({ storage: null });
  q.earn(5, 'x');
  assert.equal(q.money, 5);
  assert.equal(q.persistent, false);
});

test('a write that fails later (quota) does not lose the in-memory change', () => {
  const storage = memoryStorage();
  const p = createProfile({ storage });
  p.earn(5, 'x');
  assert.equal(p.persistent, true);
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  p.earn(5, 'y');
  assert.equal(p.money, 10);
  assert.equal(p.persistent, false);
});

test('empty, corrupt or hostile saved text starts a clean profile', () => {
  for (const text of ['', 'not json', '[1,2]', 'null', '42', '{"v":-3}', '{"v":"x"}']) {
    const p = createProfile({ storage: memoryStorage({ [STORAGE_KEY]: text }) });
    assert.equal(p.money, 0, text);
    assert.equal(p.name, '', text);
  }
  const p = createProfile({ storage: memoryStorage({ [STORAGE_KEY]: JSON.stringify({ v: 1, money: -50, name: '<<>>', owned: 'nope', outfit: [1], unlocks: [3, 'ok'], records: { a: 'x' } }) }) });
  assert.equal(p.money, 0);
  assert.equal(p.name, '');
  assert.deepEqual(p.owned, []);
  assert.deepEqual(p.outfit, {});
  assert.deepEqual(p.unlocks, ['ok']);
  assert.deepEqual(p.records, {});
});

test('migrating from an older, unversioned save', () => {
  const old = { playerName: 'Calamity', cash: '120', owned: { 'hat:a': true, 'hat:b': false }, unlocks: { 'duel:one': true }, outfit: { hat: 'hat:a' } };
  const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(old) });
  const p = createProfile({ storage });
  assert.equal(p.name, 'CALAMITY');
  assert.equal(p.money, 120);
  assert.deepEqual(p.owned, ['hat:a']);
  assert.deepEqual(p.unlocks, ['duel:one']);
  assert.deepEqual(p.outfit, { hat: 'hat:a' });
  // ...and the migrated shape is written back, versioned.
  assert.equal(JSON.parse(storage.map.get(STORAGE_KEY)).v, PROFILE_VERSION);
  assert.equal(JSON.parse(storage.map.get(STORAGE_KEY)).cash, undefined);
});

test('migrate() upgrades version 0 and refuses versions from the future', () => {
  assert.equal(migrate({ name: 'a', money: 3 }).data.money, 3);
  assert.equal(migrate({ v: 1, money: 3 }).data.money, 3);
  assert.equal(migrate({ v: PROFILE_VERSION + 1 }).error, 'newer');
  assert.ok(migrate('x').error);
});

test('a save from a newer build is neither read nor overwritten', () => {
  const future = JSON.stringify({ v: PROFILE_VERSION + 1, money: 999, name: 'FUTURE' });
  const storage = memoryStorage({ [STORAGE_KEY]: future });
  const p = createProfile({ storage });
  assert.equal(p.readOnly, true);
  assert.equal(p.money, 0);
  p.earn(5, 'x');
  assert.equal(p.money, 5);
  assert.equal(storage.map.get(STORAGE_KEY), future);
  assert.equal(p.persistent, false);
});

test('export then import round trips every field', () => {
  const a = createProfile({ storage: memoryStorage() });
  a.setName("Annie O'Da");
  a.earn(12345, 'x');
  a.own('hat:a');
  a.own('boots:b');
  a.unlock('duel:noon');
  a.unlock('card:moon', { source: 'room' });
  a.setOutfit({ hat: 'hat:a', boots: 'boots:b' });
  a.recordResult('duel:noon', { medal: 'silver', time: 512, style: 7 });
  const code = a.exportCode();
  assert.match(code, /^PAD1\.[A-Za-z0-9_-]+\.[0-9a-f]{8}$/);

  const storage = memoryStorage();
  const b = createProfile({ storage });
  const events = [];
  b.on((e) => events.push(e.type));
  assert.deepEqual(b.importCode(code), { ok: true });
  assert.equal(b.name, "ANNIE O'DA");
  assert.equal(b.money, 12345);
  assert.deepEqual(b.owned, ['hat:a', 'boots:b']);
  assert.deepEqual(b.unlocks, ['duel:noon', 'card:moon']);
  assert.deepEqual(b.outfit, { hat: 'hat:a', boots: 'boots:b' });
  assert.deepEqual(b.records, a.records);
  assert.deepEqual(events, ['import']);
  // The import was saved too.
  assert.equal(createProfile({ storage }).money, 12345);
  // Importing again and exporting gives the same text.
  assert.equal(b.exportCode(), code);
});

test('import tolerates wrapped and padded pasted text', () => {
  const a = createProfile({ storage: memoryStorage() });
  a.earn(77, 'x');
  const code = a.exportCode();
  const wrapped = '  ' + code.replace(/(.{20})/g, '$1\n') + '\n ';
  const b = createProfile({ storage: memoryStorage() });
  assert.equal(b.importCode(wrapped).ok, true);
  assert.equal(b.money, 77);
});

test('import rejects junk and damaged codes without touching the profile', () => {
  const p = createProfile({ storage: memoryStorage() });
  p.earn(40, 'x');
  const good = p.exportCode();
  const damaged = good.slice(0, 12) + (good[12] === 'A' ? 'B' : 'A') + good.slice(13);
  for (const bad of ['', 'hello', 'PAD1.abc', 'PAD1.@@@.00000000', damaged, good.slice(0, -3), null, undefined]) {
    const result = p.importCode(bad);
    assert.equal(result.ok, false, String(bad));
    assert.ok(result.error);
    assert.equal(p.money, 40);
  }
});

test('a backup from a newer build is refused politely', () => {
  const code = encodeBackup({ v: PROFILE_VERSION + 1, money: 1 });
  const result = decodeBackup(code);
  assert.match(result.error, /newer version/);
  const p = createProfile({ storage: memoryStorage() });
  assert.equal(p.importCode(code).ok, false);
});

test('import works even with storage blocked', () => {
  const a = createProfile({ storage: memoryStorage() });
  a.earn(9, 'x');
  const b = createProfile({ storage: blocked });
  assert.equal(b.importCode(a.exportCode()).ok, true);
  assert.equal(b.money, 9);
});

test('listeners that throw do not break the economy', () => {
  const p = createProfile({ storage: memoryStorage() });
  p.on(() => { throw new Error('ui bug'); });
  assert.equal(p.earn(5, 'x'), true);
  assert.equal(p.money, 5);
});

test('unsubscribing stops events', () => {
  const p = createProfile({ storage: memoryStorage() });
  let n = 0;
  const off = p.on(() => { n += 1; });
  p.earn(1, 'a');
  off();
  p.earn(1, 'b');
  assert.equal(n, 1);
});
