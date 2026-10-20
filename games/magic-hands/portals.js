import { PortalGesture, doorPose, doorAim, doorGrasp, portalCrossing, portalAperture } from './portal-gesture.js';
const THREE = AFRAME.THREE;
const vec = p => new THREE.Vector3(p.x, p.y, p.z);
const flip = new THREE.Matrix4().makeRotationY(Math.PI);

function caption() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 96;
  const context = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
  sprite.scale.set(.38, .036, 1);
  return { sprite, set(text) {
    context.clearRect(0, 0, 1024, 96); context.fillStyle = '#172333ee'; context.fillRect(0, 0, 1024, 96);
    context.font = 'bold 38px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#ffe4a4';
    context.fillText(text, 512, 48); texture.needsUpdate = true;
  } };
}

// The portal surface uses screen-projective sampling. Each actual eye camera
// supplies its own view and asymmetric projection; no mono texture is shared.
export class PortalViews {
  constructor(scene) {
    this.scene = scene; this.rendering = false; this.captures = 0; this.nestedStatic = 0;
    this.root = new THREE.Group(); scene.object3D.add(this.root);
    this.camera = new THREE.PerspectiveCamera(); this.portals = [];
    for (const color of ['#ffae57', '#74dcff']) {
      const group = new THREE.Group(); this.root.add(group);
      const material = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: {
        image: { value: null }, projector: { value: new THREE.Matrix4() }, live: { value: 0 }, time: { value: 0 }, tint: { value: new THREE.Color(color) },
      }, vertexShader: `varying vec4 projected; varying vec2 local;
        uniform mat4 projector;
        void main() { vec4 world = modelMatrix * vec4(position, 1.); projected = projector * world; local = position.xy;
          gl_Position = projectionMatrix * viewMatrix * world; }`,
      fragmentShader: `uniform sampler2D image; uniform float live; uniform float time; uniform vec3 tint;
        varying vec4 projected; varying vec2 local;
        void main() { float noise = fract(sin(dot(floor(local * 180.), vec2(12.9898,78.233)) + floor(time * 18.)) * 43758.5453);
          vec3 color = tint * .12;
          if (gl_FrontFacing) {
            color = tint * (.10 + noise * .52);
            if (live > .5 && projected.w > 0.) color = texture2D(image, projected.xy / projected.w * .5 + .5).rgb;
          }
          gl_FragColor = vec4(color, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
      const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), material); group.add(surface);
      const rim = new THREE.Group(); group.add(rim);
      for (const sign of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(.025, 2.03, .025), new THREE.MeshBasicMaterial({ color })); side.position.x = sign * .5; rim.add(side);
        const horizontal = new THREE.Mesh(new THREE.BoxGeometry(1, .025, .025), new THREE.MeshBasicMaterial({ color })); horizontal.position.y = sign; rim.add(horizontal);
      }
      const handles = [-1, 1].map(sign => {
        const mesh = new THREE.Mesh(new THREE.TorusGeometry(.045, .009, 5, 24), new THREE.MeshBasicMaterial({ color }));
        mesh.position.set(sign * .5, .25, .025); group.add(mesh); return mesh;
      });
      const help = caption(); help.set('GRAB SIDES TO HOLD / PULL TO TRAVEL');
      help.sprite.position.set(0, .65, .04); help.sprite.scale.set(.55, .052, 1); group.add(help.sprite);
      const portal = { group, surface, rim, handles, help: help.sprite, targets: new Map(), radius: 1, previous: null };
      surface.onBeforeRender = (renderer, world, camera) => this.capture(portal, renderer, world, camera);
      this.portals.push(portal);
    }
    this.root.visible = false;
  }
  mapping(entry, exit) {
    return new THREE.Matrix4().copy(exit.group.matrixWorld).multiply(flip).multiply(entry.group.matrixWorld.clone().invert());
  }
  capture(entry, renderer, world, eye) {
    if (this.rendering) { this.nestedStatic++; return; }
    const material = entry.surface.material;
    material.uniforms.live.value = 0;
    material.uniformsNeedUpdate = true;
    const eyes = this.scene.camera.isArrayCamera ? this.scene.camera.cameras : renderer.xr.isPresenting ? renderer.xr.getCamera().cameras : [];
    if (eye !== this.scene.camera && !eyes.includes(eye)) return; // Farsight sees static too.
    const localEye = vec(eye.position).setFromMatrixPosition(eye.matrixWorld).applyMatrix4(entry.group.matrixWorld.clone().invert());
    entry.help.visible = localEye.z > .005;
    if (localEye.z <= .005) return;
    const exit = this.portals.find(p => p !== entry), camera = this.camera;
    camera.matrixWorld.copy(this.mapping(entry, exit)).multiply(eye.matrixWorld);
    camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
    camera.projectionMatrix.copy(eye.projectionMatrix); camera.near = eye.near; camera.far = eye.far;
    // Oblique near-plane clipping removes the destination wall behind the exit.
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(exit.group.matrixWorld), exit.group.position);
    plane.constant -= .015;
    plane.applyMatrix4(camera.matrixWorldInverse);
    const clip = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const projection = camera.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(clip.x) + projection[8]) / projection[0], (Math.sign(clip.y) + projection[9]) / projection[5], -1, (1 + projection[10]) / projection[14]);
    clip.multiplyScalar(2 / clip.dot(q));
    projection[2] = clip.x; projection[6] = clip.y; projection[10] = clip.z + 1; projection[14] = clip.w;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    if (!entry.targets.has(eye.uuid)) entry.targets.set(eye.uuid, new THREE.WebGLRenderTarget(640, 640, { depthBuffer: true }));
    const target = entry.targets.get(eye.uuid), oldTarget = renderer.getRenderTarget(), enabled = renderer.xr.enabled;
    const viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4()), scissorTest = renderer.getScissorTest();
    const shadowUpdate = renderer.shadowMap.autoUpdate, hud = document.querySelector('#magic-hud')?.object3D, hudVisible = hud?.visible;
    const previousLive = this.portals.map(p => p.surface.material.uniforms.live.value), exitVisible = exit.group.visible;
    const helpVisibility = this.portals.map(p => p.help.visible);
    this.rendering = true;
    this.portals.forEach(p => { p.surface.material.uniforms.live.value = 0; p.surface.material.uniformsNeedUpdate = true; p.help.visible = false; });
    try {
      renderer.xr.enabled = false; renderer.shadowMap.autoUpdate = false;
      exit.group.visible = false;
      if (hud) hud.visible = false;
      renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.state.buffers.depth.setMask(true); renderer.clear();
      renderer.render(world, camera); this.captures++;
      entry.lastEye = new THREE.Vector3().setFromMatrixPosition(eye.matrixWorld);
    } finally {
      this.rendering = false; renderer.xr.enabled = enabled; renderer.shadowMap.autoUpdate = shadowUpdate;
      exit.group.visible = exitVisible;
      if (hud) hud.visible = hudVisible;
      this.portals.forEach((p, i) => { p.surface.material.uniforms.live.value = previousLive[i]; p.surface.material.uniformsNeedUpdate = true; p.help.visible = helpVisibility[i]; });
      renderer.setRenderTarget(oldTarget); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest);
      // ArrayCamera installs a per-eye viewport before onBeforeRender.
      if (eye.viewport) renderer.state.viewport(eye.viewport);
    }
    material.uniforms.image.value = target.texture;
    material.uniforms.projector.value.copy(eye.projectionMatrix).multiply(eye.matrixWorldInverse);
    material.uniforms.live.value = 1;
    material.uniformsNeedUpdate = true;
  }
  close() {
    this.root.visible = false;
    this.portals.forEach(p => {
      p.previous = null; p.targets.forEach(t => t.dispose()); p.targets.clear();
      p.surface.material.uniforms.image.value = null; p.surface.material.uniforms.live.value = 0;
    });
  }
  dispose() { this.close(); this.root.removeFromParent(); this.root.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); }
}

export class Portals {
  constructor(scene, rig, sandbox) {
    this.scene = scene; this.rig = rig; this.sandbox = sandbox; this.gesture = new PortalGesture(); this.views = new PortalViews(scene);
    this.root = new THREE.Group(); scene.object3D.add(this.root);
    this.guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffc77a', transparent: true, opacity: .25 }));
    this.spark = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(32 * 3), 3)), new THREE.PointsMaterial({ color: '#ffd48a', size: .035, depthWrite: false }));
    this.preview = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 2)), new THREE.LineBasicMaterial({ color: '#ffcb80', transparent: true, opacity: .55 }));
    this.label = caption(); this.root.add(this.guide, this.spark, this.preview, this.label.sprite);
    this.guide.frustumCulled = this.spark.frustumCulled = false;
    this.ray = new THREE.Raycaster(); this.reset();
  }
  reset(close = true) {
    this.gesture.reset(); this.grips = {}; this.grip = null; this.teleported = null; this.lastTime = null; this.aim = null;
    this.guide.visible = this.spark.visible = this.preview.visible = this.label.sprite.visible = false;
    if (close) this.views.close();
  }
  obstacles() { return [...this.scene.querySelectorAll('[data-magic-blocker], [magic-receiver]')].map(el => el.getObject3D('mesh')).filter(Boolean); }
  clearLanding(position, normal, radius) {
    const feet = position.clone().addScaledVector(normal, .45); feet.y = .06;
    if (Math.abs(feet.x) > 57 || Math.abs(feet.z) > 57) return false;
    const body = new THREE.Box3(new THREE.Vector3(feet.x - .28, feet.y, feet.z - .28), new THREE.Vector3(feet.x + .28, radius * 2 - .05, feet.z + .28));
    return !this.obstacles().some(mesh => { const box = new THREE.Box3().setFromObject(mesh); return box.max.y > .08 && body.intersectsBox(box); });
  }
  destination(hands, head, dt) {
    const desired = vec(doorAim(hands, head));
    if (!this.aim || this.aim.dot(desired) < -.8) this.aim = desired; else this.aim.lerp(desired, 1 - Math.exp(-dt / 160)).normalize();
    // A level gaze selects distant ground rather than the sky. Looking down
    // brings the landing closer; palm direction provides a small aiming bias.
    const direction = this.aim.clone(); direction.y = Math.min(-.07, direction.y); direction.normalize();
    this.ray.set(head.position, direction); this.ray.far = 50;
    const solids = [...this.scene.querySelectorAll('[data-magic-blocker]')].map(el => el.getObject3D('mesh')).filter(Boolean);
    const hit = this.ray.intersectObjects(solids, true)[0];
    if (!hit || !hit.object.el?.hasAttribute('data-portal-surface') || hit.distance < 2.5) return null;
    const radius = THREE.MathUtils.clamp((head.position.y - this.rig.object3D.position.y + .40) / 2, .9, 1.15);
    const normal = head.position.clone().sub(hit.point).setY(0).normalize();
    const surfaceNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (surfaceNormal.y < .8 && Math.abs(surfaceNormal.y) > .15) return null;
    const position = hit.point.clone().addScaledVector(normal, surfaceNormal.y > .8 ? .02 : .55); position.y = radius + .03;
    return this.clearLanding(position, normal, radius) ? { position, normal, point: hit.point.clone(), radius } : null;
  }
  open(cast, head, time) {
    const d = cast.destination;
    if (!d || !this.clearLanding(vec(d.position), vec(d.normal), d.radius)) return;
    this.views.close(); this.views.root.visible = true; this.opened = this.lastInteraction = time; this.aperture = .05; this.cooldown = time + 400; this.grips = {};
    const forward = vec(head.forward).setY(0).normalize(), source = head.position.clone().addScaledVector(forward, .48); source.y = d.radius + .03;
    [{ position: source, normal: forward.negate() }, d].forEach((placement, i) => {
      const p = this.views.portals[i]; p.radius = d.radius; p.group.position.copy(placement.position);
      p.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(placement.normal)); p.group.scale.setScalar(p.radius * this.aperture); p.previous = null;
    });
    this.scene.emit('magic-cast', { spell: 'portal', hand: 'both' });
  }
  nearSide(portal, hand) {
    const local = vec(hand.palm).applyMatrix4(portal.group.matrixWorld.clone().invert()), scale = portal.group.scale.x;
    return Math.abs(Math.abs(local.x) - .5) * scale < .20 && Math.abs(local.y) < 1.05 && Math.abs(local.z) * scale < .24;
  }
  pull(hands, occupied, head, time) {
    const reserved = {};
    if (!this.views.root.visible || time - this.opened < 250) return reserved;
    for (const side of ['left', 'right']) {
      const hand = hands[side]; let grip = this.grips[side];
      if (grip && (!hand || occupied[side] || (hand.tracked !== false && !doorGrasp(hand)))) { delete this.grips[side]; grip = null; }
      if (!grip && hand && hand.tracked !== false && !occupied[side] && doorGrasp(hand)) {
        const portal = this.views.portals.find(p => this.nearSide(p, hand));
        if (portal) this.grips[side] = grip = { side, portal, anchor: vec(hand.palm), start: portal.group.position.clone() };
      }
      if (grip) {
        reserved[side] = true; this.lastInteraction = time;
        if (hand.reacquired) { grip.anchor.copy(hand.palm); grip.start.copy(grip.portal.group.position); }
      }
    }
    for (const portal of this.views.portals) {
      const active = Object.values(this.grips).filter(g => g.portal === portal && hands[g.side]?.tracked !== false);
      if (!active.length) continue;
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(portal.group.quaternion);
      const locations = active.map(g => {
        const delta = vec(hands[g.side].palm).sub(g.anchor).dot(normal);
        return g.start.clone().addScaledVector(normal, THREE.MathUtils.clamp(delta * 2, -.12, .95));
      });
      portal.group.position.copy(locations.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / locations.length));
    }
    this.grip = Object.values(this.grips)[0] || null; return reserved;
  }
  travel(head, time) {
    for (const portal of this.views.portals) {
      const scale = portal.group.scale.x;
      const local = head.position.clone().applyMatrix4(portal.group.matrixWorld.clone().invert()).multiplyScalar(scale);
      if (this.aperture > .65 && time >= this.cooldown && portalCrossing(portal.previous, local, scale * .5, scale)) {
        const exit = this.views.portals.find(p => p !== portal), mapping = this.views.mapping(portal, exit);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(exit.group.quaternion), mappedHead = head.position.clone().applyMatrix4(mapping);
        const gap = mappedHead.clone().sub(exit.group.position).dot(normal);
        if (gap < .45) mapping.premultiply(new THREE.Matrix4().makeTranslation(normal.x * (.45 - gap), 0, normal.z * (.45 - gap)));
        if (!this.clearLanding(exit.group.position, normal, exit.radius)) { portal.previous = null; this.grips = {}; return null; }
        const next = mapping.clone().multiply(this.rig.object3D.matrixWorld);
        next.decompose(this.rig.object3D.position, this.rig.object3D.quaternion, this.rig.object3D.scale); this.rig.object3D.updateMatrixWorld(true);
        this.sandbox.engine.teleport(p => vec(p).applyMatrix4(mapping));
        this.gesture.reset(); this.aim = null; this.grips = {}; this.grip = null; this.cooldown = time + 1000; this.lastInteraction = time;
        this.views.portals.forEach(p => { p.previous = null; }); this.scene.emit('magic-travel', { spell: 'portal' }); return mapping;
      }
      portal.previous = local;
    }
    return null;
  }
  update(hands, head, time) {
    const session = this.scene.renderer.xr.getSession();
    if (session && session.visibilityState !== 'visible') { this.reset(); return {}; }
    let elapsed = this.lastTime === null ? 16 : Math.max(0, time - this.lastTime);
    if (elapsed > 300) this.views.portals.forEach(p => { p.previous = null; });
    if (elapsed > 1500) this.grips = {};
    this.lastTime = time; const dt = Math.min(elapsed, 100);
    const occupied = Object.fromEntries(['left', 'right'].map(side => [side, ['fireball', 'telekinesis'].includes(this.sandbox.engine.hands[side].mode)]));
    const pulled = this.pull(hands, occupied, head, time);
    const canAim = doorPose(hands, head, !this.gesture.state);
    const destination = canAim ? this.destination(hands, head, dt) : null;
    const result = this.gesture.update(hands, head, time, destination, { left: occupied.left || pulled.left, right: occupied.right || pulled.right });
    this.lastResult = result; if (result.completed) this.open(result.completed, head, time);
    const s = result.state, drawing = s && s.phase !== 'complete';
    this.guide.visible = this.label.sprite.visible = !!drawing; this.spark.visible = this.preview.visible = !!drawing && !!s.destination;
    if (drawing) {
      const center = vec(doorPose(hands, head, false)?.center || s.anchorCenter), d = s.destination;
      const end = d ? vec(d.point) : head.position.clone().addScaledVector(head.forward, 12), a = this.guide.geometry.attributes.position;
      a.setXYZ(0, center.x, center.y, center.z); a.setXYZ(1, end.x, end.y, end.z); a.needsUpdate = true;
      this.guide.material.opacity = s.phase === 'aim' ? .18 : .6;
      const text = !d ? 'LOOK AT CLEAR GROUND / MOVE HANDS TO AIM' : s.phase === 'aim' ? 'PALMS OUT / DOOR PREPARING' : 'SPREAD YOUR HANDS APART';
      if (text !== this.labelText) { this.label.set(text); this.labelText = text; } this.label.sprite.position.copy(center).y += .18;
      if (d) {
        this.preview.position.copy(d.position); this.preview.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(d.normal)); this.preview.scale.setScalar(d.radius);
        const a = this.spark.geometry.attributes.position;
        for (let i = 0; i < 32; i++) { const phase = (time * .0015 + i * .071) % 1, angle = i * 2.399, p = vec(d.point).add(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0).multiplyScalar(phase * .2)); a.setXYZ(i, p.x, p.y, p.z); } a.needsUpdate = true;
      }
    }
    this.teleported = null;
    if (this.views.root.visible) {
      const held = Object.keys(this.grips).length > 0;
      const desired = portalAperture(time, this.lastInteraction, held);
      this.aperture += (desired - this.aperture) * (1 - Math.exp(-dt / (held ? 85 : 140)));
      this.views.portals.forEach(p => { p.group.scale.setScalar(Math.max(.01, p.radius * this.aperture)); p.surface.material.uniforms.time.value = time / 1000; });
      this.views.root.updateMatrixWorld(true);
      if (this.aperture < .035 && desired === 0) { this.views.close(); this.grips = {}; }
      else this.teleported = this.travel(head, time);
    }
    return { left: result.reserved.left || pulled.left, right: result.reserved.right || pulled.right };
  }
  dispose() { this.views.dispose(); this.root.removeFromParent(); this.root.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); }
}
