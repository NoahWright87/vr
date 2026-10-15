import { models, palette } from '../assets/models/catalog.js';

// One mesh per color, rather than a draw call for every primitive limb/rib.
// Every instance owns its buffers/materials; disposing it cannot break another.
export function createModel(THREE, id) {
  const definition = models.find(model => model.id === id);
  if (!definition) throw new Error(`Unknown model: ${id}`);
  const batches = new Map();
  for (const [shape, color, position, size, rotation = [0, 0, 0]] of definition.parts) {
    let geometry;
    if (shape === 'box') geometry = new THREE.BoxGeometry(...size);
    else if (shape === 'cylinder') geometry = new THREE.CylinderGeometry(...size, 12);
    else if (shape === 'cone') geometry = new THREE.ConeGeometry(...size, 4);
    else if (shape === 'sphere') {
      geometry = new THREE.SphereGeometry(1, 10, 6);
      geometry.scale(...size);
    } else throw new Error(`Unknown model primitive: ${shape}`);
    if (geometry.index) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed();
      indexed.dispose();
    }
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(...position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation.map(n => n * Math.PI / 180))),
      new THREE.Vector3(1, 1, 1),
    );
    geometry.applyMatrix4(matrix);
    if (!batches.has(color)) batches.set(color, { positions: [], normals: [] });
    const batch = batches.get(color);
    batch.positions.push(...geometry.attributes.position.array);
    batch.normals.push(...geometry.attributes.normal.array);
    geometry.dispose();
  }
  const group = new THREE.Group();
  group.name = definition.name;
  for (const [color, batch] of batches) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.computeBoundingBox();
    const material = new THREE.MeshStandardMaterial({ color: palette[color], roughness: 0.8 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = color;
    group.add(mesh);
  }
  group.userData = { id, license: definition.license, author: definition.author };
  return group;
}

export function disposeModel(object) {
  const resources = new Set();
  object.traverse(child => {
    if (child.geometry) resources.add(child.geometry);
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach(material => {
        for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
        resources.add(material);
      });
    }
  });
  resources.forEach(resource => resource.dispose());
}

if (typeof AFRAME !== 'undefined') {
  AFRAME.registerComponent('library-model', {
    schema: { type: 'string', default: 'crate' },
    update() {
      if (this.model) { this.el.removeObject3D('mesh'); disposeModel(this.model); }
      this.model = createModel(AFRAME.THREE, this.data);
      this.el.setObject3D('mesh', this.model);
      this.el.emit('model-loaded', { format: 'procedural', model: this.model });
    },
    remove() {
      if (this.model) { this.el.removeObject3D('mesh'); disposeModel(this.model); }
    },
  });
}
