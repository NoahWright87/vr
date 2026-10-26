// ==============================================================
// PROFILE CORE — who the player is, as plain data and plain functions.
//
// The pure half of the player profile (phase 01-C): name, money, what
// you own, what you wear, what you've unlocked, how you did. No DOM, no
// A-Frame, no `window`, so `node --test` can drive all of it
// (tests/profile.test.js). profile.js wires one instance to
// localStorage and exposes it to the plain scripts as `window.PROFILE`.
//
// Saving is versioned. Every save is { v: <number>, ...data }. When the
// shape changes, bump PROFILE_VERSION and add a step to MIGRATIONS
// that turns version N into version N + 1; old saves and old backup
// codes then keep working. Version 0 stands for "no version field": a
// hand-edited or very early save, which is also what an empty or
// partly-missing record normalizes through.
//
// Storage is optional. The profile works with `storage` null, empty or
// throwing (private windows, blocked site data); it just can't remember
// anything, and says so through `persistent`.
// ==============================================================

export const PROFILE_VERSION = 1;
export const STORAGE_KEY = 'pistols-at-dawn:profile';
export const NAME_MAX = 10;
export const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -'";
export const MEDALS = ['none', 'bronze', 'silver', 'gold'];
export const BACKUP_PREFIX = 'PAD1';

const MONEY_CAP = 999999999;

// ---------- shape ----------

export function blankData() {
  return { name: '', money: 0, owned: [], outfit: {}, unlocks: [], records: {} };
}

// version N -> N + 1. Keyed by the version they upgrade FROM.
const MIGRATIONS = {
  // v0 -> v1: the loose pre-versioned shape. `unlocks` and `owned` may
  // have been object maps ({ id: true }), money may be a numeric string
  // or sit under `cash`, and the name may sit under `playerName`.
  0(data) {
    const next = Object.assign({}, data);
    if (next.name === undefined && next.playerName !== undefined) next.name = next.playerName;
    if (next.money === undefined && next.cash !== undefined) next.money = next.cash;
    for (const key of ['owned', 'unlocks']) {
      const value = next[key];
      if (value && !Array.isArray(value) && typeof value === 'object') {
        next[key] = Object.keys(value).filter((id) => value[id]);
      }
    }
    delete next.playerName;
    delete next.cash;
    return next;
  },
};

export function sanitizeName(raw) {
  const text = String(raw === undefined || raw === null ? '' : raw).toUpperCase();
  let out = '';
  for (const ch of text) if (NAME_CHARS.includes(ch)) out += ch;
  return out.replace(/ +/g, ' ').trim().slice(0, NAME_MAX).trim();
}

function cleanId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 80 ? id : null;
}

function cleanIdList(list) {
  const seen = new Set();
  if (Array.isArray(list)) for (const id of list) { const ok = cleanId(id); if (ok) seen.add(ok); }
  return [...seen];
}

function cleanMoney(value) {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), MONEY_CAP) : 0;
}

function cleanRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const record = {};
  if (MEDALS.includes(raw.medal) && raw.medal !== 'none') record.medal = raw.medal;
  if (Number.isFinite(raw.time) && raw.time >= 0) record.time = raw.time;
  if (Number.isFinite(raw.style)) record.style = raw.style;
  return Object.keys(record).length ? record : null;
}

// Whatever came in, return something safe to hold. Unknown fields are dropped.
export function normalizeData(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const data = blankData();
  data.name = sanitizeName(src.name);
  data.money = cleanMoney(src.money);
  data.owned = cleanIdList(src.owned);
  data.unlocks = cleanIdList(src.unlocks);
  if (src.outfit && typeof src.outfit === 'object' && !Array.isArray(src.outfit)) {
    for (const slot of Object.keys(src.outfit)) {
      const slotId = cleanId(slot);
      const itemId = cleanId(src.outfit[slot]);
      if (slotId && itemId) data.outfit[slotId] = itemId;
    }
  }
  if (src.records && typeof src.records === 'object' && !Array.isArray(src.records)) {
    for (const id of Object.keys(src.records)) {
      const duelId = cleanId(id);
      const record = cleanRecord(src.records[id]);
      if (duelId && record) data.records[duelId] = record;
    }
  }
  return data;
}

// Bring a parsed save of any version up to the current one.
// Returns { data } or { error }; a save from a NEWER build is refused
// rather than guessed at (and, in the profile, never overwritten).
export function migrate(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'not a save' };
  let version = parsed.v === undefined ? 0 : parsed.v;
  if (!Number.isInteger(version) || version < 0) return { error: 'bad version' };
  if (version > PROFILE_VERSION) return { error: 'newer', version };
  let data = Object.assign({}, parsed);
  delete data.v;
  while (version < PROFILE_VERSION) {
    data = MIGRATIONS[version](data);
    version += 1;
  }
  return { data: normalizeData(data) };
}

// ---------- backup codes ----------

function checksum(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code) {
  const padded = code.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// "PAD1.<payload>.<checksum>": text a player can paste into a note.
export function encodeBackup(data) {
  const payload = toBase64Url(JSON.stringify(Object.assign({ v: PROFILE_VERSION }, data)));
  return `${BACKUP_PREFIX}.${payload}.${checksum(payload)}`;
}

// Whitespace anywhere is ignored, since codes get wrapped when pasted.
export function decodeBackup(code) {
  const text = String(code === undefined || code === null ? '' : code).replace(/\s+/g, '');
  const parts = text.split('.');
  if (parts.length !== 3 || parts[0] !== BACKUP_PREFIX) return { error: 'This is not a Pistols at Dawn backup code.' };
  if (checksum(parts[1]) !== parts[2]) return { error: 'The code is damaged or incomplete.' };
  let parsed;
  try { parsed = JSON.parse(fromBase64Url(parts[1])); } catch (e) { return { error: 'The code is damaged or incomplete.' }; }
  const result = migrate(parsed);
  if (result.error === 'newer') return { error: 'This backup is from a newer version of the game.' };
  if (result.error) return { error: 'The code is damaged or incomplete.' };
  return { data: result.data };
}

// ---------- the profile ----------

function betterRecord(old, next) {
  const out = Object.assign({}, old);
  let changed = false;
  if (next.medal && (!old.medal || MEDALS.indexOf(next.medal) > MEDALS.indexOf(old.medal))) { out.medal = next.medal; changed = true; }
  if (next.time !== undefined && (old.time === undefined || next.time < old.time)) { out.time = next.time; changed = true; }
  if (next.style !== undefined && (old.style === undefined || next.style > old.style)) { out.style = next.style; changed = true; }
  return { record: out, changed };
}

// `storage` is anything shaped like localStorage (or null). It may throw.
export function createProfile({ storage = null, key = STORAGE_KEY } = {}) {
  let data = blankData();
  let persistent = false;
  // A save from a newer build is left alone: we run on a blank profile
  // in memory and do not write, so an old tab can't wipe a newer save.
  let readOnly = false;
  const listeners = new Set();

  function emit(type, detail) {
    const event = Object.assign({ type }, detail);
    for (const fn of [...listeners]) {
      try { fn(event); } catch (e) { /* a broken listener must not break the economy */ }
    }
  }

  function save() {
    if (!storage || readOnly) { persistent = false; return false; }
    try {
      storage.setItem(key, JSON.stringify(Object.assign({ v: PROFILE_VERSION }, data)));
      persistent = true;
    } catch (e) {
      persistent = false;
    }
    return persistent;
  }

  function load() {
    persistent = false;
    readOnly = false;
    let text = null;
    if (storage) {
      try { text = storage.getItem(key); persistent = true; } catch (e) { text = null; }
    }
    if (text === null || text === undefined) { data = blankData(); return; }
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    const result = migrate(parsed);
    if (result.error === 'newer') { readOnly = true; persistent = false; data = blankData(); return; }
    // Corrupt text: start fresh. The bad value is replaced on the next save.
    data = result.data || blankData();
    // Persist a migrated save in the current shape once, quietly.
    if (result.data && parsed && parsed.v !== PROFILE_VERSION) save();
  }

  const profile = {
    load,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    get name() { return data.name; },
    get money() { return data.money; },
    get owned() { return [...data.owned]; },
    get outfit() { return Object.assign({}, data.outfit); },
    get unlocks() { return [...data.unlocks]; },
    get records() { return JSON.parse(JSON.stringify(data.records)); },
    get persistent() { return persistent; },
    get readOnly() { return readOnly; },

    setName(name) {
      const clean = sanitizeName(name);
      if (clean === data.name) return false;
      data.name = clean;
      save();
      emit('name', { name: clean });
      return true;
    },

    // Whole dollars only. Returns false for nonsense amounts.
    earn(amount, reason) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return false;
      const gained = Math.floor(n);
      if (gained < 1) return false;
      data.money = Math.min(data.money + gained, MONEY_CAP);
      save();
      emit('money', { delta: gained, money: data.money, reason: reason || '' });
      return true;
    },

    // Refuses (returns false, changes nothing) when you can't afford it.
    spend(amount, reason) {
      const n = Number(amount);
      if (!Number.isFinite(n) || n <= 0) return false;
      const cost = Math.ceil(n);
      if (cost > data.money) return false;
      data.money -= cost;
      save();
      emit('money', { delta: -cost, money: data.money, reason: reason || '' });
      return true;
    },

    canAfford(amount) { return Number.isFinite(Number(amount)) && Number(amount) <= data.money; },

    // Cosmetics you own for good (the wardrobe's collection).
    own(id, opts) {
      const ok = cleanId(id);
      if (!ok || data.owned.includes(ok)) return false;
      data.owned.push(ok);
      save();
      emit('owned', { id: ok, source: (opts && opts.source) || 'local' });
      return true;
    },
    owns(id) { return data.owned.includes(id); },

    // `source` says where an unlock came from ('local', or later a room-wide
    // one such as 'room'); the same call serves both, so applying a shared
    // unlock to everyone present needs no API change. Returns true only
    // when the id is new.
    unlock(id, opts) {
      const ok = cleanId(id);
      if (!ok || data.unlocks.includes(ok)) return false;
      data.unlocks.push(ok);
      save();
      emit('unlock', { id: ok, source: (opts && opts.source) || 'local' });
      return true;
    },
    has(id) { return data.unlocks.includes(id); },

    // setOutfit('hat', 'sombrero'), setOutfit('hat', null) to take it off,
    // or setOutfit({ hat: 'sombrero', boots: null }) for several at once.
    setOutfit(slotOrMap, itemId) {
      const changes = typeof slotOrMap === 'string' ? { [slotOrMap]: itemId } : slotOrMap;
      if (!changes || typeof changes !== 'object') return false;
      const applied = {};
      for (const slot of Object.keys(changes)) {
        const slotId = cleanId(slot);
        if (!slotId) continue;
        const item = changes[slot];
        if (item === null || item === undefined) {
          if (slotId in data.outfit) { delete data.outfit[slotId]; applied[slotId] = null; }
        } else {
          const itemOk = cleanId(item);
          if (itemOk && data.outfit[slotId] !== itemOk) { data.outfit[slotId] = itemOk; applied[slotId] = itemOk; }
        }
      }
      if (!Object.keys(applied).length) return false;
      save();
      emit('outfit', { changes: applied, outfit: Object.assign({}, data.outfit) });
      return true;
    },

    // Keeps the best of each: highest medal, fastest time, highest style.
    recordResult(duelId, result) {
      const id = cleanId(duelId);
      const next = cleanRecord(result);
      if (!id || !next) return false;
      const { record, changed } = betterRecord(data.records[id] || {}, next);
      if (!changed) return false;
      data.records[id] = record;
      save();
      emit('record', { id, record: Object.assign({}, record) });
      return true;
    },

    exportCode() { return encodeBackup(data); },

    // Replaces the whole profile. Returns { ok: true } or { ok: false, error }.
    importCode(code) {
      const result = decodeBackup(code);
      if (result.error) return { ok: false, error: result.error };
      data = result.data;
      // An explicit restore is the player's call, so it may replace a
      // save we were protecting from an old tab.
      readOnly = false;
      save();
      emit('import', {});
      return { ok: true };
    },

    // Wipe everything (also what a test or a "start over" button wants).
    reset() {
      data = blankData();
      readOnly = false;
      save();
      emit('import', {});
    },
  };

  load();
  return profile;
}
