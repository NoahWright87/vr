import { ramp, rotateXZ } from './redirection.js';

export const DEFAULT_MOTION_SETTINGS = {
  armEnabled: false, maxArmGain: 3, armSpeed: 1.5, armStroke: .12, speedLines: true,
  slideEnabled: false, slideBoost: 3, slideLossMode: 'percent', slideFlatLoss: .5, slidePercentLoss: .5,
  jumpEnabled: false, jumpBoost: 1.5, jumpVerticalGain: 3, jumpRise: .08, jumpPercentLoss: .3,
};
export function sanitizeMotionSettings(settings = {}) {
  const s = { ...DEFAULT_MOTION_SETTINGS, ...settings }, output = {};
  for (const key of ['armEnabled', 'slideEnabled', 'jumpEnabled', 'speedLines']) output[key] = s[key] === true || s[key] === 'true';
  for (const [key, min, max] of [['maxArmGain', 1, 8], ['armSpeed', .3, 3], ['armStroke', .04, .4],
    ['slideBoost', .25, 10], ['slideFlatLoss', 0, 4], ['slidePercentLoss', 0, .95],
    ['jumpBoost', .25, 10], ['jumpVerticalGain', 1, 10], ['jumpRise', .03, .3], ['jumpPercentLoss', 0, .95]]) {
    const v = Number(s[key]); output[key] = Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : DEFAULT_MOTION_SETTINGS[key];
  }
  output.slideLossMode = s.slideLossMode === 'flat' ? 'flat' : 'percent';
  return output;
}

// Exact distance integral for either drag model; independent of headset Hz.
export function coast(speed, dt, mode, loss) {
  if (speed <= 0) return { speed: 0, distance: 0 };
  if (dt <= 0) return { speed, distance: 0 };
  if (loss === 0) return { speed, distance: speed * dt };
  if (mode === 'flat') {
    const duration = Math.min(dt, speed / loss);
    return { speed: Math.max(0, speed - loss * dt), distance: speed * duration - .5 * loss * duration * duration };
  }
  const rate = -Math.log(1 - loss), next = speed * Math.exp(-rate * dt);
  return { speed: next, distance: (speed - next) / rate };
}

export class MotionEffectsTracker {
  constructor(settings) { this.settings = sanitizeMotionSettings(settings); this.standingHeight = null; this.reset(); }
  setSettings(settings) { this.settings = sanitizeMotionSettings({ ...this.settings, ...settings }); }
  calibrate(height) {
    if (!Number.isFinite(height) || height < .5 || height > 2.5) return false;
    this.standingHeight = height; this.reset(); return true;
  }
  reset() {
    this.previous = null; this.hands = null; this.handHistory = []; this.impulses = [];
    this.armActivity = 0; this.armGain = 1; this.armTracked = false;
    this.slide = null; this.jump = null; this.wasCrouched = false; this.wasAirborne = false;
    this.verticalJump = false; this.jumpLift = 0;
    this.crouchDepth = 0; this.speed = 0;
  }

  clipMomentum(normals) {
    const project = velocity => {
      for (const normal of normals) {
        const into = velocity.x * normal.x + velocity.z * normal.z;
        if (into < 0) { velocity.x -= into * normal.x; velocity.z -= into * normal.z; }
      }
      return Math.hypot(velocity.x, velocity.z);
    };
    for (const motion of [this.slide, this.jump]) {
      if (!motion) continue;
      const old = motion.speed, velocity = { x: motion.x * old, z: motion.z * old }, speed = project(velocity);
      motion.x = speed > 1e-8 ? velocity.x / speed : 0; motion.z = speed > 1e-8 ? velocity.z / speed : 0;
      motion.speed = speed; motion.seedSpeed *= old > 1e-8 ? speed / old : 0;
    }
    // Do not relaunch a crouch from the velocity that the wall just removed.
    this.impulses = this.impulses.filter(impulse => (impulse.speed = project(impulse)) > .001);
  }

  sampleArms(head, hands, direction, speed, dt, time) {
    this.armTracked = Boolean(hands?.left && hands?.right && [hands.left.x, hands.left.z, hands.right.x, hands.right.z].every(Number.isFinite));
    if (!this.armTracked || !this.settings.armEnabled || speed <= .3) {
      this.hands = null; this.handHistory = []; this.armActivity = 0; this.armGain = 1; return;
    }
    const relative = Object.fromEntries(['left', 'right'].map(side => [side, { x: hands[side].x - head.x, z: hands[side].z - head.z }]));
    const old = this.hands; this.hands = relative;
    this.handHistory.push({ ...relative, time });
    this.handHistory = this.handHistory.filter(p => time - p.time <= 800);
    if (!old) return;
    const velocity = side => ((relative[side].x - old[side].x) * direction.x + (relative[side].z - old[side].z) * direction.z) / dt;
    const left = velocity('left'), right = velocity('right');
    const stroke = side => {
      const positions = this.handHistory.map(p => p[side].x * direction.x + p[side].z * direction.z);
      return Math.max(...positions) - Math.min(...positions);
    };
    // Require substantial strokes from both arms. Head translation is removed;
    // a missing hand, one-arm gesture or tiny shake cannot boost.
    const amplitude = Math.min(stroke('left'), stroke('right'));
    const activity = Math.max(Math.abs(left), Math.abs(right)) < 7 ?
      Math.min(Math.abs(left), Math.abs(right)) * ramp(amplitude, this.settings.armStroke / 2, this.settings.armStroke) : 0;
    this.armActivity += (activity - this.armActivity) * (1 - Math.exp(-dt / .1));
    this.armGain = 1 + (this.settings.maxArmGain - 1) * ramp(this.armActivity, .1, this.settings.armSpeed);
  }

  sample(position, time, { hands = null, baseGain = 1, yaw = 0, paused = false } = {}) {
    const neutral = () => ({ extraX: 0, extraZ: 0, worldX: 0, worldZ: 0, heightOffset: 0,
      armGain: 1, effectiveGain: baseGain, momentumSpeed: 0 });
    if (![position.x, position.y, position.z, time].every(Number.isFinite)) { this.reset(); return neutral(); }
    if (this.standingHeight === null && position.y >= .5) this.standingHeight = position.y;
    const old = this.previous; this.previous = { ...position, time };
    if (!old) return neutral();
    const dt = (time - old.time) / 1000, dx = position.x - old.x, dz = position.z - old.z;
    const speed = Math.hypot(dx, dz) / dt, dy = (position.y - old.y) / dt;
    if (dt <= 0 || dt > .25 || speed > 8) {
      const anchor = this.previous; this.reset(); this.previous = anchor; return neutral();
    }
    if (Math.abs(dy) > 6) {
      const anchor = this.previous; this.reset(); this.previous = anchor;
      return { ...neutral(), extraX: dx * (baseGain - 1), extraZ: dz * (baseGain - 1) };
    }
    if (paused) {
      this.slide = null; this.jump = null; this.impulses = []; this.hands = null;
      this.verticalJump = false; this.jumpLift = 0;
      this.handHistory = []; this.armActivity = 0; this.armGain = 1;
      this.wasCrouched = true; this.wasAirborne = true;
      return { ...neutral(), extraX: dx * (baseGain - 1), extraZ: dz * (baseGain - 1) };
    }
    this.sampleArms(position, hands, speed ? { x: dx / (speed * dt), z: dz / (speed * dt) } : { x: 0, z: -1 }, speed, dt, time);
    const gain = baseGain * this.armGain;
    // Remember recent *virtual* velocity, including both walking multipliers.
    const velocity = rotateXZ({ x: dx / dt * gain, z: dz / dt * gain }, yaw);
    this.impulses = this.impulses.filter(p => time - p.time < 600);
    if (speed >= .8) this.impulses.push({ ...velocity, time, speed: Math.hypot(velocity.x, velocity.z) });
    const impulse = this.impulses.reduce((best, p) => !best || p.speed > best.speed ? p : best, null);
    const height = this.standingHeight || position.y;
    this.crouchDepth = Math.max(0, (height - position.y) / height);
    const crouched = this.crouchDepth > .08;
    const airborne = position.y > height + this.settings.jumpRise;
    const depth = Math.max(0, Math.min(1, (this.crouchDepth - .08) / .77));
    const launch = (seed, factor, mode) => ({ x: seed.x / seed.speed, z: seed.z / seed.speed,
      speed: seed.speed * factor, seedSpeed: seed.speed, depth: mode === 'slide' ? depth : 1, started: time });
    if (!this.settings.slideEnabled || !crouched) this.slide = null;
    else if (!this.wasCrouched && dy < -.15 && impulse) this.slide = launch(impulse, this.settings.slideBoost * depth, 'slide');
    if (this.slide && time - this.slide.started < 1200 && depth > this.slide.depth) {
      this.slide.speed += this.slide.seedSpeed * this.settings.slideBoost * (depth - this.slide.depth);
      this.slide.depth = depth;
    }
    if (!this.settings.jumpEnabled || !airborne || (this.jump && time - this.jump.started > 1500)) this.jump = null;
    else if (!this.wasAirborne && dy > .15 && impulse) this.jump = launch(impulse, this.settings.jumpBoost, 'jump');
    // Height gain needs a real upward threshold crossing, but no horizontal
    // impulse. Amplify only excess rise, easing the first 4 cm so crossing
    // the activation threshold cannot produce an instantaneous height step.
    if (!this.settings.jumpEnabled || !airborne) this.verticalJump = false;
    else if (!this.wasAirborne && dy > .15) this.verticalJump = true;
    const excessRise = Math.max(0, position.y - height - this.settings.jumpRise);
    this.jumpLift = this.verticalJump ? (this.settings.jumpVerticalGain - 1) * excessRise * ramp(excessRise, 0, .04) : 0;
    this.wasCrouched = crouched; this.wasAirborne = airborne;
    let worldX = 0, worldZ = 0, momentumSpeed = 0;
    for (const [name, motion] of [['slide', this.slide], ['jump', this.jump]]) {
      if (!motion) continue;
      const mode = name === 'slide' ? this.settings.slideLossMode : 'percent';
      const loss = name === 'slide' ? (mode === 'flat' ? this.settings.slideFlatLoss : this.settings.slidePercentLoss) : this.settings.jumpPercentLoss;
      const result = coast(motion.speed, dt, mode, loss);
      motion.speed = result.speed;
      // A shallow entry can begin near zero; retain its seed while the duck
      // deepens, otherwise the early threshold would swallow a deep slide.
      if (motion.speed < .05 && (name === 'jump' || time - motion.started >= 1200)) this[name] = null;
      worldX += motion.x * result.distance; worldZ += motion.z * result.distance;
      momentumSpeed += motion.speed;
    }
    this.speed = speed;
    return { extraX: dx * (gain - 1), extraZ: dz * (gain - 1), worldX, worldZ,
      heightOffset: this.jumpLift, armGain: this.armGain, effectiveGain: gain, momentumSpeed };
  }
}
