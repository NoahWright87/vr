import { ArenaCombat, CombatShields, ARENA, inArena } from './arena-combat.js';
import { disposeModel } from '../../common/model-library.js';
const THREE = AFRAME.THREE;
function label(text, width = 2.4, color = '#ffe0bb') {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
  const c = canvas.getContext('2d'); c.fillStyle = '#221b2ce8'; c.fillRect(0, 0, 1024, 128);
  c.fillStyle = color; c.font = 'bold 43px sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 512, 64, 1000);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthWrite: false })); sprite.scale.set(width, width / 8, 1); return sprite;
}
export class ArenaView {
  constructor(scene) {
    this.scene = scene; this.engine = new ArenaCombat(); this.shields = new CombatShields(); this.visuals = new Map(); this.corpses = new Map(); this.orbs = new Map(); this.bursts = [];
    this.root = new THREE.Group(); scene.object3D.add(this.root); this.disposed = false;
    this.structure = document.createElement('a-entity'); this.structure.id = 'magic-arena'; scene.appendChild(this.structure);
    const box = (p, size, color, blocker = true) => {
      const el = document.createElement('a-box'); el.setAttribute('position', p.join(' ')); el.setAttribute('width', size[0]); el.setAttribute('height', size[1]); el.setAttribute('depth', size[2]); el.setAttribute('color', color);
      if (blocker) el.setAttribute('data-magic-blocker', ''); this.structure.appendChild(el); return el;
    };
    // Ground stays flush with the playground and has no raised teleport lip.
    box([24, -.035, -3], [16, .06, 18], '#514452', false);
    for (const y of [.35, .85, 1.35]) {
      box([24, y, -12.45], [17, .4, .8], '#726078'); box([32.45, y, -3], [.8, .4, 18], '#726078');
      for (const [z, depth] of [[-7.2, 10.5], [4.3, 3.5]]) box([15.55, y, z], [.8, .4, depth], '#726078');
      for (const x of [18.7, 29.3]) box([x, y, 6.45], [5.4, .4, .8], '#726078');
    }
    for (const x of [15.5, 32.5]) for (const z of [-12.5, -6, 6.5]) {
      box([x, 1.65, z], [.75, 3.3, .75], '#958393'); box([x, 3.35, z], [1.15, .2, 1.15], '#c5a8a0');
    }
    const banner = label('THE SPARRING PIT / ENTER TO FIGHT', 6); banner.position.set(24, 3, -11.7); this.root.add(banner);
    const marker = new THREE.Mesh(new THREE.RingGeometry(1.15, 1.22, 48), new THREE.MeshBasicMaterial({ color: '#ffcc8a', side: THREE.DoubleSide }));
    marker.rotation.x = -Math.PI / 2; marker.position.copy(ARENA.landing).y = .018; this.root.add(marker);
    const landing = label('PORTAL LANDING / NO PLAYER HP', 3); landing.position.set(19, .65, 1); this.root.add(landing);
    const sign = label('ARENA TO YOUR RIGHT  →  /  PORTAL OVER TO SPAR', 4.3); sign.position.set(6, 2.5, -1); this.root.add(sign);
    const sign2 = label('SHIELDS BLOCK / CORPSES CAN BE RAISED', 4); sign2.position.set(24, 2.5, 6.1); this.root.add(sign2);
    for (const enemy of this.engine.enemies) this.createEnemy(enemy);
    // Camera child covers both eyes; transparent red vignette, no health or death state.
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const c = canvas.getContext('2d'), gradient = c.createRadialGradient(128, 128, 20, 128, 128, 170);
    gradient.addColorStop(0, 'rgba(255,20,25,.50)'); gradient.addColorStop(1, 'rgba(210,0,12,.85)'); c.fillStyle = gradient; c.fillRect(0, 0, 256, 256);
    this.flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
    this.flash.position.z = -.2; this.flash.renderOrder = 10000; this.flash.frustumCulled = false; this.flash.visible = false; this.flashUntil = 0; this.playerHits = 0; this.blockedHits = 0;
    this.flash.onBeforeRender = (renderer, world, camera) => {
      const eyes = scene.camera.isArrayCamera ? scene.camera.cameras : renderer.xr.isPresenting ? renderer.xr.getCamera().cameras : [];
      this.flash.material.opacity = camera === scene.camera || eyes.includes(camera) ? this.flash.userData.opacity || 0 : 0;
    };
  }
  createEnemy(enemy) {
    const el = document.createElement('a-entity'); el.id = enemy.id; el.setAttribute('magic-receiver', 'external: true'); el.setAttribute('data-arena-enemy', ''); this.structure.appendChild(el);
    const collider = new THREE.Mesh(new THREE.SphereGeometry(.58, 16, 12), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    collider.scale.y = 1.45; el.setObject3D('mesh', collider);
    const art = new THREE.Group(); el.setObject3D('enemy-art', art);
    const fallback = new THREE.Mesh(new THREE.IcosahedronGeometry(.5, 1), new THREE.MeshStandardMaterial({ color: enemy.type === 'melee' ? '#dfaa89' : '#bd94ed', roughness: .8 })); art.add(fallback);
    const bar = new THREE.Mesh(new THREE.PlaneGeometry(.9, .085), new THREE.MeshBasicMaterial({ color: '#9aeea2', side: THREE.DoubleSide }));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(.94, .12), new THREE.MeshBasicMaterial({ color: '#341f32', side: THREE.DoubleSide })); back.position.z = -.005; bar.add(back); back.position.x = 0;
    // Background is a sibling, so damage never shrinks its reference width.
    bar.remove(back); el.object3D.add(bar, back);
    const title = label(`${enemy.name} / ${enemy.type === 'melee' ? 'HEADBUTT' : 'SLOW ORBS'}`, 1.8); el.object3D.add(title);
    const visual = { el, art, collider, fallback, bar, back, title, asset: null }; this.visuals.set(enemy.id, visual);
    visual.onHit = e => {
      const hit = this.engine.hitEnemy(enemy.id, e.detail?.damage ?? 25, this.scene.time || 0); if (!hit) return;
      this.scene.emit('magic-scored', { points: hit.damage, target: el });
      collider.visible = !hit.killed; art.visible = !hit.killed; bar.visible = back.visible = title.visible = !hit.killed;
      // Invalidate cached receivers synchronously: a second bolt in the same tick
      // cannot score against a corpse or absorb a shot intended for a live enemy.
    };
    el.addEventListener('magic-hit', visual.onHit);
    new THREE.GLTFLoader().load(`/assets/models/kenney/${enemy.file}`, gltf => {
      if (this.disposed) { disposeModel(gltf.scene); return; }
      const model = gltf.scene, bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      const scale = Math.min(enemy.height / Math.max(.01, size.y), 1.2 / Math.max(.01, size.x, size.z));
      model.scale.setScalar(scale); model.position.set(-center.x * scale, -bounds.min.y * scale - .9, -center.z * scale);
      fallback.visible = false; art.add(model); visual.asset = model;
    }, undefined, error => console.warn(`Arena model unavailable: ${enemy.file}`, error));
    el.object3D.position.copy(enemy.position).y = .9;
  }
  sources() { return this.engine.corpses; }
  isInside(head) { return inArena(head.position); }
  worldTargets() { return this.engine.enemies.filter(e => e.alive).map(e => ({ id: e.id, hostile: true, center: { x: e.position.x, y: .9, z: e.position.z }, radius: .65 })); }
  prepareShields(result, hands, head, time) { return this.shields.update(result, hands, head, time); }
  update(head, necromancy, effects, highlighted, time, world) {
    if (this.scene.camera && this.flash.parent !== this.scene.camera) this.scene.camera.add(this.flash);
    const events = this.engine.update(head, necromancy.active(), this.shields, time, world, necromancy.consumed);
    for (const event of events) {
      if (event.type === 'damage') {
        if (event.kind === 'minion') necromancy.damage(event.target, event.damage, time);
        else { this.flashUntil = time + 450; this.playerHits++; this.scene.emit('magic-player-hit', event); }
      } else if (event.type === 'blocked') { this.blockedHits++; this.scene.emit('magic-shield-hit', event); }
      if (event.point) {
        const burst = new THREE.Mesh(new THREE.IcosahedronGeometry(.15, 1), new THREE.MeshBasicMaterial({ color: event.type === 'blocked' ? '#f3e6ff' : '#ff524b', wireframe: true, transparent: true, depthWrite: false }));
        burst.position.copy(event.point); burst.userData.born = time; this.root.add(burst); this.bursts.push(burst);
      }
    }
    this.flash.visible = time < this.flashUntil; this.flash.material.opacity = Math.max(0, (this.flashUntil - time) / 450) * .65;
    this.flash.userData.opacity = this.flash.material.opacity;
    effects.paintShields(this.shields.poses);
    for (const e of this.engine.enemies) {
      const o = this.visuals.get(e.id); o.el.object3D.position.copy(e.position).y = .9;
      o.collider.visible = o.art.visible = o.bar.visible = o.back.visible = o.title.visible = e.alive;
      if (!e.alive) continue;
      o.art.rotation.y = Math.atan2(-e.direction.x, -e.direction.z); o.art.rotation.z = e.moving ? Math.sin(time * .01) * .08 : 0;
      const age = (time - e.attackAt) / 750, lunge = age >= 0 && age < 1 ? Math.sin(age * Math.PI) : 0;
      o.art.rotation.x = e.type === 'melee' ? -.35 * lunge : .12 * lunge; o.art.position.y = e.moving ? Math.abs(Math.sin(time * .009)) * .035 : 0;
      o.bar.position.set(-.45 * (1 - e.hp / e.health), e.height + .27 - .9, .01); o.bar.scale.x = e.hp / e.health;
      o.back.position.set(0, e.height + .27 - .9, 0); o.title.position.set(0, e.height + .55 - .9, 0);
      o.bar.lookAt(head.position); o.back.lookAt(head.position);
      o.bar.material.color.set(time < e.flashUntil ? '#ffffff' : e.hp / e.health < .3 ? '#ff6e66' : '#9aeea2');
    }
    const corpseIds = new Set(this.engine.corpses.map(c => c.id));
    for (const [id, root] of this.corpses) if (!corpseIds.has(id)) { root.removeFromParent(); disposeModel(root.userData.rune); this.corpses.delete(id); }
    for (const corpse of this.engine.corpses) {
      if (!this.corpses.has(corpse.id)) {
        const root = new THREE.Group(), o = this.visuals.get(corpse.enemy), body = o.art.clone(true); body.visible = true; body.rotation.set(0, 0, Math.PI / 2); body.position.y = .3;
        // Clones borrow the loaded model's resources. Only the rune is owned here.
        const rune = new THREE.Mesh(new THREE.RingGeometry(.62, .72, 32), new THREE.MeshBasicMaterial({ color: '#7effa5', transparent: true, opacity: .3, side: THREE.DoubleSide, depthWrite: false }));
        rune.rotation.x = -Math.PI / 2; rune.position.y = .035; root.add(body, rune); root.userData.rune = rune; root.userData.body = body; root.position.copy(corpse.position); this.root.add(root); this.corpses.set(corpse.id, root);
      }
      const root = this.corpses.get(corpse.id), glow = highlighted.includes(corpse.id);
      root.userData.rune.material.opacity = glow ? .8 + .15 * Math.sin(time * .008) : .22;
      root.userData.body.position.y = .3 - Math.max(0, time - corpse.expires + 1500) / 1500;
    }
    const orbIds = new Set(this.engine.projectiles.map(p => p.id));
    for (const [id, orb] of this.orbs) if (!orbIds.has(id)) { disposeModel(orb); orb.removeFromParent(); this.orbs.delete(id); }
    for (const p of this.engine.projectiles) {
      if (!this.orbs.has(p.id)) {
        const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(p.radius, 1), new THREE.MeshBasicMaterial({ color: '#ff7771' }));
        const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(p.radius * 1.65, 1), new THREE.MeshBasicMaterial({ color: '#ffad6d', wireframe: true })); orb.add(halo); this.root.add(orb); this.orbs.set(p.id, orb);
      }
      const orb = this.orbs.get(p.id); orb.position.copy(p.position); orb.rotation.y = time * .004;
    }
    this.bursts = this.bursts.filter(b => { const age = (time - b.userData.born) / 350; b.scale.setScalar(1 + age * 3); b.material.opacity = 1 - age; if (age < 1) return true; disposeModel(b); b.removeFromParent(); return false; });
    this.root.updateMatrixWorld(true); this.structure.object3D.updateMatrixWorld(true);
  }
  reset() {
    this.engine.reset(); this.shields.reset(); this.playerHits = this.blockedHits = 0; this.flashUntil = 0; this.flash.visible = false;
    for (const root of this.corpses.values()) { disposeModel(root.userData.rune); root.removeFromParent(); } this.corpses.clear();
    for (const orb of this.orbs.values()) { disposeModel(orb); orb.removeFromParent(); } this.orbs.clear();
    for (const burst of this.bursts) { disposeModel(burst); burst.removeFromParent(); } this.bursts = [];
    for (const e of this.engine.enemies) { const o = this.visuals.get(e.id); o.el.object3D.position.copy(e.position).y = .9; o.collider.visible = o.art.visible = true; }
  }
  suspend() { this.engine.projectiles = []; this.engine.lastTime = null; for (const e of this.engine.enemies) e.pending = null; this.shields.poses = []; this.flashUntil = 0; }
  dispose() {
    this.disposed = true; this.reset();
    for (const o of this.visuals.values()) { o.el.removeEventListener('magic-hit', o.onHit); disposeModel(o.el.object3D); }
    this.structure.remove(); disposeModel(this.root); this.root.removeFromParent(); disposeModel(this.flash); this.flash.removeFromParent();
  }
}
