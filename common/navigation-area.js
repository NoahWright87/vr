import { containsPoint, prepareFloor, sameFloorTransform } from './floor-overlap.js';

// Portal traversal can pin an area explicitly; geometric overlap between two
// impossible rooms must not silently combine both rooms into one objective.
AFRAME.registerSystem('navigation-areas', {
  init() { this.areas = new Set(); this.pinned = null; this.current = null; },
  setActiveArea(el) {
    if (el && !this.areas.has(el.components?.['navigation-area'])) throw new Error('Unknown navigation area');
    this.pinned = el?.components['navigation-area'] || null;
    if (this.pinned) this.current = this.pinned;
  },
  getActiveArea(position) {
    const usable = area => area && this.areas.has(area) && area.data.enabled && area.getFloor();
    if (usable(this.pinned)) return this.pinned.getSnapshot();
    const candidates = [...this.areas].filter(area => usable(area) && containsPoint(position, area.getFloor().points));
    candidates.sort((a, b) => b.data.priority - a.data.priority || Number(b === this.current) - Number(a === this.current));
    this.current = candidates[0] || (usable(this.current) ? this.current : null);
    return this.current?.getSnapshot() || null;
  },
});

AFRAME.registerComponent('navigation-area', {
  schema: { enabled: { default: true }, priority: { default: 0 } },
  init() {
    this.system = this.el.sceneEl.systems['navigation-areas']; this.system.areas.add(this);
    this.localFloor = null; this.worldFloor = null; this.revision = 0;
    this.matrix = new AFRAME.THREE.Matrix4();
  },
  setFootprint(points) { this.localFloor = prepareFloor(points); this.worldFloor = null; this.snapshot = null; this.revision++; },
  getFloor() {
    if (!this.localFloor) return null;
    this.el.object3D.updateWorldMatrix(true, false);
    const world = this.el.object3D.matrixWorld;
    if (!this.worldFloor || !sameFloorTransform(this.matrix, world)) {
      this.matrix.copy(world);
      this.worldFloor = prepareFloor(this.localFloor.points.map(p => {
        const v = new AFRAME.THREE.Vector3(p.x, 0, p.z).applyMatrix4(world); return { x: v.x, z: v.z };
      }));
      this.snapshot = { id: this.el.id || 'Walkable area', floor: this.worldFloor, revision: this.revision };
    }
    return this.worldFloor;
  },
  getSnapshot() { return this.getFloor() ? this.snapshot : null; },
  remove() { this.system.areas.delete(this); },
});
