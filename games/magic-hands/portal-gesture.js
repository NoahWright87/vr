// Portal intent and loop recognition are independent of WebXR and rendering.
import { sub, dot, unit, distance, midpoint } from '../../common/hand-gestures.js';
export function portalPoint(hand) {
  if (!hand || hand.extension.index < .82 || hand.extension.middle < .82 || hand.extension.ring > .72 || hand.extension.pinky > .72) return null;
  const j = hand.joints;
  const a = unit(sub(j['index-finger-tip'], j['index-finger-phalanx-proximal']));
  const b = unit(sub(j['middle-finger-tip'], j['middle-finger-phalanx-proximal']));
  if (dot(a, b) < .75) return null;
  // Thumb shape and contact play no part in this spell.
  return { tip: midpoint(j['index-finger-tip'], j['middle-finger-tip']), aim: hand.portalAim || unit(midpoint(a, b)) };
}

export function recognizeLoop(points) {
  if (points.length < 12) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  if (Math.min(width, height) < .22 || Math.max(width, height) > 1.2 || Math.max(width, height) / Math.min(width, height) > 2.1) return null;
  const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const normalized = points.map(p => ({ x: (p.x - center.x) / (width / 2), y: (p.y - center.y) / (height / 2) }));
  let turn = 0, absoluteTurn = 0, path = 0;
  const bins = new Set();
  normalized.forEach((p, i) => {
    const angle = Math.atan2(p.y, p.x); bins.add(Math.floor((angle + Math.PI) / (Math.PI / 4)) % 8);
    if (!i) return;
    const previous = normalized[i - 1];
    const delta = Math.atan2(previous.x * p.y - previous.y * p.x, previous.x * p.x + previous.y * p.y);
    turn += delta; absoluteTurn += Math.abs(delta); path += Math.hypot(p.x - previous.x, p.y - previous.y);
  });
  const closure = Math.hypot(normalized.at(-1).x - normalized[0].x, normalized.at(-1).y - normalized[0].y);
  const radialError = normalized.reduce((n, p) => n + Math.abs(Math.hypot(p.x, p.y) - 1), 0) / points.length;
  if (Math.abs(turn) < 5.05 || bins.size < 7 || closure > .85 || path < 5 || path > 10 ||
      absoluteTurn > Math.abs(turn) * 1.65 || radialError > .32) return null;
  return { center, width, height, clockwise: turn < 0 };
}

export class PortalGesture {
  constructor() { this.reset(); }
  reset() { this.state = null; this.lastTime = null; this.released = {}; this.cancelUntil = {}; }
  cancel(time) {
    if (this.state) { this.released[this.state.side] = false; this.cancelUntil[this.state.side] = time + 400; }
    this.state = null;
  }
  update(hands, head, time, destinations = {}, occupied = {}) {
    if (this.lastTime !== null && (time < this.lastTime || time - this.lastTime > 180)) this.cancel(time);
    this.lastTime = time;
    const poses = Object.fromEntries(['right', 'left'].map(side => [side, occupied[side] ? null : portalPoint(hands[side])]));
    const reserved = {};
    for (const side of ['left', 'right']) {
      if (!poses[side]) this.released[side] = true;
      reserved[side] = !!poses[side] || time < (this.cancelUntil[side] || 0);
    }
    let s = this.state;
    if (s && (!poses[s.side] || occupied[s.side])) { this.cancel(time); reserved[s.side] = true; s = null; }
    if (!s) {
      const side = ['right', 'left'].find(side => poses[side] && this.released[side] !== false);
      if (side) s = this.state = { side, phase: 'aim', since: null, points: [] };
    }
    let completed = null;
    if (s) {
      const pose = poses[s.side], destination = destinations[s.side];
      if (s.phase === 'aim') {
        const steady = destination && s.destination && s.anchor && distance(pose.tip, s.anchor) < .035 && dot(pose.aim, s.aim) > .994 &&
          distance(destination.position, s.destination.position) < Math.max(.30, distance(head.position, destination.position) * .08);
        if (!steady) {
          s.since = destination ? time : null; s.anchor = pose.tip; s.aim = pose.aim; s.destination = destination;
        }
        if (s.since !== null && time - s.since >= 1000) {
          s.phase = 'ready'; s.readyAt = time; s.origin = pose.tip;
          s.up = { x: 0, y: 1, z: 0 }; s.normal = unit({ x: head.forward.x, y: 0, z: head.forward.z });
          s.right = { x: -s.normal.z, y: 0, z: s.normal.x }; s.points = [{ x: 0, y: 0 }];
        }
      } else if (s.phase === 'ready' || s.phase === 'drawing') {
        const offset = sub(pose.tip, s.origin), point = { x: dot(offset, s.right), y: offset.y };
        if (Math.abs(dot(offset, s.normal)) > .24 || time - s.readyAt > 5000 || (s.phase === 'drawing' && time - s.drawAt > 3500)) {
          this.cancel(time);
        } else if (Math.hypot(point.x, point.y) > .035 || s.phase === 'drawing') {
          if (s.phase === 'ready') { s.phase = 'drawing'; s.drawAt = time; }
          const previous = s.points.at(-1), delta = Math.hypot(point.x - previous.x, point.y - previous.y);
          if (delta > .22 || s.points.length >= 300) this.cancel(time);
          else if (delta > .006) {
            s.points.push(point);
            const loop = recognizeLoop(s.points);
            if (loop && time - s.drawAt >= 180) {
              completed = { side: s.side, destination: s.destination, loop, origin: s.origin, right: s.right };
              s.phase = 'complete'; this.released[s.side] = false;
            }
          }
        }
      }
    }
    return { reserved, state: this.state, completed };
  }
}

// Front-to-back crossings only, with interpolation for quick steps or pulls.
// Both points are in their respective previous/current portal-local frames.
export function portalCrossing(previous, current, radius, margin = .12) {
  if (!previous || previous.z <= 0 || current.z > 0) return false;
  const t = previous.z / (previous.z - current.z);
  const x = previous.x + (current.x - previous.x) * t, y = previous.y + (current.y - previous.y) * t;
  return x * x + y * y < (radius - margin) ** 2;
}
