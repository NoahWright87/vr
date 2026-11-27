// ============================================================
// PREFAB CORE — what a usable object is, as data. Pure; tested by
// tests/prefab-core.test.js. docs/prefabs/ has the design; the
// workshop at primitives/prefabs/ edits these files.
//
// A prefab is everything that is true of an object in every game that
// uses it: its model, what it weighs, where hands go on it, where
// things come out of it and where things attach to it. What happens
// when you use it is a game's business.
//
// Everything is in the PREFAB FRAME: metres, +Y up, -Z forward (a
// gun's barrel, a flashlight's beam), origin wherever the object is
// best pivoted (a gun's main grip). `fit` is the transform that takes
// the model file into that frame, so a model that faces the wrong way
// is fixed once, here, and never by a game.
//
//   {
//     "name": "SMG",
//     "model": "kenney-blaster-kit-blaster-d",     // id in the model catalogs
//     "fit": { "pos": [0, 0.04, 0], "rot": [0, 180, 0], "scale": 0.4 },
//     "massKg": 2.4,
//     "interactions": [{
//       "id": "grip", "hands": "either",           // left | right | either
//       "occupants": [                             // one entry per hand that fits at once
//         { "pose": "pistol-grip", "pos": [0, 0, 0], "rot": [90, 0, 0] },
//         { "pose": "wrap-over", "pos": [0, 0.02, 0], "rot": [90, 0, 0] } ]
//     }],
//     "emitters": [{ "id": "muzzle", "role": "muzzle", "pos": [0, 0.06, -0.21], "rot": [0, 0, 0] }],
//     "attachments": [{ "id": "rail", "accepts": ["optic"], "pos": [0, 0.11, -0.04], "rot": [0, 0, 0] }],
//     "stats": {}                                  // yours to define; never interpreted here
//   }
//
// An occupant's pos/rot place the HAND MODEL'S OWN FRAME (the origin
// and axes of the hand .glb: fingers along -Z, palm toward -Y, thumb
// toward -X on the right hand) in the prefab frame. Written for the
// right hand; `either` mirrors it across the prefab's X = 0 plane for
// the left, unless the occupant carries its own `left` placement.
// `drives` says whether that hand's movement steers the object; it is
// the first occupant only unless set.
// ============================================================

import { compactPose, poseEquals as handPoseEquals } from './hand-pose-core.js';

export const HANDS = ['left', 'right', 'either'];
export const EXPORT_FORMAT = 'prefab-export/1';

// ---------- transforms ----------
// A transform is { pos: [x, y, z], rot: [x, y, z] }, metres and degrees,
// rotation as THREE's Euler 'XYZ'. Quaternions are [x, y, z, w].

const RAD = Math.PI / 180;

export function quatFromEuler([x, y, z]) {
  const c1 = Math.cos(x * RAD / 2), s1 = Math.sin(x * RAD / 2);
  const c2 = Math.cos(y * RAD / 2), s2 = Math.sin(y * RAD / 2);
  const c3 = Math.cos(z * RAD / 2), s3 = Math.sin(z * RAD / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

export function eulerFromQuat([x, y, z, w]) {
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
  const m22 = 1 - (xx + zz), m23 = yz - wx;
  const m32 = yz + wx, m33 = 1 - (xx + yy);
  const ey = Math.asin(Math.min(1, Math.max(-1, m13)));
  const gimbal = Math.abs(m13) >= 0.9999999;
  return [
    Math.atan2(gimbal ? m32 : -m23, gimbal ? m22 : m33) / RAD,
    ey / RAD,
    gimbal ? 0 : Math.atan2(-m12, m11) / RAD,
  ];
}

export function quatMultiply([ax, ay, az, aw], [bx, by, bz, bw]) {
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const quatInvert = ([x, y, z, w]) => [-x, -y, -z, w];

export function rotateVector(q, [vx, vy, vz]) {
  const [x, y, z, w] = q;
  // v + 2w(q × v) + 2 q × (q × v)
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

// a ∘ b: the transform that applies b first, then a.
export function composeTransforms(a, b) {
  const qa = quatFromEuler(a.rot);
  const moved = rotateVector(qa, b.pos);
  return {
    pos: [a.pos[0] + moved[0], a.pos[1] + moved[1], a.pos[2] + moved[2]],
    rot: eulerFromQuat(quatMultiply(qa, quatFromEuler(b.rot))),
  };
}

export function invertTransform(t) {
  const qi = quatInvert(quatFromEuler(t.rot));
  const p = rotateVector(qi, t.pos);
  return { pos: [-p[0], -p[1], -p[2]], rot: eulerFromQuat(qi) };
}

// The same placement seen in a mirror standing at X = 0.
export function mirrorTransform(t) {
  const [x, y, z, w] = quatFromEuler(t.rot);
  return { pos: [-t.pos[0], t.pos[1], t.pos[2]], rot: eulerFromQuat([x, -y, -z, w]) };
}

// ---------- the format ----------

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const vec3 = (v, places) => {
  const a = Array.isArray(v) ? v : [];
  return [0, 1, 2].map(i => round(Number.isFinite(a[i]) ? a[i] : 0, places));
};
const POS = 4;
const ROT = 2;

function normalizePlacement(p) {
  return { pos: vec3(p?.pos, POS), rot: vec3(p?.rot, ROT) };
}

function normalizeOccupant(o, index) {
  const out = { pose: o?.pose ?? 'grip', ...normalizePlacement(o), drives: o?.drives ?? index === 0 };
  if (o?.left) out.left = { ...normalizePlacement(o.left), ...(o.left.pose ? { pose: o.left.pose } : {}) };
  return out;
}

function normalizeInteraction(i) {
  return {
    id: i?.id ?? '',
    hands: i?.hands ?? 'either',
    occupants: (i?.occupants ?? []).map(normalizeOccupant),
  };
}

const normalizeEmitter = e => ({ id: e?.id ?? '', role: e?.role ?? '', ...normalizePlacement(e) });
const normalizeSocket = a => ({ id: a?.id ?? '', accepts: [...(a?.accepts ?? [])].map(String), ...normalizePlacement(a) });

// Every field present, numbers rounded, nothing shared with the input.
export function normalizePrefab(entry) {
  const e = entry && typeof entry === 'object' ? entry : {};
  return {
    name: e.name ?? '',
    model: e.model ?? '',
    fit: { ...normalizePlacement(e.fit), scale: round(Number.isFinite(e.fit?.scale) ? e.fit.scale : 1, 4) },
    massKg: Number.isFinite(e.massKg) ? round(e.massKg, 3) : null,
    interactions: (e.interactions ?? []).map(normalizeInteraction),
    emitters: (e.emitters ?? []).map(normalizeEmitter),
    attachments: (e.attachments ?? []).map(normalizeSocket),
    stats: e.stats && typeof e.stats === 'object' ? JSON.parse(JSON.stringify(e.stats)) : {},
  };
}

const placementJson = p => ({ pos: p.pos, rot: p.rot });

// The shortest JSON for a prefab: defaults left out, always the same key
// order, so two equal prefabs serialize equally and a diff shows only
// what someone actually changed.
export function compactPrefab(entry) {
  const n = normalizePrefab(entry);
  const out = { name: n.name, model: n.model };
  const fitDefault = n.fit.scale === 1 && n.fit.pos.every(v => v === 0) && n.fit.rot.every(v => v === 0);
  if (!fitDefault) out.fit = { ...placementJson(n.fit), scale: n.fit.scale };
  if (n.massKg !== null) out.massKg = n.massKg;
  if (n.interactions.length) {
    out.interactions = n.interactions.map(i => ({
      id: i.id, hands: i.hands,
      occupants: i.occupants.map((o, index) => {
        const c = { pose: o.pose, ...placementJson(o) };
        if (o.drives !== (index === 0)) c.drives = o.drives;
        if (o.left) c.left = { ...(o.left.pose ? { pose: o.left.pose } : {}), ...placementJson(o.left) };
        return c;
      }),
    }));
  }
  if (n.emitters.length) out.emitters = n.emitters.map(e => ({ id: e.id, role: e.role, ...placementJson(e) }));
  if (n.attachments.length) out.attachments = n.attachments.map(a => ({ id: a.id, accepts: a.accepts, ...placementJson(a) }));
  if (Object.keys(n.stats).length) out.stats = n.stats;
  return out;
}

export function prefabEquals(a, b) {
  return JSON.stringify(compactPrefab(a)) === JSON.stringify(compactPrefab(b));
}

// ---------- validation ----------

const ID = /^[a-z0-9][a-z0-9-]*$/;

// Complaints about a prefab as plain sentences; an empty list is a valid
// one. `context.poses` (a name -> pose object) and `context.hasModel`
// (id -> boolean) are checked when given.
export function validatePrefab(entry, context = {}) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['prefab must be an object'];
  const numbers = (at, v) => {
    if (!Array.isArray(v) || v.length !== 3 || !v.every(Number.isFinite)) errors.push(`${at}: must be three numbers`);
  };
  const placement = (at, p) => {
    if (!p || typeof p !== 'object') { errors.push(`${at}: missing`); return; }
    numbers(`${at}.pos`, p.pos);
    numbers(`${at}.rot`, p.rot);
  };
  const unique = (at, list) => {
    const seen = new Set();
    list.forEach((item, i) => {
      if (!item?.id || !ID.test(item.id)) errors.push(`${at}[${i}].id: "${item?.id ?? ''}" must be lowercase letters, digits and dashes`);
      else if (seen.has(item.id)) errors.push(`${at}[${i}].id: "${item.id}" is used twice`);
      seen.add(item?.id);
    });
  };
  const poseKnown = (at, name) => {
    if (context.poses && !context.poses[name]) errors.push(`${at}: unknown pose "${name}"`);
  };

  if (!entry.name) errors.push('name: missing');
  if (!entry.model) errors.push('model: missing');
  else if (context.hasModel && !context.hasModel(entry.model)) errors.push(`model: "${entry.model}" is not in the model catalogs`);
  if (entry.fit) {
    placement('fit', entry.fit);
    if (!(entry.fit.scale > 0)) errors.push('fit.scale: must be above zero');
  }
  if (entry.massKg != null && !(Number.isFinite(entry.massKg) && entry.massKg >= 0)) errors.push('massKg: must be zero or more');

  const interactions = entry.interactions ?? [];
  unique('interactions', interactions);
  interactions.forEach((point, i) => {
    const at = `interactions[${i}]`;
    if (!HANDS.includes(point.hands)) errors.push(`${at}.hands: must be left, right or either`);
    if (!Array.isArray(point.occupants) || !point.occupants.length) errors.push(`${at}.occupants: needs at least one`);
    (point.occupants ?? []).forEach((o, j) => {
      const here = `${at}.occupants[${j}]`;
      placement(here, o);
      poseKnown(`${here}.pose`, o.pose);
      if (o.drives != null && typeof o.drives !== 'boolean') errors.push(`${here}.drives: must be true or false`);
      if (o.left) {
        placement(`${here}.left`, o.left);
        if (o.left.pose) poseKnown(`${here}.left.pose`, o.left.pose);
        if (point.hands !== 'either') errors.push(`${here}.left: only an "either" point has a separate left hand`);
      }
    });
  });

  const emitters = entry.emitters ?? [];
  unique('emitters', emitters);
  emitters.forEach((e, i) => {
    placement(`emitters[${i}]`, e);
    if (!e.role) errors.push(`emitters[${i}].role: missing`);
  });

  const sockets = entry.attachments ?? [];
  unique('attachments', sockets);
  sockets.forEach((a, i) => {
    placement(`attachments[${i}]`, a);
    if (!Array.isArray(a.accepts) || !a.accepts.length) errors.push(`attachments[${i}].accepts: needs at least one type`);
  });

  if (entry.stats != null && (typeof entry.stats !== 'object' || Array.isArray(entry.stats))) errors.push('stats: must be an object');
  return errors;
}

// ---------- using a prefab ----------

// Where the hand model's frame goes, in the prefab frame, for `side`'s
// hand taking the interaction point's `index`th place. Null if that hand
// can't use the point or the point has no such place. The mirrored left
// hand of an "either" point is the right hand's placement across X = 0.
export function occupantFor(interaction, side, index = 0) {
  const o = interaction.occupants?.[index];
  if (!o) return null;
  const drives = o.drives ?? index === 0;
  if (interaction.hands !== 'either') {
    return interaction.hands === side ? { pose: o.pose, pos: o.pos, rot: o.rot, drives, mirrored: false } : null;
  }
  if (side === 'right') return { pose: o.pose, pos: o.pos, rot: o.rot, drives, mirrored: false };
  if (o.left) return { pose: o.left.pose ?? o.pose, pos: o.left.pos, rot: o.left.rot, drives, mirrored: false };
  const m = mirrorTransform(o);
  return { pose: o.pose, pos: m.pos, rot: m.rot, drives, mirrored: true };
}

// ---------- the library, and passing changes around ----------
// A library is every prefab and pose together:
//   { poses: { name: pose }, prefabs: { id: prefab } }
// The workshop edits one, and copies out only what differs from the
// committed one, which is what gets pasted back and committed.

export function cloneLibrary(library) {
  return JSON.parse(JSON.stringify({ poses: library.poses ?? {}, prefabs: library.prefabs ?? {} }));
}

// What differs between two libraries as an export: a changed or new
// entry is written out whole, a deleted one is null.
export function diffLibraries(baseline, current) {
  const out = { format: EXPORT_FORMAT, prefabs: {}, poses: {} };
  const sections = [
    ['prefabs', compactPrefab, prefabEquals],
    ['poses', pose => compactPose(pose), handPoseEquals],
  ];
  for (const [key, compact, equals] of sections) {
    const before = baseline[key] ?? {};
    const after = current[key] ?? {};
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!after[id]) out[key][id] = null;
      else if (!before[id] || !equals(before[id], after[id])) out[key][id] = compact(after[id]);
    }
  }
  return out;
}


export function isEmptyExport(exported) {
  return !Object.keys(exported.prefabs ?? {}).length && !Object.keys(exported.poses ?? {}).length;
}

// A library with an export applied to it; a null entry deletes.
export function applyExport(library, exported) {
  const out = cloneLibrary(library);
  for (const key of ['prefabs', 'poses']) {
    for (const [id, value] of Object.entries(exported[key] ?? {})) {
      if (value === null) delete out[key][id];
      else out[key][id] = JSON.parse(JSON.stringify(value));
    }
  }
  return out;
}

// Text pasted from somewhere to an export, or why not.
export function parseExport(text) {
  let value;
  try { value = JSON.parse(text); } catch (error) { return { error: `Not JSON: ${error.message}` }; }
  if (!value || typeof value !== 'object' || value.format !== EXPORT_FORMAT) {
    return { error: `Not a prefab export (expected "format": "${EXPORT_FORMAT}")` };
  }
  return { value: { format: EXPORT_FORMAT, prefabs: value.prefabs ?? {}, poses: value.poses ?? {} } };
}

// ---------- writing JSON people read ----------

function inlineJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return value.length ? `[${value.map(inlineJson).join(', ')}]` : '[]';
  const entries = Object.entries(value);
  return entries.length ? `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${inlineJson(v)}`).join(', ')} }` : '{}';
}

// JSON with whatever fits on a line kept on a line, so a placement is one
// row and a prefab a short block, not a number per line.
export function formatJson(value, width = 100, indent = '') {
  const inline = inlineJson(value);
  if (value === null || typeof value !== 'object' || indent.length + inline.length <= width) return inline;
  const inner = `${indent}  `;
  if (Array.isArray(value)) return `[\n${value.map(v => inner + formatJson(v, width, inner)).join(',\n')}\n${indent}]`;
  const rows = Object.entries(value).map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, width, inner)}`);
  return `{\n${rows.join(',\n')}\n${indent}}`;
}
