// ============================================================
// PREFAB — the component that makes a prefab (common/prefab-core.js)
// an entity.
//
//   <a-entity prefab="id: smg-d"></a-entity>
//
//   const prefab = el.components.prefab;
//   prefab.def                            // the normalized prefab
//   prefab.anchor('emitter', 'muzzle')    // an entity at that emitter, -Z out of it
//   prefab.anchor('attachment', 'rail')   // the same for a socket
//   prefab.holdPlacement('grip', 'left')  // { pose, position, quaternion, drives }
//
// The entity is the prefab frame: the model sits in it with the prefab's
// `fit` applied, and every anchor is a child entity at its place, so a
// game attaches things to `.prefab-anchor` entities and never to numbers.
// `holdPlacement` is where the hand model's own frame goes in the prefab
// frame (the data's mirror rule already applied); making a hand actually
// hold the prefab is the next layer's job.
//
// `setDefinition(def)` swaps the data under a live entity, loading a new
// model only if the model changed: the workshop edits this way.
// ============================================================

import { assets, disposeModel, loadToy } from './model-catalog.js';
import { getPrefab } from './prefab-data.js';
import { normalizePrefab, occupantFor } from './prefab-core.js';

const THREE = AFRAME.THREE;
const RAD = Math.PI / 180;
const KINDS = { emitter: 'emitters', attachment: 'attachments' };

export function applyPlacement(object3D, placement) {
  object3D.position.set(...placement.pos);
  object3D.rotation.set(placement.rot[0] * RAD, placement.rot[1] * RAD, placement.rot[2] * RAD, 'XYZ');
}

AFRAME.registerComponent('prefab', {
  schema: { id: { type: 'string' } },

  init() {
    this.def = null;
    this.loadedModel = null;
    this.modelRoot = new THREE.Group();
    this.modelRoot.name = 'prefab-model';
    this.el.setObject3D('prefab-model', this.modelRoot);
    this.anchors = { emitter: new Map(), attachment: new Map() };
    this.loadToken = 0;
    // A definition handed over before A-Frame got round to init() waits here.
    if (this.pendingDef) this.setDefinition(this.pendingDef);
  },

  update() {
    if (!this.data.id) return;
    const def = getPrefab(this.data.id);
    if (!def) {
      console.warn(`prefab: no prefab called "${this.data.id}"`);
      return;
    }
    this.setDefinition(def);
  },

  setDefinition(def) {
    if (!this.modelRoot) { this.pendingDef = def; return; }
    this.def = normalizePrefab(def);
    applyPlacement(this.modelRoot, this.def.fit);
    this.modelRoot.scale.setScalar(this.def.fit.scale);
    this.syncAnchors();
    if (this.def.model !== this.loadedModel) this.loadModel(this.def.model);
  },

  async loadModel(modelId) {
    const token = ++this.loadToken;
    this.loadedModel = modelId;
    const asset = assets.find(a => a.id === modelId);
    if (!asset) {
      console.warn(`prefab: no model called "${modelId}"`);
      this.clearModel();
      return;
    }
    try {
      const object = await loadToy(asset);
      if (token !== this.loadToken) { disposeModel(object); return; }
      this.clearModel();
      this.modelRoot.add(object);
      this.el.emit('prefab-ready', { prefab: this.def }, false);
    } catch (error) {
      console.warn(`prefab: could not load "${modelId}"`, error);
    }
  },

  clearModel() {
    for (const child of [...this.modelRoot.children]) {
      this.modelRoot.remove(child);
      disposeModel(child);
    }
  },

  syncAnchors() {
    for (const [kind, key] of Object.entries(KINDS)) {
      const wanted = new Map(this.def[key].map(a => [a.id, a]));
      for (const [id, entity] of this.anchors[kind]) {
        if (wanted.has(id)) continue;
        entity.remove();
        this.anchors[kind].delete(id);
      }
      for (const [id, anchor] of wanted) {
        let entity = this.anchors[kind].get(id);
        if (!entity) {
          entity = document.createElement('a-entity');
          entity.classList.add('prefab-anchor', `prefab-${kind}`);
          entity.dataset.anchorKind = kind;
          entity.dataset.anchorId = id;
          this.el.appendChild(entity);
          this.anchors[kind].set(id, entity);
        }
        if (anchor.role) entity.dataset.role = anchor.role;
        if (anchor.accepts) entity.dataset.accepts = anchor.accepts.join(' ');
        applyPlacement(entity.object3D, anchor);
      }
    }
  },

  anchor(kind, id) { return this.anchors[kind]?.get(id) || null; },

  holdPlacement(interactionId, side, index = 0) {
    const point = this.def.interactions.find(i => i.id === interactionId);
    const placed = point && occupantFor(point, side, index);
    if (!placed) return null;
    const object = new THREE.Object3D();
    applyPlacement(object, placed);
    return { pose: placed.pose, position: object.position, quaternion: object.quaternion, drives: placed.drives };
  },

  remove() {
    this.loadToken++;
    this.clearModel();
    this.el.removeObject3D('prefab-model');
    for (const map of Object.values(this.anchors)) for (const entity of map.values()) entity.remove();
  },
});
