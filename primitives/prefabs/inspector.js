// ============================================================
// WORKSHOP INSPECTOR — the right-hand panels: a prefab's sections, the
// hand pose editor, and what to copy out.
//
// Each panel is rebuilt when its structure changes (a row added, a
// different thing opened) and merely re-read, through `fields.sync()`,
// when a number changes under it (a gizmo drag).
// ============================================================

import { FINGERS, JOINTS, LIMITS, compactPose, normalizePose } from '../../common/hand-pose-core.js';
import { formatJson, normalizePrefab, occupantFor, parseExport } from '../../common/prefab-core.js';
import { sameSelection, select } from './selection.js';
import { createFields, h } from './ui.js';

const ID = /^[a-z0-9][a-z0-9-]*$/;
const THREE = AFRAME.THREE;
// The hand model's own clips, which a new pose can start from.
const BAKED_CLIPS = ['Open', 'Fist', 'Hold', 'Grip', 'Point', 'Thumb Up', 'Point + Thumb'];
const ROLES = ['muzzle', 'eject', 'exhaust', 'smoke', 'spark', 'dust', 'trail', 'flash', 'drip'];
const clone = value => JSON.parse(JSON.stringify(value));

export function uniqueId(taken, base) {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// A titled, collapsible block that remembers whether it was open.
function section(app, key, title, count, ...body) {
  const open = app.openSections.has(key);
  const el = h('details', { class: 'sec', open }, h('summary', {}, title, count == null ? '' : h('span', { class: 'count' }, count)), h('div', { class: 'sec-body' }, body));
  el.addEventListener('toggle', () => { if (el.open) app.openSections.add(key); else app.openSections.delete(key); });
  return el;
}

const row = (label, ...controls) => h('div', { class: 'row' }, h('span', { class: 'lab' }, label), controls);

// Place and turn of one thing, as two rows of three numbers.
function placementRows(fields, getPlacement, change) {
  return [
    row('pos m', fields.vec3({
      title: 'position', step: 0.005, places: 3,
      get: () => getPlacement().pos,
      set: (axis, value) => change(placement => { placement.pos[axis] = value; }),
    })),
    row('rot °', fields.vec3({
      title: 'rotation', step: 5, places: 1,
      get: () => getPlacement().rot,
      set: (axis, value) => change(placement => { placement.rot[axis] = value; }),
    })),
  ];
}

// ---------- the prefab tab ----------

function createCard(app) {
  const { store } = app;
  const asset = app.assetById(app.modelId);
  const suggestion = (asset?.file ?? 'prefab').split('/').pop().replace(/\.[^.]+$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const idInput = h('input', { type: 'text', class: 'txt', value: uniqueId(Object.keys(store.library.prefabs), suggestion), spellcheck: false });
  const nameInput = h('input', { type: 'text', class: 'txt', value: asset?.name ?? '' });
  const message = h('p', { class: 'note' });
  const create = () => {
    const id = idInput.value.trim();
    if (!ID.test(id)) { message.textContent = 'The id must be lowercase letters, digits and dashes.'; return; }
    if (store.library.prefabs[id]) { message.textContent = `There is already a prefab called "${id}".`; return; }
    store.update(lib => { lib.prefabs[id] = normalizePrefab({ name: nameInput.value.trim() || id, model: app.modelId }); });
    app.openPrefab(id);
  };
  return h('div', { class: 'card' },
    h('h3', {}, 'No prefab for this model yet'),
    h('p', { class: 'note' }, `${asset?.name ?? app.modelId} is a model. Make it a prefab to place hands, emitters and attachment points on it, and give it a weight.`),
    row('id', idInput), row('name', nameInput),
    h('button', { class: 'primary', onClick: create }, 'Create prefab'), message);
}

function fitSection(app, fields, edit) {
  const entry = () => app.entry();
  const bounds = () => app.view.fittedBounds();
  const sizeLine = h('p', { class: 'note size' });
  const showSize = () => {
    const box = bounds();
    if (!box) { sizeLine.textContent = 'Loading model…'; return; }
    const size = box.getSize(new THREE.Vector3());
    sizeLine.textContent = `${size.x.toFixed(3)} × ${size.y.toFixed(3)} × ${size.z.toFixed(3)} m (x, y, z). −Z is forward.`;
  };
  app.afterModelLoad = showSize;
  showSize();
  const nudge = (kind) => () => {
    const box = bounds();
    if (!box) return;
    const center = box.getCenter(new THREE.Vector3());
    edit(prefab => {
      if (kind === 'center' || kind === 'floor-center') { prefab.fit.pos[0] -= center.x; prefab.fit.pos[2] -= center.z; }
      if (kind === 'center') prefab.fit.pos[1] -= center.y;
      if (kind === 'floor' || kind === 'floor-center') prefab.fit.pos[1] -= box.min.y;
      if (kind === 'turn') prefab.fit.rot[1] += 90;
      if (kind === 'flip') prefab.fit.rot[1] += 180;
    });
    app.view.refresh();
    showSize();
  };
  const lengthInput = h('input', { type: 'number', class: 'num', step: 0.01, min: 0.001, placeholder: 'm' });
  const setLength = () => {
    const box = bounds();
    const target = parseFloat(lengthInput.value);
    if (!box || !(target > 0)) return;
    const size = box.getSize(new THREE.Vector3());
    edit(prefab => { prefab.fit.scale = Math.round(prefab.fit.scale * target / Math.max(size.x, size.y, size.z) * 1e4) / 1e4; });
    app.view.refresh();
    showSize();
  };
  return section(app, 'fit', 'Model fit', null,
    h('p', { class: 'note' }, 'Takes the model file into the prefab frame: grip at the origin, barrel or front toward −Z, up is +Y.'),
    ...placementRows(fields, () => entry().fit, change => edit(prefab => change(prefab.fit))),
    row('scale', fields.number({ title: 'scale', step: 0.01, places: 4, min: 0.0001, get: () => entry().fit.scale, set: v => edit(prefab => { prefab.fit.scale = v; }) })),
    row('longest side', lengthInput, h('button', { onClick: setLength }, 'Set m')),
    sizeLine,
    h('div', { class: 'buttons' },
      h('button', { onClick: nudge('center') }, 'Centre'),
      h('button', { onClick: nudge('floor-center') }, 'Centre, sit on floor'),
      h('button', { onClick: nudge('floor') }, 'Sit on floor'),
      h('button', { onClick: nudge('turn') }, 'Turn 90°'),
      h('button', { onClick: nudge('flip') }, 'Flip 180°')),
    h('button', { class: sameSelection(app.selection, select.fit()) ? 'on' : '', onClick: () => app.select(select.fit()) }, 'Drag with gizmo'));
}

function interactionSection(app, fields, edit) {
  const entry = () => app.entry();
  const poseNames = () => Object.keys(app.store.library.poses);
  // A pose that has gone missing still shows, so the box doesn't silently say something else.
  const poseOptions = current => [...new Set([...poseNames(), ...(current ? [current] : [])])]
    .map(value => ({ value, label: app.store.library.poses[value]?.label || (poseNames().includes(value) ? value : `${value} (missing)`) }));

  const cards = entry().interactions.map((interaction, i) => {
    const at = () => entry().interactions[i];
    const occupants = interaction.occupants.map((occupant, j) => {
      const here = () => at().occupants[j];
      const selected = sameSelection(app.selection, select.occupant(i, j));
      const selectedLeft = sameSelection(app.selection, select.occupant(i, j, true));
      return h('div', { class: `occupant${selected || selectedLeft ? ' selected' : ''}` },
        h('div', { class: 'head' },
          h('strong', {}, `Hand ${j + 1}`),
          fields.select({ title: 'pose', options: poseOptions(occupant.pose), get: () => here().pose, set: v => edit(() => { here().pose = v; }) }),
          fields.check({ label: 'steers', title: 'This hand’s movement steers the object', get: () => here().drives, set: v => edit(() => { here().drives = v; }) }),
          h('button', { class: selected ? 'on' : '', title: 'Drag this hand with the gizmo', onClick: () => app.select(select.occupant(i, j)) }, '✥'),
          h('button', { class: 'danger', title: 'Remove this hand position', onClick: () => { edit(() => at().occupants.splice(j, 1)); app.afterSelectionStale(); app.renderInspector(); } }, '×')),
        ...placementRows(fields, () => here(), change => edit(() => change(here()))),
        at().hands === 'either' ? [
          fields.check({
            label: 'its own left hand', title: 'Off: the left hand is the right one mirrored',
            get: () => Boolean(here().left),
            set: on => {
              edit(() => {
                if (on) {
                  const mirrored = occupantFor(at(), 'left', j);
                  here().left = { pos: [...mirrored.pos], rot: [...mirrored.rot] };
                } else delete here().left;
              });
              if (!on && selectedLeft) app.select(select.occupant(i, j));
              app.renderInspector();
            },
          }),
          here().left ? h('div', { class: `left${selectedLeft ? ' selected' : ''}` },
            h('div', { class: 'head' }, h('strong', {}, 'Left hand'),
              fields.select({ title: 'left pose', options: [{ value: '', label: '(same pose)' }, ...poseOptions(here().left?.pose)], get: () => here().left?.pose ?? '', set: v => edit(() => { if (v) here().left.pose = v; else delete here().left.pose; }) }),
              h('button', { class: selectedLeft ? 'on' : '', onClick: () => app.select(select.occupant(i, j, true)) }, '✥')),
            ...placementRows(fields, () => here().left ?? { pos: [0, 0, 0], rot: [0, 0, 0] }, change => edit(() => change(here().left)))) : null,
        ] : null);
    });
    return h('div', { class: 'card' },
      h('div', { class: 'head' },
        fields.text({ title: 'interaction point id', get: () => at().id, set: v => edit(() => { at().id = v; }) }),
        fields.select({
          title: 'which hands', options: [{ value: 'either', label: 'either hand' }, { value: 'left', label: 'left only' }, { value: 'right', label: 'right only' }],
          get: () => at().hands, set: v => { edit(() => { at().hands = v; if (v !== 'either') at().occupants.forEach(o => delete o.left); }); app.renderInspector(); },
        }),
        h('button', { class: 'danger', title: 'Remove this interaction point', onClick: () => { edit(() => entry().interactions.splice(i, 1)); app.afterSelectionStale(); app.renderInspector(); } }, '×')),
      occupants,
      h('button', {
        onClick: () => {
          edit(() => {
            const last = at().occupants.at(-1);
            at().occupants.push({ pose: last?.pose ?? 'hold', pos: clone(last?.pos ?? [0, 0, 0]), rot: clone(last?.rot ?? [0, 0, 0]), drives: false });
          });
          app.select(select.occupant(i, at().occupants.length - 1));
          app.renderInspector();
        },
      }, '+ another hand at this point'));
  });

  return section(app, 'interactions', 'Where hands go', entry().interactions.length,
    h('p', { class: 'note' }, 'Each point has a place per hand that can use it at once. Place the right hand; the left is its mirror unless you give it its own. A hand is the hand model’s frame: fingers along −Z, palm toward −Y.'),
    cards,
    h('button', {
      onClick: () => {
        const taken = entry().interactions.map(x => x.id);
        edit(() => entry().interactions.push({ id: uniqueId(taken, 'grip'), hands: 'either', occupants: [{ pose: 'hold', pos: [0, 0, 0], rot: [0, 0, 0], drives: true }] }));
        app.select(select.occupant(entry().interactions.length - 1, 0));
        app.renderInspector();
      },
    }, '+ interaction point'));
}

function anchorSection(app, fields, edit, { key, title, listKey, kind, make, note, extra }) {
  const entry = () => app.entry();
  const items = entry()[listKey].map((item, i) => {
    const at = () => entry()[listKey][i];
    const chosen = sameSelection(app.selection, select[kind](i));
    return h('div', { class: `card${chosen ? ' selected' : ''}` },
      h('div', { class: 'head' },
        fields.text({ title: 'id', get: () => at().id, set: v => edit(() => { at().id = v; }) }),
        extra.field(fields, at, edit),
        h('button', { class: chosen ? 'on' : '', title: 'Drag with the gizmo', onClick: () => app.select(select[kind](i)) }, '✥'),
        h('button', { class: 'danger', onClick: () => { edit(() => entry()[listKey].splice(i, 1)); app.afterSelectionStale(); app.renderInspector(); } }, '×')),
      ...placementRows(fields, at, change => edit(() => change(at()))));
  });
  return section(app, key, title, entry()[listKey].length, h('p', { class: 'note' }, note), items,
    h('button', {
      onClick: () => {
        const taken = entry()[listKey].map(x => x.id);
        edit(() => entry()[listKey].push(make(uniqueId(taken, extra.base))));
        app.select(select[kind](entry()[listKey].length - 1));
        app.renderInspector();
      },
    }, `+ ${extra.add}`));
}

function statsSection(app, edit) {
  const entry = () => app.entry();
  const area = h('textarea', { class: 'json', rows: 5, spellcheck: false, value: JSON.stringify(entry().stats, null, 2) });
  const message = h('p', { class: 'note' });
  area.addEventListener('input', () => {
    try {
      const value = JSON.parse(area.value || '{}');
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('must be an object');
      edit(() => { entry().stats = value; });
      area.classList.remove('bad');
      message.textContent = '';
    } catch (error) { area.classList.add('bad'); message.textContent = `Not saved: ${error.message}`; }
  });
  return section(app, 'stats', 'Stats', Object.keys(entry().stats).length || null,
    h('p', { class: 'note' }, 'Anything a shared universe should agree on: damage, caliber, price. Nothing here reads it; each game takes the keys it understands.'),
    area, message);
}

export function prefabPanel(app) {
  const { store } = app;
  if (!app.prefabId) return app.modelId ? createCard(app) : h('p', { class: 'note' }, 'Pick a prefab or a model on the left.');
  const fields = createFields();
  app.syncFields = fields.sync;
  const id = app.prefabId;
  const entry = () => app.entry();
  const edit = fn => store.update(lib => fn(lib.prefabs[id]), 'edit');
  const rolesList = h('datalist', { id: 'roles' }, ROLES.map(r => h('option', { value: r })));

  return h('div', {},
    h('div', { class: 'card identity' },
      h('div', { class: 'head' }, h('code', {}, id), store.isPrefabChanged(id) ? h('span', { class: 'dot', title: 'Changed since the last commit' }, '● changed') : null),
      row('name', fields.text({ title: 'name', get: () => entry().name, set: v => edit(prefab => { prefab.name = v; }) })),
      row('model', h('span', { class: 'model-id' }, entry().model)),
      row('mass kg', fields.number({ title: 'mass in kilograms', step: 0.1, places: 3, min: 0, nullable: true, placeholder: 'unset', get: () => entry().massKg, set: v => edit(prefab => { prefab.massKg = v; }) })),
      h('div', { class: 'buttons' },
        h('button', { onClick: () => { store.revertPrefab(id); if (!store.library.prefabs[id]) app.closePrefab(); else app.renderInspector(); } }, store.baseline.prefabs[id] ? 'Revert to committed' : 'Discard new prefab'),
        h('button', { onClick: () => app.duplicatePrefab() }, 'Duplicate'),
        h('button', { class: 'danger', onClick: () => app.deletePrefab() }, 'Delete'))),
    fitSection(app, fields, edit),
    interactionSection(app, fields, edit),
    anchorSection(app, fields, edit, {
      key: 'emitters', title: 'Emitters', listKey: 'emitters', kind: 'emitter',
      note: 'Where things come out: muzzle flash, shell casings, exhaust. −Z is out; the dashed line is the way it points.',
      make: emitterId => ({ id: emitterId, role: 'muzzle', pos: [0, 0, 0], rot: [0, 0, 0] }),
      extra: { base: 'muzzle', add: 'emitter', field: (f, at, e) => f.text({ title: 'role', list: 'roles', placeholder: 'role', get: () => at().role, set: v => e(() => { at().role = v; }) }) },
    }),
    anchorSection(app, fields, edit, {
      key: 'attachments', title: 'Attachment sockets', listKey: 'attachments', kind: 'socket',
      note: 'Where other prefabs attach: a rail for optics, a muzzle for a silencer. “Accepts” is a list of types, separated by commas.',
      make: socketId => ({ id: socketId, accepts: ['optic'], pos: [0, 0, 0], rot: [0, 0, 0] }),
      extra: { base: 'socket', add: 'socket', field: (f, at, e) => f.text({ title: 'accepts', placeholder: 'accepts', get: () => at().accepts.join(', '), set: v => e(() => { at().accepts = v.split(',').map(s => s.trim()).filter(Boolean); }) }) },
    }),
    statsSection(app, edit),
    rolesList);
}

// ---------- the poses tab ----------

function jointRow(fields, label, get, set) {
  return h('div', { class: 'joint' }, h('span', { class: 'lab' }, label),
    ...['curl', 'spread', 'twist'].map(dof => fields.slider({
      title: dof, min: LIMITS[dof][0], max: LIMITS[dof][1], step: dof === 'curl' ? 0.01 : 0.5, places: dof === 'curl' ? 2 : 1,
      get: () => get()[dof], set: value => set(dof, value),
    })));
}

export function posesPanel(app) {
  const { store } = app;
  const names = Object.keys(store.library.poses);
  if (!store.library.poses[app.poseName]) app.poseName = names[0];
  const fields = createFields();
  app.syncFields = fields.sync;
  const name = app.poseName;
  const pose = () => store.library.poses[name];
  const edit = fn => store.update(lib => fn(lib.poses[name]), 'edit');
  const nameInput = h('input', { type: 'text', class: 'txt', value: name, spellcheck: false });
  const message = h('p', { class: 'note' });
  const usage = () => {
    const places = [];
    for (const [id, prefab] of Object.entries(store.library.prefabs)) {
      prefab.interactions.forEach(point => point.occupants.forEach(o => {
        if (o.pose === name || o.left?.pose === name) places.push(`${id}/${point.id}`);
      }));
    }
    return places;
  };
  const wanted = () => {
    const value = nameInput.value.trim();
    if (!ID.test(value)) { message.textContent = 'A pose name is lowercase letters, digits and dashes.'; return null; }
    if (store.library.poses[value]) { message.textContent = `There is already a pose called "${value}".`; return null; }
    message.textContent = '';
    return value;
  };
  const adopt = value => { app.poseName = value; app.updatePreview(); app.renderInspector(); };

  const rename = () => {
    const value = wanted();
    if (!value) return;
    store.update(lib => {
      lib.poses[value] = lib.poses[name];
      delete lib.poses[name];
      for (const prefab of Object.values(lib.prefabs)) {
        prefab.interactions.forEach(point => point.occupants.forEach(o => {
          if (o.pose === name) o.pose = value;
          if (o.left?.pose === name) o.left.pose = value;
        }));
      }
    });
    adopt(value);
  };
  const duplicate = () => {
    const value = wanted();
    if (!value) return;
    store.update(lib => { lib.poses[value] = clone(lib.poses[name]); });
    adopt(value);
  };
  const create = () => {
    const value = wanted();
    if (!value) return;
    store.update(lib => { lib.poses[value] = normalizePose({}); });
    adopt(value);
  };
  const remove = () => {
    const places = usage();
    if (places.length) { message.textContent = `Used by ${places.slice(0, 4).join(', ')}${places.length > 4 ? '…' : ''}: give those another pose first.`; return; }
    store.update(lib => { delete lib.poses[name]; });
    adopt(Object.keys(store.library.poses)[0]);
  };

  const clipSelect = h('select', {}, [h('option', { value: '' }, 'Start from a baked clip…'), ...BAKED_CLIPS.map(c => h('option', { value: c }, c))]);
  clipSelect.addEventListener('change', async () => {
    if (!clipSelect.value) return;
    try {
      const measured = normalizePose(compactPose(await app.view.measureClip(clipSelect.value)));
      edit(target => { target.fingers = measured.fingers; });
      fields.sync();
    } catch (error) { message.textContent = error.message; }
    clipSelect.value = '';
  });

  const finger = f => {
    const open = app.openFingers.has(f);
    const joints = open ? [h('div', { class: 'joint-head' }, h('span', {}, 'curl'), h('span', {}, 'spread °'), h('span', {}, 'twist °')), ...[0, 1, 2].map(j => jointRow(fields, 'abc'[j], () => pose().fingers[f][j], (dof, v) => edit(target => { target.fingers[f][j][dof] = Math.min(LIMITS[dof][1], Math.max(LIMITS[dof][0], v)); })))] : null;
    return h('div', { class: 'finger' },
      h('div', { class: 'head' },
        h('button', { class: 'twist', title: 'Show each joint', onClick: () => { if (open) app.openFingers.delete(f); else app.openFingers.add(f); app.renderInspector(); } }, open ? '▾' : '▸'),
        h('strong', {}, f),
        fields.slider({
          title: `${f} curl, all joints`, min: LIMITS.curl[0], max: LIMITS.curl[1], step: 0.01,
          get: () => pose().fingers[f].reduce((sum, j) => sum + j.curl, 0) / JOINTS,
          set: value => edit(target => {
            const mean = target.fingers[f].reduce((sum, j) => sum + j.curl, 0) / JOINTS;
            for (const joint of target.fingers[f]) joint.curl = Math.min(LIMITS.curl[1], Math.max(LIMITS.curl[0], joint.curl + value - mean));
          }),
        })),
      joints);
  };

  const places = usage();
  return h('div', {},
    h('div', { class: 'card' },
      h('div', { class: 'head' },
        fields.select({ title: 'pose', options: names.map(value => ({ value, label: store.library.poses[value].label ? `${store.library.poses[value].label} (${value})` : value })), get: () => name, set: adopt }),
        store.isPoseChanged(name) ? h('span', { class: 'dot' }, '● changed') : null),
      row('label', fields.text({ title: 'label', placeholder: 'shown in menus (optional)', get: () => pose().label ?? '', set: v => edit(target => { if (v) target.label = v; else delete target.label; }) })),
      row('name', nameInput),
      h('div', { class: 'buttons' },
        h('button', { onClick: rename }, 'Rename'),
        h('button', { onClick: duplicate }, 'Duplicate as'),
        h('button', { onClick: create }, 'New blank'),
        h('button', { class: 'danger', onClick: remove }, 'Delete')),
      message,
      h('p', { class: 'note' }, places.length ? `Used by ${places.length} hand position${places.length === 1 ? '' : 's'}: ${places.slice(0, 5).join(', ')}${places.length > 5 ? '…' : ''}.` : 'Not used by any prefab yet.'),
      h('div', { class: 'buttons' },
        h('button', { onClick: () => { store.revertPose(name); app.renderInspector(); } }, store.baseline.poses[name] ? 'Revert to committed' : 'Discard new pose'),
        clipSelect)),
    h('div', { class: 'card' },
      h('div', { class: 'head' }, h('strong', {}, 'Show it on'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'preview', checked: app.preview === 'free', onChange: () => { app.preview = 'free'; app.updatePreview(); } }), 'free hands'),
        h('label', { class: 'check' }, h('input', { type: 'radio', name: 'preview', checked: app.preview === 'on-grip', disabled: app.selection?.kind !== 'occupant', onChange: () => { app.preview = 'on-grip'; app.updatePreview(); } }),
          'the selected hand position')),
      h('p', { class: 'note' }, 'Curl: 0 is the hand model’s open hand, 1 its fist. Spread fans a joint sideways, twist turns it along the bone. Open a finger to set each joint. One pose serves both hands.')),
    FINGERS.map(finger));
}

// ---------- the export tab ----------

export function exportPanel(app) {
  const { store } = app;
  const changes = store.changes();
  const text = formatJson(changes);
  const list = [
    ...Object.entries(changes.prefabs).map(([id, v]) => `${v === null ? 'deleted' : store.baseline.prefabs[id] ? 'changed' : 'new'} prefab ${id}`),
    ...Object.entries(changes.poses).map(([name, v]) => `${v === null ? 'deleted' : store.baseline.poses[name] ? 'changed' : 'new'} pose ${name}`),
  ];
  const area = h('textarea', { class: 'json', rows: 12, readOnly: true, spellcheck: false, value: list.length ? text : '' , placeholder: 'Nothing changed yet.' });
  const pasted = h('textarea', { class: 'json', rows: 4, spellcheck: false, placeholder: 'Paste a copied export here to apply it on top of what is here.' });
  const message = h('p', { class: 'note' });
  const importNow = () => {
    const parsed = parseExport(pasted.value);
    if (parsed.error) { message.textContent = parsed.error; return; }
    store.importChanges(parsed.value);
    app.toast(`Applied ${Object.keys(parsed.value.prefabs).length + Object.keys(parsed.value.poses).length} changes.`);
  };
  return h('div', {},
    h('div', { class: 'card' },
      h('h3', {}, list.length ? `${list.length} changed since the last commit` : 'Nothing changed since the last commit'),
      h('ul', { class: 'changes' }, list.map(line => h('li', {}, line))),
      h('div', { class: 'buttons' },
        h('button', { class: 'primary', disabled: !list.length, onClick: () => app.copyChanges() }, 'Copy changed JSON'),
        h('button', { disabled: !list.length, onClick: () => app.downloadChanges() }, 'Download .json'),
        h('button', { class: 'danger', disabled: !list.length, onClick: () => { if (confirm('Throw away every change you have made here?')) store.discardAll(); } }, 'Discard all')),
      area,
      h('p', { class: 'note' }, 'Paste the copied text to Claude. Each changed prefab or pose is written out whole; a deleted one is null. Your edits are also kept in this browser until you discard them.')),
    h('div', { class: 'card' }, h('h3', {}, 'Apply a copied export'), pasted,
      h('div', { class: 'buttons' }, h('button', { onClick: importNow }, 'Apply')), message));
}
