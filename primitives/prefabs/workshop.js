// ============================================================
// PREFAB WORKSHOP — edit prefabs (common/prefab-core.js) and hand poses
// (common/hand-pose-core.js) on a normal screen, see them, and copy out
// what you changed.
//
//   left   every prefab, and every model that doesn't have one yet
//   middle the 3D view: the model, the hands, emitters and sockets, the gizmo
//   right  the inspector: Prefab, Hand poses, Export
//
// Edits are kept in this browser as you go and compared with what is
// committed in assets/prefabs/. "Copy changed JSON" copies only the
// difference; pasting it to Claude (or running
// scripts/apply-prefab-export.mjs on it) commits it.
// ============================================================

import { assets } from '../../common/model-catalog.js';
import { committedLibrary } from '../../common/prefab-data.js';
import { formatJson } from '../../common/prefab-core.js';
import { exportPanel, posesPanel, prefabPanel } from './inspector.js';
import { select } from './selection.js';
import { createStore } from './store.js';
import { copyText, h } from './ui.js';
import { createView } from './view.js';

const $ = selector => document.querySelector(selector);
const sceneEl = $('a-scene');
if (!sceneEl.hasLoaded) await new Promise(done => sceneEl.addEventListener('loaded', done, { once: true }));

const store = createStore({ baseline: committedLibrary() });
const view = createView({ sceneEl, store });

const app = {
  store, view,
  prefabId: null, modelId: null, selection: null,
  tab: 'prefab', poseName: 'open', preview: 'free',
  openSections: new Set(['fit', 'interactions', 'emitters']),
  openFingers: new Set(),
  syncFields() {},
  toast: message => toast(message),
  afterModelLoad: null,

  assetById: id => assets.find(a => a.id === id),
  entry() { return store.library.prefabs[this.prefabId]; },

  openPrefab(id) {
    const entry = id ? store.library.prefabs[id] : null;
    this.prefabId = entry ? id : null;
    this.modelId = entry ? entry.model : null;
    const firstHand = entry?.interactions[0]?.occupants.length ? select.occupant(0, 0) : null;
    this.selection = firstHand;
    view.setSubject({ prefabId: this.prefabId, modelId: this.modelId });
    view.setSelection(this.selection);
    this.updatePreview();
    this.renderInspector();
    renderBrowser();
    const url = new URL(location.href);
    url.search = this.prefabId ? `?prefab=${this.prefabId}` : (this.modelId ? `?model=${this.modelId}` : '');
    history.replaceState(null, '', url);
  },

  // A model: its prefab if it has one, otherwise just the model, to start one from.
  openModel(modelId) {
    const existing = Object.entries(store.library.prefabs).find(([, prefab]) => prefab.model === modelId);
    if (existing) { this.openPrefab(existing[0]); return; }
    this.prefabId = null;
    this.modelId = modelId;
    this.selection = null;
    view.setSubject({ prefabId: null, modelId });
    view.setSelection(null);
    this.updatePreview();
    this.renderInspector();
    renderBrowser();
    history.replaceState(null, '', `?model=${modelId}`);
  },

  closePrefab() { this.openPrefab(null); },

  select(selection) {
    this.selection = selection;
    view.setSelection(selection);
    if (this.tab === 'poses') this.updatePreview();
    this.renderInspector();
  },

  afterSelectionStale() { this.select(null); },

  setTab(tab) {
    this.tab = tab;
    for (const button of document.querySelectorAll('#tabs button')) button.setAttribute('aria-selected', String(button.dataset.tab === tab));
    this.updatePreview();
    this.renderInspector();
  },

  // Poses show on free hands, or on the selected hand position; other tabs show the prefab.
  updatePreview() {
    const onGrip = this.preview === 'on-grip' && this.selection?.kind === 'occupant';
    const mode = this.tab !== 'poses' ? 'prefab' : (onGrip ? 'on-grip' : 'free');
    view.setPreview({ mode, poseName: this.poseName });
  },

  renderInspector() {
    this.afterModelLoad = null;
    const panel = this.tab === 'poses' ? posesPanel(this) : this.tab === 'export' ? exportPanel(this) : prefabPanel(this);
    $('#panel').replaceChildren(panel);
  },

  duplicatePrefab() {
    const source = this.entry();
    const taken = Object.keys(store.library.prefabs);
    let id = `${this.prefabId}-copy`;
    for (let n = 2; taken.includes(id); n++) id = `${this.prefabId}-copy-${n}`;
    store.update(lib => { lib.prefabs[id] = JSON.parse(JSON.stringify({ ...source, name: `${source.name} copy` })); });
    this.openPrefab(id);
    toast(`Made ${id}.`);
  },

  deletePrefab() {
    if (!confirm(`Delete the prefab "${this.prefabId}"? Copy changed JSON afterwards to commit the deletion.`)) return;
    const id = this.prefabId;
    store.update(lib => { delete lib.prefabs[id]; });
    this.closePrefab();
    toast(`Deleted ${id}.`);
  },

  async copyChanges() {
    const count = store.changedCount();
    if (!count) { toast('Nothing has changed yet.'); return; }
    const ok = await copyText(formatJson(store.changes()));
    toast(ok ? `Copied ${count} change${count === 1 ? '' : 's'}. Paste them to Claude.` : 'The browser blocked copying. Open the Export tab and copy the text there.');
    if (!ok) this.setTab('export');
  },

  downloadChanges() {
    const url = URL.createObjectURL(new Blob([`${formatJson(store.changes())}\n`], { type: 'application/json' }));
    h('a', { href: url, download: 'prefab-changes.json' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
window.workshop = app;

// ---------- status ----------

let toastTimer = null;
function toast(message) {
  $('#status').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => updateHeader(), 4000);
}

function updateHeader() {
  const count = store.changedCount();
  $('#copy-changed').textContent = count ? `Copy changed JSON (${count})` : 'Copy changed JSON';
  $('#status').textContent = count
    ? `${count} change${count === 1 ? '' : 's'}${store.storageWorks ? ', kept in this browser' : ', NOT kept: this browser blocks storage'}`
    : 'No changes since the last commit';
}

// ---------- the list on the left ----------

const MODEL_LIMIT = 120;
let listQueued = false;

function renderBrowser() {
  listQueued = false;
  const term = $('#search').value.trim().toLowerCase();
  const matches = text => !term || text.toLowerCase().includes(term);
  const prefabs = Object.entries(store.library.prefabs)
    .filter(([id, p]) => matches(`${id} ${p.name} ${p.model}`))
    .sort(([, a], [, b]) => a.name.localeCompare(b.name));
  const used = new Set(Object.values(store.library.prefabs).map(p => p.model));
  const plain = assets.filter(a => !used.has(a.id) && matches(`${a.name} ${a.packName} ${a.id}`));

  const prefabRow = ([id, prefab]) => {
    const state = !store.baseline.prefabs[id] ? 'new' : store.isPrefabChanged(id) ? '● changed' : '';
    return h('button', { class: `item${id === app.prefabId ? ' current' : ''}`, onClick: () => app.openPrefab(id) },
      h('span', {}, prefab.name || id, ' ', h('small', {}, id)), h('span', { class: 'tag' }, state));
  };
  const modelRow = asset => h('button', { class: `item${!app.prefabId && asset.id === app.modelId ? ' current' : ''}`, onClick: () => app.openModel(asset.id) },
    h('span', {}, asset.name, ' ', h('small', {}, asset.packName)), h('span', { class: 'tag' }, '+'));

  $('#list').replaceChildren(...[
    h('h2', {}, `Prefabs (${prefabs.length})`),
    prefabs.length ? prefabs.map(prefabRow) : h('p', { class: 'more' }, term ? 'No prefab matches.' : 'None yet. Pick a model below to make one.'),
    h('h2', {}, `Models without a prefab (${plain.length})`),
    plain.slice(0, MODEL_LIMIT).map(modelRow),
    plain.length > MODEL_LIMIT ? h('p', { class: 'more' }, `${plain.length - MODEL_LIMIT} more: search to narrow the list.`) : null,
  ].flat().filter(Boolean));
}

// ---------- wiring ----------

store.subscribe(what => {
  view.refresh();
  updateHeader();
  if (what === 'drag' || what === 'edit') {
    app.syncFields();
    if (app.tab === 'export') app.renderInspector();
    if (what === 'edit' && !listQueued) { listQueued = true; requestAnimationFrame(renderBrowser); }
    return;
  }
  app.openPrefab(app.prefabId && store.library.prefabs[app.prefabId] ? app.prefabId : null);
});

view.prefabEl.addEventListener('prefab-ready', () => app.afterModelLoad?.());
view.onDragEnd = () => { if (!listQueued) { listQueued = true; requestAnimationFrame(renderBrowser); } };

for (const button of document.querySelectorAll('#tabs button')) button.addEventListener('click', () => app.setTab(button.dataset.tab));
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => view.setView(button.dataset.view));
$('#frame').addEventListener('click', () => view.frame());
$('#space').addEventListener('click', event => {
  view.setSpace(view.space === 'world' ? 'local' : 'world');
  event.target.textContent = `Gizmo: ${view.space}`;
});
$('#all-hands').addEventListener('click', event => {
  const on = event.target.getAttribute('aria-pressed') !== 'true';
  event.target.setAttribute('aria-pressed', String(on));
  view.setShowAllHands(on);
});
$('#see-through').addEventListener('click', event => {
  const on = event.target.getAttribute('aria-pressed') !== 'true';
  event.target.setAttribute('aria-pressed', String(on));
  view.setSeeThrough(on);
});
$('#focus').addEventListener('click', () => view.focusSelection());
$('#copy-changed').addEventListener('click', () => app.copyChanges());
$('#search').addEventListener('input', renderBrowser);
addEventListener('pagehide', () => store.flush());
document.addEventListener('visibilitychange', () => { if (document.hidden) store.flush(); });

view.start();
updateHeader();

const params = new URLSearchParams(location.search);
const first = params.get('prefab') && store.library.prefabs[params.get('prefab')] ? params.get('prefab') : Object.keys(store.library.prefabs)[0];
if (first && !params.get('model')) app.openPrefab(first);
else app.openModel(params.get('model') ?? 'kenney-blaster-kit-blaster-d');
