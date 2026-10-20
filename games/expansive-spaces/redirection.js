import { planGuidance } from './boundary-guidance.js';
import { OverlapPlanner } from './overlap-planner.js';

const RAD = Math.PI / 180;
export const DEFAULT_REDIRECTION_SETTINGS = {
  steeringEnabled: false, steeringMode: 'adaptive', maxCurvature: 5,
  steeringSpeed: 2, maxSteeringRate: 6,
  lookAhead: 1.5, wallMargin: .4,
  turnEnabled: false, minTurnGain: .9, maxTurnGain: 200 / 180, turnSpeed: 180, alignmentStrength: 1,
};

export function sanitizeRedirectionSettings(settings = {}) {
  const s = { ...DEFAULT_REDIRECTION_SETTINGS, ...settings };
  const number = (value, fallback, min, max) => Number.isFinite(Number(value)) ?
    Math.max(min, Math.min(max, Number(value))) : fallback;
  return {
    steeringEnabled: s.steeringEnabled === true || s.steeringEnabled === 'true',
    // Migrate the old center-seeking mode to boundary-aware steering.
    steeringMode: 'adaptive',
    maxCurvature: number(s.maxCurvature, 5, 0, 20),
    steeringSpeed: number(s.steeringSpeed, 2, .8, 4),
    maxSteeringRate: number(s.maxSteeringRate, 6, 1, 30),
    turnEnabled: s.turnEnabled === true || s.turnEnabled === 'true',
    lookAhead: number(s.lookAhead, 1.5, .5, 3),
    wallMargin: number(s.wallMargin, .4, .1, 1),
    minTurnGain: number(settings.minTurnGain ?? (s.maxTurnGain < 1 ? s.maxTurnGain : s.minTurnGain), .9, .5, 1),
    maxTurnGain: number(s.maxTurnGain, 200 / 180, 1, 1.5),
    turnSpeed: number(s.turnSpeed, 180, 60, 360),
    alignmentStrength: number(s.alignmentStrength, 1, 0, 1),
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

export class RedirectionTracker {
  constructor(settings) { this.settings = sanitizeRedirectionSettings(settings); this.reset(); }
  setSettings(settings) { this.settings = sanitizeRedirectionSettings({ ...this.settings, ...settings }); }
  reset() { this.previous = null; this.walkSpeed = 0; this.turnRate = 0; this.steeringRate = 0; this.turnGain = 1; this.bias = 1; this.guidance = null; this.planner = new OverlapPlanner(); }
  sample(position, yaw, timeMs, { context = null, paused = false } = {}) {
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
    const heading = speed > .15 ? Math.atan2(-dx, -dz) : yaw;
    this.guidance = planGuidance(position, heading, Math.min(speed, this.walkSpeed), context, s, this.planner, timeMs, this.bias);
    if (Math.abs(this.guidance.correction) > .05) this.bias = Math.sign(this.guidance.correction);
    let turnYaw = 0;
    if (!paused && s.turnEnabled && this.guidance.valid && angularSpeed > 30 + 1e-6 && this.turnRate > 30 && Math.abs(dyaw) > 1e-8) {
      const goal = this.guidance.correction;
      const limit = Math.sign(goal) === Math.sign(dyaw) ? s.maxTurnGain - 1 : 1 - s.minTurnGain;
      const strength = Math.min(1, Math.abs(goal) / (30 * RAD));
      const available = Math.abs(dyaw) * limit * ramp(Math.min(angularSpeed, this.turnRate), 30, s.turnSpeed) * strength * s.alignmentStrength;
      turnYaw = Math.sign(goal) * Math.min(Math.abs(goal), available);
    }
    this.turnGain = Math.abs(dyaw) > 1e-8 ? 1 + turnYaw / dyaw : 1;
    let desired = 0;
    if (!paused && s.steeringEnabled && speed > .6) {
      const direction = this.guidance.valid ? Math.sign(this.guidance.correction) *
        Math.min(1, Math.abs(this.guidance.correction) / (Math.PI / 2)) * s.alignmentStrength : 0;
      const curvature = s.maxCurvature * ramp(Math.min(speed, this.walkSpeed), .6, s.steeringSpeed);
      desired = direction * Math.min(s.maxSteeringRate, curvature * speed);
    }
    // A changed course must not keep the previous wall's correction alive
    // through the smoothing interval, particularly after a quick reversal.
    if (desired === 0 || Math.sign(desired) !== Math.sign(this.steeringRate)) this.steeringRate = 0;
    this.steeringRate += (desired - this.steeringRate) * (1 - Math.exp(-dt / .3));
    // No lingering rotation at rest, while looking at settings, or when off.
    if (paused || !s.steeringEnabled || speed <= .6 || !this.guidance.valid) this.steeringRate = 0;
    this.steeringRate = Math.max(-s.maxSteeringRate, Math.min(s.maxSteeringRate, this.steeringRate));
    const requested = this.steeringRate * RAD * dt + turnYaw;
    const bounded = Math.sign(requested) * Math.min(Math.abs(requested), Math.abs(this.guidance.correction), 3 * RAD);
    const yawDelta = this.guidance.valid ? this.planner.limitYaw(bounded, this.guidance.minimumOverlap) : 0;
    const ratio = Math.abs(requested) > 1e-10 ? yawDelta / requested : 0;
    this.steeringRate *= ratio; turnYaw *= ratio;
    this.turnGain = Math.abs(dyaw) > 1e-8 ? 1 + turnYaw / dyaw : 1;
    return { yawDelta,
      steeringRate: this.steeringRate, turnRate: this.turnRate, turnGain: this.turnGain };
  }
}
