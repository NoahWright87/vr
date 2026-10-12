import { extractHand, FINGERS, JOINTS } from '../../common/hand-gestures.js';
const THREE = AFRAME.THREE;
const LINKS = JOINTS.flatMap((name, i) => {
  if (name === 'wrist') return [];
  return [[name, name.endsWith('metacarpal') ? 'wrist' : JOINTS[i - 1]]];
});

// The desktop adapter produces joints, not spell commands. It therefore uses
// the same feature extraction, arbitration, thumb edges and hit path as XR.
export function previewJoints(mode, side, hammerDown, aperture = .16) {
  const joints = { wrist: new THREE.Vector3(0, -.085, 0) };
  const mirror = side === 'left' ? -1 : 1;
  const xs = [-.030, -.010, .010, .030];
  FINGERS.forEach((finger, i) => {
    const x = xs[i] * mirror, curled = mode !== 'shield' && (finger !== 'index' || mode === 'farsight');
    const points = curled ? [[0, 0], [.026, 0], [.014, .024], [-.013, .017]] : [[0, 0], [.033, 0], [.061, 0], [.084, 0]];
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
  if (mode === 'farsight') {
    // Each hand supplies one semicircle, meeting at index and thumb seams.
    const center = new THREE.Vector3(side === 'left' ? .07 : -.07, .01, 0);
    joints['index-finger-tip'].copy(center).y += aperture / 2;
    joints['index-finger-phalanx-intermediate'].set(center.x * .35, aperture * .42, 0);
    joints['index-finger-phalanx-distal'].set(center.x * .70, aperture * .52, 0);
    joints['thumb-tip'].copy(center).y -= aperture / 2;
    joints['thumb-phalanx-distal'].copy(joints['thumb-tip']).multiplyScalar(.8);
  }
  return joints;
}

export class HandInput {
  constructor(scene, camera) {
    this.scene = scene; this.camera = camera;
    this.mode = 'lightning'; this.hammerDown = false; this.aperture = .16; this.shieldHands = 2;
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
  sample(head) {
    const xr = this.scene.renderer.xr, session = xr.getSession();
    const hands = { left: null, right: null };
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
            joints[name] = pose.transform.position; radii[name] = pose.radius;
            if (name === 'wrist') wrist = pose.transform.orientation;
          }
          if (!wrist) continue;
          // WebXR defines -Y as the outward palm normal for wrist joints.
          const normal = new THREE.Vector3(0, -1, 0).applyQuaternion(new THREE.Quaternion(wrist.x, wrist.y, wrist.z, wrist.w));
          hands[side] = extractHand(joints, normal);
          if (hands[side]) hands[side].radii = radii;
        }
      }
    } else {
      for (const side of ['left', 'right']) {
        if ((this.mode === 'lightning' && side === 'left') || (this.mode === 'shield' && this.shieldHands === 1 && side === 'left')) continue;
        const joints = previewJoints(this.mode, side, this.hammerDown, this.aperture);
        const offset = new THREE.Vector3(this.mode === 'farsight' ? (side === 'left' ? -.075 : .075) : (side === 'left' ? -.18 : .18), this.mode === 'farsight' ? -.01 : -.18, -.45);
        const pose = head.quaternion.clone();
        if (this.mode === 'lightning') pose.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
        const origin = offset.applyQuaternion(head.quaternion).add(head.position);
        for (const name of JOINTS) joints[name].applyQuaternion(pose).add(origin);
        const normal = this.mode === 'shield' ? new THREE.Vector3().copy(head.forward) : new THREE.Vector3(0, 0, 1).applyQuaternion(head.quaternion);
        hands[side] = extractHand(joints, normal);
      }
    }
    for (const side of ['left', 'right']) this.draw(side, hands[side]?.joints, hands[side]?.radii);
    return hands;
  }
  dispose() {
    this.scene.object3D.remove(this.root);
    this.root.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}
