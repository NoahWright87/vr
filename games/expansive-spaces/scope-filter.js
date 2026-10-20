export const DEFAULT_SCOPE_SETTINGS = { enabled: false, stabilize: true, zoom: 4, rotationLag: .15, positionLag: .15 };
export function sanitizeScopeSettings(settings = {}) {
  const s = { ...DEFAULT_SCOPE_SETTINGS, ...settings };
  const number = (key, min, max) => Number.isFinite(Number(s[key])) ? Math.max(min, Math.min(max, Number(s[key]))) : DEFAULT_SCOPE_SETTINGS[key];
  return { enabled: s.enabled === true || s.enabled === 'true', stabilize: s.stabilize === true || s.stabilize === 'true',
    zoom: number('zoom', 2, 8), rotationLag: number('rotationLag', 0, .8), positionLag: number('positionLag', 0, .8) };
}
export function response(dt, lag) { return lag <= 0 ? 1 : 1 - Math.exp(-dt / lag); }

function slerp(a, b, t) {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  const target = dot < 0 ? Object.fromEntries(['x', 'y', 'z', 'w'].map(k => [k, -b[k]])) : b;
  dot = Math.abs(dot);
  let wa = 1 - t, wb = t;
  if (dot < .9995) {
    const angle = Math.acos(Math.min(1, dot)), divisor = Math.sin(angle);
    wa = Math.sin((1 - t) * angle) / divisor; wb = Math.sin(t * angle) / divisor;
  }
  const q = Object.fromEntries(['x', 'y', 'z', 'w'].map(k => [k, a[k] * wa + target[k] * wb]));
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  return Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v / length]));
}

// Filters only the secondary magnified camera. The headset camera never changes.
export class ScopePoseFilter {
  constructor() { this.reset(); }
  reset() { this.position = null; this.quaternion = null; this.time = null; }
  sample(position, quaternion, time, settings) {
    if (![position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w, time].every(Number.isFinite) ||
      Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w) < .1) {
      this.reset(); return null;
    }
    const dt = this.time === null ? 0 : (time - this.time) / 1000;
    const jump = this.position && Math.hypot(position.x - this.position.x, position.y - this.position.y, position.z - this.position.z) > 1;
    if (!this.position || dt <= 0 || dt > .25 || jump || !settings.stabilize) {
      this.position = { x: position.x, y: position.y, z: position.z };
      this.quaternion = { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
    } else {
      const p = response(dt, settings.positionLag);
      for (const k of ['x', 'y', 'z']) this.position[k] += (position[k] - this.position[k]) * p;
      this.quaternion = slerp(this.quaternion, quaternion, response(dt, settings.rotationLag));
    }
    this.time = time;
    return { position: this.position, quaternion: this.quaternion };
  }
}
