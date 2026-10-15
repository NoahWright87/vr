import { PortalGesture, portalPoint, portalCrossing } from './portal-gesture.js';
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
          vec3 color = tint * (.10 + noise * .52);
          if (live > .5 && projected.w > 0.) color = texture2D(image, projected.xy / projected.w * .5 + .5).rgb;
          gl_FragColor = vec4(color, 1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }` });
      const surface = new THREE.Mesh(new THREE.CircleGeometry(1, 64), material); group.add(surface);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(1, .017, 6, 96), new THREE.MeshBasicMaterial({ color })); group.add(rim);
      const halo = new THREE.Mesh(new THREE.TorusGeometry(1.035, .006, 4, 96), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45 })); group.add(halo);
      const handles = [-1, 1].map(sign => {
        const mesh = new THREE.Mesh(new THREE.TorusGeometry(.045, .009, 5, 24), new THREE.MeshBasicMaterial({ color }));
        mesh.position.set(sign * .30, .25, .025); group.add(mesh); return mesh;
      });
      const help = caption(); help.set('PINCH RINGS + PULL / OR STEP THROUGH');
      help.sprite.position.set(0, .52, .04); help.sprite.scale.set(.55, .052, 1); group.add(help.sprite);
      const portal = { group, surface, rim, handles, targets: new Map(), radius: 1, previous: null };
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
    this.rendering = true;
    this.portals.forEach(p => { p.surface.material.uniforms.live.value = 0; p.surface.material.uniformsNeedUpdate = true; });
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
      this.portals.forEach((p, i) => { p.surface.material.uniforms.live.value = previousLive[i]; p.surface.material.uniformsNeedUpdate = true; });
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
    this.guide = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: '#ffc77a', transparent: true, opacity: .18 }));
    this.trace = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 300 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: '#ffdc8d' }));
    this.trace.geometry.setDrawRange(0, 0); this.root.add(this.guide, this.trace);
    this.spark = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(48 * 3), 3)), new THREE.PointsMaterial({ color: '#ffd48a', size: .025, transparent: true, opacity: .85, depthWrite: false }));
    this.root.add(this.spark); this.label = caption(); this.root.add(this.label.sprite);
    this.guide.frustumCulled = this.trace.frustumCulled = this.spark.frustumCulled = false;
    this.ray = new THREE.Raycaster(); this.lastTime = null; this.grip = null; this.pinchReady = {}; this.cooldown = 0;
  }
  reset(close = true) { this.gesture.reset(); this.grip = null; this.teleported = null; this.pinchReady = {}; this.lastTime = null; if (close) this.views.close(); this.guide.visible = this.spark.visible = this.trace.visible = this.label.sprite.visible = false; }
  obstacles() {
    return [...this.scene.querySelectorAll('[data-magic-blocker], [magic-receiver]')].map(el => el.getObject3D('mesh')).filter(Boolean);
  }
  clearLanding(position, normal, radius) {
    const feet = position.clone().addScaledVector(normal, .42); feet.y = .06;
    if (Math.abs(feet.x) > 57 || Math.abs(feet.z) > 57) return false;
    const body = new THREE.Box3(new THREE.Vector3(feet.x - .28, feet.y, feet.z - .28), new THREE.Vector3(feet.x + .28, radius * 2 - .05, feet.z + .28));
    return !this.obstacles().some(mesh => {
      const box = new THREE.Box3().setFromObject(mesh);
      return box.max.y > .08 && body.intersectsBox(box);
    });
  }
  destination(hand, head) {
    const pose = portalPoint(hand); if (!pose) return null;
    this.ray.set(vec(pose.tip), vec(pose.aim)); this.ray.far = 50;
    const hit = this.ray.intersectObjects(this.obstacles(), true)[0];
    if (!hit || !hit.object.el?.hasAttribute('data-portal-surface') || hit.distance < 2.5) return null;
    const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const radius = THREE.MathUtils.clamp((head.position.y - this.rig.object3D.position.y + .35) / 2, .9, 1.15);
    if (normal.y < .8 && Math.abs(normal.y) > .15) return null;
    if (normal.y > .8) normal.copy(head.forward).setY(0).normalize();
    else normal.setY(0).normalize();
    const position = hit.point.clone().addScaledVector(normal, .025); position.y = radius + .03;
    if (!this.clearLanding(position, normal, radius)) return null;
    return { position, normal, point: hit.point.clone(), radius };
  }
  open(cast, head, time) {
    const destination = cast.destination;
    if (!this.clearLanding(vec(destination.position), vec(destination.normal), destination.radius)) return;
    this.views.close(); this.views.root.visible = true; this.opened = time; this.cooldown = time + 700; this.grip = null;
    const center = vec(cast.origin).addScaledVector(vec(cast.right), cast.loop.center.x); center.y += cast.loop.center.y;
    const forward = vec(head.forward).setY(0).normalize(), source = head.position.clone().addScaledVector(forward, .62);
    source.addScaledVector(vec(cast.right), THREE.MathUtils.clamp(vec(center).sub(head.position).dot(vec(cast.right)), -.25, .25)); source.y = destination.radius + .03;
    const placements = [{ position: source, normal: forward.negate() }, destination];
    this.views.portals.forEach((portal, i) => {
      portal.radius = destination.radius; portal.group.position.copy(placements[i].position);
      portal.endPosition = portal.group.position.clone(); portal.startPosition = portal.endPosition.clone();
      portal.startPosition.y = i === 0 ? center.y : Math.max(.15, destination.point.y); portal.settled = false;
      portal.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), vec(placements[i].normal)); portal.group.scale.setScalar(.12);
      portal.previous = null;
    });
    this.scene.emit('magic-cast', { spell: 'portal', hand: cast.side });
  }
  pull(hands, occupied, head, time) {
    const reserved = {};
    if (!this.views.root.visible || time - this.opened < 700) return reserved;
    if (this.grip) {
      const { side, portal, anchor, start } = this.grip, hand = hands[side]; reserved[side] = true;
      if (!hand || hand.pinch > .65 || occupied[side]) { this.grip = null; return reserved; }
      const delta = vec(hand.palm).sub(anchor);
      if (delta.length() > 1.1) { this.grip = null; return reserved; }
      // Translate only toward/away from the player: a pull cannot fling the door sideways.
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(portal.group.quaternion);
      // A comfortable ~32 cm pull carries the nearby door over the head.
      portal.group.position.copy(start).addScaledVector(normal, THREE.MathUtils.clamp(delta.dot(normal) * 2, -.15, .95));
      return reserved;
    }
    for (const side of ['left', 'right']) {
      const hand = hands[side]; if (!hand || occupied[side]) { this.pinchReady[side] = false; continue; }
      if (hand.pinch > .72) this.pinchReady[side] = true;
      if (hand.pinch >= .45 || !this.pinchReady[side]) continue;
      const portal = this.views.portals.find(p => p.handles.some(h => h.getWorldPosition(new THREE.Vector3()).distanceTo(vec(hand.palm)) < .19));
      this.pinchReady[side] = false;
      if (portal) { this.grip = { side, portal, anchor: vec(hand.palm), start: portal.group.position.clone() }; reserved[side] = true; break; }
    }
    return reserved;
  }
  travel(head, time) {
    for (const portal of this.views.portals) {
      const local = head.position.clone().applyMatrix4(portal.group.matrixWorld.clone().invert()).multiplyScalar(portal.radius);
      if (time >= this.cooldown && portalCrossing(portal.previous, local, portal.radius)) {
        const exit = this.views.portals.find(p => p !== portal);
        // Keep the landing offset at least a body radius clear of a destination wall.
        const mapping = this.views.mapping(portal, exit);
        const mappedHead = head.position.clone().applyMatrix4(mapping);
        const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(exit.group.quaternion);
        const gap = mappedHead.clone().sub(exit.group.position).dot(normal);
        if (gap < .42) mapping.premultiply(new THREE.Matrix4().makeTranslation(normal.x * (.42 - gap), 0, normal.z * (.42 - gap)));
        if (!this.clearLanding(exit.group.position, normal, exit.radius)) { portal.previous = null; this.grip = null; return null; }
        const next = mapping.clone().multiply(this.rig.object3D.matrixWorld);
        next.decompose(this.rig.object3D.position, this.rig.object3D.quaternion, this.rig.object3D.scale);
        this.rig.object3D.updateMatrixWorld(true);
        this.sandbox.engine.teleport(p => vec(p).applyMatrix4(mapping));
        this.gesture.reset(); this.grip = null; this.cooldown = time + 1200;
        this.views.portals.forEach(p => { p.previous = null; });
        this.scene.emit('magic-travel', { spell: 'portal' }); return mapping;
      }
      portal.previous = local;
    }
    return null;
  }
  update(hands, head, time) {
    const session = this.scene.renderer.xr.getSession();
    if (session && session.visibilityState !== 'visible') { this.reset(false); this.views.portals.forEach(p => { p.previous = null; }); return {}; }
    const gap = this.lastTime === null ? 0 : time - this.lastTime;
    if (gap > 180 || gap < 0) { this.reset(false); this.views.portals.forEach(p => { p.previous = null; }); }
    this.lastTime = time;
    const occupied = Object.fromEntries(['left', 'right'].map(side => [side, ['fireball', 'telekinesis'].includes(this.sandbox.engine.hands[side].mode)]));
    const pulled = this.pull(hands, occupied, head, time);
    const destinations = {};
    for (const side of ['left', 'right']) if (!occupied[side] && !pulled[side]) destinations[side] = this.destination(hands[side], head);
    const result = this.gesture.update(hands, head, time, destinations, { left: occupied.left || pulled.left, right: occupied.right || pulled.right });
    this.lastResult = result;
    if (result.completed) this.open(result.completed, head, time);
    const s = result.state, pose = s && portalPoint(hands[s.side]);
    this.guide.visible = !!pose && s.phase !== 'complete'; this.trace.visible = !!s && ['ready', 'drawing'].includes(s.phase);
    this.spark.visible = !!s?.destination && s.phase !== 'complete'; this.label.sprite.visible = this.guide.visible;
    if (this.guide.visible) {
      const destination = s.destination, end = destination ? destination.point : vec(pose.tip).addScaledVector(vec(pose.aim), 15);
      const a = this.guide.geometry.attributes.position; a.setXYZ(0, pose.tip.x, pose.tip.y, pose.tip.z); a.setXYZ(1, end.x, end.y, end.z); a.needsUpdate = true;
      const ready = s.phase !== 'aim'; this.guide.material.opacity = ready ? .65 : .16;
      const progress = s.since === null ? 0 : Math.min(1, (time - s.since) / 1000);
      const text = !destination ? 'POINT AT CLEAR GROUND OR A PORTAL WALL' : ready ? 'READY / DRAW A HEAD-SIZED LOOP' : `HOLD STILL / ${Math.round(progress * 100)}%`;
      if (text !== this.labelText) { this.label.set(text); this.labelText = text; }
      this.label.sprite.position.copy(pose.tip).y += .14;
      if (destination) {
        const a = this.spark.geometry.attributes.position, power = ready ? 1 : .18;
        for (let i = 0; i < 48; i++) {
          const phase = (time * .0012 + i * .071) % 1, angle = i * 2.399;
          const p = vec(destination.point).add(new THREE.Vector3(Math.cos(angle), Math.sin(angle), .2 * Math.sin(i)).multiplyScalar(phase * .24 * power));
          a.setXYZ(i, p.x, p.y, p.z);
        } a.needsUpdate = true;
      }
    }
    if (this.trace.visible) {
      const a = this.trace.geometry.attributes.position;
      s.points.forEach((p, i) => { const world = vec(s.origin).addScaledVector(vec(s.right), p.x); world.y += p.y; a.setXYZ(i, world.x, world.y, world.z); });
      this.trace.geometry.setDrawRange(0, s.points.length); a.needsUpdate = true;
    }
    if (this.views.root.visible) {
      const growth = Math.min(1, Math.max(0, (time - this.opened) / 650)), eased = 1 - (1 - growth) ** 3;
      this.views.portals.forEach(p => {
        p.group.scale.setScalar(p.radius * (.12 + .88 * eased)); p.surface.material.uniforms.time.value = time / 1000;
        if (!p.settled) { p.group.position.lerpVectors(p.startPosition, p.endPosition, eased); p.settled = growth === 1; }
      });
      this.views.root.updateMatrixWorld(true);
      this.teleported = this.travel(head, time);
    } else this.teleported = null;
    return { left: result.reserved.left || pulled.left, right: result.reserved.right || pulled.right };
  }
  dispose() {
    this.views.dispose(); this.root.removeFromParent();
    this.root.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
  }
}
