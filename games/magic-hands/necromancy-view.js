import { Necromancy, GRAVES } from './necromancy.js';
import { createModel, disposeModel } from '../../common/model-library.js';
const THREE = AFRAME.THREE;
const vec = p => new THREE.Vector3(p.x, p.y, p.z);
function caption(text = '', width = .48) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 96;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true })); sprite.scale.set(width, width * .094, 1);
  const set = value => {
    const c = canvas.getContext('2d'); c.clearRect(0, 0, 1024, 96); c.fillStyle = '#142b26e8'; c.fillRect(0, 0, 1024, 96);
    c.fillStyle = '#b6ffbf'; c.font = 'bold 37px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(value, 512, 48, 1000); texture.needsUpdate = true;
  };
  set(text); return { sprite, set };
}
export class NecromancyView {
  constructor(scene) {
    this.scene = scene; this.engine = new Necromancy(); this.root = new THREE.Group(); scene.object3D.add(this.root);
    this.models = new Map(); this.graves = new Map(); this.labels = {};
    this.yard = document.createElement('a-entity'); this.yard.id = 'magic-graveyard'; scene.appendChild(this.yard);
    const box = (position, dimensions, color = '#45445a') => {
      const el = document.createElement('a-box'); el.setAttribute('position', position.join(' '));
      el.setAttribute('width', dimensions[0]); el.setAttribute('height', dimensions[1]); el.setAttribute('depth', dimensions[2]);
      el.setAttribute('color', color); el.setAttribute('data-magic-blocker', ''); this.yard.appendChild(el); return el;
    };
    for (const y of [.25, .60]) {
      box([-1.95, y, 3.2], [2.1, .09, .09]); box([1.95, y, 3.2], [2.1, .09, .09]); box([0, y, 8], [6, .09, .09]);
      for (const x of [-3, 3]) box([x, y, 5.6], [.09, .09, 4.8]);
    }
    for (const z of [3.2, 8]) for (const x of [-3, -2, -.9, .9, 2, 3]) box([x, .4, z], [.12, .8, .12]);
    for (const x of [-3, 3]) for (const z of [4.8, 6.4]) box([x, .4, z], [.12, .8, .12]);
    const gate = document.createElement('a-entity'); gate.id = 'magic-graveyard-gate';
    gate.setAttribute('gltf-model', '/assets/models/kenney/mini-dungeon/gate.glb'); gate.setAttribute('position', '-.9 0 3.2'); gate.setAttribute('rotation', '0 90 0'); gate.setAttribute('scale', '1.7 1.7 1.7'); this.yard.appendChild(gate);
    for (const source of GRAVES) {
      const patch = new THREE.Mesh(new THREE.BoxGeometry(.72, .025, 1.3), new THREE.MeshStandardMaterial({ color: '#373d3c', emissive: '#5cff91', emissiveIntensity: 0 }));
      patch.position.copy(source.position).y = .018; this.root.add(patch);
      const rune = new THREE.Mesh(new THREE.RingGeometry(.34, .38, 36), new THREE.MeshBasicMaterial({ color: '#84ffaa', transparent: true, opacity: .12, depthWrite: false }));
      rune.position.copy(source.position).y = .04; rune.rotation.x = -Math.PI / 2; this.root.add(rune);
      const stone = new THREE.Group(); stone.position.copy(source.position).z += .70;
      const material = new THREE.MeshStandardMaterial({ color: '#68717c', roughness: 1 });
      const base = new THREE.Mesh(new THREE.BoxGeometry(.46, .53, .15), material); base.position.y = .285;
      const top = new THREE.Mesh(new THREE.CylinderGeometry(.23, .23, .15, 16), material); top.rotation.x = Math.PI / 2; top.position.y = .55; stone.add(base, top); this.root.add(stone);
      const mark = caption('R I P', .28); mark.sprite.position.copy(source.position).add(new THREE.Vector3(0, .50, .60)); this.root.add(mark.sprite);
      this.graves.set(source.id, { patch, rune });
    }
    const title = caption('RESTLESS GRAVES / HORNS + LIFT TO RAISE', 3.5); title.sprite.position.set(0, 2.1, 7.1); this.root.add(title.sprite);
    const welcome = caption('GRAVEYARD BEHIND YOU / HORNS TO RAISE MINIONS', 2.0); welcome.sprite.position.set(0, 2.3, -3); this.root.add(welcome.sprite);
    for (const side of ['left', 'right']) { this.labels[side] = caption(); this.root.add(this.labels[side].sprite); }
    this.marker = new THREE.Mesh(new THREE.RingGeometry(.12, .15, 24), new THREE.MeshBasicMaterial({ color: '#9dffb7', side: THREE.DoubleSide, depthWrite: false })); this.root.add(this.marker);
    this.guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#9dffb7', transparent: true, opacity: .35 })); this.guide.frustumCulled = false; this.root.add(this.guide);
    this.targetEls = [...scene.querySelectorAll('[magic-receiver]')].map((el, i) => ({ el, id: el.id || `practice-target-${i}` }));
  }
  update(hands, head, time, world, occupied) {
    const result = this.engine.update(hands, head, time, world, occupied);
    for (const event of result.events) {
      if (event.type === 'raised') { this.scene.emit('magic-cast', event); this.scene.emit('magic-minion-raised', event); }
      if (event.type === 'command') this.scene.emit('magic-minion-command', event);
      if (event.type === 'hit') this.targetEls.find(t => t.id === event.target)?.el.emit('magic-hit', event);
    }
    for (const [id, { patch, rune }] of this.graves) {
      const glowing = result.highlighted.includes(id), selected = Object.values(result.hands).some(h => h.source === id);
      patch.material.emissiveIntensity = glowing ? (selected ? .7 : .3) * (1 + .2 * Math.sin(time * .006)) : 0;
      rune.material.opacity = glowing ? selected ? .95 : .5 : .10; rune.rotation.z = time * .0004;
    }
    let target = null, aimingHand = null;
    for (const side of ['left', 'right']) {
      const label = this.labels[side], state = result.hands[side], text = result.reserved[side] ? state.label || 'NECROMANCY' : '';
      if (label.text !== text) { label.set(text); label.text = text; }
      label.sprite.visible = !!text;
      if (hands[side]) label.sprite.position.copy(hands[side].palm).y += .23;
      if (state.target && hands[side]?.tracked !== false) { target = world.targets.find(t => t.id === state.target); aimingHand = hands[side]; }
    }
    this.marker.visible = this.guide.visible = !!target;
    if (target) {
      this.marker.position.copy(target.center); this.marker.lookAt(head.position); this.marker.scale.setScalar(1 + .15 * Math.sin(time * .01));
      const a = this.guide.geometry.attributes.position; a.setXYZ(0, aimingHand.tip.x, aimingHand.tip.y, aimingHand.tip.z); a.setXYZ(1, target.center.x, target.center.y, target.center.z); a.needsUpdate = true;
    }
    const ids = new Set(this.engine.minions.map(m => m.id));
    for (const [id, visual] of this.models) if (!ids.has(id)) { disposeModel(visual.root); visual.root.removeFromParent(); this.models.delete(id); }
    for (const minion of this.engine.minions) {
      if (!this.models.has(minion.id)) {
        const root = new THREE.Group(), model = createModel(THREE, 'skeleton'); model.scale.setScalar(.85); root.add(model); this.root.add(root);
        model.traverse(mesh => { if (mesh.material) { mesh.material.emissive.set('#53ff91'); mesh.material.emissiveIntensity = mesh.name === 'black' ? .7 : .06; } });
        const health = new THREE.Mesh(new THREE.PlaneGeometry(.55, .045), new THREE.MeshBasicMaterial({ color: '#89ffb1', side: THREE.DoubleSide })); health.position.y = 1.75; root.add(health);
        this.models.set(minion.id, { root, model, health });
      }
      const { root, model } = this.models.get(minion.id); root.position.copy(minion.position); root.rotation.y = Math.atan2(-minion.direction.x, -minion.direction.z);
      const health = this.models.get(minion.id).health; health.visible = minion.mode !== 'dying'; health.scale.x = minion.health / 60; health.lookAt(head.position);
      health.material.color.set(time < minion.hurtUntil ? '#ff5656' : '#89ffb1');
      model.position.set(0, 0, 0); model.rotation.set(0, 0, 0);
      if (minion.mode === 'rising') model.position.y = -1.65 * (1 - Math.min(1, (time - minion.born) / 1000)) ** 2;
      else if (minion.mode === 'dying') {
        const age = time - minion.diedAt; model.rotation.z = (minion.id % 2 ? 1 : -1) * Math.PI / 2 * Math.min(1, age / 600);
        model.position.y = -.12 - Math.max(0, age - 650) / 1500 * 1.8;
      } else {
        const phase = time * .007 + minion.id * 2.4;
        model.rotation.z = Math.sin(phase) * (minion.moving ? .10 : .025); model.rotation.x = Math.cos(phase * .7) * .025;
        model.position.y = minion.moving ? Math.abs(Math.sin(phase)) * .045 : 0;
        const attack = (time - minion.attackAt) / 450;
        if (attack >= 0 && attack < 1) { const lunge = Math.sin(attack * Math.PI); model.rotation.x -= lunge * .48; model.position.z -= lunge * .24; }
      }
    }
    return result;
  }
  reset() { this.engine.reset(); }
  dispose() { this.yard.remove(); disposeModel(this.root); this.root.removeFromParent(); }
}
