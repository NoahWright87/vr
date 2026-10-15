import { distance, midpoint } from '../../common/hand-gestures.js';
import { LIGHTNING_AIM, selectLightningTarget } from './lightning-aim.js';
const THREE = AFRAME.THREE;
const vec = p => new THREE.Vector3(p.x, p.y, p.z);
function visible(object) {
  for (let p = object; p; p = p.parent) if (!p.visible) return false;
  return !!object;
}

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
    this.targetEls = [...scene.querySelectorAll('[magic-receiver]')];
    this.blockerEls = [...scene.querySelectorAll('[data-magic-blocker]')];
    this.glows = {}; this.beams = {}; this.guides = {}; this.shields = [];
    for (const side of ['left', 'right']) {
      const glow = new THREE.Mesh(new THREE.SphereGeometry(.014, 12, 8), new THREE.MeshBasicMaterial({ color: '#65d8ff' }));
      glow.add(new THREE.Mesh(new THREE.SphereGeometry(.026, 12, 8), new THREE.MeshBasicMaterial({ color: '#219eff', transparent: true, opacity: .22, depthWrite: false })));
      this.root.add(glow); this.glows[side] = glow;
      const beam = new THREE.Group();
      this.root.add(beam); this.beams[side] = { object: beam, until: 0 };
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#69c9ff', transparent: true, opacity: .22, depthWrite: false }));
      line.frustumCulled = false;
      const marker = new THREE.Mesh(new THREE.RingGeometry(.8, 1, 24), new THREE.MeshBasicMaterial({ color: '#b0f3ff', transparent: true, opacity: .8, side: THREE.DoubleSide, depthWrite: false }));
      this.root.add(line, marker); this.guides[side] = { line, marker };
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
    Object.values(this.guides).forEach(g => { g.line.visible = g.marker.visible = false; });
    this.shields.forEach(s => { s.visible = false; }); this.lens.visible = false; this.lastRender = -Infinity;
  }
  solveAim(hand) {
    const origin = vec(hand.tip), direction = vec(hand.aim).normalize();
    const targets = this.targetEls.map(el => ({ el, mesh: el.getObject3D('mesh') })).filter(t => visible(t.mesh));
    const blockers = this.blockerEls.map(el => el.getObject3D('mesh')).filter(visible);
    const meshes = [...targets.map(t => t.mesh), ...blockers];
    const trace = dir => {
      this.ray.set(origin, dir); this.ray.near = .015; this.ray.far = LIGHTNING_AIM.range;
      return this.ray.intersectObjects(meshes, true).find(hit => visible(hit.object));
    };
    const recipient = hit => {
      for (let object = hit?.object; object; object = object.parent) {
        const target = targets.find(t => t.mesh === object); if (target) return target;
      }
      return null;
    };
    const raw = trace(direction), direct = recipient(raw);
    const solution = { origin, direction, rawEnd: raw?.point || origin.clone().addScaledVector(direction, 60), point: null, el: null, kind: 'miss' };
    if (direct) return { ...solution, point: raw.point, el: direct.el, kind: 'direct' };
    for (const target of targets) {
      if (target.mesh.geometry) {
        if (!target.mesh.geometry.boundingSphere) target.mesh.geometry.computeBoundingSphere();
        const sphere = target.mesh.geometry.boundingSphere.clone().applyMatrix4(target.mesh.matrixWorld);
        target.center = sphere.center; target.radius = sphere.radius;
      } else {
        const sphere = new THREE.Box3().setFromObject(target.mesh).getBoundingSphere(new THREE.Sphere());
        target.center = sphere.center; target.radius = sphere.radius;
      }
      const hit = trace(target.center.clone().sub(origin).normalize());
      target.visible = recipient(hit) === target; target.hit = hit;
    }
    const selected = selectLightningTarget(origin, direction, targets);
    return selected ? { ...solution, point: selected.target.hit.point, el: selected.target.el, kind: selected.kind } : solution;
  }
  cast(side, hand, time, solution = this.solveAim(hand)) {
    const { origin, direction, point, el, kind } = solution;
    if (el) el.emit('magic-hit', { spell: 'lightning', damage: 25, point, hand: side, assistance: kind });
    const end = point || solution.rawEnd, reach = origin.distanceTo(end), beam = this.beams[side];
    // The path initially follows the real finger direction, then bends toward
    // the selected hit. The visible endpoint is exactly the scored hit point.
    const bend = kind === 'arc' ? .70 : .40;
    const control = origin.clone().addScaledVector(direction, reach * bend);
    const path = new THREE.CatmullRomCurve3([origin, control, end]);
    const points = Array.from({ length: 17 }, (_, i) => {
      const p = path.getPoint(i / 16), envelope = Math.sin(i * Math.PI / 16) * Math.min(.06, reach * .006);
      p.x += Math.sin(i * 4.7 + time) * envelope; p.y += Math.cos(i * 3.1 + time) * envelope; return p;
    });
    const bolt = new THREE.CatmullRomCurve3(points);
    for (const child of [...beam.object.children]) { child.geometry.dispose(); child.material.dispose(); beam.object.remove(child); }
    for (const [radius, color, opacity] of [[.006, '#d5f7ff', 1], [.018, '#259eff', .35]]) {
      beam.object.add(new THREE.Mesh(new THREE.TubeGeometry(bolt, 48, radius, 4, false), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
    }
    beam.object.visible = true; beam.until = time + 160;
    this.scene.emit('magic-cast', { spell: 'lightning', hand: side, hit: el, assistance: kind });
  }
  update(result, hands, head, time, dt) {
    for (const side of ['left', 'right']) {
      const glow = this.glows[side]; glow.visible = result[side] === 'lightning';
      if (glow.visible) { glow.position.copy(vec(hands[side].tip)); glow.scale.setScalar(1 + .12 * Math.sin(time / 90)); }
      const guide = this.guides[side]; guide.line.visible = glow.visible; guide.marker.visible = false;
      if (glow.visible) {
        const solution = this.solveAim(hands[side]), positions = guide.line.geometry.attributes.position;
        positions.setXYZ(0, solution.origin.x, solution.origin.y, solution.origin.z);
        positions.setXYZ(1, solution.rawEnd.x, solution.rawEnd.y, solution.rawEnd.z); positions.needsUpdate = true;
        if (solution.point) {
          guide.marker.visible = true;
          guide.marker.position.copy(solution.point).addScaledVector(solution.origin.clone().sub(solution.point).normalize(), .015);
          guide.marker.lookAt(head.position); guide.marker.scale.setScalar(Math.max(.025, .008 * solution.origin.distanceTo(solution.point)));
        }
        if (result.casts.includes(side)) this.cast(side, hands[side], time, solution);
      }
      const beam = this.beams[side]; if (time >= beam.until) beam.object.visible = false;
    }
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
