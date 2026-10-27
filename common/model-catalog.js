// The model catalogs as one list, and loading any entry as a three.js object:
// the Toybox and the prefab workshop both start from here.
import kenney from '../assets/models/kenney/catalog.json';
import { models } from '../assets/models/catalog.js';
import { createModel, disposeModel } from './model-library.js';

export const creators = [
  { id: 'kenney', name: 'Kenney', site: 'https://kenney.nl', license: 'CC0-1.0', logo: '/assets/models/kenney/logo.png' },
  { id: 'originals', name: 'Originals', site: '', license: 'BSD-2-Clause' },
];
export const assets = [
  ...kenney.map(model => ({ ...model, creatorId: 'kenney', description: `${model.packName} by Kenney.`, format: 'glb' })),
  ...models.map(model => ({ ...model, creatorId: 'originals', creator: 'Noah’s VR projects', pack: model.category,
    packName: model.category, file: `/assets/models/starter/${model.id}.gltf`, format: 'procedural' })),
];
export function packsFor(creatorId) {
  return [...new Map(assets.filter(a => a.creatorId === creatorId).map(a => [a.pack, { id: a.pack, name: a.packName }])).values()];
}
export function toysFor(creatorId, pack, query = '') {
  const term = query.trim().toLowerCase();
  return assets.filter(a => a.creatorId === creatorId && (!pack || a.pack === pack) && `${a.name} ${a.packName}`.toLowerCase().includes(term));
}
export async function loadToy(definition) {
  if (definition.format === 'procedural') return createModel(AFRAME.THREE, definition.id);
  const gltf = await new AFRAME.THREE.GLTFLoader().loadAsync(definition.file);
  gltf.scene.userData = { id: definition.id, creator: definition.creator, license: definition.license };
  return gltf.scene;
}
export function measureToy(object) {
  const THREE = AFRAME.THREE;
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  if (![size.x, size.y, size.z].every(n => Number.isFinite(n)) || Math.max(size.x, size.y, size.z) <= 0) {
    disposeModel(object); throw Error('This model has no visible geometry.');
  }
  return { size, center: box.getCenter(new THREE.Vector3()) };
}
export { disposeModel };
