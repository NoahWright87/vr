import { sub, dot, unit, length, distance, midpoint, FINGERS } from '../../common/hand-gestures.js';
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const doorOpenHand = hand => !!hand && FINGERS.filter(f => hand.extension[f] > .72).length >= 3;
export const doorGrasp = hand => !!hand && (hand.pinch < .55 || FINGERS.filter(f => hand.extension[f] < .76).length >= 3);

// Backs together, palms outward; the hands can also be slightly angled forward.
// This is a chest-level two-hand preparation, outside shield extension range.
export function doorPose(hands, head, preparing = true) {
  const { left, right } = hands;
  if (!doorOpenHand(left) || !doorOpenHand(right)) return null;
  const forward = unit({ x: head.forward.x, y: 0, z: head.forward.z }), sideways = { x: -forward.z, y: 0, z: forward.x };
  const center = midpoint(left.palm, right.palm), offset = sub(center, head.position);
  const span = dot(sub(right.palm, left.palm), sideways), depth = dot(offset, forward);
  if (span < -.04 || depth < .08 || depth > .85 || offset.y < -.85 || offset.y > .22) return null;
  if (preparing && (distance(left.palm, right.palm) > .28 || depth > .58)) return null;
  const outward = dot(left.normal, sideways) < -.35 && dot(right.normal, sideways) > .35;
  const forwardPalms = dot(left.normal, forward) > .45 && dot(right.normal, forward) > .45;
  if (preparing && !outward && !forwardPalms) return null;
  return { center, span, depth, forward, sideways };
}

export function doorAim(hands, head) {
  const palms = hands.left && hands.right ? add(hands.left.normal, hands.right.normal) : head.forward;
  const handAim = length(palms) > .35 && dot(unit(palms), head.forward) > .05 ? unit(palms) : head.forward;
  return unit(add({ x: head.forward.x * .78, y: head.forward.y * .78, z: head.forward.z * .78 },
    { x: handAim.x * .22, y: handAim.y * .22, z: handAim.z * .22 }));
}

// No steady-aim test: deliberate opening movement confirms a softly filtered
// gaze/hand destination. Freeze it when movement starts, not while preparing.
export class PortalGesture {
  constructor() { this.reset(); }
  reset() { this.state = null; this.lastTime = null; this.blockedUntil = 0; }
  update(hands, head, time, destination, occupied = {}) {
    if (this.lastTime !== null && (time < this.lastTime || time - this.lastTime > 1500)) this.reset();
    this.lastTime = time;
    let s = this.state, completed = null;
    const reserved = { left: false, right: false };
    const unavailable = occupied.left || occupied.right;
    const missing = !hands.left || !hands.right || hands.left.tracked === false || hands.right.tracked === false;
    if (unavailable) { this.state = null; return { state: null, completed, reserved }; }
    if (s?.phase === 'complete') {
      if (time - s.completedAt < 450) reserved.left = reserved.right = true;
      if (time - s.completedAt > 700 && doorPose(hands, head)) this.state = null;
      return { state: this.state, completed, reserved };
    }
    if (s && missing) {
      s.missingAt ??= time;
      if (time - s.missingAt > 650) { this.state = null; this.blockedUntil = time + 250; }
      else reserved.left = reserved.right = true;
      return { state: this.state, completed, reserved };
    }
    if (missing || time < this.blockedUntil) return { state: s, completed, reserved };
    const pose = doorPose(hands, head, !s);
    if (!s && pose) s = this.state = { phase: 'aim', since: time, anchorSpan: pose.span, anchorCenter: pose.center, destination: null };
    if (!s) return { state: null, completed, reserved };
    reserved.left = reserved.right = true; s.missingAt = null;
    if (!pose || time - s.since > 4500) { this.state = null; this.blockedUntil = time + 200; return { state: null, completed, reserved }; }
    if (s.phase === 'aim') {
      if (destination) { s.destination = destination; s.targetAt = time; }
      if (s.destination && time - s.targetAt < 650 && time - s.since >= 180) { s.phase = 'ready'; s.anchorSpan = pose.span; s.anchorCenter = pose.center; }
    }
    if (s.phase === 'ready' || s.phase === 'opening') {
      const push = dot(sub(pose.center, s.anchorCenter), pose.forward), spread = pose.span - s.anchorSpan;
      if (s.phase === 'ready') {
        if (destination) { s.destination = destination; s.targetAt = time; }
        if (push > .035 || spread > .06) s.phase = 'opening';
      }
      s.progress = Math.max(0, Math.min(1, Math.min(push / .08, spread / .14)));
      if (s.phase === 'opening' && ((push > .08 && spread > .14) || (push > .16 && spread > .08))) {
        completed = { destination: s.destination, origin: pose.center, side: 'both' };
        s.phase = 'complete'; s.completedAt = time;
      }
      if (push < -.15) { this.state = null; this.blockedUntil = time + 200; }
    }
    return { state: this.state, completed, reserved };
  }
}

export function portalCrossing(previous, current, width, height = width, margin = .08) {
  if (!previous || previous.z <= 0 || current.z > 0) return false;
  const t = previous.z / (previous.z - current.z);
  const x = previous.x + (current.x - previous.x) * t, y = previous.y + (current.y - previous.y) * t;
  return Math.abs(x) < width - margin && Math.abs(y) < height - margin;
}

// Closing starts shortly after the last interaction; a held frame stays open.
export function portalAperture(time, lastInteraction, held) {
  return held ? 1 : Math.max(0, 1 - Math.max(0, time - lastInteraction - 1400) / 1600);
}
