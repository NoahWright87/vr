import { SpellSandbox } from './spell-sandbox.js';
const THREE = AFRAME.THREE;
const vec = p => new THREE.Vector3(p.x, p.y, p.z);
const show = object => { for (let p = object; p; p = p.parent) if (!p.visible) return false; return !!object; };

function fireModel(radius = .10) {
  const group = new THREE.Group();
  for (const [size, color, opacity] of [[.65, '#fff6ac', 1], [1, '#ff932b', .9], [1.65, '#ff5126', .17]]) {
    group.add(new THREE.Mesh(new THREE.IcosahedronGeometry(radius * size, 1), new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 })));
  }
  return group;
}
function dispose(object) { object.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); }); object.removeFromParent(); }
function caption() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 128;
  const context = canvas.getContext('2d'), texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(.30, .0375, 1);
  return { sprite, setText(text) {
    context.clearRect(0, 0, 1024, 128); context.font = 'bold 44px sans-serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    const width = Math.min(1000, context.measureText(text).width + 36);
    context.fillStyle = 'rgba(15,18,39,.85)'; context.fillRect((1024 - width) / 2, 23, width, 82);
    context.fillStyle = '#e6d6ff'; context.fillText(text, 512, 64, 970); texture.needsUpdate = true;
  } };
}

export class SandboxView {
  constructor(scene) {
    this.scene = scene; this.engine = new SpellSandbox(); this.root = new THREE.Group(); scene.object3D.add(this.root);
    this.personal = new THREE.Group(); this.root.add(this.personal);
    this.targets = [...scene.querySelectorAll('[magic-receiver]')].map((el, i) => ({ el, id: el.id || `practice-target-${i}` }));
    this.blockers = [...scene.querySelectorAll('[data-magic-blocker]')]; this.lastWorld = -Infinity;
    this.props = new Map(); this.orbs = new Map(); this.bursts = new Map(); this.hands = {};
    for (const body of this.engine.bodies) {
      const geometry = body.shape === 'cube' ? new THREE.BoxGeometry(body.radius * 1.15, body.radius * 1.15, body.radius * 1.15) : body.shape === 'orb' ? new THREE.SphereGeometry(body.radius, 16, 12) : new THREE.IcosahedronGeometry(body.radius, 0);
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: body.color, roughness: .65, emissive: body.color, emissiveIntensity: .18 }));
      const outline = new THREE.Mesh(new THREE.IcosahedronGeometry(body.radius * 1.18, 1), new THREE.MeshBasicMaterial({ color: '#d5b7ff', wireframe: true, transparent: true, opacity: .65, depthWrite: false }));
      const group = new THREE.Group(); group.add(mesh, outline); this.root.add(group); this.props.set(body.id, { group, mesh, outline });
    }
    for (const side of ['left', 'right']) {
      const rock = new THREE.Group();
      for (let i = 0; i < 7; i++) {
        const piece = new THREE.Mesh(new THREE.IcosahedronGeometry(i ? .075 : .16, 0), new THREE.MeshStandardMaterial({ color: i % 2 ? '#807b85' : '#b1a599', roughness: 1, emissive: '#453429', emissiveIntensity: .15 }));
        if (i) piece.position.set(Math.sin(i * 2.4) * .12, Math.cos(i * 2.4) * .12, Math.sin(i * 1.9) * .08);
        rock.add(piece);
      }
      const fire = fireModel();
      const sparks = new THREE.Mesh(new THREE.TorusGeometry(.055, .004, 4, 20), new THREE.MeshBasicMaterial({ color: '#ffab4e', transparent: true, opacity: .6 }));
      sparks.rotation.x = Math.PI / 2;
      const tether = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 13 }, () => new THREE.Vector3())), new THREE.LineBasicMaterial({ color: '#c595ff', transparent: true, opacity: .7, depthWrite: false }));
      tether.frustumCulled = false; this.personal.add(rock, fire, sparks, tether);
      const label = caption(); this.personal.add(label.sprite);
      this.hands[side] = { rock, fire, sparks, tether, label, text: '' };
    }
  }
  world(time) {
    if (time - this.lastWorld < 250 && this.worldData) return this.worldData;
    this.lastWorld = time;
    const targets = this.targets.flatMap(({ el, id }) => {
      const mesh = el.getObject3D('mesh'); if (!show(mesh)) return [];
      mesh.updateWorldMatrix(true, false);
      const sphere = new THREE.Box3().setFromObject(mesh).getBoundingSphere(new THREE.Sphere());
      // A-Frame sphere primitives have a tighter native bounding sphere.
      if (mesh.geometry) { if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere(); sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld); }
      return [{ id, center: { x: sphere.center.x, y: sphere.center.y, z: sphere.center.z }, radius: sphere.radius }];
    });
    const obstacles = this.blockers.flatMap(el => {
      const mesh = el.getObject3D('mesh'); if (!show(mesh)) return [];
      mesh.updateWorldMatrix(true, false);
      const box = new THREE.Box3().setFromObject(mesh);
      if (box.max.y - box.min.y < .04) return []; // Ground has exact sphere-floor collision.
      return [{ min: { ...box.min }, max: { ...box.max } }];
    });
    this.worldData = { targets, obstacles }; return this.worldData;
  }
  update(hands, head, time, reserved = {}) {
    const result = this.engine.update(hands, head, time, this.world(time), reserved);
    for (const event of result.events) {
      if (event.type === 'hit') this.targets.find(t => t.id === event.target)?.el.emit('magic-hit', event);
      if (event.type === 'cast') this.scene.emit('magic-cast', event);
      if (event.type === 'acquired') this.scene.emit('magic-acquired', event);
    }
    for (const body of this.engine.bodies) {
      const visual = this.props.get(body.id); visual.group.position.copy(body.position);
      visual.mesh.rotation.y = time * .0002; visual.outline.rotation.y = -time * .0003;
      visual.outline.visible = !!body.owner || Object.values(result.hands).some(s => s.focus === body.id && s.mode === 'idle');
      visual.mesh.material.emissiveIntensity = visual.outline.visible ? .45 : .18;
    }
    for (const side of ['left', 'right']) {
      const state = result.hands[side], hand = hands[side], visual = this.hands[side];
      visual.rock.visible = !!hand && (state.mode === 'boulder' || (state.mode === 'idle' && state.fistSince !== null));
      visual.fire.visible = !!hand && state.mode === 'fireball';
      visual.sparks.visible = !!hand && state.mode === 'idle' && !!state.scoop;
      visual.tether.visible = !!hand && state.mode === 'telekinesis';
      if (hand) {
        visual.rock.position.copy(hand.palm);
        visual.rock.scale.setScalar(state.mode === 'boulder' ? .65 + .35 * Math.min(1, (time - state.since) / 180) : .15 + .50 * Math.min(1, (time - state.fistSince) / 180));
        visual.fire.position.copy(hand.palm).y += .12;
        visual.fire.rotation.y = time * .002; visual.fire.scale.setScalar(1 + Math.sin(time * .008) * .08);
        visual.sparks.position.copy(hand.palm).y += .06; visual.sparks.scale.setScalar(.5 + (state.charge || 0));
        if (state.body) {
          const start = vec(hand.palm), end = vec(state.body.position), control = start.clone().lerp(end, .5); control.y += .08;
          const curve = new THREE.QuadraticBezierCurve3(start, control, end), positions = visual.tether.geometry.attributes.position;
          for (let i = 0; i < 13; i++) { const p = curve.getPoint(i / 12); positions.setXYZ(i, p.x, p.y, p.z); } positions.needsUpdate = true;
        }
      }
      const text = !hand ? '' : hand.tracked === false && ['boulder', 'fireball', 'telekinesis'].includes(state.mode) ? 'STILL HELD / HAND OUT OF VIEW' : state.mode === 'boulder' ? 'BOULDER / PUNCH' : state.mode === 'fireball' ? 'FIRE / THROW OR THRUST' : state.mode === 'telekinesis' ?
        state.phase === 'remote' ? 'LIFT / YANK TO CATCH' : state.phase === 'pulling' ? 'OPEN YOUR HAND / CATCH' : 'GRASPED / PUSH TO THROW' :
        state.mode === 'recovery' ? 'RELAX HAND TO READY' : state.fistSince !== null ? 'STONE FORMING...' : state.scoop ? 'SCOOP TO GATHER FIRE' : state.focus ? 'PINCH TO LIFT' : '';
      if (text !== visual.text) { visual.label.setText(text); visual.text = text; }
      visual.label.sprite.visible = !!text;
      if (hand) visual.label.sprite.position.copy(hand.palm).y += .27;
    }
    this.syncEffects(this.engine.projectiles, this.orbs, p => fireModel(p.radius), (object, p) => {
      object.position.copy(p.position); object.rotation.y = time * .004;
    });
    this.syncEffects(this.engine.bursts, this.bursts, b => new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: b.color, wireframe: true, transparent: true, depthWrite: false })), (object, b) => {
      const age = Math.min(1, (time - b.born) / 450); object.position.copy(b.position); object.scale.setScalar(.06 + b.radius * age); object.material.opacity = .8 * (1 - age);
    });
    return result;
  }
  syncEffects(items, visuals, create, update) {
    const ids = new Set(items.map(item => item.id));
    for (const [id, object] of visuals) if (!ids.has(id)) { dispose(object); visuals.delete(id); }
    for (const item of items) {
      if (!visuals.has(item.id)) { const object = create(item); this.root.add(object); visuals.set(item.id, object); }
      update(visuals.get(item.id), item);
    }
  }
  dispose() { dispose(this.root); }
}
