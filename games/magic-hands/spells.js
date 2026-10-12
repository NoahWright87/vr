import { distance, midpoint } from '../../common/hand-gestures.js';
const THREE = AFRAME.THREE;
const vec = p => new THREE.Vector3(p.x, p.y, p.z);

function sigilTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d'); c.translate(256, 256);
  const fill = c.createRadialGradient(0, 0, 20, 0, 0, 250);
  fill.addColorStop(0, 'rgba(55,139,226,.03)'); fill.addColorStop(.82, 'rgba(72,161,255,.16)'); fill.addColorStop(1, 'rgba(129,211,255,.7)');
  c.fillStyle = fill; c.beginPath(); c.arc(0, 0, 246, 0, Math.PI * 2); c.fill();
  c.strokeStyle = '#b5e5ff'; c.lineWidth = 3;
  for (const r of [188, 218, 243]) { c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke(); }
  for (let i = 0; i < 16; i++) {
    c.save(); c.rotate(i * Math.PI / 8); c.beginPath();
    c.moveTo(-7, -199); c.lineTo(0, -209); c.lineTo(7, -199); c.moveTo(0, -209); c.lineTo(0, -191); c.stroke(); c.restore();
  }
  c.lineWidth = 2; c.beginPath();
  for (let i = 0; i <= 6; i++) { const a = i * Math.PI * 2 / 3; const x = Math.sin(a) * 154, y = Math.cos(a) * 154; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
  c.stroke(); return new THREE.CanvasTexture(canvas);
}

// Receivers own their reaction. Future projectiles/area spells can publish the
// same magic-hit event without knowing whether the recipient is a target.
AFRAME.registerComponent('magic-receiver', {
  schema: { damage: { default: 25 } },
  init() {
    this.hits = 0; this.flashUntil = 0;
    this.popup = document.createElement('a-text');
    this.popup.setAttribute('align', 'center'); this.popup.setAttribute('width', 2.8);
    this.popup.setAttribute('color', '#b4eaff'); this.popup.setAttribute('visible', false);
    this.el.appendChild(this.popup);
    this.onHit = e => {
      this.hits++; this.flashUntil = this.el.sceneEl.time + 900;
      this.el.setAttribute('material', 'color', '#d0f7ff');
      this.el.setAttribute('material', 'emissive', '#4cbfff');
      this.popup.setAttribute('value', `+${e.detail?.damage || this.data.damage}  /  ${this.hits} hits`);
      this.popup.object3D.visible = true;
      this.el.sceneEl.emit('magic-scored', { points: e.detail?.damage || this.data.damage, target: this.el });
    };
    this.el.addEventListener('magic-hit', this.onHit);
  },
  tick(time) {
    if (!this.flashUntil) return;
    const elapsed = 900 - (this.flashUntil - time);
    this.popup.object3D.position.set(0, .48 + Math.min(elapsed, 900) / 2200, 0);
    const camera = this.el.sceneEl.camera;
    if (camera) this.popup.object3D.lookAt(camera.getWorldPosition(new THREE.Vector3()));
    if (time >= this.flashUntil) {
      this.el.setAttribute('material', 'color', '#5a69b8'); this.el.setAttribute('material', 'emissive', '#17244a');
      this.popup.object3D.visible = false; this.flashUntil = 0;
    }
  },
  reset() { this.hits = 0; this.flashUntil = 1; },
  remove() { this.el.removeEventListener('magic-hit', this.onHit); this.popup.remove(); },
});

export class SpellEffects {
  constructor(scene, handsRoot) {
    this.scene = scene; this.handsRoot = handsRoot;
    this.root = new THREE.Group(); scene.object3D.add(this.root);
    this.ray = new THREE.Raycaster(); this.ray.far = 70;
    this.glows = {}; this.beams = {}; this.shields = [];
    for (const side of ['left', 'right']) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(.014, 12, 8), new THREE.MeshBasicMaterial({ color: '#65d8ff' }));
      glow.add(new THREE.Mesh(new THREE.SphereGeometry(.026, 12, 8), new THREE.MeshBasicMaterial({ color: '#219eff', transparent: true, opacity: .22, depthWrite: false })));
      this.root.add(glow); this.glows[side] = glow;
      const beam = new THREE.Group();
      for (const [radius, color, opacity] of [[.006, '#d5f7ff', 1], [.02, '#259eff', .40]]) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 1, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
        beam.add(mesh);
      }
      this.root.add(beam); this.beams[side] = { object: beam, until: 0 };
    }
    this.sigil = sigilTexture();
    for (let i = 0; i < 2; i++) {
      const shield = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.sigil, transparent: true, opacity: .82, side: THREE.DoubleSide, depthWrite: false }));
      this.shields.push(shield); this.root.add(shield);
    }
    this.renderTarget = new THREE.WebGLRenderTarget(512, 512);
    this.renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
    this.lens = new THREE.Group();
    this.screen = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ map: this.renderTarget.texture, side: THREE.DoubleSide }));
    this.rim = new THREE.Mesh(new THREE.RingGeometry(1, 1.07, 64), new THREE.MeshBasicMaterial({ color: '#f1d4ff', side: THREE.DoubleSide }));
    this.screen.position.z = .001; this.lens.add(this.screen, this.rim); this.root.add(this.lens);
    this.scope = new THREE.PerspectiveCamera(20, 1, .08, 100);
    this.lastRender = -Infinity; this.lastZoom = 0;
    this.clear();
  }
  clear() {
    Object.values(this.glows).forEach(g => { g.visible = false; });
    Object.values(this.beams).forEach(b => { b.object.visible = false; b.until = 0; });
    this.shields.forEach(s => { s.visible = false; }); this.lens.visible = false; this.lastRender = -Infinity;
  }
  cast(side, hand, time) {
    const origin = vec(hand.tip), direction = vec(hand.aim);
    this.ray.set(origin, direction);
    const candidates = [...this.scene.querySelectorAll('[magic-receiver]')].filter(el => el.object3D.visible).map(el => el.getObject3D('mesh')).filter(Boolean);
    const hits = this.ray.intersectObjects(candidates, true);
    let hit;
    for (const candidate of hits) {
      let object = candidate.object;
      while (object && !object.el?.components?.['magic-receiver']) object = object.parent;
      if (object) { hit = { ...candidate, el: object.el }; break; }
    }
    if (hit) hit.el.emit('magic-hit', { spell: 'lightning', damage: 25, point: hit.point, hand: side });
    const reach = hit?.distance || 60, beam = this.beams[side];
    beam.object.position.copy(origin).addScaledVector(direction, reach * .5);
    beam.object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    beam.object.scale.set(1, reach, 1); beam.object.visible = true; beam.until = time + 160;
    this.scene.emit('magic-cast', { spell: 'lightning', hand: side, hit: hit?.el || null });
  }
  update(result, hands, head, time, dt) {
    for (const side of ['left', 'right']) {
      const glow = this.glows[side]; glow.visible = result[side] === 'lightning';
      if (glow.visible) { glow.position.copy(vec(hands[side].tip)); glow.scale.setScalar(1 + .12 * Math.sin(time / 90)); }
      const beam = this.beams[side]; if (time >= beam.until) beam.object.visible = false;
    }
    result.casts.forEach(side => this.cast(side, hands[side], time));
    const palms = ['left', 'right'].filter(side => result[side] === 'shield').map(side => hands[side].palm);
    const shields = palms.length === 2 && distance(palms[0], palms[1]) < .40 ? [{ palm: midpoint(...palms), diameter: 1 }] : palms.map(palm => ({ palm, diameter: .5 }));
    this.shields.forEach((shield, i) => {
      shield.visible = !!shields[i]; if (!shields[i]) return;
      const { palm, diameter } = shields[i];
      shield.position.copy(vec(palm)).addScaledVector(head.forward, .20);
      shield.lookAt(head.position); shield.rotateZ(time * .00015);
      shield.scale.setScalar(diameter * 512 / 492);
    });
    this.updateLens(result.lens, head, time, dt);
  }
  updateLens(pose, head, time, dt) {
    const wasActive = this.lens.visible; this.lens.visible = !!pose;
    if (!pose) return;
    const center = vec(pose.center);
    const direction = center.clone().sub(head.position).normalize();
    // Damping affects only this secondary camera. Headset rendering remains raw.
    const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(center, center.clone().add(direction), head.up));
    const blend = 1 - Math.exp(-Math.min(dt, 100) / 65);
    if (!wasActive) { this.scope.position.copy(center); this.scope.quaternion.copy(desired); this.lastZoom = pose.zoom; }
    else { this.scope.position.lerp(center, blend); this.scope.quaternion.slerp(desired, blend); this.lastZoom += (pose.zoom - this.lastZoom) * blend; }
    this.lens.position.copy(center); this.lens.lookAt(head.position); this.lens.scale.setScalar(pose.radius);
    // Use the same angular magnification in mono and XR, independent of lens size.
    this.scope.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(60) / 2) / this.lastZoom));
    this.scope.updateProjectionMatrix();
    if (time - this.lastRender < 33) return; this.lastRender = time;
    const renderer = this.scene.renderer, previous = renderer.getRenderTarget(), xrEnabled = renderer.xr.enabled;
    const rootVisible = this.root.visible, handsVisible = this.handsRoot.visible;
    const hud = document.querySelector('#magic-hud').object3D, hudVisible = hud.visible;
    try {
      this.root.visible = false; this.handsRoot.visible = false; hud.visible = false;
      renderer.xr.enabled = false; renderer.setRenderTarget(this.renderTarget);
      renderer.render(this.scene.object3D, this.scope);
    } finally {
      renderer.setRenderTarget(previous); renderer.xr.enabled = xrEnabled;
      this.root.visible = rootVisible; this.handsRoot.visible = handsVisible; hud.visible = hudVisible;
    }
  }
  dispose() {
    this.scene.object3D.remove(this.root);
    this.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    this.sigil.dispose(); this.renderTarget.dispose();
  }
}
