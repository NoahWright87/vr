// Sampling history is diagnostic only; it never supplies gameplay bounds.
export class BoundaryObservation {
  constructor() {
    this.startTime = null;
    this.elapsed = 0;
    this.frames = 0;
    this.emptyFrames = 0;
    this.firstGeometrySeconds = null;
    this.corners = 0;
    this.maxCorners = 0;
    this.changes = 0;
    this.history = [];
    this.points = [];
    this.key = null;
  }

  sample(time, points) {
    if (!Number.isFinite(time)) return;
    if (this.startTime === null) this.startTime = time;
    this.elapsed = Math.max(0, (time - this.startTime) / 1000);
    this.frames++;
    const valid = points.length >= 3 && points.every(p => [p.x,p.y,p.z].every(Number.isFinite));
    this.points = valid ? points.map(p => ({...p})) : [];
    this.corners = this.points.length;
    if (!valid) this.emptyFrames++;
    else if (this.firstGeometrySeconds === null) this.firstGeometrySeconds = this.elapsed;
    this.maxCorners = Math.max(this.maxCorners, this.corners);
    const key = JSON.stringify(this.points);
    if (key !== this.key) {
      if (this.key !== null) this.changes++;
      this.key = key;
      this.history.push({ seconds: this.elapsed, corners: this.corners });
      // Keep a bounded history even if a runtime changes its data every frame.
      if (this.history.length > 50) this.history.shift();
    }
  }

  text() {
    if (!this.frames) return 'Waiting for XR boundary frames';
    const first = this.firstGeometrySeconds === null ? 'No geometry yet' : `First geometry: ${this.firstGeometrySeconds.toFixed(2)} s`;
    return `${Math.floor(this.elapsed)} s · ${this.frames} frames · ${this.corners} corners\n${first} · ${this.emptyFrames} empty frames\n${this.changes} changes · most corners: ${this.maxCorners}`;
  }
}
