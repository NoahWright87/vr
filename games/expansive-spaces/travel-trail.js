export const TRAIL_METRES = 20;
const MAX_POINTS = 1024;
const MIN_STEP = .02;

// Retain distance, rather than frames, so the same cap works at every speed.
// Disconnected tracking segments never count the jump between them as travel.
export class TravelTrail {
  constructor(maxLength = TRAIL_METRES, maxPoints = MAX_POINTS) {
    this.maxLength = maxLength;
    this.maxPoints = maxPoints;
    this.clear();
  }

  clear() { this.points = []; this.length = 0; }

  add(point, breakBefore = false) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.z)) return;
    const last = this.points.at(-1);
    const distance = last ? Math.hypot(point.x - last.x, point.z - last.z) : 0;
    if (last && !breakBefore && distance < MIN_STEP) return;
    this.points.push({ x: point.x, z: point.z, start: !last || breakBefore });
    if (last && !breakBefore) this.length += distance;
    while (this.points.length > 1 && this.length > this.maxLength) {
      const a = this.points[0], b = this.points[1];
      if (b.start) { this.points.shift(); continue; }
      const segment = Math.hypot(b.x - a.x, b.z - a.z);
      const excess = this.length - this.maxLength;
      if (excess >= segment) this.removeFirst();
      else {
        const fraction = excess / segment;
        a.x += (b.x - a.x) * fraction;
        a.z += (b.z - a.z) * fraction;
        this.length = this.maxLength;
      }
    }
    // Also bound memory for many tracking breaks and tiny movements.
    while (this.points.length > this.maxPoints) this.removeFirst();
  }

  removeFirst() {
    const a = this.points.shift(), b = this.points[0];
    if (b) {
      if (!b.start) this.length = Math.max(0, this.length - Math.hypot(b.x - a.x, b.z - a.z));
      b.start = true;
    }
  }
}
