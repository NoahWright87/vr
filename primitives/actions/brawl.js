// ============================================================
// THE BRAWL — robots all round you, taking turns to swing.
//
// Off by default. Turn it on (B on desktop, or the visor's Brawl row)
// and a ring of Rock 'Em Sock 'Em robots walks in from all sides and
// surrounds you wherever you stand: a couple at a time step in to
// punch while the rest circle. Punch them; hold a hand up and it snaps
// onto their punch to block; swat a punch sideways or drive into it to
// counter (common/counters.js) — they're shoved, often into whoever's
// behind them, and both get hurt.
// Knocked down, they pop back up a few seconds later.
//
// The kinds: red boxers, yellow quick jabbers, purple brutes (slow, hit
// hard, take a lot), blue blockers (never swing — moving punching
// bags). Tuning > Brawl sets how many, which, and how hard they press.
// The dummies station also has a line of them on their own, on rails.
//
// Off a headset: B starts the brawl. Z / X swat an incoming punch to
// your left / right (the right / left hand sweeps across your face — a
// real hand motion, so the counter code reads it like a headset's);
// a click jab into a punch meets it head-on. Hands at rest are up in a
// guard, so they block on their own.
// ============================================================

import '../../common/brawlers.js';
import { defineTunables } from '../../common/tunables.js';
import { addLabRows } from './lab-page.js';

function ring() { return document.querySelector('#brawl-ring'); }

function apply(values) {
  var el = ring();
  if (!el) return;
  el.setAttribute('brawl-ring', {
    count: values.on ? values.count : 0, mix: values.mix, attackers: values.attackers, pace: values.pace,
    holdRadius: values.hold, engageRadius: values.engage, flank: values.flank,
    knock: values.knock, parryShove: values.parry, impactDamage: values.impact,
  });
}

var tune = defineTunables('brawl', 'Brawl', [
  { key: 'on', label: 'On', kind: 'toggle', value: false,
    info: 'A ring of robots surrounds you wherever you stand. Desktop: B.' },
  { key: 'count', label: 'Robots', value: 6, min: 1, max: 12, step: 1 },
  { key: 'mix', label: 'Kinds', kind: 'select', value: 'mixed', options: [
    { value: 'mixed', label: 'Mixed' }, { value: 'boxer', label: 'Boxers' }, { value: 'quick', label: 'Quick' },
    { value: 'brute', label: 'Brutes' }, { value: 'blocker', label: 'Bags' },
  ], info: 'Boxers (red), quick jabbers (yellow), brutes (purple: slow, hit hard), bags (blue: never swing).' },
  { key: 'attackers', label: 'At once', value: 2, min: 1, max: 6, step: 1,
    info: 'How many step in to swing at the same time.' },
  { key: 'pace', label: 'Pace', value: 1.2, min: 0.2, max: 4, step: 0.1, unit: 's',
    info: 'Time between one robot being handed a turn and the next.' },
  { key: 'hold', label: 'Circle at', value: 1.7, min: 1, max: 3, step: 0.1, unit: 'm',
    info: 'How far away the waiting ones circle.' },
  { key: 'engage', label: 'Swing from', value: 0.85, min: 0.5, max: 1.3, step: 0.05, unit: 'm' },
  { key: 'flank', label: 'Flank', kind: 'toggle', value: false,
    info: 'Off: only robots you can see (within 70° of your gaze) get a turn. On: from behind too.' },
  { key: 'knock', label: 'Knockback', value: 1, min: 0, max: 3, step: 0.25, unit: 'x' },
  { key: 'parry', label: 'Parry shove', value: 3.2, min: 0, max: 8, step: 0.2, unit: 'm/s',
    info: 'How hard a parry shoves a robot back. Into another one: both take damage.' },
  { key: 'impact', label: 'Pile-up dmg', value: 0.6, min: 0, max: 3, step: 0.1,
    info: 'Damage per m/s when one robot is knocked into another.' },
], apply);

var scene = document.querySelector('a-scene');
if (scene.hasLoaded) apply(tune.values); else scene.addEventListener('loaded', function () { apply(tune.values); });

function setOn(on) { tune.set('on', Boolean(on)); }

document.addEventListener('keydown', function (evt) {
  if (evt.repeat || scene.is('vr-mode')) return;
  if (evt.code === 'KeyB') setOn(!tune.values.on);
  if (evt.code === 'KeyZ') swat('left');
  if (evt.code === 'KeyX') swat('right');
});

// A point in front of the camera (yaw only), as the throw input does.
function frame(offset) {
  var THREE = AFRAME.THREE;
  var cam = document.querySelector('#lab-camera').object3D;
  var pos = cam.getWorldPosition(new THREE.Vector3());
  var e = new THREE.Euler().setFromQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()), 'YXZ');
  var yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), e.y);
  return { position: offset.clone().applyQuaternion(yaw).add(pos), quaternion: yaw };
}

// Sweep a hand across your face: to your left with the right hand, to
// your right with the left.
function swat(toward) {
  var handEl = document.querySelector(toward === 'left' ? '#right-hand' : '#left-hand');
  var hand = handEl && handEl.components['semantic-hand'];
  if (!hand) return;
  var THREE = AFRAME.THREE;
  var s = toward === 'left' ? 1 : -1;
  var from = frame(new THREE.Vector3(s * 0.28, -0.12, -0.32));
  var to = frame(new THREE.Vector3(-s * 0.18, -0.1, -0.36));
  hand.cancelMotion();
  hand.runWorldMotion([
    { position: from.position, quaternion: from.quaternion, pose: 'Open', duration: 90 },
    { position: to.position, quaternion: to.quaternion, pose: 'Open', duration: 130 },
    { position: to.position, quaternion: to.quaternion, pose: 'Open', duration: 120 },
  ], { action: 'swat', source: 'desktop' });
}

addLabRows(function () {
  return [{ kind: 'toggle', id: 'brawl-on', label: scene.is('vr-mode') ? 'Brawl' : 'Brawl (B)', value: tune.values.on }];
});

document.addEventListener('menu-commit', function (evt) {
  if (evt.detail.id === 'brawl-on') setOn(evt.detail.value);
});

export { setOn, swat };
