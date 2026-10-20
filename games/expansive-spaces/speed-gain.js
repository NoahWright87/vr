export const SLOW_SPEED = 0.6; // m/s: slow walking stays exactly one-to-one.
export const DEFAULT_GAIN_SETTINGS = { maxGain: 1.2, speedForMax: 2 };

export function sanitizeGainSettings(settings = {}) {
  function number(value, fallback, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }
  return {
    maxGain: number(settings.maxGain ?? DEFAULT_GAIN_SETTINGS.maxGain, 1.2, 1, 2),
    speedForMax: number(settings.speedForMax ?? DEFAULT_GAIN_SETTINGS.speedForMax, 2, 0.8, 4),
  };
}

export function gainAtSpeed(speed, settings) {
  const fraction = Math.max(0, Math.min(1, (speed - SLOW_SPEED) / (settings.speedForMax - SLOW_SPEED)));
  const smooth = fraction * fraction * (3 - 2 * fraction);
  return 1 + (settings.maxGain - 1) * smooth;
}

// Pure physical-pose sampling. Offsets are applied by the rig component, never
// fed back into this estimator. Head height and head rotation do not affect gain.
export class SpeedGainTracker {
  constructor(settings = DEFAULT_GAIN_SETTINGS) {
    this.settings = sanitizeGainSettings(settings);
    this.reset();
  }

  setSettings(settings) {
    this.settings = sanitizeGainSettings({ ...this.settings, ...settings });
  }

  reset() {
    this.previous = null;
    this.speed = 0;
    this.gain = 1;
  }

  sample(position, timeMs) {
    const neutral = () => ({ extraX: 0, extraZ: 0, speed: this.speed, gain: this.gain });
    if (!Number.isFinite(position.x) || !Number.isFinite(position.z) || !Number.isFinite(timeMs)) {
      this.reset();
      return neutral();
    }
    const previous = this.previous;
    this.previous = { x: position.x, z: position.z, timeMs };
    if (!previous) return neutral();
    const dt = (timeMs - previous.timeMs) / 1000;
    const dx = position.x - previous.x, dz = position.z - previous.z;
    const rawSpeed = Math.hypot(dx, dz) / dt;
    // Resume with a new anchor after dropped tracking, a recenter/teleport or
    // an implausible pose jump. Never turn a discontinuity into gained travel.
    if (dt <= 0 || dt > 0.25 || rawSpeed > 8) {
      this.speed = 0;
      this.gain = 1;
      return neutral();
    }
    // Frame-rate-independent 120 ms smoothing limits gait/head jitter without
    // making the visual rig coast: only the actual measured delta is amplified.
    this.speed += (rawSpeed - this.speed) * (1 - Math.exp(-dt / 0.12));
    // Drop to 1x immediately for genuinely slow steps, even while the smoothed
    // speed is settling after a sprint. The ramp upwards still uses smoothing.
    this.gain = gainAtSpeed(Math.min(rawSpeed, this.speed), this.settings);
    return { extraX: dx * (this.gain - 1), extraZ: dz * (this.gain - 1), speed: this.speed, gain: this.gain };
  }
}
