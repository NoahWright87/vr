import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FRAME_DEFAULTS, clampFrame, sheetToLocal, sheetToCamera, sheetAngles,
  sheetHalfExtents, layoutSlots, splitSlot, menuLayout, gameKey,
  loadCalibration, saveCalibration, switchScope, STORAGE_KEY,
} from '../common/visor-frame.js';

function close(actual, expected, tolerance, message) {
  assert.ok(Math.abs(actual - expected) <= tolerance, (message || '') + ` expected ${expected}, got ${actual}`);
}

function memoryStorage() {
  var data = {};
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    raw: data,
  };
}

test('the sheet middle is straight ahead at the frame distance, whatever the bend', () => {
  for (const bend of [0, 0.5, 1]) {
    const p = sheetToLocal(0, 0, Object.assign({}, FRAME_DEFAULTS, { bend, bendY: bend }));
    close(p.x, 0, 1e-9); close(p.y, 0, 1e-9); close(p.z, -FRAME_DEFAULTS.distance, 1e-9);
  }
});

test('full bend wraps every column onto a circle around the eye', () => {
  const frame = Object.assign({}, FRAME_DEFAULTS, { bend: 1, bendY: 0 });
  for (const x of [-1, -0.4, 0.3, 1.2]) {
    const p = sheetToLocal(x, 0, frame);
    close(Math.hypot(p.x, p.z), frame.distance, 1e-9, `column at ${x}`);
  }
});

test('a flat sheet stays a plane at the frame distance', () => {
  const frame = Object.assign({}, FRAME_DEFAULTS, { bend: 0, bendY: 0 });
  const p = sheetToLocal(0.7, -0.3, frame);
  close(p.x, 0.7, 1e-9); close(p.y, -0.3, 1e-9); close(p.z, -frame.distance, 1e-9);
});

test('the frame edges appear at exactly the width and height asked for', () => {
  for (const bend of [0, 0.4, 1]) {
    for (const bendY of [0, 1]) {
      const frame = Object.assign({}, FRAME_DEFAULTS, { width: 70, height: 44, bend, bendY });
      const ext = sheetHalfExtents(frame);
      close(sheetAngles(ext.halfW, 0, frame).yaw, 35, 1e-3, `bend ${bend}/${bendY} width`);
      close(sheetAngles(0, ext.halfH, frame).pitch, 22, 1e-3, `bend ${bend}/${bendY} height`);
    }
  }
});

test('lift pitches the whole sheet about the eye', () => {
  const frame = Object.assign({}, FRAME_DEFAULTS, { lift: 10 });
  const p = sheetToCamera(0, 0, frame);
  close(Math.atan2(p.y, -p.z) * 180 / Math.PI, 10, 1e-9);
  close(Math.hypot(p.y, p.z), frame.distance, 1e-9);
});

test('slots sit inside the frame, corners square, bars clear of the corners', () => {
  const layout = layoutSlots(FRAME_DEFAULTS);
  const { slots, halfW, halfH } = layout;
  for (const [name, r] of Object.entries(slots)) {
    assert.ok(r.x - r.w / 2 >= -halfW - 1e-9 && r.x + r.w / 2 <= halfW + 1e-9, `${name} inside horizontally`);
    assert.ok(r.y - r.h / 2 >= -halfH - 1e-9 && r.y + r.h / 2 <= halfH + 1e-9, `${name} inside vertically`);
  }
  for (const name of ['top-left', 'top-right', 'bottom-left', 'bottom-right']) close(slots[name].w, slots[name].h, 1e-12, name);
  assert.ok(slots.top.x + slots.top.w / 2 < slots['top-right'].x - slots['top-right'].w / 2);
  assert.ok(slots.above.y > slots.reticle.y + slots.reticle.h / 2);
  assert.ok(slots.below.y < slots.reticle.y - slots.reticle.h / 2);
});

test('a shared slot splits along its long side in order', () => {
  const across = splitSlot({ x: 0, y: 0, w: 4, h: 1 }, [1, 3], false);
  close(across[0].x, -1.5, 1e-12); close(across[0].w, 1, 1e-12);
  close(across[1].x, 0.5, 1e-12); close(across[1].w, 3, 1e-12);
  const down = splitSlot({ x: 0, y: 0, w: 1, h: 2 }, [1, 1], true);
  close(down[0].y, 0.5, 1e-12); close(down[1].y, -0.5, 1e-12);
});

test('the visor menu fits inside the frame, its far edge on the frame edge', async () => {
  const { menuOuterEdge } = await import('../common/visor-frame.js');
  for (const width of [50, 72, 96]) {
    const frame = Object.assign({}, FRAME_DEFAULTS, { width });
    const menu = menuLayout(frame);
    close(menuOuterEdge(menu.position, menu.curve, menu.width), width / 2, 1e-6, `frame ${width}`);
    assert.ok(menu.position < width / 2 && menu.width > 0);
    close(menu.height, frame.height * 0.9, 1e-12);
  }
});

test('settings are clamped and missing ones fall back to the defaults', () => {
  const frame = clampFrame({ width: 500, bend: -1, lift: 'nope' });
  assert.equal(frame.width, 100);
  assert.equal(frame.bend, 0);
  assert.equal(frame.lift, FRAME_DEFAULTS.lift);
  assert.equal(frame.height, FRAME_DEFAULTS.height);
});

test('a game key ignores the page file name', () => {
  assert.equal(gameKey('/games/pistols-at-dawn/index.html'), '/games/pistols-at-dawn/');
  assert.equal(gameKey('/games/pistols-at-dawn/'), '/games/pistols-at-dawn/');
});

test('calibration is shared between games until one is switched to its own', () => {
  const storage = memoryStorage();
  assert.equal(loadCalibration(storage, '/a/').saved, false);
  saveCalibration(storage, '/a/', 'shared', { width: 70 });
  assert.equal(loadCalibration(storage, '/b/').frame.width, 70, 'game b sees the shared calibration');
  assert.equal(loadCalibration(storage, '/b/').saved, true);

  const own = switchScope(storage, '/b/', 'game', { width: 70 });
  assert.equal(own.width, 70, 'starts from what you had');
  saveCalibration(storage, '/b/', 'game', { width: 50 });
  assert.equal(loadCalibration(storage, '/b/').frame.width, 50);
  assert.equal(loadCalibration(storage, '/b/').scope, 'game');
  assert.equal(loadCalibration(storage, '/a/').frame.width, 70, 'the shared one is untouched');

  const back = switchScope(storage, '/b/', 'shared', { width: 50 });
  assert.equal(back.width, 70);
  assert.equal(loadCalibration(storage, '/b/').scope, 'shared');
  switchScope(storage, '/b/', 'game', back);
  assert.equal(loadCalibration(storage, '/b/').frame.width, 50, 'the game copy was kept');
});

test('broken or missing storage never throws', () => {
  const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(loadCalibration(broken, '/a/').frame.width, FRAME_DEFAULTS.width);
  saveCalibration(broken, '/a/', 'shared', { width: 70 });
  saveCalibration(null, '/a/', 'shared', { width: 70 });
  const corrupt = memoryStorage();
  corrupt.setItem(STORAGE_KEY, '{nope');
  assert.equal(loadCalibration(corrupt, '/a/').saved, false);
});

test('HUD preferences are cleaned: rings stay nested, unknown values fall back', async () => {
  const { cleanPreferences, loadPreferences, savePreferences, PREFERENCE_DEFAULTS } = await import('../common/visor-frame.js');
  const prefs = cleanPreferences({ rings: [10, 4, 2], targeting: 'sometimes', others: 99, opacity: 0 });
  assert.deepEqual(prefs.rings, [10, 10, 10]);
  assert.equal(prefs.targeting, PREFERENCE_DEFAULTS.targeting);
  assert.equal(prefs.others, 10);
  assert.equal(prefs.opacity, 0.1);
  const storage = memoryStorage();
  savePreferences(storage, { bracket: 'angle' });
  assert.equal(loadPreferences(storage).bracket, 'angle');
});

test('sheetOffsetForAngle inverts sheetAngles', async () => {
  const { sheetOffsetForAngle } = await import('../common/visor-frame.js');
  const frame = Object.assign({}, FRAME_DEFAULTS, { bend: 0.6, bendY: 0.3 });
  close(sheetAngles(sheetOffsetForAngle(12, frame, false), 0, frame).yaw, 12, 1e-3);
  close(sheetAngles(0, sheetOffsetForAngle(9, frame, true), frame).pitch, 9, 1e-3);
});
