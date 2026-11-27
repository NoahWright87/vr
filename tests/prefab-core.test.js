import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyExport, cloneLibrary, compactPrefab, composeTransforms, diffLibraries, eulerFromQuat, invertTransform,
  isEmptyExport, mirrorTransform, normalizePrefab, occupantFor, parseExport, prefabEquals, quatFromEuler,
  rotateVector, validatePrefab, EXPORT_FORMAT,
} from '../common/prefab-core.js';

const close = (a, b, eps = 1e-6) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < eps);
// Two rotations are the same if their quaternions match, in either sign.
const closeAngles = (a, b) => {
  const qa = quatFromEuler(a);
  const qb = quatFromEuler(b);
  return close(qa, qb) || close(qa, qb.map(v => -v));
};

const smg = () => ({
  name: 'SMG', model: 'kenney-blaster-kit-blaster-d',
  fit: { pos: [0, 0.04, 0], rot: [0, 180, 0], scale: 0.4 },
  massKg: 2.4,
  interactions: [
    { id: 'grip', hands: 'either', occupants: [
      { pose: 'pistol-grip', pos: [0.01, -0.02, 0], rot: [80, 0, 10] },
      { pose: 'wrap-over', pos: [0.01, 0.01, 0], rot: [80, 0, 10] },
    ] },
    { id: 'left-eyecup', hands: 'left', occupants: [{ pose: 'grip', pos: [-0.05, 0, 0], rot: [0, 0, 0] }] },
  ],
  emitters: [{ id: 'muzzle', role: 'muzzle', pos: [0, 0.06, -0.21], rot: [0, 0, 0] }],
  attachments: [{ id: 'rail', accepts: ['optic'], pos: [0, 0.11, -0.04], rot: [0, 0, 0] }],
  stats: { caliber: '9mm' },
});

test('euler and quaternion agree with three.js conventions', () => {
  // THREE: new Euler(90deg, 0, 0) is a quarter turn about X; the XYZ order applies Z first.
  const q = quatFromEuler([90, 0, 0]);
  assert.ok(close(q, [Math.SQRT1_2, 0, 0, Math.SQRT1_2]));
  assert.ok(close(rotateVector(quatFromEuler([0, 90, 0]), [0, 0, -1]), [-1, 0, 0]), 'a quarter turn about Y takes forward to the left');
  assert.ok(close(rotateVector(quatFromEuler([90, 0, 0]), [0, 0, -1]), [0, 1, 0]), 'a quarter turn about X takes forward to up');
  for (const e of [[10, 20, 30], [-70, 45, 120], [0, 180, 0], [90, 0, 0], [33, -80, -170], [0, 0, 0], [20, 90, 30], [-45, -90, 10]]) {
    assert.ok(closeAngles(eulerFromQuat(quatFromEuler(e)), e), `round trip ${e}`);
  }
});

test('composing a transform with its inverse is the identity', () => {
  const t = { pos: [0.1, -0.3, 0.7], rot: [20, 70, -40] };
  const id = composeTransforms(t, invertTransform(t));
  assert.ok(close(id.pos, [0, 0, 0]));
  assert.ok(closeAngles(id.rot, [0, 0, 0]));
  const turn = { pos: [1, 0, 0], rot: [0, 90, 0] };
  const there = composeTransforms(turn, { pos: [0, 0, -1], rot: [0, 0, 0] });
  assert.ok(close(there.pos, [0, 0, 0]), 'a point one metre ahead of something turned left lands back at the origin');
});

test('mirroring is its own inverse, flips X, and keeps a symmetric placement symmetric', () => {
  const t = { pos: [0.04, 0.02, -0.1], rot: [75, 20, 40] };
  const m = mirrorTransform(t);
  assert.ok(close(m.pos, [-0.04, 0.02, -0.1]));
  const back = mirrorTransform(m);
  assert.ok(close(back.pos, t.pos));
  assert.ok(closeAngles(back.rot, t.rot));
  const onAxis = { pos: [0, 0.1, 0], rot: [90, 0, 0] };
  const same = mirrorTransform(onAxis);
  assert.ok(close(same.pos, onAxis.pos) && closeAngles(same.rot, onAxis.rot), 'pitching about X is unchanged by an X mirror');
  // A forward vector held along the hand's -Z mirrors to the mirror of where it points.
  const pointed = rotateVector(quatFromEuler(t.rot), [0, 0, -1]);
  const mirroredPointed = rotateVector(quatFromEuler(m.rot), [0, 0, -1]);
  assert.ok(close(mirroredPointed, [-pointed[0], pointed[1], pointed[2]]));
});

test('normalizing fills every field and compacting leaves defaults out', () => {
  const n = normalizePrefab({ name: 'Rock', model: 'rock' });
  assert.deepEqual(n.fit, { pos: [0, 0, 0], rot: [0, 0, 0], scale: 1 });
  assert.equal(n.massKg, null);
  assert.deepEqual(compactPrefab({ name: 'Rock', model: 'rock' }), { name: 'Rock', model: 'rock' });
  const c = compactPrefab(smg());
  assert.equal(c.interactions[0].occupants[0].drives, undefined, 'the first occupant drives by default');
  assert.equal(c.interactions[0].occupants[1].drives, undefined, 'later occupants follow by default');
  assert.deepEqual(Object.keys(c), ['name', 'model', 'fit', 'massKg', 'interactions', 'emitters', 'attachments', 'stats']);
  assert.deepEqual(compactPrefab(c), c, 'compacting twice changes nothing');
  const driving = smg();
  driving.interactions[0].occupants[1].drives = true;
  assert.equal(compactPrefab(driving).interactions[0].occupants[1].drives, true);
});

test('equal prefabs compare equal through rounding and key order', () => {
  const a = smg();
  const b = JSON.parse(JSON.stringify(a));
  b.fit.pos[1] = 0.04000000001;
  b.emitters[0] = { rot: [0, 0, 0], pos: [0, 0.06, -0.21], role: 'muzzle', id: 'muzzle' };
  assert.ok(prefabEquals(a, b));
  b.massKg = 2.5;
  assert.ok(!prefabEquals(a, b));
});

test('a valid prefab has no complaints; each kind of mistake gets its own', () => {
  const context = { poses: { grip: {}, 'pistol-grip': {}, 'wrap-over': {} }, hasModel: id => id.startsWith('kenney-') };
  assert.deepEqual(validatePrefab(smg(), context), []);
  const complaints = mutate => {
    const p = smg();
    mutate(p);
    return validatePrefab(p, context).join('\n');
  };
  assert.match(complaints(p => { p.model = 'nope'; }), /not in the model catalogs/);
  assert.match(complaints(p => { p.interactions[0].occupants[0].pose = 'jazz-hands'; }), /unknown pose "jazz-hands"/);
  assert.match(complaints(p => { p.interactions[0].hands = 'both'; }), /hands: must be left, right or either/);
  assert.match(complaints(p => { p.interactions[0].occupants = []; }), /needs at least one/);
  assert.match(complaints(p => { p.interactions[1].id = 'grip'; }), /"grip" is used twice/);
  assert.match(complaints(p => { p.emitters[0].pos = [0, 1]; }), /emitters\[0\]\.pos: must be three numbers/);
  assert.match(complaints(p => { p.emitters[0].role = ''; }), /role: missing/);
  assert.match(complaints(p => { p.attachments[0].accepts = []; }), /needs at least one type/);
  assert.match(complaints(p => { p.massKg = -1; }), /massKg/);
  assert.match(complaints(p => { p.fit.scale = 0; }), /fit\.scale/);
  assert.match(complaints(p => { p.interactions[1].occupants[0].left = { pos: [0, 0, 0], rot: [0, 0, 0] }; }), /only an "either" point/);
  assert.match(complaints(p => { p.emitters[0].id = 'Muzzle Flash'; }), /lowercase letters/);
});

test('which hand gets which placement: either mirrors, left and right are as written, and a left override wins', () => {
  const point = normalizePrefab(smg()).interactions;
  const right = occupantFor(point[0], 'right', 0);
  const left = occupantFor(point[0], 'left', 0);
  assert.deepEqual(right.pos, [0.01, -0.02, 0]);
  assert.equal(right.mirrored, false);
  assert.equal(left.mirrored, true);
  assert.ok(close(left.pos, [-0.01, -0.02, 0]));
  assert.equal(left.pose, 'pistol-grip');
  assert.equal(right.drives, true);
  assert.equal(occupantFor(point[0], 'right', 1).drives, false);
  assert.equal(occupantFor(point[0], 'left', 2), null, 'no third place');
  assert.equal(occupantFor(point[1], 'right', 0), null, 'a left-only point is not for the right hand');
  assert.deepEqual(occupantFor(point[1], 'left', 0).pos, [-0.05, 0, 0]);
  const custom = normalizePrefab({
    ...smg(),
    interactions: [{ id: 'grip', hands: 'either', occupants: [{ pose: 'grip', pos: [0.02, 0, 0], rot: [0, 0, 0], left: { pos: [-0.03, 0.01, 0], rot: [0, 0, 5], pose: 'pistol-grip' } }] }],
  }).interactions[0];
  const override = occupantFor(custom, 'left', 0);
  assert.deepEqual(override.pos, [-0.03, 0.01, 0]);
  assert.equal(override.pose, 'pistol-grip');
  assert.equal(override.mirrored, false);
});

test('an export holds only what changed, whole, and nulls for what was deleted', () => {
  const baseline = { poses: { grip: { fingers: { index: 0.5 } }, old: { fingers: {} } }, prefabs: { smg: smg(), rock: { name: 'Rock', model: 'rock' } } };
  const current = cloneLibrary(baseline);
  assert.ok(isEmptyExport(diffLibraries(baseline, current)), 'nothing edited, nothing to export');

  current.prefabs.smg.massKg = 3;
  current.prefabs.smg.fit.pos[1] += 0.0000001;
  delete current.prefabs.rock;
  delete current.poses.old;
  current.poses.pinch = { fingers: { thumb: 0.5, index: 0.5 } };
  current.poses.grip = { fingers: { index: [0.5, 0.5, 0.5] } };
  current.prefabs.crate = { name: 'Crate', model: 'crate' };

  const out = diffLibraries(baseline, current);
  assert.equal(out.format, EXPORT_FORMAT);
  assert.deepEqual(Object.keys(out.prefabs).sort(), ['crate', 'rock', 'smg']);
  assert.equal(out.prefabs.smg.massKg, 3);
  assert.equal(out.prefabs.smg.name, 'SMG', 'a changed prefab is written whole');
  assert.equal(out.prefabs.rock, null);
  assert.deepEqual(out.prefabs.crate, { name: 'Crate', model: 'crate' });
  assert.deepEqual(Object.keys(out.poses).sort(), ['old', 'pinch'], 'a respelled but identical pose is not a change');
  assert.equal(out.poses.old, null);
  assert.deepEqual(out.poses.pinch, { fingers: { thumb: 0.5, index: 0.5 } });

  const rebuilt = applyExport(baseline, out);
  assert.ok(isEmptyExport(diffLibraries(current, rebuilt)), 'applying the export to the baseline gives the edited library');
  assert.ok(baseline.prefabs.rock, 'applying does not touch the original');
});

test('pasted exports are read back, or refused with a reason', () => {
  const library = { poses: {}, prefabs: { smg: smg() } };
  const text = JSON.stringify(diffLibraries({ poses: {}, prefabs: {} }, library), null, 2);
  const parsed = parseExport(text);
  assert.ok(!parsed.error);
  assert.deepEqual(Object.keys(parsed.value.prefabs), ['smg']);
  assert.match(parseExport('{nope').error, /Not JSON/);
  assert.match(parseExport('{"prefabs":{}}').error, /Not a prefab export/);
  assert.match(parseExport('[]').error, /Not a prefab export/);
});
