// ============================================================
// THE RANGE — the Action Lab's autofire station.
//
// Steel silhouettes out past the front of your room, and a gun in each
// hand. Hold a hand out toward them and it fires; lower it and it
// stops. Everything about the targets is under Tuning > Range, the guns
// under Tuning > Gun, the targeting under Tuning > Targeting.
//
// Off a headset: Q raises both (simulated) hands into the presented
// pose — the real hands move, motion-sense sees them held out, and the
// guns take it from there. Mouse-look aims them.
// ============================================================

import '../../common/dummies.js';
import '../../common/autofire.js';
import { defineTunables } from '../../common/tunables.js';
import { addLabRows } from './lab-page.js';

function spawner() { return document.querySelector('#range-targets'); }

function applyRange(values) {
  var el = spawner();
  if (!el) return;
  el.setAttribute('target-spawner', {
    count: values.count, distance: values.distance, arc: values.arc, depth: values.depth,
    mover: values.mover, death: values.death, health: values.health, speed: values.speed,
  });
}

var range = defineTunables('range', 'Range', [
  { key: 'count', label: 'Targets', value: 5, min: 1, max: 24, step: 1 },
  { key: 'distance', label: 'Distance', value: 6, min: 2, max: 25, step: 1, unit: 'm' },
  { key: 'arc', label: 'Arc', value: 70, min: 0, max: 180, step: 10, unit: '°' },
  { key: 'depth', label: 'Stagger', value: 0, min: 0, max: 6, step: 0.5, unit: 'm' },
  { key: 'mover', label: 'Move', kind: 'select', value: 'none', options: [
    { value: 'none', label: 'Still' }, { value: 'rail', label: 'Rail' }, { value: 'popup', label: 'Pop-up' }, { value: 'walker', label: 'Walk' },
  ] },
  { key: 'speed', label: 'Speed', value: 0.8, min: 0.2, max: 3, step: 0.1, unit: 'm/s' },
  { key: 'death', label: 'Death', kind: 'select', value: 'tip', options: [
    { value: 'tip', label: 'Tip over' }, { value: 'shatter', label: 'Shatter' },
  ] },
  { key: 'health', label: 'Health', value: 3, min: 0.5, max: 20, step: 0.5 },
], applyRange);

var scene = document.querySelector('a-scene');
if (scene.hasLoaded) applyRange(range.values); else scene.addEventListener('loaded', function () { applyRange(range.values); });

// ---------- desktop: Q raises and lowers both hands ----------

var gunsUp = false;
function setGunsUp(up) {
  gunsUp = up;
  var rig = document.querySelector('#rig');
  if (!rig) return;
  // Held out at shoulder height, or dropped to your sides. The page's
  // resting pose (forward 0.2) reads as 45% extension, above the 42%
  // "lowered" threshold, so lowering goes further down than that. The
  // hands travel at semantic-hand's own speed, so this is real hand
  // motion as far as motion-sense is concerned.
  rig.setAttribute('desktop-hand-presence', up
    ? { forward: 0.55, down: 0.1, spread: 0.18 }
    : { forward: 0.05, down: 0.38, spread: 0.24 });
}

document.addEventListener('keydown', function (evt) {
  if (evt.code !== 'KeyQ' || evt.repeat) return;
  if (scene.is('vr-mode')) return;
  setGunsUp(!gunsUp);
});

addLabRows(function () {
  return scene.is('vr-mode') ? [] : [{ kind: 'toggle', id: 'range-guns-up', label: 'Guns up (Q)', value: gunsUp }];
});

document.addEventListener('menu-commit', function (evt) {
  if (evt.detail.id === 'range-guns-up') setGunsUp(Boolean(evt.detail.value));
});

export { setGunsUp };
