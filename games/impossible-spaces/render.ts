import type { Level, Vec } from './core/types.ts';
import type { RuntimeState } from './core/runtime.ts';
import { renderWalls } from './core/runtime.ts';
import { centroid, len, sub } from './core/geometry.ts';

const THREE = AFRAME.THREE;
export const pieceColor = (i: number) => `hsl(${(i * 137.5 + 200) % 360}, 55%, 62%)`;
export class LevelView {
  root = new THREE.Group();
  cache = new Map<string, any>();
  textures: any[] = [];
  colors = new Map<string, string>();
  doors = new THREE.Group();
  panels: any[] = [];
  current: any = null;
  constructor(public level: Level) {
    level.pieces.forEach((p, i) => this.colors.set(p.id, pieceColor(i)));
    // The same physical cabin keeps the same color before/after a ride.
    for (const p of level.portals) this.colors.set(p.b, this.colors.get(p.a)!);
    this.root.add(this.doors);
  }
  makeView(state: RuntimeState) {
    const group = new THREE.Group();
    for (const draw of renderWalls(this.level, state)) {
      const color = this.colors.get(draw.pieceId)!;
      const positions: number[] = [], uv: number[] = [], colors: number[] = [];
      const triangle = (pts: number[][], uvs: number[][], shade: number) => {
        pts.forEach((p, i) => { positions.push(...p); uv.push(...uvs[i]); colors.push(shade, shade, shade); });
      };
      for (const poly of draw.regions) {
        for (let i = 1; i < poly.length - 1; i++) {
          const vertices = [poly[0], poly[i], poly[i + 1]];
          const texCoords = vertices.map(p => [p.x * 2, p.y * 2]);
          triangle(vertices.map(p => [p.x, 0, p.y]), texCoords, .65);
          triangle(vertices.map(p => [p.x, 2.5, p.y]), texCoords, .4);
        }
      }
      for (const [a, b] of draw.walls) {
        const distance = len(sub(b, a)), shade = Math.abs(b.x - a.x) / distance * .15 + .75;
        // Use wall distance/height UVs, avoiding distorted grids on diagonal walls.
        triangle([[a.x, 0, a.y], [b.x, 0, b.y], [b.x, 2.5, b.y]], [[0,0],[distance*2,0],[distance*2,5]], shade);
        triangle([[a.x, 0, a.y], [b.x, 2.5, b.y], [a.x, 2.5, a.y]], [[0,0],[distance*2,5],[0,5]], shade);
      }
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = color; ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#00000018'; ctx.fillRect(0, 0, 32, 32); ctx.fillRect(32, 32, 32, 32);
      const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; this.textures.push(texture);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, side: THREE.DoubleSide }));
      mesh.name = draw.pieceId; group.add(mesh);
      const points: number[] = [];
      for (const poly of draw.regions) for (let i = 0; i < poly.length; i++) points.push(poly[i].x, 0.008, poly[i].y, poly[(i + 1) % poly.length].x, 0.008, poly[(i + 1) % poly.length].y);
      const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
      group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: '#e6f1ff', transparent: true, opacity: 0.35 })));
      if (draw.pieceId === state.activeId) {
        const c = centroid(this.level.pieces.find(p => p.id === draw.pieceId)!.parts[0]);
        const label = document.createElement('canvas'); label.width = 512; label.height = 128;
        const lc = label.getContext('2d')!; lc.fillStyle = '#172a41'; lc.fillRect(0, 0, 512, 128); lc.fillStyle = '#eef7ff'; lc.font = '42px sans-serif'; lc.textAlign = 'center';
        const p = this.level.pieces.find(p => p.id === draw.pieceId)!;
        lc.fillText(p.kind === 'elevator' ? 'ELEVATOR' : `${p.kind.toUpperCase()} ${p.id}`, 256, 55); lc.font = '26px sans-serif'; lc.fillText(p.template, 256, 99);
        const tex = new THREE.CanvasTexture(label); tex.colorSpace = THREE.SRGBColorSpace; this.textures.push(tex);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex })); sprite.position.set(c.x, 2.15, c.y); sprite.scale.set(0.9, 0.225, 1); group.add(sprite);
      }
    }
    return group;
  }
  show(state: RuntimeState) {
    const key = state.activeId + (state.doorsClosed ? ':closed' : ':open');
    let group = this.cache.get(key);
    if (!group) { group = this.makeView(state); this.cache.set(key, group); }
    if (this.current !== group) { if (this.current) this.root.remove(this.current); this.root.add(group); this.current = group; }
  }
  setCabin(id: string | null, closure: number) {
    if (this.doors.userData.id !== id) {
      this.doors.children.slice().forEach((o: any) => { this.doors.remove(o); o.geometry.dispose(); o.material.dispose(); });
      this.panels = []; this.doors.userData.id = id;
      if (id) {
        const d = this.level.doors.find(d => d.a === id || d.b === id)!;
        const width = len(sub(d.p2, d.p1));
        for (const side of [-1, 1]) {
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width / 2, 2.5), new THREE.MeshBasicMaterial({ color: side === -1 ? '#445873' : '#506680', side: THREE.DoubleSide }));
          mesh.rotation.y = -Math.atan2(d.p2.y - d.p1.y, d.p2.x - d.p1.x);
          mesh.userData = { side, width, d }; this.doors.add(mesh); this.panels.push(mesh);
        }
      }
    }
    for (const mesh of this.panels) {
      const { side, width, d } = mesh.userData;
      const t = 0.5 + side * (0.25 + (1 - closure) * 0.5);
      const normal = d.a === id ? d.normal : { x: -d.normal.x, y: -d.normal.y };
      mesh.position.set(d.p1.x + (d.p2.x - d.p1.x) * t - normal.x * .004, 1.25, d.p1.y + (d.p2.y - d.p1.y) * t - normal.y * .004);
      mesh.visible = closure > 0;
    }
  }
  dispose() {
    const objects = new Set<any>();
    for (const group of this.cache.values()) group.traverse((o: any) => objects.add(o));
    this.doors.traverse((o: any) => objects.add(o));
    for (const o of objects) { o.geometry?.dispose(); if (o.material) o.material.dispose(); }
    for (const t of this.textures) t.dispose();
    this.root.removeFromParent(); this.cache.clear();
  }
}
