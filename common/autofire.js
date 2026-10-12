// ============================================================
// AUTOFIRE — hold a hand out toward enemies and the gun in it kills them.
//
// No trigger, no precise aim (docs/actions/autofire.todo.md). The loop,
// every frame, per gun hand:
//
//   sense    is the hand presented (held out)? motion-sense says so,
//            from position alone. A lowered hand is the off switch.
//   resolve  combat-targeting picks a target along the shoulder→hand
//            line, inside the cone the Aim setting allows.
//   sell     the gun turns toward it (only so far — the arm still
//            matters), and fires at the weapon's rate. Shots are
//            guaranteed: the bullet goes to the target's zone; spread
//            only jitters the tracer.
//
// The gun is not parented to the controller: it sits at the hand and
// points along the shoulder→hand line, turned toward its target. So the
// wrist's rotation never matters, and controllers, hand tracking and
// desktop hands all aim it the same way.
//
//   <a-entity autofire-gun="side: right; rig: #rig; hand: #right-hand"></a-entity>
//
// Gun settings (Tuning > Gun) are shared by every gun on the page.
// The pure parts are in common/autofire-core.js.
// ============================================================

import './motion-sense.js';
import './combat-targeting.js';
import './action-clock.js';
import './action-effects.js';
import { haptic, sound } from './action-feedback.js';
import { defineTunables } from './tunables.js';
import { registerReadout, logAction } from './debug-hud.js';
import { zoneSurfaceToward } from './collide.js';

import { angleBetween, turnToward, shotsDue, AIM_CONES } from './autofire-core.js';

// ---------- the component ----------

var THREE = AFRAME.THREE;
var DEG = Math.PI / 180;

var tune = defineTunables('gun', 'Gun', [
  { key: 'hands', label: 'Hands', kind: 'select', value: 'both', options: [
    { value: 'both', label: 'Both' }, { value: 'right', label: 'Right' }, { value: 'left', label: 'Left' }, { value: 'none', label: 'None' },
  ] },
  { key: 'aim', label: 'Aim', kind: 'select', value: 'soft', options: [
    { value: 'wide', label: 'Wide' }, { value: 'soft', label: 'Soft' }, { value: 'tight', label: 'Tight' },
  ], info: 'How far off your arm a target can be.\nWide 70°, Soft 35°, Tight 15°.\nThe gun turns up to 10° more than that.' },
  { key: 'rate', label: 'Rate', value: 4, min: 1, max: 20, step: 1, unit: '/s' },
  { key: 'damage', label: 'Damage', value: 1, min: 0.25, max: 5, step: 0.25 },
  { key: 'multishot', label: 'Multi', value: 1, min: 1, max: 5, step: 1 },
  { key: 'crit', label: 'Headshot', value: 0.15, min: 0, max: 100, step: 5, unit: '%', scale: 100 },
  { key: 'turnSpeed', label: 'Turn', value: 720, min: 90, max: 2000, step: 30, unit: '°/s' },
  { key: 'recoil', label: 'Recoil', value: 1, min: 0, max: 200, step: 10, unit: '%', scale: 100 },
  { key: 'tracers', label: 'Tracers', kind: 'toggle', value: true },
]);

var guns = [];
registerReadout('gun', 'Gun', function () {
  return guns.map(function (g) { return g.describe(); }).join('\n') || 'no guns';
});

AFRAME.registerComponent('autofire-gun', {
  schema: {
    side: { default: 'right', oneOf: ['left', 'right'] },
    rig: { type: 'selector' }, // the entity with motion-sense
    hand: { type: 'selector' }, // where the gun sits: a virtual-hand, or the tracked hand
    color: { default: '#2b2f36' },
  },

  init: function () {
    this.fire = { cooldown: 0 };
    this.current = null; // the target element it's on
    this.gunDir = new THREE.Vector3(0, 0, -1);
    this.handPos = new THREE.Vector3();
    this.muzzle = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.kick = 0; // recoil, 0..1, springs back
    this.kickVel = 0;
    this.shots = 0;
    this.kills = 0;
    this.lastPick = null;
    this.build();
    guns.push(this);
  },

  remove: function () {
    var i = guns.indexOf(this);
    if (i >= 0) guns.splice(i, 1);
  },

  // A boxy pistol. Its local -Z is the barrel.
  build: function () {
    var el = this.el;
    var c = this.data.color;
    var add = function (w, h, d, x, y, z, rx) {
      var part = document.createElement('a-entity');
      part.setAttribute('geometry', { primitive: 'box', width: w, height: h, depth: d });
      part.setAttribute('material', { color: c, flatShading: true });
      part.setAttribute('position', { x: x, y: y, z: z });
      if (rx) part.setAttribute('rotation', { x: rx, y: 0, z: 0 });
      el.appendChild(part);
    };
    add(0.034, 0.042, 0.2, 0, 0.012, -0.075); // slide
    add(0.03, 0.1, 0.042, 0, -0.04, 0.0, 14); // grip
    add(0.012, 0.012, 0.03, 0, 0.038, -0.16); // front sight
    this.muzzleOffset = new THREE.Vector3(0, 0.012, -0.18);
  },

  // Haptics go to the real controller even when the gun sits on a
  // virtual hand.
  hapticHand: function () {
    var vh = this.data.hand && this.data.hand.components['virtual-hand'];
    return vh ? vh.data.tracked : this.data.hand;
  },

  enabled: function () {
    var hands = tune.values.hands;
    return hands === 'both' || hands === this.data.side;
  },

  sense: function () {
    var rig = this.data.rig;
    return rig && rig.components['motion-sense'];
  },

  describe: function () {
    var side = this.data.side.charAt(0).toUpperCase();
    if (!this.enabled()) return side + ': holstered';
    var sense = this.sense();
    var presented = sense && sense.state[this.data.side].presented;
    var pick = this.lastPick;
    return side + ': ' + (presented ? 'UP' : 'down') +
      (pick ? '  -> ' + pick.name + ' ' + pick.score.toFixed(2) : '') +
      '  shots ' + this.shots + ' kills ' + this.kills;
  },

  tick: function (time, rawDt) {
    var sense = this.sense();
    var o = this.el.object3D;
    var visible = this.enabled() && Boolean(sense);
    o.visible = visible;
    if (!visible) { this.current = null; this.lastPick = null; return; }
    // Holding a gun: the virtual hand (if that's what we sit on) shows a
    // grip. A punch in progress outranks it.
    var vh = this.data.hand && this.data.hand.components['virtual-hand'];
    if (vh) vh.setPose('gun', 1);

    // The player's gun runs on real time: in bullet time the world
    // slows, you don't.
    var clock = this.el.sceneEl.systems['action-clock'];
    var dtMs = clock ? clock.playerDt() : Math.min(rawDt || 16, 50);
    var dt = dtMs / 1000;
    var side = this.data.side;
    var aim = sense.aimRayWorld(side);
    if (this.data.hand) this.data.hand.object3D.getWorldPosition(this.handPos);
    else if (aim) this.handPos.copy(aim.hand);

    var presented = sense.state[side].presented && aim;
    var pick = null;
    if (presented) {
      var targeting = this.el.sceneEl.systems['combat-targeting'];
      pick = targeting.resolve('gun', {
        origin: aim.origin, direction: aim.direction, by: side, current: this.current,
        coneDeg: AIM_CONES[tune.values.aim] || AIM_CONES.soft,
        team: 'enemy', // never training dummies
      });
    }
    this.lastPick = pick;
    this.current = pick ? pick.el : null;

    // Where the gun wants to point: at the target if there is one,
    // otherwise along the arm. It turns at turnSpeed and never more
    // than the cone + 10° off the arm.
    var armDir = aim ? aim.direction : this.gunDir;
    var want = armDir;
    if (pick) {
      want = new THREE.Vector3().copy(pick.aimPoint).sub(this.handPos).normalize();
      var cap = ((AIM_CONES[tune.values.aim] || AIM_CONES.soft) + 10) * DEG;
      want = turnToward(armDir, want, cap);
    }
    var turned = turnToward(this.gunDir, want, tune.values.turnSpeed * DEG * dt);
    this.gunDir.set(turned.x, turned.y, turned.z);

    // Recoil: a kick that pitches the gun up and back, springing home.
    this.kickVel += (-this.kick * 260 - this.kickVel * 22) * dt;
    this.kick += this.kickVel * dt;

    o.position.copy(this.handPos);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.gunDir);
    o.quaternion.copy(this.quat);
    o.rotateX(this.kick * 0.5);
    o.translateZ(this.kick * 0.06);

    this.drawAssist(aim);

    if (!pick) { this.fire.cooldown = Math.min(this.fire.cooldown, 0); return; }
    this.el.sceneEl.systems['combat-targeting'].claim(pick.el, side);
    // Only fire once the barrel is actually on it, so a shot never
    // leaves the gun pointing somewhere else.
    var toTarget = new THREE.Vector3().copy(pick.aimPoint).sub(this.handPos).normalize();
    if (angleBetween(this.gunDir, toTarget) > 4 * DEG) return;
    var n = shotsDue(this.fire, dtMs, tune.values.rate);
    for (var i = 0; i < n; i++) this.shoot(pick);
  },

  shoot: function (pick) {
    var o = this.el.object3D;
    o.updateMatrixWorld();
    this.muzzle.copy(this.muzzleOffset).applyMatrix4(o.matrixWorld);
    var fx = this.el.sceneEl.systems['action-effects'];
    var targets = [pick.target];
    // Multishot: the next-best candidates, then the same one again.
    for (var m = 1; m < tune.values.multishot; m++) {
      var next = pick.candidates[m] && pick.candidates[m].candidate.target;
      targets.push(next || pick.target);
    }
    if (fx) fx.flash(this.muzzle, this.gunDir, { size: 0.09 });
    sound('shot', this.muzzle);
    haptic(this.hapticHand(), 'shot');
    this.kickVel += 9 * tune.values.recoil;
    this.shots++;

    for (var t = 0; t < targets.length; t++) {
      var target = targets[t];
      if (!target.alive) continue;
      var zoneName = Math.random() < tune.values.crit ? 'head' : target.data.aimZone;
      var zone = target.zone(zoneName);
      var point = zoneSurfaceToward(zone, this.muzzle);
      var dir = new THREE.Vector3().copy(point).sub(this.muzzle).normalize();
      if (fx && tune.values.tracers) {
        // Spread is only for looks: the tracer ends a little off, the
        // bullet does not.
        var j = 0.02;
        fx.tracer(this.muzzle, { x: point.x + (Math.random() - 0.5) * j, y: point.y + (Math.random() - 0.5) * j, z: point.z + (Math.random() - 0.5) * j });
      }
      var result = target.applyHit({
        zone: zoneName, point: point, direction: dir, force: 0.6,
        damage: tune.values.damage, source: 'gun', by: this.data.side,
      });
      if (result && result.killed) {
        this.kills++;
        haptic(this.hapticHand(), 'kill', 0.6);
        logAction(this.data.side.charAt(0).toUpperCase() + ' gun killed ' + (target.el.id || 'target') + ' (' + result.zone + ')');
      }
    }
  },

  // Draw > Assist: the arm's line (grey) and where the gun actually
  // points (green), so the turn is visible.
  drawAssist: function (aim) {
    var dd = this.el.sceneEl.systems['debug-draw'];
    if (!dd || !dd.on('assist') || !aim) return;
    var p = this.handPos;
    dd.line(p, { x: p.x + aim.direction.x * 0.6, y: p.y + aim.direction.y * 0.6, z: p.z + aim.direction.z * 0.6 }, '#7f8aa8');
    dd.line(p, { x: p.x + this.gunDir.x * 0.6, y: p.y + this.gunDir.y * 0.6, z: p.z + this.gunDir.z * 0.6 }, '#5fe08a');
  },
});
