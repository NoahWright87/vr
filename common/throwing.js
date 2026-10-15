// ============================================================
// THROWING — an overhand whip throws a knife, and it lands.
//
// Position only (docs/actions/throwing.spec.md): no grip, no button.
// Bring a hand up by your head (a knife appears in it) and whip it
// forward; common/intent.js's throw detector calls the release. Then:
//
//   resolve  combat-targeting's `throw` profile — gaze-heavy, along the
//            way the hand was moving and the way you're looking.
//   fly      common/projectiles.js, guided: where in the swing you let
//            go picks the arc (lob or line drive), and the flight is
//            bent onto wherever the target is when it arrives — a throw
//            at someone hits them. No target: the hand's own velocity,
//            exaggerated. Pooled knives, on the action clock.
//   land     a swept sphere against every target's zones, the same
//            contact test as a fist; it sticks where it hits, and the
//            target gets the usual action-hit (source 'throw').
//
//   <a-entity throwing-hands="rig: #rig; left: #left-virtual; right: #right-virtual"></a-entity>
//
// Off a headset, `desktop-throw-input` on the rig makes T throw: it
// moves the simulated hand through a real wind-up and whip, so the
// detector and everything after it run for real.
// ============================================================

import './motion-sense.js';
import './combat-targeting.js';
import './action-clock.js';
import './projectiles.js';
import { createThrowDetector, updateThrows } from './intent.js';
import { sound, haptic } from './action-feedback.js';
import { defineTunables } from './tunables.js';
import { registerReadout, logAction } from './debug-hud.js';

var THREE = AFRAME.THREE;
var SIDES = ['left', 'right'];
var DEG = Math.PI / 180;

var tune = defineTunables('throw', 'Throw', [
  { key: 'on', label: 'Throws', kind: 'toggle', value: true },
  { key: 'item', label: 'Item', kind: 'select', value: 'knife', options: [
    { value: 'knife', label: 'Knife' }, { value: 'star', label: 'Star' },
  ] },
  { key: 'maxSpeed', label: 'Max speed', value: 14, min: 4, max: 30, step: 1, unit: 'm/s' },
  { key: 'guided', label: 'Guided', kind: 'toggle', value: true,
    info: 'On: a throw at a target flies the solved arc bent onto wherever the target is, so it lands. Off: plain ballistics, capped by how hard you threw.' },
  { key: 'gravity', label: 'Gravity', value: 0.6, min: 0, max: 100, step: 10, unit: '%', scale: 100,
    info: 'Under 100% keeps throws up longer — easier to see, easier to land.' },
  { key: 'damage', label: 'Damage', value: 2, min: 0.25, max: 10, step: 0.25 },
  { key: 'releaseSpeed', label: 'Whip', value: 2.2, min: 1, max: 5, step: 0.1, unit: 'm/s',
    info: 'How fast the hand must whip forward from by your head to throw.' },
]);

var last = { text: 'no throws yet' };
registerReadout('throw', 'Throw', function () { return last.text; });

function makeItem(kind) {
  var el = document.createElement('a-entity');
  var part = function (w, h, d, x, y, z, color) {
    var p = document.createElement('a-entity');
    p.setAttribute('geometry', { primitive: 'box', width: w, height: h, depth: d });
    p.setAttribute('material', { color: color, flatShading: true });
    p.setAttribute('position', { x: x, y: y, z: z });
    el.appendChild(p);
  };
  if (kind === 'star') {
    part(0.12, 0.012, 0.03, 0, 0, 0, '#c9d1dc');
    part(0.03, 0.012, 0.12, 0, 0, 0, '#c9d1dc');
  } else {
    part(0.02, 0.006, 0.13, 0, 0, -0.06, '#d9dee6'); // blade, toward -Z
    part(0.024, 0.02, 0.07, 0, 0, 0.04, '#2b2f36'); // handle
  }
  return el;
}

AFRAME.registerComponent('throwing-hands', {
  schema: {
    rig: { type: 'selector' },
    left: { type: 'selector' }, // virtual-hand entities
    right: { type: 'selector' },
  },

  init: function () {
    this.detector = createThrowDetector();
    this.pool = { knife: [], star: [] };
    this.held = {};
    SIDES.forEach(function (side) {
      var vh = this.data[side];
      if (!vh) return;
      // A knife in your hand while it's cocked: the cue that a whip will
      // throw.
      var held = makeItem('knife');
      held.object3D.visible = false;
      held.object3D.position.set(0, 0.02, -0.05);
      vh.appendChild(held);
      this.held[side] = held;
    }, this);
    this.tmp = new THREE.Vector3();
  },

  sense: function () { var r = this.data.rig; return r && r.components['motion-sense']; },

  tick: function (time, rawDt) {
    var sense = this.sense();
    if (!sense) return;
    this.detector.settings.releaseSpeed = tune.values.releaseSpeed;
    var events = tune.values.on ? updateThrows(this.detector, sense.state) : [];
    SIDES.forEach(function (side) {
      var vh = this.data[side] && this.data[side].components['virtual-hand'];
      if (this.held[side]) this.held[side].object3D.visible = tune.values.on && !(vh && vh.holding) && this.detector.hands[side] === 'cocked';
    }, this);
    for (var i = 0; i < events.length; i++) {
      // A hand holding a gun throws the gun (common/guns.js), not a knife.
      var vh = this.data[events[i].hand] && this.data[events[i].hand].components['virtual-hand'];
      if (vh && (vh.holding || this.el.sceneEl.time - (vh.releasedGunAt || -1e9) < 250)) continue;
      this.release(events[i], sense);
    }
  },

  release: function (e, sense) {
    var vhEl = this.data[e.hand];
    var vh = vhEl && vhEl.components['virtual-hand'];
    var from = vh ? vh.position.clone() : sense.toWorld(e.position);
    var handVel = sense.directionToWorld(e.velocity, new THREE.Vector3()).multiplyScalar(e.speed);
    var targeting = this.el.sceneEl.systems['combat-targeting'];
    var gaze = targeting.gaze();
    // Look where the hand went and where you're looking, together.
    var dir = handVel.clone().normalize();
    if (gaze) dir.add(gaze.direction).normalize();
    var pick = targeting.resolve('throw', { origin: from, direction: dir, by: e.hand, team: 'enemy' });
    var tag = e.hand === 'left' ? 'L' : 'R';
    var p = this.launchItem(tune.values.item, {
      from: from, target: pick && tune.values.guided ? pick.target : null,
      velocity: this.freeVelocity(handVel),
      opts: { rise: e.rise, handSpeed: tune.values.guided ? 4 : e.speed, maxSpeed: tune.values.maxSpeed },
    });
    last.text = pick
      ? tag + ' -> ' + pick.name + (p.plan ? '  guided ' + (p.plan.angle / DEG).toFixed(0) + '° ' + p.plan.T.toFixed(2) + 's' : '  (unguided)')
      : tag + ' threw at nothing';
    logAction(last.text);
    sound('whoosh', from);
    haptic(vh ? vh.data.tracked : null, 'hit-light', 0.5);
  },

  // No target: throw it where the hand sent it, exaggerated (bare hand
  // speed throws disappointingly short — Pistols' hurl), with some loft.
  freeVelocity: function (handVel) {
    var v = handVel.clone().multiplyScalar(1.9);
    if (v.y < 1.4) v.y += 1.4;
    return v;
  },

  launchItem: function (kind, o) {
    var el = this.pool[kind].pop();
    if (!el) {
      el = makeItem(kind);
      this.el.sceneEl.appendChild(el);
    }
    var pool = this.pool[kind];
    return this.el.sceneEl.systems['thrown-projectiles'].launch({
      el: el, from: o.from, target: o.target, velocity: o.velocity, opts: o.opts,
      gravity: 9.8 * tune.values.gravity, radius: 0.04, damage: tune.values.damage, force: 0.9,
      after: 'stick', spin: kind === 'star' ? 'flat' : 'point',
      onHit: function (p, hit, first) { logAction('knife hit ' + (first.target.el.id || 'target') + ' ' + first.zone.name); },
      onDone: function () { el.object3D.visible = false; pool.push(el); },
      onLand: function (p) {
        // Stuck in the floor for a second, then back to the pool.
        setTimeout(function () { el.object3D.visible = false; pool.push(el); }, 1000);
      },
    });
  },
});

// ---------- desktop: T throws, through the real hand ----------

AFRAME.registerComponent('desktop-throw-input', {
  schema: {
    camera: { type: 'selector' },
    leftHand: { type: 'selector' },
    rightHand: { type: 'selector' },
    key: { default: 'KeyT' },
  },

  init: function () {
    this.next = 'right';
    this.onKey = this.onKey.bind(this);
    document.addEventListener('keydown', this.onKey);
  },

  remove: function () { document.removeEventListener('keydown', this.onKey); },

  frame: function (offset) {
    var cam = this.data.camera.object3D;
    var pos = cam.getWorldPosition(new THREE.Vector3());
    var q = cam.getWorldQuaternion(new THREE.Quaternion());
    var e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
    var yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), e.y);
    return { position: offset.clone().applyQuaternion(yaw).add(pos), quaternion: yaw };
  },

  onKey: function (evt) {
    if (evt.code !== this.data.key || evt.repeat || this.el.sceneEl.is('vr-mode')) return;
    var side = this.next;
    this.next = side === 'right' ? 'left' : 'right';
    var handEl = side === 'right' ? this.data.rightHand : this.data.leftHand;
    var hand = handEl && handEl.components['semantic-hand'];
    if (!hand || !this.data.camera) return;
    var s = side === 'right' ? 1 : -1;
    var cock = this.frame(new THREE.Vector3(s * 0.2, 0.06, 0.1));
    var whip = this.frame(new THREE.Vector3(s * 0.1, -0.04, -0.5));
    // Follow through low, the way an arm does after a throw (and the
    // way the detector needs it to before the next one).
    var follow = this.frame(new THREE.Vector3(s * 0.2, -0.38, -0.25));
    handEl.setAttribute('data-semantic-action-active', 'throw');
    hand.cancelMotion();
    hand.runWorldMotion([
      { position: cock.position, quaternion: cock.quaternion, pose: 'Hold', duration: 260 },
      { position: cock.position, quaternion: cock.quaternion, pose: 'Hold', duration: 120 },
      { position: whip.position, quaternion: whip.quaternion, pose: 'Open', duration: 120 },
      { position: follow.position, quaternion: follow.quaternion, pose: 'Open', duration: 220 },
    ], { action: 'throw', source: 'desktop' });
    handEl.addEventListener('semantic-hand-motion-complete', function done() {
      handEl.removeEventListener('semantic-hand-motion-complete', done);
      handEl.removeAttribute('data-semantic-action-active');
    });
  },
});
