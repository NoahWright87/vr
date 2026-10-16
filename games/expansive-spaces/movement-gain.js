import { SpeedGainTracker, DEFAULT_GAIN_SETTINGS } from './speed-gain.js';
import { RedirectionTracker, LocomotionTransform, rotateXZ } from './redirection.js';
import { MotionEffectsTracker } from './motion-effects.js';
import { prepareFloor, sameFloorTransform } from '../../common/floor-overlap.js';
import { mappedHead } from './overlap-planner.js';

const THREE = AFRAME.THREE;
const STORAGE_KEY = 'vr-expansive-speed-gain-v1';
const REDIRECTION_KEY = 'vr-expansive-redirection-v1';
const MOTION_KEY = 'vr-expansive-motion-effects-v1';
const GAIN_OPTIONS = { 'space-max-gain': 'maxGain', 'space-gain-speed': 'speedForMax' };
const REDIRECTION_OPTIONS = {
  'space-steering-enabled': 'steeringEnabled',
  'space-curvature': 'maxCurvature', 'space-steering-speed': 'steeringSpeed',
  'space-steering-rate': 'maxSteeringRate', 'space-turn-enabled': 'turnEnabled',
  'space-wall-lookahead': 'lookAhead', 'space-wall-margin': 'wallMargin',
  'space-turn-gain': 'maxTurnGain', 'space-turn-min-gain': 'minTurnGain',
  'space-turn-speed': 'turnSpeed', 'space-alignment': 'alignmentStrength',
};
const MOTION_OPTIONS = {
  'space-arm-enabled': 'armEnabled', 'space-arm-gain': 'maxArmGain', 'space-arm-speed': 'armSpeed',
  'space-arm-stroke': 'armStroke', 'space-speed-lines': 'speedLines',
  'space-slide-enabled': 'slideEnabled', 'space-slide-boost': 'slideBoost', 'space-slide-loss-mode': 'slideLossMode',
  'space-slide-flat-loss': 'slideFlatLoss', 'space-slide-percent-loss': 'slidePercentLoss',
  'space-jump-enabled': 'jumpEnabled', 'space-jump-boost': 'jumpBoost', 'space-jump-rise': 'jumpRise',
  'space-jump-loss': 'jumpPercentLoss', 'space-jump-height': 'jumpVerticalGain',
};

AFRAME.registerComponent('speed-dependent-gain', {
  init: function () {
    let settings = DEFAULT_GAIN_SETTINGS;
    try { settings = JSON.parse(localStorage.getItem(STORAGE_KEY)) || settings; } catch (_) {}
    this.tracker = new SpeedGainTracker(settings);
    let redirectionSettings;
    try { redirectionSettings = JSON.parse(localStorage.getItem(REDIRECTION_KEY)); } catch (_) {}
    this.redirection = new RedirectionTracker(redirectionSettings || undefined);
    let motionSettings;
    try { motionSettings = JSON.parse(localStorage.getItem(MOTION_KEY)); } catch (_) {}
    this.motion = new MotionEffectsTracker(motionSettings || undefined);
    this.lastMotion = { effectiveGain: 1, momentumSpeed: 0 };
    this.armHands = null;
    this.handMatrix = new THREE.Matrix4();
    this.transform = new LocomotionTransform();
    this.extraTranslation = new THREE.Vector3();
    this.rawPosition = new THREE.Vector3();
    this.step = new THREE.Vector3();
    this.viewerMatrix = new THREE.Matrix4();
    this.direction = new THREE.Vector3();
    this.inverseYaw = new THREE.Quaternion();
    this.up = new THREE.Vector3(0, 1, 0);
    this.guidanceMatrix = new THREE.Matrix4();
    this.guidancePoint = new THREE.Vector3();
    this.guidanceBoundary = null;
    this.extraYaw = 0;
    this.travelEpoch = 0;
    this.hasPose = false;
    this.session = null;
    this.baseSpace = null;
    this.frameHandle = null;
    this.lastUI = -Infinity;
    this.settingsDirty = true;
    this.onEnter = this.start.bind(this);
    this.onExit = this.stop.bind(this);
    this.onReferenceReset = function () {
      this.resetEstimators();
      this.motion.standingHeight = null;
      this.el.sceneEl.emit('space-travel-reset', {}, false);
    }.bind(this);
    this.onWatchReady = function (evt) {
      this.settingsDirty = true;
      const panel = evt.detail.panelEl;
      if (panel.hasLoaded) this.renderSettings();
      else panel.addEventListener('loaded', this.renderSettings.bind(this), { once: true });
    }.bind(this);
    this.onOption = function (evt) {
      const property = GAIN_OPTIONS[evt.detail.key];
      const redirectProperty = REDIRECTION_OPTIONS[evt.detail.key];
      const motionProperty = MOTION_OPTIONS[evt.detail.key];
      if (!property && !redirectProperty && !motionProperty) return;
      if (property) {
        this.tracker.setSettings({ [property]: evt.detail.value });
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.tracker.settings)); } catch (_) {}
      } else if (redirectProperty) {
        this.redirection.setSettings({ [redirectProperty]: evt.detail.value });
        try { localStorage.setItem(REDIRECTION_KEY, JSON.stringify(this.redirection.settings)); } catch (_) {}
      } else {
        this.motion.setSettings({ [motionProperty]: evt.detail.value });
        if (motionProperty === 'jumpEnabled' && !this.motion.settings.jumpEnabled) this.clearVerticalGain();
        try { localStorage.setItem(MOTION_KEY, JSON.stringify(this.motion.settings)); } catch (_) {}
      }
      this.renderSettings();
    }.bind(this);
    this.onSelection = function (evt) {
      if (['space-reset-travel', 'space-reset-effects'].includes(evt.detail.value)) this.resetTravel();
      if (evt.detail.value === 'space-calibrate-height' && this.hasPose) {
        this.motion.calibrate(this.rawPosition.y); this.clearVerticalGain();
      }
    }.bind(this);
    const scene = this.el.sceneEl;
    scene.addEventListener('enter-vr', this.onEnter);
    scene.addEventListener('exit-vr', this.onExit);
    scene.addEventListener('watch-menu-ready', this.onWatchReady);
    scene.addEventListener('menu-option-change', this.onOption);
    scene.addEventListener('menu-item-select', this.onSelection);
    const camera = this.el.querySelector('a-camera');
    if (camera) camera.setAttribute('gain-speed-lines', '');
  },

  renderSettings: function () {
    let synchronized = 0;
    this.el.sceneEl.querySelectorAll('[menu-option]').forEach(el => {
      const row = el.components['menu-option'];
      if (!row) return;
      const property = GAIN_OPTIONS[row.data.key] || REDIRECTION_OPTIONS[row.data.key] || MOTION_OPTIONS[row.data.key];
      if (property) {
        row.setValue(GAIN_OPTIONS[row.data.key] ? this.tracker.settings[property] :
          REDIRECTION_OPTIONS[row.data.key] ? this.redirection.settings[property] : this.motion.settings[property]);
        row.valueTextEl.setAttribute('width', MOTION_OPTIONS[row.data.key] ? 1.2 : 1.4);
        synchronized++;
      }
    });
    // A-Frame can initialize the two watches before this rig component, or
    // finish a projected panel after watch-menu-ready. Retry until both rows
    // on both wrists exist, so saved settings cannot leave stale UI defaults.
    this.settingsDirty = synchronized < 2 * (Object.keys(GAIN_OPTIONS).length + Object.keys(REDIRECTION_OPTIONS).length + Object.keys(MOTION_OPTIONS).length);
    this.renderTelemetry();
  },

  renderTelemetry: function () {
    const text = this.tracker.speed.toFixed(2) + ' m/s  ->  ' + this.tracker.gain.toFixed(2) + 'x';
    this.el.sceneEl.querySelectorAll('.space-gain-live').forEach(el => el.setAttribute('text', 'value', text));
    const s = this.redirection.settings;
    const paused = this.watchOpen();
    const guide = this.redirection.guidance;
    const wall = guide?.wallDistance == null ? 'No boundary' : 'Wall ahead ' + guide.wallDistance.toFixed(1) + ' m';
    const overlap = guide?.overlap == null ? 'Waiting for area' : 'Overlap ' + (guide.overlap * 100).toFixed(1) +
      '% -> ' + (guide.bestOverlap * 100).toFixed(1) + '%';
    const steering = !s.steeringEnabled ? 'OFF' : paused ? 'PAUSED - watch open' :
      !guide?.valid ? guide?.reason || 'Waiting for boundary tracking' :
      overlap + '\n' + this.redirection.steeringRate.toFixed(1) + ' deg/s | ' + wall;
    const turn = !s.turnEnabled ? 'OFF' : paused ? 'PAUSED - watch open' :
      !guide?.valid ? guide?.reason || 'Waiting for boundary tracking' :
      overlap + '\n' + this.redirection.turnGain.toFixed(2) + 'x | Area: ' + guide.areaId + '\n' + guide.reason;
    this.el.sceneEl.querySelectorAll('.space-steering-live').forEach(el => el.setAttribute('text', 'value', steering));
    this.el.sceneEl.querySelectorAll('.space-turn-live').forEach(el => el.setAttribute('text', 'value', turn));
    for (const [selector, label, enabled] of [['.space-steering-link', 'Walking steering', s.steeringEnabled], ['.space-turn-link', 'Turn gain', s.turnEnabled]]) {
      this.el.sceneEl.querySelectorAll(selector).forEach(el => el.setAttribute('text', 'value', label + (enabled ? ': ON >' : ': OFF >')));
    }
    const m = this.motion, settings = m.settings;
    const armText = !settings.armEnabled ? 'OFF' : paused ? 'PAUSED - watch open' : !m.armTracked ? 'Requires two tracked XR controllers' :
      m.armActivity.toFixed(2) + ' m/s | arms ' + m.armGain.toFixed(2) + 'x\nCombined ' + this.lastMotion.effectiveGain.toFixed(2) + 'x';
    const slideText = !settings.slideEnabled ? 'OFF' : paused ? 'PAUSED - watch open' :
      'Duck ' + (m.crouchDepth * 100).toFixed(0) + '% | ' + (m.slide?.speed || 0).toFixed(2) + ' m/s';
    const jumpText = !settings.jumpEnabled ? 'OFF' : paused ? 'PAUSED - watch open' :
      'Forward ' + (m.jump?.speed || 0).toFixed(2) + ' m/s | Lift ' + m.jumpLift.toFixed(2) + ' m\nStand ' + (m.standingHeight || 0).toFixed(2) + ' m';
    for (const [selector, text] of [['.space-arm-live', armText], ['.space-slide-live', slideText], ['.space-jump-live', jumpText]])
      this.el.sceneEl.querySelectorAll(selector).forEach(el => el.setAttribute('text', 'value', text));
    for (const [selector, label, enabled] of [['.space-arm-link', 'Arm swing', settings.armEnabled], ['.space-slide-link', 'Sliding', settings.slideEnabled], ['.space-jump-link', 'Jumping', settings.jumpEnabled]])
      this.el.sceneEl.querySelectorAll(selector).forEach(el => el.setAttribute('text', 'value', label + (enabled ? ': ON >' : ': OFF >')));
  },

  resetEstimators: function () {
    this.clearVerticalGain();
    this.tracker.reset();
    this.redirection.reset();
    this.motion.reset();
    this.lastMotion = { effectiveGain: 1, momentumSpeed: 0 };
    this.travelEpoch++;
    this.hasPose = false;
  },

  clearVerticalGain: function () {
    this.el.object3D.position.y -= this.extraTranslation.y;
    this.extraTranslation.y = 0;
  },

  watchOpen: function () {
    return [...this.el.sceneEl.querySelectorAll('.watch-menu-panel')].some(el => el.object3D.visible);
  },

  redirectionContext: function (position = this.rawPosition, motion = null) {
    const roomEl = document.querySelector('#space-room');
    const room = roomEl && roomEl.components['expansive-space'];
    if (!room?.bounds || !room.virtualBounds || (this.session && !room.detected)) return null;
    roomEl.object3D.updateWorldMatrix(true, false);
    const matrix = roomEl.object3D.matrixWorld;
    if (room.points !== this.guidancePoints || !sameFloorTransform(this.guidanceMatrix, matrix)) {
      this.guidancePoints = room.points; this.guidanceMatrix.copy(matrix);
      this.guidanceBoundary = room.points.map(point => {
        this.guidancePoint.set(point.x, 0, point.z).applyMatrix4(matrix);
        return { x: this.guidancePoint.x, z: this.guidancePoint.z };
      });
      this.guidanceFloor = prepareFloor(this.guidanceBoundary);
    }
    // Score after this frame's gained translation, before injecting yaw.
    // This matches LocomotionTransform.apply, including slide/jump carry.
    const extra = rotateXZ({ x: motion?.extraX || 0, z: motion?.extraZ || 0 }, this.extraYaw);
    const mapping = { yaw: this.extraYaw, x: this.transform.x + extra.x + (motion?.worldX || 0),
      z: this.transform.z + extra.z + (motion?.worldZ || 0) };
    const area = this.el.sceneEl.systems['navigation-areas']?.getActiveArea(mappedHead(position, mapping));
    return { boundary: this.guidanceBoundary, physicalFloor: this.guidanceFloor, area, mapping };
  },

  resetTravel: function () {
    // Explicitly undo our pose transform. Settings never do this automatically:
    // that would snap the viewpoint while using the watch.
    this.el.object3D.position.sub(this.extraTranslation);
    this.extraTranslation.set(0, 0, 0);
    this.el.object3D.rotation.y -= this.extraYaw;
    this.extraYaw = 0;
    this.transform.reset();
    this.resetEstimators();
    this.el.sceneEl.emit('space-travel-reset', {}, false);
    this.renderTelemetry();
  },

  applySample: function (position, time, yaw = null) {
    if (![position.x, position.z, time].every(Number.isFinite)) {
      this.resetEstimators();
      return { extraX: 0, extraZ: 0, speed: 0, gain: 1 };
    }
    const previous = this.tracker.previous;
    if (previous) {
      const dt = (time - previous.timeMs) / 1000;
      const speed = Math.hypot(position.x - previous.x, position.z - previous.z) / dt;
      if (dt <= 0 || dt > .25 || speed > 8) this.travelEpoch++;
    }
    const result = this.tracker.sample(position, time);
    const paused = this.watchOpen() || Boolean(document.querySelector('#space-binoculars')?.components['space-binoculars']?.active);
    const motion = this.motion.sample(position, time, { hands: this.armHands, baseGain: result.gain,
      yaw: this.extraYaw, paused });
    this.lastMotion = motion;
    const redirect = this.redirection.sample(position, yaw, time,
      { context: this.redirection.settings.steeringEnabled || this.redirection.settings.turnEnabled ? this.redirectionContext(position, motion) : null, paused });
    this.transform.apply(position, motion.extraX, motion.extraZ, redirect.yawDelta);
    this.transform.x += motion.worldX; this.transform.z += motion.worldZ;
    this.step.set(this.transform.x, motion.heightOffset, this.transform.z).sub(this.extraTranslation);
    this.el.object3D.position.add(this.step);
    this.el.object3D.rotation.y += redirect.yawDelta;
    this.extraTranslation.set(this.transform.x, motion.heightOffset, this.transform.z);
    this.extraYaw = this.transform.yaw;
    this.hasPose = true;
    return result;
  },

  physicalPosition: function (world, out) {
    const physical = this.transform.physicalPoint(world);
    return out.set(physical.x, world.y - this.extraTranslation.y, physical.z);
  },

  physicalDirection: function (worldDirection) {
    this.inverseYaw.setFromAxisAngle(this.up, -this.extraYaw);
    return worldDirection.applyQuaternion(this.inverseYaw);
  },

  sampledYaw: function () {
    return Math.hypot(this.direction.x, this.direction.z) > .15 ? Math.atan2(-this.direction.x, -this.direction.z) : null;
  },

  start: function () {
    const xr = this.el.sceneEl.renderer && this.el.sceneEl.renderer.xr;
    const session = xr && xr.getSession();
    if (!session || session === this.session) return;
    this.releaseSession();
    this.resetTravel();
    this.session = session;
    this.motion.standingHeight = null;
    const onFrame = (time, frame) => {
      if (this.session !== session) return;
      this.updateFromFrame(frame, time);
      this.frameHandle = session.requestAnimationFrame(onFrame);
    };
    this.frameHandle = session.requestAnimationFrame(onFrame);
  },

  updateFromFrame: function (frame, time) {
    const baseSpace = this.el.sceneEl.renderer.xr.getReferenceSpace();
    if (baseSpace !== this.baseSpace) {
      if (this.baseSpace) this.baseSpace.removeEventListener('reset', this.onReferenceReset);
      this.baseSpace = baseSpace;
      if (baseSpace) baseSpace.addEventListener('reset', this.onReferenceReset);
      this.resetEstimators();
      this.motion.standingHeight = null;
    }
    const viewer = baseSpace && frame.getViewerPose(baseSpace);
    if (!viewer) {
      this.resetEstimators();
      return;
    }
    this.viewerMatrix.fromArray(viewer.transform.matrix);
    this.rawPosition.setFromMatrixPosition(this.viewerMatrix);
    // Raw XR reference-space pose excludes the accumulated rig correction.
    this.direction.set(0, 0, -1).transformDirection(this.viewerMatrix);
    this.armHands = null;
    if (this.motion.settings.armEnabled) {
      const hands = {};
      for (const source of this.session?.inputSources || []) {
        if (!source.gripSpace || !['left', 'right'].includes(source.handedness)) continue;
        const pose = frame.getPose(source.gripSpace, baseSpace);
        if (!pose) continue;
        this.handMatrix.fromArray(pose.transform.matrix);
        const hand = new THREE.Vector3().setFromMatrixPosition(this.handMatrix);
        hands[source.handedness] = { x: hand.x, z: hand.z };
      }
      this.armHands = hands;
    }
    this.applySample(this.rawPosition, time, this.sampledYaw());
  },

  releaseSession: function () {
    if (this.baseSpace) this.baseSpace.removeEventListener('reset', this.onReferenceReset);
    if (this.session && this.frameHandle !== null) this.session.cancelAnimationFrame(this.frameHandle);
    this.baseSpace = null;
    this.session = null;
    this.frameHandle = null;
    this.resetEstimators();
  },

  stop: function () {
    this.releaseSession();
    this.resetTravel();
  },

  tick: function (time) {
    if (this.settingsDirty) this.renderSettings();
    const xr = this.el.sceneEl.renderer && this.el.sceneEl.renderer.xr;
    const session = xr && xr.getSession();
    if (session && session !== this.session) this.start();
    if (!session && this.session) this.stop();
    if (!session) {
      this.armHands = null;
      const camera = this.el.querySelector('a-camera');
      if (camera) {
        // Desktop WASD/touch/gamepad simulates physical travel for inspection.
        // Invert our correction so it cannot amplify itself next frame.
        camera.object3D.getWorldPosition(this.rawPosition);
        this.physicalPosition(this.rawPosition, this.rawPosition);
        camera.object3D.getWorldDirection(this.direction).negate();
        this.physicalDirection(this.direction);
        this.applySample(this.rawPosition, time, this.sampledYaw());
      }
    }
    if (time - this.lastUI >= 100) {
      this.lastUI = time;
      this.renderTelemetry();
    }
  },

  remove: function () {
    this.stop();
    const scene = this.el.sceneEl;
    scene.removeEventListener('enter-vr', this.onEnter);
    scene.removeEventListener('exit-vr', this.onExit);
    scene.removeEventListener('watch-menu-ready', this.onWatchReady);
    scene.removeEventListener('menu-option-change', this.onOption);
    scene.removeEventListener('menu-item-select', this.onSelection);
  },
});

AFRAME.registerComponent('gain-speed-lines', {
  init: function () {
    this.positions = new Float32Array(32 * 6);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.LineBasicMaterial({ color: '#c6f6ff', transparent: true, opacity: 0, depthTest: false });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false; this.lines.renderOrder = 10;
    this.el.setObject3D('gain-speed-lines', this.lines);
  },
  tick: function (time) {
    const gain = this.el.parentEl.components['speed-dependent-gain'];
    const boost = gain?.lastMotion.armGain > 1.02 ? gain.lastMotion.effectiveGain - 1 : 0;
    const intensity = gain ? Math.min(1, boost / 3 + gain.lastMotion.momentumSpeed / 12) : 0;
    this.lines.visible = Boolean(gain?.hasPose && gain.motion.settings.speedLines && intensity > .03 && !gain.watchOpen());
    if (!this.lines.visible) return;
    this.material.opacity = intensity * .5;
    for (let i = 0; i < 32; i++) {
      const angle = i * Math.PI * 2 / 32, z = -.45 - ((i * .137 + time * .001 * (1 + intensity * 2)) % 1) * 1.5;
      const x = Math.cos(angle) * .7, y = Math.sin(angle) * .5, j = i * 6;
      this.positions.set([x, y, z, x * .9, y * .9, z + .15 + intensity * .2], j);
    }
    this.geometry.attributes.position.needsUpdate = true;
  },
  remove: function () { this.geometry.dispose(); this.material.dispose(); this.el.removeObject3D('gain-speed-lines'); },
});
