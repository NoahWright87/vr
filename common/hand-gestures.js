// Input-independent gesture features and temporal arbitration. All positions
// share world metres; finger extension is relative to hand size.
export const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = a => Math.hypot(a.x, a.y, a.z);
export const unit = a => { const n = length(a) || 1; return { x: a.x / n, y: a.y / n, z: a.z / n }; };
export const distance = (a, b) => length(sub(a, b));
export const midpoint = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const ramp = (value, lo, hi) => clamp((value - lo) / (hi - lo));
const finite = p => p && [p.x, p.y, p.z].every(Number.isFinite);
export const FINGERS = ['index', 'middle', 'ring', 'pinky'];
export const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...FINGERS.flatMap(f => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(j => `${f}-finger-${j}`))];

export function extractHand(joints, palmNormal) {
  if (!finite(palmNormal) || JOINTS.some(name => !finite(joints?.[name]))) return null;
  const size = distance(joints['index-finger-phalanx-proximal'], joints['pinky-finger-phalanx-proximal']);
  if (size < .025 || size > .14 || distance(joints['thumb-tip'], joints['thumb-phalanx-distal']) < .005) return null;
  const extension = {};
  for (const finger of FINGERS) {
    const chain = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(j => joints[`${finger}-finger-${j}`]);
    const arc = chain.slice(1).reduce((sum, p, i) => sum + distance(p, chain[i]), 0);
    if (arc < .015) return null;
    extension[finger] = clamp(distance(chain[0], chain[3]) / arc);
  }
  return { joints, extension, size, pinch: distance(joints['thumb-tip'], joints['index-finger-tip']) / size,
    palm: midpoint(joints.wrist, joints['middle-finger-phalanx-proximal']),
    normal: unit(palmNormal), tip: joints['index-finger-tip'],
    // A longer baseline is less sensitive to a noisy final index joint.
    aim: unit(sub(joints['index-finger-tip'], joints['index-finger-phalanx-proximal'])),
    thumbAlignment: Math.abs(dot(unit(sub(joints['thumb-tip'], joints['thumb-phalanx-distal'])),
      unit(sub(joints['index-finger-tip'], joints['index-finger-phalanx-proximal'])))) };
}

function inFront(hand, head) {
  return dot(sub(hand.palm, head.position), head.forward) > .10;
}
export function fingerGunScore(hand, head) {
  if (!hand || !inFront(hand, head)) return 0;
  const e = hand.extension;
  return Math.min(ramp(e.index, .68, .86), ...['middle', 'ring', 'pinky'].map(f => 1 - ramp(e[f], .52, .78)));
}
export function shieldReach(hand, head) {
  // WebXR tracks hands and head, not elbows/shoulders. Estimate the shoulder
  // from horizontal head heading; the default shoulder-to-palm reach is 65 cm.
  const forward = unit({ x: head.forward.x, y: 0, z: head.forward.z });
  const right = { x: -forward.z, y: 0, z: forward.x };
  const side = hand.side === 'left' ? -1 : hand.side === 'right' ? 1 : Math.sign(dot(sub(hand.palm, head.position), right)) || 1;
  const shoulder = { x: head.position.x + right.x * side * .16 - forward.x * .04,
    y: head.position.y - .22, z: head.position.z + right.z * side * .16 - forward.z * .04 };
  const reach = sub(hand.palm, shoulder);
  return { fraction: length(reach) / (head.armReach || .65), outward: dot(hand.normal, unit(reach)) };
}
export function shieldScore(hand, head) {
  if (!hand || !inFront(hand, head)) return 0;
  const reach = shieldReach(hand, head);
  if (reach.fraction < .80 || reach.outward < .60) return 0;
  const openness = Math.min(...FINGERS.map(f => ramp(hand.extension[f], .70, .88)));
  return Math.min(openness, ramp(reach.outward, .50, .80));
}
export function farsightPose(left, right, head, forming = false) {
  if (!left || !right) return null;
  const l = left.joints, r = right.joints;
  if (!finite(l?.wrist) || !finite(r?.wrist)) return null;
  const slack = forming ? 1.45 : 1;
  const seam = clamp((left.size + right.size) * .75, .055, .11) * slack;
  if (distance(l.wrist, r.wrist) > seam) return null;
  const bottom = midpoint(l.wrist, r.wrist);
  // Any non-thumb fingertips can close the upper seam. The heels close the
  // lower seam; thumbs, spare finger curl, and exact roundness are irrelevant.
  const contacts = FINGERS.flatMap(a => FINGERS.map(b => [l[`${a}-finger-tip`], r[`${b}-finger-tip`]]))
    .filter(([a, b]) => finite(a) && finite(b) && distance(a, b) <= seam)
    .map(([a, b]) => midpoint(a, b));
  contacts.sort((a, b) => dot(sub(b, bottom), head.up) - dot(sub(a, bottom), head.up));
  const top = contacts[0]; if (!top) return null;
  const center = midpoint(top, bottom), aperture = distance(top, bottom), span = distance(left.palm, right.palm);
  if (aperture < .065 || aperture > .34 || span < .045 || span > .38 ||
      dot(sub(top, bottom), head.up) < aperture * .25) return null;
  const normal = unit(cross(sub(right.palm, left.palm), sub(top, bottom)));
  const faceDistance = distance(center, head.position);
  if (Math.abs(dot(normal, head.forward)) < .55 || dot(sub(center, head.position), head.forward) < .055 ||
      dot(unit(sub(center, head.position)), head.forward) < .70 || faceDistance > 1.05) return null;
  return { center, radius: clamp(Math.min(aperture * .45, span * .65), .025, .18),
    zoom: 10 - 8 * clamp((faceDistance - .12) / .53), score: 1 };
}

// Reusable declarative gesture gate: hysteresis + dwell + optional release grace.
// Tracking loss is handled by the caller with reset(), never the grace period.
export class GestureGate {
  constructor({ enter = .72, exit = .45, dwell = 160, grace = 80 } = {}) {
    Object.assign(this, { enter, exit, dwell, grace }); this.reset();
  }
  reset() { this.active = false; this.since = null; this.lost = null; }
  update(score, time) {
    if (!Number.isFinite(score)) { this.reset(); return false; }
    if (!this.active) {
      if (score >= this.enter) {
        this.since ??= time;
        if (time - this.since >= this.dwell) this.active = true;
      } else this.since = null;
    } else if (score < this.exit) {
      this.lost ??= time;
      if (time - this.lost >= this.grace) this.reset();
    } else this.lost = null;
    return this.active;
  }
}

export const SPELL_GESTURES = {
  lightning: { score: fingerGunScore, dwell: 160, priority: 10 },
  shield: { score: shieldScore, dwell: 220, priority: 20 },
  farsight: { dwell: 180, grace: 100, priority: 100, hands: 2 },
};

export class SpellGestures {
  constructor(definitions = SPELL_GESTURES) {
    this.definitions = definitions;
    this.hands = Object.fromEntries(['left', 'right'].map(side => [side, {
      gates: Object.fromEntries(Object.entries(definitions).filter(([, d]) => d.hands !== 2).map(([id, d]) => [id, new GestureGate(d)])),
      hammer: new GestureGate({ enter: .55, exit: .40, dwell: 35, grace: 0 }),
      bent: new GestureGate({ enter: .70, exit: .55, dwell: 20, grace: 0 }), armed: false, lastCast: -Infinity,
    }]));
    this.circle = new GestureGate(definitions.farsight); this.lastTime = null; this.lastLens = null;
  }
  reset() {
    this.circle.reset(); this.lastLens = null; this.lastTime = null;
    Object.values(this.hands).forEach(h => { Object.values(h.gates).forEach(g => g.reset()); h.hammer.reset(); h.bent.reset(); h.armed = false; h.lastCast = -Infinity; });
  }
  update(hands, head, time, reserved = {}) {
    if (this.lastTime !== null && (time - this.lastTime > 180 || time < this.lastTime)) this.reset();
    this.lastTime = time;
    const occupied = reserved.left || reserved.right;
    const lens = occupied ? null : farsightPose(hands.left, hands.right, head);
    const forming = occupied ? null : lens || farsightPose(hands.left, hands.right, head, true);
    if (occupied) { this.circle.reset(); this.lastLens = null; }
    if (!hands.left || !hands.right) { this.circle.reset(); this.lastLens = null; }
    const circle = this.circle.update(lens ? 1 : 0, time);
    if (lens) this.lastLens = lens;
    const result = { left: null, right: null, casts: [], lens: circle ? this.lastLens : null };
    // Reserve both hands even while farsight is dwelling. Clear lightning's
    // arming so lowering thumbs to close the circle cannot produce a shot.
    for (const side of ['left', 'right']) {
      const state = this.hands[side], hand = hands[side];
      if (!hand || reserved[side] || forming || circle) {
        Object.values(state.gates).forEach(g => g.reset()); state.hammer.reset(); state.bent.reset(); state.armed = false; continue;
      }
      const matches = Object.entries(state.gates).filter(([id, gate]) => {
        const score = this.definitions[id].score(hand, head);
        // Retracting an arm or turning the palm inward removes a shield now.
        if (id === 'shield' && score === 0) gate.reset();
        return gate.update(score, time);
      });
      matches.sort(([a], [b]) => this.definitions[b].priority - this.definitions[a].priority);
      const spell = matches[0]?.[0] || null; result[side] = spell;
      if (spell !== 'lightning' || fingerGunScore(hand, head) < .45) {
        state.hammer.reset(); state.bent.reset(); state.armed = false; continue;
      }
      if (state.hammer.update(1 - hand.thumbAlignment, time)) state.armed = true;
      const bent = state.bent.update(hand.thumbAlignment, time);
      if (state.armed && bent) {
        state.armed = false; state.hammer.reset(); state.bent.reset();
        if (time - state.lastCast >= 100) { result.casts.push(side); state.lastCast = time; }
      }
    }
    return result;
  }
}
