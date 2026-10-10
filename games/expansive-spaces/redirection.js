import { isInsideBoundary, measureBounds } from './play-space.js';

const RAD = Math.PI / 180;
export const DEFAULT_REDIRECTION_SETTINGS = {
  steeringEnabled: false, steeringMode: 'center', maxCurvature: 5,
  steeringSpeed: 2, maxSteeringRate: 6,
  turnEnabled: false, maxTurnGain: 200 / 180, turnSpeed: 180,
};

export function sanitizeRedirectionSettings(settings = {}) {
  const s = { ...DEFAULT_REDIRECTION_SETTINGS, ...settings };
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ?
    Math.max(min, Math.min(max, Number(value))) : fallback;
  return {
    steeringEnabled: s.steeringEnabled === true || s.steeringEnabled === 'true',
    steeringMode: ['center', 'left', 'right'].includes(s.steeringMode) ? s.steeringMode : 'center',
    maxCurvature: number(s.maxCurvature, 5, 0, 20),
    steeringSpeed: number(s.steeringSpeed, 2, .8, 4),
    maxSteeringRate: number(s.maxSteeringRate, 6, 1, 30),
    turnEnabled: s.turnEnabled === true || s.turnEnabled === 'true',
    maxTurnGain: number(s.maxTurnGain, 200 / 180, .8, 1.5),
    turnSpeed: number(s.turnSpeed, 180, 60, 360),
  };
}

export function ramp(value, low, high) {
  const f = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return f * f * (3 - 2 * f);
}

export function wrapYaw(angle) { return Math.atan2(Math.sin(angle), Math.cos(angle)); }

// THREE's positive Y rotation turns left when facing -Z.
export function rotateXZ(point, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: c * point.x + s * point.z, z: -s * point.x + c * point.z };
}

// A single rigid transform maps physical poses to virtual poses. Rotation is
// injected around the current head, never the reference-space origin. Existing
// travel is not rescaled or rotated when any setting changes.
export class LocomotionTransform {
  constructor() { this.reset(); }
  reset() { this.x = 0; this.z = 0; this.yaw = 0; }
  apply(position, extraX, extraZ, yawDelta) {
    const extra = rotateXZ({ x: extraX, z: extraZ }, this.yaw);
    const before = rotateXZ(position, this.yaw);
    this.yaw = wrapYaw(this.yaw + yawDelta);
    const after = rotateXZ(position, this.yaw);
    this.x += extra.x + before.x - after.x;
    this.z += extra.z + before.z - after.z;
  }
  physicalPoint(point) { return rotateXZ({ x: point.x - this.x, z: point.z - this.z }, -this.yaw); }
}

export function boundaryTarget(points) {
  const b = measureBounds(points);
  if (!b) return null;
  const center = { x: b.centerX, z: b.centerZ };
  if (isInsideBoundary(center, points)) return center;
  // Concave boundaries can put the extents' center outside the guardian.
  // Choose the interior grid point with the largest clearance to its edges.
  let best = null, clearance = -1;
  for (let i = 1; i < 16; i++) for (let j = 1; j < 16; j++) {
    const p = { x: b.minX + b.width * i / 16, z: b.minZ + b.depth * j / 16 };
    if (!isInsideBoundary(p, points)) continue;
    let distance = Infinity;
    points.forEach((a, k) => {
      const next = points[(k + 1) % points.length];
      const dx = next.x - a.x, dz = next.z - a.z;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      distance = Math.min(distance, Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz));
    });
    if (distance > clearance) { best = p; clearance = distance; }
  }
  return best;
}

export class RedirectionTracker {
  constructor(settings) { this.settings = sanitizeRedirectionSettings(settings); this.reset(); }
  setSettings(settings) { this.settings = sanitizeRedirectionSettings({ ...this.settings, ...settings }); }
  reset() { this.previous = null; this.walkSpeed = 0; this.turnRate = 0; this.steeringRate = 0; this.turnGain = 1; this.bias = 1; }
  sample(position, yaw, timeMs, { target = null, paused = false } = {}) {
    const neutral = () => ({ yawDelta: 0, steeringRate: 0, turnRate: this.turnRate, turnGain: 1 });
    if (![position.x, position.z, timeMs].every(Number.isFinite)) { this.reset(); return neutral(); }
    const previous = this.previous;
    this.previous = { x: position.x, z: position.z, yaw: Number.isFinite(yaw) ? yaw : null, timeMs };
    if (!previous) return neutral();
    const dt = (timeMs - previous.timeMs) / 1000;
    const dx = position.x - previous.x, dz = position.z - previous.z;
    const distance = Math.hypot(dx, dz), speed = distance / dt;
    const dyaw = Number.isFinite(yaw) && previous.yaw !== null ? wrapYaw(yaw - previous.yaw) : 0;
    const angularSpeed = Math.abs(dyaw) / dt / RAD;
    if (dt <= 0 || dt > .25 || speed > 8 || angularSpeed > 1080) {
      const anchor = this.previous; this.reset(); this.previous = anchor; return neutral();
    }
    this.walkSpeed += (speed - this.walkSpeed) * (1 - Math.exp(-dt / .12));
    this.turnRate += (angularSpeed - this.turnRate) * (1 - Math.exp(-dt / .04));
    const s = this.settings;
    this.turnGain = !paused && s.turnEnabled ? 1 + (s.maxTurnGain - 1) *
      ramp(Math.min(angularSpeed, this.turnRate), 30, s.turnSpeed) : 1;
    let desired = 0;
    if (!paused && s.steeringEnabled && speed > .6) {
      let direction = s.steeringMode === 'left' ? -1 : 1;
      if (s.steeringMode === 'center') {
        direction = 0;
        if (target && Math.hypot(target.x - position.x, target.z - position.z) > .25 && distance > 0) {
          const heading = Math.atan2(-dx, -dz);
          const targetHeading = Math.atan2(position.x - target.x, position.z - target.z);
          const error = wrapYaw(targetHeading - heading);
          // Keep a stable side when the target is almost directly behind us.
          if (Math.abs(error) < Math.PI - .2 && Math.abs(error) > .05) this.bias = Math.sign(error);
          direction = -this.bias * Math.min(1, Math.abs(error) / (Math.PI / 2));
        }
      }
      const curvature = s.maxCurvature * ramp(Math.min(speed, this.walkSpeed), .6, s.steeringSpeed);
      desired = direction * Math.min(s.maxSteeringRate, curvature * speed);
    }
    this.steeringRate += (desired - this.steeringRate) * (1 - Math.exp(-dt / .3));
    // No lingering rotation at rest, while looking at settings, or when off.
    if (paused || !s.steeringEnabled || speed <= .6 || (s.steeringMode === 'center' && !target)) this.steeringRate = 0;
    this.steeringRate = Math.max(-s.maxSteeringRate, Math.min(s.maxSteeringRate, this.steeringRate));
    return { yawDelta: this.steeringRate * RAD * dt + dyaw * (this.turnGain - 1),
      steeringRate: this.steeringRate, turnRate: this.turnRate, turnGain: this.turnGain };
  }
}
