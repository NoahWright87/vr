import { extractHand, FINGERS, JOINTS } from '../../common/hand-gestures.js';
import { HandPersistence } from '../../common/hand-persistence.js';
const THREE = AFRAME.THREE;
const LINKS = JOINTS.flatMap((name, i) => {
  if (name === 'wrist') return [];
  return [[name, name.endsWith('metacarpal') ? 'wrist' : JOINTS[i - 1]]];
});

// The desktop adapter produces joints, not spell commands. It therefore uses
// the same feature extraction, arbitration, thumb edges and hit path as XR.
export function previewJoints(mode, side, hammerDown, aperture = .16, poseKind = null) {
  const joints = { wrist: new THREE.Vector3(0, -.085, 0) };
  const mirror = side === 'left' ? -1 : 1;
  const xs = [-.030, -.010, .010, .030];
  FINGERS.forEach((finger, i) => {
    const x = xs[i] * mirror, curled = poseKind === 'fist' || mode === 'boulder' || (!['shield', 'fireball', 'portal'].includes(mode) && (finger !== 'index' || mode === 'farsight'));
    const points = poseKind === 'open' ? [[0, 0], [.033, 0], [.061, 0], [.084, 0]] :
      poseKind === 'cup' ? [[0, 0], [.032, 0], [.046, .026], [.034, .045]] :
      curled ? [[0, 0], [.026, 0], [.014, .024], [-.013, .017]] : [[0, 0], [.033, 0], [.061, 0], [.084, 0]];
    joints[`${finger}-finger-metacarpal`] = new THREE.Vector3(x * .6, -.045, 0);
    ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].forEach((name, n) => {
      joints[`${finger}-finger-${name}`] = new THREE.Vector3(x, points[n][0], points[n][1]);
    });
  });
  const thumbEnd = hammerDown ? new THREE.Vector3(-.021 * mirror, -.014, .005) : new THREE.Vector3(-.098 * mirror, .040, 0);
  const thumbBase = new THREE.Vector3(-.04 * mirror, -.050, 0);
  ['metacarpal', 'phalanx-proximal', 'phalanx-distal', 'tip'].forEach((name, i) => {
    joints[`thumb-${name}`] = thumbBase.clone().lerp(thumbEnd, i / 3);
  });
  joints['thumb-phalanx-distal'].set(-.070 * mirror, .030, 0);
  joints['thumb-tip'].copy(joints['thumb-phalanx-distal']).add(new THREE.Vector3(hammerDown ? 0 : -.035 * mirror, hammerDown ? .035 : 0, 0));
  if (poseKind === 'pinch') {
    joints['thumb-tip'].copy(joints['index-finger-tip']).add(new THREE.Vector3(-.008 * mirror, 0, 0));
    joints['thumb-phalanx-distal'].copy(joints['thumb-tip']).add(new THREE.Vector3(-.025 * mirror, -.008, 0));
  }
  if (mode === 'farsight') {
    // Fingertips meet above and the wrists/hand heels meet below; no thumb seam.
    const center = new THREE.Vector3(side === 'left' ? .07 : -.07, .01, 0);
    joints['index-finger-tip'].copy(center).y += aperture / 2;
    joints['index-finger-phalanx-intermediate'].set(center.x * .35, aperture * .42, 0);
    joints['index-finger-phalanx-distal'].set(center.x * .70, aperture * .52, 0);
    joints['thumb-tip'].copy(center).y -= aperture / 2;
    joints['thumb-phalanx-distal'].copy(joints['thumb-tip']).multiplyScalar(.8);
    joints.wrist.x = side === 'left' ? .05 : -.05;
  }
  return joints;
}

export class HandInput {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.persistence = new HandPersistence();
    this.mode = 'lightning'; this.hammerDown = { left: false, right: false };
    this.faceDistance = .40; this.shieldDistance = .65; this.shieldHands = 2;
    this.aimHistory = {}; this.lastSample = null;
    this.resetActions();
    this.visuals = {}; this.root = new THREE.Group(); scene.object3D.add(this.root);
    for (const side of ['left', 'right']) {
      const material = new THREE.MeshBasicMaterial({ color: side === 'left' ? '#8dd7da' : '#bbcaed' });
      const spheres = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 4), material, JOINTS.length);
      spheres.frustumCulled = false;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINKS.length * 6), 3));
      const bones = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#a4c9e4', transparent: true, opacity: .65 }));
      bones.frustumCulled = false;
      const group = new THREE.Group(); group.add(spheres, bones); this.root.add(group);
      this.visuals[side] = { group, spheres, bones };
    }
    this.matrix = new THREE.Matrix4(); this.scale = new THREE.Vector3(); this.q = new THREE.Quaternion();
  }
  resetActions() {
    this.cycles = { left: { down: false, start: null, released: null }, right: { down: false, start: null, released: null } };
    this.pull = false; this.pullAt = null; this.pushAt = null;
    this.portalPullOrigin = null; this.portalPullAt = null;
    this.persistence?.reset();
  }
  desktopPose(side, time) {
    const cycle = this.cycles[side], down = this.mode === 'portal' ? this.hammerDown.left || this.hammerDown.right : this.hammerDown[side];
    if (down && !cycle.down) { cycle.start = time; cycle.released = null; this.pull = false; this.pullAt = null; }
    if (!down && cycle.down) cycle.released = time;
    cycle.down = down;
    const age = cycle.start === null ? 0 : Math.max(0, time - cycle.start);
    const release = cycle.released === null ? null : Math.max(0, time - cycle.released);
    const data = { kind: null, y: -.18, depth: .45, normal: null };
    if (this.mode === 'boulder') {
      data.kind = 'fist'; data.depth = .30 + .50 * (down ? Math.min(1, age / 260) : release === null ? 0 : Math.max(0, 1 - release / 250));
    }
    if (this.mode === 'fireball') {
      data.kind = 'cup'; data.y = -.43 + (down ? .15 * Math.min(1, age / 350) : 0); data.depth = .38; data.normal = new THREE.Vector3(0, 1, 0);
      if (release !== null && release < 280) {
        data.depth += .50 * Math.min(1, release / 200); data.y = -.28; data.kind = release > 65 ? 'open' : 'cup';
        data.normal = new THREE.Vector3(0, 0, -1);
      } else if (!down && release !== null) { data.kind = 'open'; data.normal.set(0, -1, 0); data.depth = .32; }
    }
    if (this.mode === 'telekinesis') {
      data.kind = down ? 'pinch' : release === null ? null : 'open'; data.y = -.36;
      if (this.pull && down) {
        this.pullAt ??= time;
        const pulled = Math.min(1, (time - this.pullAt) / 300); data.depth -= .26 * pulled;
        if (pulled > .65) data.kind = 'open';
      }
      if (this.pushAt !== null && time - this.pushAt < 280) {
        data.depth = .25 + .60 * Math.min(1, (time - this.pushAt) / 220); data.kind = 'open'; data.normal = new THREE.Vector3(0, 0, -1);
      }
    }
    if (this.mode === 'portal') {
      const opening = down ? Math.min(1, age / 350) : 0, sign = side === 'left' ? -1 : 1;
      data.kind = 'open'; data.y = -.30; data.depth = .32 + opening * .19; data.x = sign * opening * .23;
      data.normal = new THREE.Vector3(sign * (1 - opening), 0, -opening).normalize();
      if (this.portalPullOrigin && side === 'right') data.kind = 'fist';
    }
    return data;
  }
  draw(side, joints, radii = {}) {
    const { group, spheres, bones } = this.visuals[side]; group.visible = !!joints;
    if (!joints) return;
    JOINTS.forEach((name, i) => {
      this.scale.setScalar(Math.max(.003, radii[name] || .006));
      this.matrix.compose(joints[name], this.q.identity(), this.scale); spheres.setMatrixAt(i, this.matrix);
    });
    spheres.instanceMatrix.needsUpdate = true;
    const a = bones.geometry.attributes.position;
    LINKS.forEach(([from, to], i) => { a.setXYZ(i * 2, joints[from].x, joints[from].y, joints[from].z); a.setXYZ(i * 2 + 1, joints[to].x, joints[to].y, joints[to].z); });
    a.needsUpdate = true;
  }
  sample(head, time) {
    const gap = this.lastSample === null ? Infinity : time - this.lastSample;
    if (gap > 180 || gap < 0) this.aimHistory = {};
    this.lastSample = time;
    const xr = this.scene.renderer.xr, session = xr.getSession();
    let hands = { left: null, right: null };
    if (session) {
      const frame = xr.getFrame(), space = xr.getReferenceSpace();
      if (session.visibilityState === 'visible' && frame && space) {
        for (const source of session.inputSources) {
          const side = source.handedness;
          if (!source.hand || !(side in hands)) continue;
          const joints = {}, radii = {}; let wrist;
          for (const name of JOINTS) {
            const pose = frame.getJointPose(source.hand.get(name), space);
            if (!pose) break;
            joints[name] = new THREE.Vector3().copy(pose.transform.position).applyMatrix4(this.scene.querySelector('#magic-rig').object3D.matrixWorld); radii[name] = pose.radius;
            if (name === 'wrist') wrist = pose.transform.orientation;
          }
          if (!wrist) continue;
          // WebXR defines -Y as the outward palm normal for wrist joints.
          const normal = new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(wrist.x, wrist.y, wrist.z, wrist.w));
          normal.transformDirection(this.scene.querySelector('#magic-rig').object3D.matrixWorld);
          hands[side] = extractHand(joints, normal);
          if (hands[side]) hands[side].radii = radii;
        }
      }
    } else {
      for (const side of ['left', 'right']) {
        if (this.mode === 'shield' && this.shieldHands === 1 && side === 'left') continue;
        const action = this.desktopPose(side, time);
        const joints = previewJoints(this.mode, side, this.hammerDown[side], .20, action.kind);
        const depth = this.mode === 'farsight' ? this.faceDistance : this.mode === 'shield' ? this.shieldDistance : action.depth;
        const handX = this.mode === 'farsight' ? .075 : this.mode === 'boulder' ? .4 : this.mode === 'portal' ? .065 : .18;
        const offset = new THREE.Vector3((side === 'left' ? -handX : handX) + (action.x || 0), this.mode === 'farsight' ? -.003 : action.y, -depth);
        const pose = head.quaternion.clone();
        if (['lightning', 'telekinesis'].includes(this.mode)) pose.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
        const origin = offset.applyQuaternion(head.quaternion).add(head.position);
        for (const name of JOINTS) joints[name].applyQuaternion(pose).add(origin);
        const normal = this.mode === 'shield' ? new THREE.Vector3().copy(head.forward) : (action.normal || new THREE.Vector3(0, 0, 1)).applyQuaternion(head.quaternion);
        hands[side] = extractHand(joints, normal);
        if (this.mode === 'portal' && side === 'right' && this.portalPullOrigin && hands[side]) {
          const pull = Math.min(1, (time - this.portalPullAt) / 1000) * .38;
          const desired = this.portalPullOrigin.clone().addScaledVector(head.forward, -pull);
          const delta = desired.sub(hands[side].palm);
          Object.values(joints).forEach(p => p.add(delta)); hands[side] = extractHand(joints, normal);
        }
      }
    }
    if (session && session.visibilityState !== 'visible') this.persistence.reset();
    hands = this.persistence.update(hands, time);
    for (const side of ['left', 'right']) {
      const hand = hands[side];
      if (hand) {
        hand.side = side;
        const aim = new THREE.Vector3(hand.aim.x, hand.aim.y, hand.aim.z);
        if (this.aimHistory[side] && !hand.reacquired) aim.copy(this.aimHistory[side]).lerp(hand.aim, 1 - Math.exp(-gap / 70)).normalize();
        this.aimHistory[side] = aim; hand.aim = aim;
      } else delete this.aimHistory[side];
      this.draw(side, hand?.joints, hand?.radii);
      this.visuals[side].group.visible = !!hand && hand.tracked !== false;
    }
    return hands;
  }
  dispose() {
    this.scene.object3D.remove(this.root);
    this.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
