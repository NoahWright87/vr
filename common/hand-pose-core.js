// ============================================================
// HAND POSE CORE — what a hand looks like around something, as data.
// Pure; tested by tests/hand-pose-core.test.js. Turning a pose into
// bone rotations on the hand model is common/hand-pose.js.
//
// A pose is a name and, for each of the five fingers, how far each of
// its three joints is curled, plus a little sideways fan and twist
// where the shape needs it (a pinch's thumb does):
//
//   "pistol-grip": { "fingers": {
//     "thumb":  [0.5, 0.6, 0.4],
//     "index":  0.35,                                  // all three joints
//     "middle": [{ "curl": 0.9, "spread": -4 }, 1, 0.9],
//     "ring": 1, "pinky": 1 } }
//
//   curl    0 is the hand model's own open hand, 1 its own fist. Past
//           either end is allowed (-0.5 .. 1.5), for a flatter palm or
//           a tighter squeeze.
//   spread  degrees, sideways at the joint. Positive fans the finger
//           away from the middle one; for the thumb, away from the palm.
//   twist   degrees, about the bone's own length.
//
// Missing is open: a pose that names no fingers is the open hand. The
// same pose serves both hands (the left model is the right's mirror).
// ============================================================

export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
export const JOINTS = 3;
export const DOFS = ['curl', 'spread', 'twist'];
export const LIMITS = { curl: [-0.5, 1.5], spread: [-60, 60], twist: [-90, 90] };
// The hand model's bones are T, F1..F4, each with joints a (knuckle), b, c.
const BONE_PREFIX = { thumb: 'T', index: 'F1', middle: 'F2', ring: 'F3', pinky: 'F4' };

export function boneName(finger, joint) { return BONE_PREFIX[finger] + 'abc'[joint]; }

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));

function normalizeJoint(value) {
  if (typeof value === 'number') return { curl: value, spread: 0, twist: 0 };
  const v = value && typeof value === 'object' ? value : {};
  return { curl: v.curl ?? 0, spread: v.spread ?? 0, twist: v.twist ?? 0 };
}

function normalizeFinger(value) {
  if (Array.isArray(value)) return Array.from({ length: JOINTS }, (_, i) => normalizeJoint(value[i]));
  return Array.from({ length: JOINTS }, () => normalizeJoint(value));
}

// Every finger, every joint, every degree of freedom, written out.
export function normalizePose(pose) {
  const p = pose && typeof pose === 'object' ? pose : {};
  const fingers = {};
  for (const finger of FINGERS) fingers[finger] = normalizeFinger(p.fingers?.[finger]);
  const out = { fingers };
  if (p.label) out.label = String(p.label);
  return out;
}

const isRest = joint => !joint.curl && !joint.spread && !joint.twist;
const jointJson = joint => {
  if (!joint.spread && !joint.twist) return round(joint.curl, 3);
  const out = {};
  for (const dof of DOFS) if (joint[dof]) out[dof] = round(joint[dof], dof === 'curl' ? 3 : 1);
  return out;
};

// The shortest JSON for a pose: a number where a finger is uniform and
// has no spread or twist, an array of joints otherwise, nothing at all
// where a finger is open. Always in the same key order, so equal poses
// serialize equally.
export function compactPose(pose) {
  const n = normalizePose(pose);
  const fingers = {};
  for (const finger of FINGERS) {
    const joints = n.fingers[finger].map(j => ({
      curl: round(j.curl, 3), spread: round(j.spread, 1), twist: round(j.twist, 1),
    }));
    if (joints.every(isRest)) continue;
    const plain = joints.every(j => !j.spread && !j.twist);
    fingers[finger] = plain && joints.every(j => j.curl === joints[0].curl)
      ? joints[0].curl : joints.map(jointJson);
  }
  const out = {};
  if (n.label) out.label = n.label;
  out.fingers = fingers;
  return out;
}

export function poseEquals(a, b) {
  return JSON.stringify(compactPose(a)) === JSON.stringify(compactPose(b));
}

// Complaints about a pose, as plain sentences; an empty list is a valid pose.
export function validatePose(pose) {
  const errors = [];
  if (!pose || typeof pose !== 'object' || Array.isArray(pose)) return ['pose must be an object'];
  for (const key of Object.keys(pose)) {
    if (key !== 'fingers' && key !== 'label') errors.push(`unknown key "${key}"`);
  }
  const fingers = pose.fingers ?? {};
  for (const finger of Object.keys(fingers)) {
    if (!FINGERS.includes(finger)) { errors.push(`unknown finger "${finger}"`); continue; }
    const value = fingers[finger];
    const joints = Array.isArray(value) ? value : [value];
    if (Array.isArray(value) && value.length !== JOINTS) errors.push(`${finger}: needs ${JOINTS} joints, has ${value.length}`);
    joints.forEach((joint, i) => {
      const at = Array.isArray(value) ? `${finger}[${i}]` : finger;
      if (typeof joint === 'number') { check(errors, at, 'curl', joint); return; }
      if (!joint || typeof joint !== 'object') { errors.push(`${at}: must be a number or an object`); return; }
      for (const key of Object.keys(joint)) {
        if (!DOFS.includes(key)) errors.push(`${at}: unknown key "${key}"`);
        else check(errors, at, key, joint[key]);
      }
    });
  }
  return errors;
}

function check(errors, at, dof, value) {
  const [lo, hi] = LIMITS[dof];
  if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${at}.${dof}: must be a number`);
  else if (value < lo || value > hi) errors.push(`${at}.${dof}: ${value} is outside ${lo}..${hi}`);
}

// Move one degree of freedom of one joint, clamped to its limits.
export function setJoint(pose, finger, joint, dof, value) {
  const n = normalizePose(pose);
  n.fingers[finger][joint][dof] = clamp(value, LIMITS[dof]);
  return n;
}

// The macro control: every joint of a finger to the same curl.
export function setFingerCurl(pose, finger, curl) {
  const n = normalizePose(pose);
  for (const joint of n.fingers[finger]) joint.curl = clamp(curl, LIMITS.curl);
  return n;
}

// The mean curl of a finger, to show on its macro slider.
export function fingerCurl(pose, finger) {
  const joints = normalizePose(pose).fingers[finger];
  return joints.reduce((sum, j) => sum + j.curl, 0) / JOINTS;
}

// A pose part-way from `a` to `b`, for a trigger finger that closes as it is pulled.
export function blendPoses(a, b, t) {
  const pa = normalizePose(a);
  const pb = normalizePose(b);
  const fingers = {};
  for (const finger of FINGERS) {
    fingers[finger] = pa.fingers[finger].map((ja, i) => {
      const jb = pb.fingers[finger][i];
      const joint = {};
      for (const dof of DOFS) joint[dof] = ja[dof] + (jb[dof] - ja[dof]) * t;
      return joint;
    });
  }
  return { fingers };
}
