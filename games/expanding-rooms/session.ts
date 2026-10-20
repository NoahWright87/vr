import { ExpandedWalker, expandBoundary } from './walking.ts';
import { containsPoint } from '../../common/floor-overlap.js';

const THREE = AFRAME.THREE;
export class ExpandedSession {
  game: any;
  scale = 1.25;
  activeScale = 1.25;
  paused = false;
  walker: ExpandedWalker | null = null;
  physical: any[] = [];
  gain = { maxGain: 1.2, speedForMax: 2 };
  steering = { steeringEnabled: true, turnEnabled: true, maxCurvature: 5, steeringSpeed: 2,
    maxSteeringRate: 6, lookAhead: 1.5, wallMargin: .4, minTurnGain: .9,
    maxTurnGain: 200 / 180, turnSpeed: 180, alignmentStrength: 1 };
  inverse = new THREE.Matrix4();
  direction = new THREE.Vector3();
  rotation = new THREE.Matrix4();
  quaternion = new THREE.Quaternion();
  constructor(game: any) { this.game = game; }
  menuOpen() {
    return [...this.game.scene.querySelectorAll('[crossbar-menu]')].some((el: any) => el.components['crossbar-menu']?.menu.isOpen);
  }
  points(points: any[]) {
    if(this.game.xr && !containsPoint({ x:this.game.boundary.position.x,z:this.game.boundary.position.y },points.map(p=>({x:p.x,z:p.y})))) {
      throw new Error('Step inside your physical boundary before generating.');
    }
    this.physical = points.map(p => ({ ...p }));
    this.activeScale = this.scale;
    return expandBoundary(points, this.activeScale);
  }
  start() {
    const g = this.game, o = g.footprint.origin;
    this.walker = new ExpandedWalker(g.level, this.physical.map(p => ({ x: p.x - o.x, y: p.y - o.y })));
    this.sync();
  }
  sync() { this.walker?.gain.setSettings(this.gain); this.walker?.redirection.setSettings(this.steering); }
  applyFrame(frame: any, target: any) {
    const g = this.game, w = this.walker!;
    if(frame.orientation) {
      const q=frame.orientation;
      this.quaternion.set(q.x,q.y,q.z,q.w);
      this.direction.set(0,0,-1).applyQuaternion(this.quaternion);
    } else {
      // Fallback for desktop/synthetic boundary frames; XR supplies orientation
      // in the same bounded-floor space as position, independent of tick order.
      g.camera.object3D.getWorldDirection(this.direction);
      this.direction.negate().transformDirection(this.inverse.copy(g.transform).invert());
    }
    const yaw = Math.atan2(-this.direction.x, -this.direction.z);
    const result = w.sample(target, yaw, performance.now(), g.state, this.paused || this.menuOpen(), g.ride.phase !== 'idle');
    // Keep headset, hands, menus and physical boundary in tracked coordinates.
    // Move the virtual world by the inverse locomotion mapping instead.
    this.rotation.makeRotationY(w.transform.yaw);
    this.rotation.setPosition(w.transform.x, 0, w.transform.z);
    g.world.object3D.matrix.multiply(this.rotation.invert());
    g.world.object3D.matrixWorldNeedsUpdate = true;
    return result.valid && !result.outside;
  }
  recover() {
    const g = this.game;
    if (!g.xr || !g.tracking || !this.walker || !g.boundary || g.measuring() || g.ride.phase !== 'idle') {
      g.status('Recovery unavailable', 'Finish calibration or the elevator ride, and wait for tracking.'); return;
    }
    const o = g.footprint.origin, raw = { x: g.boundary.position.x - o.x, y: g.boundary.position.y - o.y };
    if (!this.walker.reanchor(raw, g.state)) { g.status('Step inside your physical boundary', 'Return to a clear spot in your traced area before re-anchoring.'); return; }
    g.onBoundaryFrame(g.boundary); g.showRoomStatus();
  }
  describe() {
    const w = this.walker;
    if (!w) return `Next world: ${this.scale.toFixed(2)}x width/depth. Save a boundary, then Generate.`;
    const s = w.stats, guide = w.redirection.guidance;
    return [this.game.xr ? 'Tracked walking' : 'Desktop: geometry preview only',
      `World ${this.activeScale.toFixed(2)}x / next ${this.scale.toFixed(2)}x`,
      `Physical ${s.physicalMetres.toFixed(1)} m / virtual ${s.virtualMetres.toFixed(1)} m`,
      `Gain ${w.gain.gain.toFixed(2)}x / turn ${w.redirection.turnGain.toFixed(2)}x`,
      `Steering ${w.redirection.steeringRate.toFixed(1)} deg/s`,
      `Floor overlap ${guide?.overlap == null ? '—' : Math.round(guide.overlap * 100) + '%'}`,
      `Boundary exits ${s.boundaryExits} / wall blocks ${s.wallBlocks}`,
      `Rejected gain ${s.rejectedGain} / recoveries ${s.recoveries}`,
      this.paused ? 'Movement effects paused' : 'Effects pause while a menu is open'].join('\n');
  }
  exportReport() {
    const g = this.game;
    const report = { version: 1, activity: 'expanding-rooms', physicalBoundary: this.physical,
      activeScale: this.activeScale, nextScale: this.scale, gain: this.gain, steering: this.steering,
      level: g.level, state: g.state, stats: this.walker?.stats, mapping: this.walker?.transform };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `expanding-rooms-${g.level?.params.seed ?? 'setup'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    g.status('Debug report downloaded', 'Boundary, seed, generated level, settings and counters.');
  }
}
