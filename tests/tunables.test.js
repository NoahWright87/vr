import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createTunableGroup,
  setTunable,
  resetTunables,
  normalizeTunable,
  toMenuValue,
  fromMenuValue,
  formatTunable,
  summarizeTunables,
  changedTunables,
  applyTunables,
  encodeTuneParam,
  decodeTuneParam,
} from '../common/tunables.js';

const DEFS = [
  { key: 'rate', label: 'Rate', value: 4, min: 1, max: 20, step: 1, unit: '/s' },
  { key: 'present', label: 'Present', value: 0.55, min: 20, max: 100, step: 5, unit: '%', scale: 100 },
  { key: 'aim', label: 'Aim', kind: 'select', value: 'soft', options: [{ value: 'none', label: 'None' }, { value: 'soft', label: 'Soft' }] },
  { key: 'tracers', label: 'Tracers', kind: 'toggle', value: true },
];

test('a group starts at its defaults', () => {
  const g = createTunableGroup('gun', 'Gun', DEFS);
  assert.deepEqual(g.values, { rate: 4, present: 0.55, aim: 'soft', tracers: true });
});

test('numbers clamp and snap to their step in menu units', () => {
  const g = createTunableGroup('gun', 'Gun', DEFS);
  assert.equal(setTunable(g, 'rate', 99), 20);
  assert.equal(setTunable(g, 'rate', 0), 1);
  assert.equal(setTunable(g, 'rate', 6.4), 6);
  // Stored 0.62 is shown as 62 with step 5 -> 60 -> stored 0.6.
  assert.equal(setTunable(g, 'present', 0.62), 0.6);
  assert.equal(setTunable(g, 'present', 0.1), 0.2);
  assert.equal(setTunable(g, 'rate', 'nonsense'), 4); // back to default rather than NaN
  assert.equal(setTunable(g, 'missing', 1), undefined);
});

test('selects only take listed options; toggles become booleans', () => {
  const g = createTunableGroup('gun', 'Gun', DEFS);
  assert.equal(setTunable(g, 'aim', 'none'), 'none');
  assert.equal(setTunable(g, 'aim', 'laser'), 'soft');
  assert.equal(setTunable(g, 'tracers', 0), false);
});

test('scale converts between stored and menu units', () => {
  const def = DEFS[1];
  assert.equal(toMenuValue(def, 0.55), 55);
  assert.equal(fromMenuValue(def, 70), 0.7);
  assert.equal(toMenuValue(DEFS[2], 'soft'), 'soft');
  assert.equal(normalizeTunable(def, 0.3), 0.3);
});

test('formatting and the summary show menu units with the unit attached', () => {
  const g = createTunableGroup('gun', 'Gun', DEFS);
  assert.equal(formatTunable(DEFS[0], 4), '4/s');
  assert.equal(formatTunable(DEFS[1], 0.55), '55%');
  assert.equal(formatTunable(DEFS[2], 'soft'), 'Soft');
  assert.equal(formatTunable(DEFS[3], false), 'Off');
  assert.equal(summarizeTunables(g), 'Rate 4/s\nPresent 55%\nAim Soft\nTracers On');
});

test('only changed values are exported, and they round-trip through a URL param', () => {
  const g = createTunableGroup('gun', 'Gun', DEFS);
  setTunable(g, 'rate', 8);
  setTunable(g, 'aim', 'none');
  const changed = changedTunables(g);
  assert.deepEqual(changed, { rate: 8, aim: 'none' });
  const encoded = encodeTuneParam({ gun: changed });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeTuneParam(encoded), { gun: { rate: 8, aim: 'none' } });

  const fresh = createTunableGroup('gun', 'Gun', DEFS);
  applyTunables(fresh, decodeTuneParam(encoded).gun);
  assert.equal(fresh.values.rate, 8);
  assert.equal(fresh.values.aim, 'none');
  resetTunables(fresh);
  assert.equal(fresh.values.rate, 4);
});

test('a broken URL param decodes to null rather than throwing', () => {
  assert.equal(decodeTuneParam('%%%not-base64'), null);
  assert.equal(decodeTuneParam(encodeTuneParam('just a string')), null);
});
