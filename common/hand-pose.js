// ============================================================
// HAND POSE — putting a pose (common/hand-pose-core.js) on the hand
// model by turning its finger bones directly.
//
//   const hand = await loadHand(AFRAME.THREE, 'right');   // { model, poser }
//   scene.add(hand.model);
//   hand.poser.apply({ fingers: { index: 0.4, thumb: [0.5, 0.6, 0.4] } });
//   hand.poser.measureClip('Hold');                       // a baked clip, as pose data
//
// The hand model came with seven baked poses (Open, Fist, Hold, Grip,
// Point, Thumb Up, Point + Thumb). Rather than choose between them, a
// curl is how far along the way from the model's own Open to its own
// Fist a joint is, so the model's idea of how a finger bends is kept and
// the pose is just numbers. Spread and twist turn the joint about the
// two other axes. Applying a pose sets every finger bone, so it replaces
// whatever a baked clip left there: don't run a clip's mixer on the same
// model at the same time.
//
// The left model is the right one's mirror. Its bones share the right's
// local axes, so one pose, written once, makes the mirrored fist on
// either hand.
// ============================================================

import { FINGERS, JOINTS, LIMITS, boneName, normalizePose } from './hand-pose-core.js';

export const HAND_MODEL_URLS = {
  left: new URL('../vendor/aframe-1.6.0/controllers/hands/leftHandLow.glb', import.meta.url).href,
  right: new URL('../vendor/aframe-1.6.0/controllers/hands/rightHandLow.glb', import.meta.url).href,
};

const RAD = Math.PI / 180;

export function createHandPoser(THREE, model) {
  const mixer = new THREE.AnimationMixer(model);
  const clips = new Map((model.animations || []).map(clip => [clip.name, clip]));
  const temp = new THREE.Quaternion();
  const turn = new THREE.Vector3();
  const joints = {};

  // Every finger bone's rotation with a baked clip played to its end.
  function snapshot(clipName) {
    const clip = clips.get(clipName);
    if (!clip) throw new Error(`The hand model has no "${clipName}" clip`);
    const action = mixer.clipAction(clip);
    action.reset();
    action.play();
    action.time = clip.duration;
    action.paused = true;
    mixer.update(0);
    const rotations = {};
    for (const finger of FINGERS) {
      for (let j = 0; j < JOINTS; j++) {
        const name = boneName(finger, j);
        rotations[name] = model.getObjectByName(name).quaternion.clone();
      }
    }
    action.stop();
    mixer.uncacheAction(clip);
    return rotations;
  }

  const open = snapshot('Open');
  const fist = snapshot('Fist');

  for (const finger of FINGERS) {
    joints[finger] = [];
    let directionInParent = null;
    for (let j = 0; j < JOINTS; j++) {
      const name = boneName(finger, j);
      const bone = model.getObjectByName(name);
      // Fist = Open then a turn about the bone's own axis: that turn is a full curl.
      const delta = open[name].clone().invert().multiply(fist[name]);
      if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
      const curlAngle = 2 * Math.acos(Math.min(1, delta.w));
      const curlAxis = new THREE.Vector3(delta.x, delta.y, delta.z);
      if (curlAxis.lengthSq() > 1e-12) curlAxis.normalize(); else curlAxis.set(1, 0, 0);
      // The bone's length, in its own frame: toward its child bone; the last
      // joint has none, so it carries on in the direction the one before it pointed.
      let direction;
      if (j < JOINTS - 1) direction = model.getObjectByName(boneName(finger, j + 1)).position.clone().normalize();
      else direction = directionInParent.clone().applyQuaternion(open[name].clone().invert());
      if (j < JOINTS - 1) directionInParent = direction.clone();
      // Curl, spread and twist are turns about three perpendicular axes, so a
      // pure curl has no spread or twist in it: spread is across the bend,
      // twist is along the bone as near as the curl axis allows.
      const spreadAxis = new THREE.Vector3().crossVectors(curlAxis, direction);
      if (spreadAxis.lengthSq() > 1e-12) spreadAxis.normalize(); else spreadAxis.set(0, 1, 0);
      const twistAxis = new THREE.Vector3().crossVectors(curlAxis, spreadAxis).normalize();
      if (twistAxis.dot(direction) < 0) twistAxis.negate();
      joints[finger].push({ bone, open: open[name], curlAxis, curlAngle, spreadAxis, twistAxis, spreadSign: 1 });
    }
  }

  // Positive spread should fan a finger away from the middle one (the thumb
  // away from the palm, to the thumb's side), whichever way the bone's own
  // axes happen to point: try it, see which way the fingertip went.
  model.updateMatrixWorld(true);
  const lateral = bone => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(new THREE.Matrix4().copy(model.matrixWorld).invert()).x;
  const thumbSide = Math.sign(lateral(model.getObjectByName('F1a')) - lateral(model.getObjectByName('F4a'))) || 1;
  const outward = { thumb: 1, index: 1, middle: 1, ring: -1, pinky: -1 };
  for (const finger of FINGERS) {
    const knuckle = joints[finger][0];
    const tip = joints[finger][JOINTS - 1].bone;
    const before = lateral(tip);
    knuckle.bone.quaternion.copy(knuckle.open).multiply(temp.setFromAxisAngle(knuckle.spreadAxis, 10 * RAD));
    model.updateMatrixWorld(true);
    const moved = lateral(tip) - before;
    for (const joint of joints[finger]) joint.spreadSign = moved * outward[finger] * thumbSide >= 0 ? 1 : -1;
    knuckle.bone.quaternion.copy(knuckle.open);
  }

  const poser = {
    model,
    clipNames: [...clips.keys()],

    apply(pose) {
      const n = normalizePose(pose);
      for (const finger of FINGERS) {
        for (let j = 0; j < JOINTS; j++) {
          const { curl, spread, twist } = n.fingers[finger][j];
          const info = joints[finger][j];
          // One turn, about the sum of the three: what measureClip takes apart.
          turn.set(0, 0, 0)
            .addScaledVector(info.curlAxis, info.curlAngle * curl)
            .addScaledVector(info.spreadAxis, info.spreadSign * spread * RAD)
            .addScaledVector(info.twistAxis, twist * RAD);
          const angle = turn.length();
          info.bone.quaternion.copy(info.open);
          if (angle > 1e-9) info.bone.quaternion.multiply(temp.setFromAxisAngle(turn.divideScalar(angle), angle));
        }
      }
    },

    // A baked clip's final pose as pose data, to start a new pose from.
    measureClip(clipName) {
      const rotations = snapshot(clipName);
      const fingers = {};
      for (const finger of FINGERS) {
        fingers[finger] = joints[finger].map((info, j) => {
          const delta = info.open.clone().invert().multiply(rotations[boneName(finger, j)]);
          if (delta.w < 0) delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
          const angle = 2 * Math.acos(Math.min(1, delta.w));
          const rotation = new THREE.Vector3(delta.x, delta.y, delta.z);
          if (rotation.lengthSq() > 1e-12) rotation.normalize().multiplyScalar(angle);
          const clamp = (value, dof) => Math.min(LIMITS[dof][1], Math.max(LIMITS[dof][0], value));
          return {
            curl: info.curlAngle > 1e-6 ? clamp(rotation.dot(info.curlAxis) / info.curlAngle, 'curl') : 0,
            spread: clamp(rotation.dot(info.spreadAxis) / RAD * info.spreadSign, 'spread'),
            twist: clamp(rotation.dot(info.twistAxis) / RAD, 'twist'),
          };
        });
      }
      return { fingers };
    },

    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model);
    },
  };
  poser.apply({});
  return poser;
}

// A hand model, loaded and ready to pose. `side` is 'left' or 'right'.
export async function loadHand(THREE, side) {
  const gltf = await new THREE.GLTFLoader().loadAsync(HAND_MODEL_URLS[side]);
  const model = gltf.scene;
  model.animations = gltf.animations;
  return { model, poser: createHandPoser(THREE, model), side };
}
