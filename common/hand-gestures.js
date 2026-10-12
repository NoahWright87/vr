// Input-independent gesture features and temporal arbitration. All positions
// share world metres; extension and thumb travel are relative to hand size.
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
  if (size < .025 || size > .14) return null;
  const extension = {};
  for (const finger of FINGERS) {
    const chain = ['phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(j => joints[`${finger}-finger-${j}`]);
    const arc = chain.slice(1).reduce((sum, p, i) => sum + distance(p, chain[i]), 0);
    if (arc < .015) return null;
    extension[finger] = clamp(distance(chain[0], chain[3]) / arc);
  }
  return { joints, extension, size, palm: midpoint(joints.wrist, joints['middle-finger-phalanx-proximal']),
    normal: unit(palmNormal), tip: joints['index-finger-tip'],
    aim: unit(sub(joints['index-finger-tip'], joints['index-finger-phalanx-distal'])),
    thumb: distance(joints['thumb-tip'], joints['index-finger-phalanx-proximal']) / size };
}

function inFront(hand, head) {
  return dot(sub(hand.palm, head.position), head.forward) > .10;
}
export function fingerGunScore(hand, head) {
  if (!hand || !inFront(hand, head)) return 0;
  const e = hand.extension;
  return Math.min(ramp(e.index, .68, .86), ...['middle', 'ring', 'pinky'].map(f => 1 - ramp(e[f], .52, .78)));
}
export function shieldScore(hand, head) {
  if (!hand || !inFront(hand, head)) return 0;
  const openness = Math.min(...FINGERS.map(f => ramp(hand.extension[f], .70, .88)));
  const facing = Math.max(dot(hand.normal, { x: 0, y: 1, z: 0 }), dot(hand.normal, head.forward));
  return Math.min(openness, ramp(facing, .35, .70));
}
export function farsightPose(left, right, head) {
  if (!left || !right || !inFront(left, head) || !inFront(right, head)) return null;
  const l = left.joints, r = right.joints;
  const top = midpoint(l['index-finger-tip'], r['index-finger-tip']);
  const bottom = midpoint(l['thumb-tip'], r['thumb-tip']);
  const center = midpoint(top, bottom), aperture = distance(top, bottom);
  const span = distance(left.palm, right.palm);
  // Two matching seams, a real aperture, and curled spare fingers distinguish
  // this from prayer, a clasp, two open palms, and a pair of finger guns.
  const seam = clamp((left.size + right.size) * .60, .035, .085);
  if (distance(l['index-finger-tip'], r['index-finger-tip']) > seam ||
      distance(l['thumb-tip'], r['thumb-tip']) > seam || aperture < .025 - 1e-6 || aperture > .28 + 1e-6 ||
      span < .085 || span > .5 || dot(sub(top, bottom), head.up) < aperture * .45 ||
      ['middle', 'ring', 'pinky'].some(f => left.extension[f] > .82 || right.extension[f] > .82)) return null;
  const normal = unit(cross(sub(right.palm, left.palm), sub(top, bottom)));
  if (Math.abs(dot(normal, head.forward)) < .65 ||
      dot(unit(sub(center, head.position)), head.forward) < .80 || distance(center, head.position) > .85) return null;
  // Small circles can reach telescope territory without an unbounded FOV.
  return { center, radius: aperture * .5, zoom: clamp(.40 / aperture, 2, 16), score: 1 };
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
  farsight: { dwell: 240, grace: 100, priority: 100, hands: 2 },
};

export class SpellGestures {
  constructor(definitions = SPELL_GESTURES) {
    this.definitions = definitions;
    this.hands = Object.fromEntries(['left', 'right'].map(side => [side, {
      gates: Object.fromEntries(Object.entries(definitions).filter(([, d]) => d.hands !== 2).map(([id, d]) => [id, new GestureGate(d)])),
      hammer: new GestureGate({ enter: .95, exit: .72, dwell: 100, grace: 0 }), armed: false, lastCast: -Infinity,
    }]));
    this.circle = new GestureGate(definitions.farsight); this.lastTime = null; this.lastLens = null;
  }
  reset() {
    this.circle.reset(); this.lastLens = null; this.lastTime = null;
    Object.values(this.hands).forEach(h => { Object.values(h.gates).forEach(g => g.reset()); h.hammer.reset(); h.armed = false; h.lastCast = -Infinity; });
  }
  update(hands, head, time) {
    if (this.lastTime !== null && (time - this.lastTime > 180 || time < this.lastTime)) this.reset();
    this.lastTime = time;
    const lens = farsightPose(hands.left, hands.right, head);
    if (!hands.left || !hands.right) { this.circle.reset(); this.lastLens = null; }
    const circle = this.circle.update(lens ? 1 : 0, time);
    if (lens) this.lastLens = lens;
    const result = { left: null, right: null, casts: [], lens: circle ? this.lastLens : null };
    // Reserve both hands even while farsight is dwelling. Clear lightning's
    // arming so lowering thumbs to close the circle cannot produce a shot.
    for (const side of ['left', 'right']) {
      const state = this.hands[side], hand = hands[side];
      if (!hand || lens || circle) {
        Object.values(state.gates).forEach(g => g.reset()); state.hammer.reset(); state.armed = false; continue;
      }
      const matches = Object.entries(state.gates).filter(([id, gate]) => gate.update(this.definitions[id].score(hand, head), time));
      matches.sort(([a], [b]) => this.definitions[b].priority - this.definitions[a].priority);
      const spell = matches[0]?.[0] || null; result[side] = spell;
      if (spell !== 'lightning' || fingerGunScore(hand, head) < .45) {
        state.hammer.reset(); state.armed = false; continue;
      }
      if (state.hammer.update(hand.thumb, time)) state.armed = true;
      if (state.armed && hand.thumb < .72) {
        state.armed = false; state.hammer.reset();
        if (time - state.lastCast >= 300) { result.casts.push(side); state.lastCast = time; }
      }
    }
    return result;
  }
}
