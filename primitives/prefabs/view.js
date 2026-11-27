// ============================================================
// WORKSHOP VIEW — the 3D side: the prefab and the hands on it, markers
// for its emitters and sockets, an orbit camera, and the gizmo that drags
// whatever is selected.
//
// It reads the store and draws it; the only thing it writes back is the
// selected placement, as the gizmo is dragged.
// ============================================================

import { loadHand } from '../../common/hand-pose.js';
import { occupantFor } from '../../common/prefab-core.js';
import '../../common/prefab.js';
import { placementOf } from './selection.js';

const THREE = AFRAME.THREE;
const RAD = Math.PI / 180;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const AXIS_COLORS = [0xff5a5a, 0x5aff7a, 0x5a8cff];
const HAND_COLORS = ['#7fb4ff', '#ffb05a', '#8fe08f'];
const FREE_HANDS = { right: { pos: [0.1, 0, 0], rot: [0, 0, 0] }, left: { pos: [-0.1, 0, 0], rot: [0, 0, 0] } };
const VIEWS = {
  threeQuarter: { yaw: 140, pitch: 22 }, side: { yaw: 90, pitch: 0 },
  front: { yaw: 180, pitch: 0 }, back: { yaw: 0, pitch: 0 }, top: { yaw: 90, pitch: 88 },
};

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const quatOf = rot => new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD, 'XYZ'));
const rotOf = quat => {
  const e = new THREE.Euler().setFromQuaternion(quat, 'XYZ');
  return [e.x / RAD, e.y / RAD, e.z / RAD];
};

export function createView({ sceneEl, store }) {
  const world = new THREE.Group();
  sceneEl.object3D.add(world);
  const cameraEl = sceneEl.querySelector('[camera]');

  // ---- subject: the prefab entity, whose model and anchors the prefab component keeps ----
  const prefabEl = document.createElement('a-entity');
  prefabEl.setAttribute('prefab', '');
  sceneEl.append(prefabEl);

  let subject = { prefabId: null, modelId: null };
  let selection = null;
  let preview = { mode: 'prefab', poseName: 'open' };
  let space = 'world';
  let framePending = true;
  let showAllHands = false;
  let seeThrough = false;
  const solidState = new WeakMap();

  // ---- furniture: a floor grid, axes, which way is forward ----
  const grid = new THREE.GridHelper(2, 20, 0x56677d, 0x2b394a);
  world.add(grid);
  for (const [axis, color] of [[0, 0xff5a5a], [1, 0x5aff7a], [2, 0x5a8cff]]) {
    const points = [new THREE.Vector3(), AXES[axis].clone().multiplyScalar(0.12)];
    world.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color })));
  }
  const forward = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0.002, -0.2), 0.5, 0x8aa0b8, 0.08, 0.05);
  world.add(forward);
  const markers = new THREE.Group();
  world.add(markers);

  // ---- markers for emitters and sockets ----
  const emitterMat = new THREE.MeshBasicMaterial({ color: 0xffa43a, depthTest: false, transparent: true, opacity: 0.9 });
  const emitterLine = new THREE.LineDashedMaterial({ color: 0xffa43a, dashSize: 0.03, gapSize: 0.02, transparent: true, opacity: 0.55 });
  const socketMat = new THREE.LineBasicMaterial({ color: 0x4fd6e8, depthTest: false });
  const coneGeometry = new THREE.ConeGeometry(0.012, 0.04, 10).rotateX(-Math.PI / 2).translate(0, 0, -0.02);
  const beamGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1.5)]);
  const socketGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.04, 0.04, 0.04));

  function placeObject(object, placement) {
    object.position.set(...placement.pos);
    object.quaternion.copy(quatOf(placement.rot));
  }

  function rebuildMarkers(entry) {
    markers.clear();
    if (!entry || preview.mode === 'free') return;
    entry.emitters.forEach((emitter, i) => {
      const group = new THREE.Group();
      const cone = new THREE.Mesh(coneGeometry, emitterMat);
      const beam = new THREE.Line(beamGeometry, emitterLine);
      beam.computeLineDistances();
      cone.renderOrder = beam.renderOrder = 998;
      group.add(cone, beam);
      placeObject(group, emitter);
      markers.add(group);
    });
    entry.attachments.forEach(socket => {
      const box = new THREE.LineSegments(socketGeometry, socketMat);
      box.renderOrder = 998;
      placeObject(box, socket);
      markers.add(box);
    });
  }

  // ---- hands ----
  const hands = new Map();

  function styleHand(entry, { color, opacity, solid }) {
    for (const material of entry.materials) {
      material.color.set(color);
      material.opacity = opacity;
      material.transparent = opacity < 1;
      material.depthWrite = solid;
    }
  }

  function wantedHands(entry) {
    const out = [];
    if (preview.mode === 'free') {
      for (const side of ['right', 'left']) out.push({ key: `free-${side}`, side, poseName: preview.poseName, placement: FREE_HANDS[side], slot: 0, strong: true });
      return out;
    }
    if (!entry) return out;
    const focused = selection?.kind === 'occupant' ? selection.i : (showAllHands ? -1 : 0);
    entry.interactions.forEach((interaction, i) => {
      if (focused !== -1 && i !== focused) return;
      interaction.occupants.forEach((occupant, j) => {
        for (const side of ['right', 'left']) {
          const placement = occupantFor(interaction, side, j);
          if (!placement) continue;
          const chosen = selection?.kind === 'occupant' && selection.i === i && selection.j === j;
          out.push({
            key: `h-${i}-${j}-${side}`, side, slot: j, placement,
            poseName: preview.mode === 'on-grip' && chosen ? preview.poseName : placement.pose,
            strong: chosen || (i === focused && selection?.kind !== 'occupant'),
            faint: placement.mirrored,
          });
        }
      });
    });
    return out;
  }

  function reconcileHands(entry) {
    const wanted = wantedHands(entry);
    const keep = new Set(wanted.map(w => w.key));
    for (const [key, hand] of hands) {
      if (keep.has(key)) continue;
      world.remove(hand.group);
      hand.poser?.dispose();
      hands.delete(key);
    }
    for (const want of wanted) {
      let hand = hands.get(want.key);
      if (!hand) {
        hand = { group: new THREE.Group(), side: want.side, materials: [], poser: null };
        hands.set(want.key, hand);
        world.add(hand.group);
        loadHand(THREE, want.side).then(loaded => {
          if (hands.get(want.key) !== hand) { loaded.poser.dispose(); return; }
          loaded.model.traverse(object => {
            if (!object.material) return;
            object.material = object.material.clone();
            hand.materials.push(object.material);
          });
          hand.poser = loaded.poser;
          hand.group.add(loaded.model);
          view.refresh();
        });
      }
      placeObject(hand.group, want.placement);
      const color = HAND_COLORS[want.slot % HAND_COLORS.length];
      const opacity = want.strong ? 0.92 : (want.faint ? 0.3 : 0.5);
      if (hand.poser) {
        const pose = store.library.poses[want.poseName] ?? store.library.poses.open ?? {};
        hand.poser.apply(pose);
        styleHand(hand, { color, opacity, solid: want.strong });
      }
    }
  }

  // The model drawn faint, so a hand inside it can be seen.
  function applyModelOpacity() {
    prefabEl.getObject3D('prefab-model')?.traverse(object => {
      const materials = object.material ? [].concat(object.material) : [];
      for (const material of materials) {
        if (!solidState.has(material)) solidState.set(material, { transparent: material.transparent, opacity: material.opacity, depthWrite: material.depthWrite });
        const solid = solidState.get(material);
        material.transparent = seeThrough || solid.transparent;
        material.opacity = seeThrough ? 0.35 : solid.opacity;
        material.depthWrite = seeThrough ? false : solid.depthWrite;
        material.needsUpdate = true;
      }
    });
  }

  // ---- camera ----
  const orbit = { target: new THREE.Vector3(0, 0.1, 0), distance: 0.8, yaw: VIEWS.threeQuarter.yaw * RAD, pitch: VIEWS.threeQuarter.pitch * RAD };
  function placeCamera() {
    const { yaw, pitch, distance, target } = orbit;
    cameraEl.object3D.position.set(
      target.x + distance * Math.sin(yaw) * Math.cos(pitch),
      target.y + distance * Math.sin(pitch),
      target.z + distance * Math.cos(yaw) * Math.cos(pitch),
    );
    // The entity is a plain group, whose lookAt would aim its +Z at the target;
    // the camera inside looks down -Z, so aim that.
    cameraEl.object3D.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(cameraEl.object3D.position, target, AXES[1]));
  }

  function fittedBounds() {
    const model = prefabEl.getObject3D('prefab-model');
    if (!model) return null;
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    return box.isEmpty() ? null : box;
  }

  // ---- the gizmo ----
  const gizmo = new THREE.Group();
  gizmo.visible = false;
  world.add(gizmo);
  const handles = [];
  const visual = color => new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.95 });
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const addHandle = (parent, geometry, material, userData, setup) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999;
    setup?.(mesh);
    if (userData) { mesh.userData = userData; handles.push(mesh); }
    parent.add(mesh);
    return mesh;
  };
  AXES.forEach((axis, a) => {
    const arrow = new THREE.Group();
    addHandle(arrow, new THREE.CylinderGeometry(0.014, 0.014, 0.8, 8), visual(AXIS_COLORS[a]), null, m => { m.position.y = 0.4; });
    addHandle(arrow, new THREE.ConeGeometry(0.05, 0.2, 14), visual(AXIS_COLORS[a]), null, m => { m.position.y = 0.9; });
    addHandle(arrow, new THREE.CylinderGeometry(0.09, 0.09, 1, 8), hitMaterial, { kind: 'translate', axis: a }, m => { m.position.y = 0.5; });
    if (a === 0) arrow.rotation.z = -Math.PI / 2;
    if (a === 2) arrow.rotation.x = Math.PI / 2;
    const turn = new THREE.Group();
    addHandle(turn, new THREE.TorusGeometry(0.62, 0.012, 8, 72), visual(AXIS_COLORS[a]), null);
    addHandle(turn, new THREE.TorusGeometry(0.62, 0.05, 6, 36), hitMaterial, { kind: 'rotate', axis: a });
    if (a === 0) turn.rotation.y = Math.PI / 2;
    if (a === 1) turn.rotation.x = Math.PI / 2;
    gizmo.add(arrow, turn);
  });
  addHandle(gizmo, new THREE.SphereGeometry(0.08, 14, 10), visual(0xe6edf3), { kind: 'free' });

  const selectedEntry = () => store.library.prefabs[subject.prefabId];
  const selectedPlacement = () => placementOf(selectedEntry(), selection);

  function syncGizmo() {
    const placement = preview.mode === 'free' ? null : selectedPlacement();
    gizmo.visible = Boolean(placement);
    if (!placement) return;
    gizmo.position.set(...placement.pos);
    gizmo.quaternion.copy(space === 'local' ? quatOf(placement.rot) : new THREE.Quaternion());
  }

  // ---- pointer ----
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag = null;

  function rayFrom(event) {
    const rect = sceneEl.canvas.getBoundingClientRect();
    ndc.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, sceneEl.camera);
    return raycaster.ray;
  }

  function pickHandle(event) {
    if (!gizmo.visible) return null;
    gizmo.updateMatrixWorld(true);
    rayFrom(event);
    return raycaster.intersectObjects(handles, false)[0]?.object.userData ?? null;
  }

  const axisVector = a => AXES[a].clone().applyQuaternion(gizmo.quaternion);

  // How far along the line (point, direction) the pick ray passes closest.
  function alongLine(ray, point, direction) {
    const w = point.clone().sub(ray.origin);
    const b = direction.dot(ray.direction);
    const d = direction.dot(w);
    const e = ray.direction.dot(w);
    const denominator = 1 - b * b;
    return Math.abs(denominator) < 1e-5 ? null : (b * e - d) / denominator;
  }

  function startGizmoDrag(handle, event) {
    const placement = selectedPlacement();
    const start = { pos: new THREE.Vector3(...placement.pos), quat: quatOf(placement.rot) };
    const ray = rayFrom(event);
    drag = { type: 'gizmo', handle, start };
    if (handle.kind === 'translate') {
      drag.axis = axisVector(handle.axis);
      drag.s0 = alongLine(ray, start.pos, drag.axis);
    } else if (handle.kind === 'free') {
      const facing = sceneEl.camera.getWorldDirection(new THREE.Vector3()).negate();
      drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(facing, start.pos);
      drag.hit0 = ray.intersectPlane(drag.plane, new THREE.Vector3());
    } else {
      // A turn is measured as an angle round the axis, from where the ray first met its plane.
      drag.axis = axisVector(handle.axis);
      drag.plane = new THREE.Plane().setFromNormalAndCoplanarPoint(drag.axis, start.pos);
      const helper = Math.abs(drag.axis.y) < 0.9 ? AXES[1] : AXES[0];
      const u = new THREE.Vector3().crossVectors(drag.axis, helper).normalize();
      const v = new THREE.Vector3().crossVectors(drag.axis, u);
      drag.angleOf = hit => {
        const offset = hit.clone().sub(start.pos);
        return Math.atan2(offset.dot(v), offset.dot(u));
      };
      const hit = ray.intersectPlane(drag.plane, new THREE.Vector3());
      drag.angle0 = hit ? drag.angleOf(hit) : 0;
    }
  }

  function moveGizmoDrag(event) {
    const { handle, start } = drag;
    const ray = rayFrom(event);
    let pos = null;
    let quat = null;
    if (handle.kind === 'translate') {
      const s = alongLine(ray, start.pos, drag.axis);
      if (s === null || drag.s0 === null) return;
      let move = s - drag.s0;
      if (event.shiftKey) move = Math.round(move / 0.005) * 0.005;
      pos = start.pos.clone().addScaledVector(drag.axis, move);
    } else if (handle.kind === 'free') {
      const hit = ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit || !drag.hit0) return;
      pos = start.pos.clone().add(hit.sub(drag.hit0));
      if (event.shiftKey) pos.set(...pos.toArray().map(n => Math.round(n / 0.005) * 0.005));
    } else {
      const hit = ray.intersectPlane(drag.plane, new THREE.Vector3());
      if (!hit) return;
      let turn = drag.angleOf(hit) - drag.angle0;
      if (event.shiftKey) turn = Math.round(turn / (15 * RAD)) * 15 * RAD;
      quat = new THREE.Quaternion().setFromAxisAngle(drag.axis, turn).multiply(start.quat);
    }
    store.update(lib => {
      const placement = placementOf(lib.prefabs[subject.prefabId], selection);
      if (!placement) return;
      if (pos) placement.pos = pos.toArray().map(n => round(n, 4));
      if (quat) placement.rot = rotOf(quat).map(n => round(n, 2));
    }, 'drag');
  }

  function onPointerDown(event) {
    sceneEl.canvas.setPointerCapture(event.pointerId);
    const handle = event.button === 0 && !event.altKey ? pickHandle(event) : null;
    if (handle) startGizmoDrag(handle, event);
    else drag = { type: event.button === 2 || event.shiftKey || event.button === 1 ? 'pan' : 'orbit' };
    drag.x = event.clientX;
    drag.y = event.clientY;
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!drag) {
      sceneEl.canvas.style.cursor = pickHandle(event) ? 'pointer' : 'grab';
      return;
    }
    if (drag.type === 'gizmo') { moveGizmoDrag(event); return; }
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.type === 'orbit') {
      orbit.yaw -= dx * 0.008;
      orbit.pitch = Math.min(1.5, Math.max(-1.5, orbit.pitch + dy * 0.008));
    } else {
      const right = AXES[0].clone().applyQuaternion(cameraEl.object3D.quaternion);
      const up = AXES[1].clone().applyQuaternion(cameraEl.object3D.quaternion);
      orbit.target.addScaledVector(right, -dx * orbit.distance * 0.0016).addScaledVector(up, dy * orbit.distance * 0.0016);
    }
    placeCamera();
  }

  function onPointerUp(event) {
    if (drag?.type === 'gizmo') view.onDragEnd?.();
    drag = null;
    sceneEl.canvas.releasePointerCapture?.(event.pointerId);
  }

  function onWheel(event) {
    orbit.distance = Math.min(8, Math.max(0.08, orbit.distance * Math.exp(event.deltaY * 0.0012)));
    placeCamera();
    event.preventDefault();
  }

  function listen() {
    const target = sceneEl.canvas;
    target.addEventListener('pointerdown', onPointerDown);
    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
    target.addEventListener('pointercancel', onPointerUp);
    target.addEventListener('wheel', onWheel, { passive: false });
    target.addEventListener('contextmenu', event => event.preventDefault());
    target.style.touchAction = 'none';
  }

  // Keep the gizmo one size on screen, whatever the zoom.
  AFRAME.registerComponent('workshop-tick', {
    tick() {
      if (!gizmo.visible) return;
      gizmo.scale.setScalar(Math.max(0.01, cameraEl.object3D.position.distanceTo(gizmo.position) * 0.16));
    },
  });
  cameraEl.setAttribute('workshop-tick', '');

  prefabEl.addEventListener('prefab-ready', () => {
    if (framePending) { framePending = false; view.frame(); }
    view.refresh();
  });

  const view = {
    prefabEl,
    get gizmoVisible() { return gizmo.visible; },

    start() {
      listen();
      placeCamera();
      if (prefabEl.hasLoaded) this.refresh();
      else prefabEl.addEventListener('loaded', () => this.refresh(), { once: true });
    },

    // Show a prefab, or a bare model that has none yet.
    setSubject(next) {
      subject = next;
      framePending = true;
      this.refresh();
    },
    setSelection(next) { selection = next; this.refresh(); },
    setPreview(next) {
      const modeChanged = next.mode !== preview.mode;
      preview = { ...preview, ...next };
      if (modeChanged) this.frame();
      this.refresh();
    },
    setSpace(next) { space = next; this.refresh(); },
    setShowAllHands(next) { showAllHands = next; this.refresh(); },
    setSeeThrough(next) { seeThrough = next; applyModelOpacity(); },

    // Zoom in on whatever is selected.
    focusSelection() {
      const placement = selectedPlacement();
      if (!placement) { this.frame(); return; }
      orbit.target.set(...placement.pos);
      orbit.distance = 0.55;
      placeCamera();
    },
    get space() { return space; },
    get preview() { return preview; },

    refresh() {
      const entry = subject.prefabId ? selectedEntry() : null;
      const definition = entry ?? (subject.modelId ? { name: subject.modelId, model: subject.modelId } : null);
      const component = prefabEl.components.prefab;
      if (component && definition) component.setDefinition(definition);
      prefabEl.object3D.visible = preview.mode !== 'free';
      applyModelOpacity();
      rebuildMarkers(entry);
      reconcileHands(entry);
      syncGizmo();
    },

    frame() {
      if (preview.mode === 'free') {
        orbit.target.set(0, 0, -0.05);
        orbit.distance = 0.75;
      } else {
        const box = fittedBounds();
        if (box) {
          box.getCenter(orbit.target);
          orbit.distance = Math.max(0.35, box.getSize(new THREE.Vector3()).length() * 1.4);
        } else { orbit.target.set(0, 0.1, 0); orbit.distance = 0.8; }
      }
      placeCamera();
    },

    setView(name) {
      const v = VIEWS[name];
      orbit.yaw = v.yaw * RAD;
      orbit.pitch = v.pitch * RAD;
      placeCamera();
    },

    // The model's size and place in the prefab frame, with its fit applied.
    fittedBounds,

    // Where a gizmo handle is on screen (page pixels), `t` of the way out along it,
    // so a test can grab it with a real mouse. Null while nothing is selected.
    handleScreenPoint(kind, axis = 0, t = 0.7) {
      if (!gizmo.visible) return null;
      gizmo.updateMatrixWorld(true);
      const local = new THREE.Vector3();
      if (kind === 'translate') local.copy(AXES[axis]).multiplyScalar(t);
      else if (kind === 'rotate') local.copy(AXES[(axis + 1) % 3]).add(AXES[(axis + 2) % 3]).normalize().multiplyScalar(0.62); // between the two arrows in its plane
      const point = local.applyMatrix4(gizmo.matrixWorld).project(sceneEl.camera);
      const rect = sceneEl.canvas.getBoundingClientRect();
      return { x: rect.left + (point.x + 1) / 2 * rect.width, y: rect.top + (1 - point.y) / 2 * rect.height };
    },

    // A baked clip of the hand model, as pose data (the free right hand has it loaded).
    async measureClip(name) {
      const hand = [...hands.values()].find(h => h.poser);
      if (!hand) throw new Error('The hand model has not loaded yet');
      return hand.poser.measureClip(name);
    },
    get clipNames() { return [...hands.values()].find(h => h.poser)?.poser.clipNames ?? []; },
  };
  return view;
}
