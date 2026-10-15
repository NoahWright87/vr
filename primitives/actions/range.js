// ============================================================
// THE RANGE — the Action Lab's gun and throwing station.
//
// A gallery of steel silhouettes out past the front of your room —
// near, popping up, sliding, peeking out from cover, far — and a table
// of guns that restock themselves: grab one, empty it, throw it at
// someone, grab another. Targets: Tuning > Range. Guns: Tuning > Gun.
//
// Off a headset: G / H reach the right / left hand to the nearest gun
// and grab it (again to drop), Space pulls the triggers, T throws (a
// held gun, or a knife), and Q holds both hands out — for autofire.
// All of it moves the simulated hands or presses their buttons, so the
// real code paths run. Mouse-look aims.
// ============================================================

import '../../common/dummies.js';
import '../../common/guns.js';
import { defineTunables } from '../../common/tunables.js';
import { addLabRows } from './lab-page.js';

function spawner() { return document.querySelector('#range-targets'); }
function gallery() { return document.querySelector('#range-gallery'); }

// Gallery: near, poppers, sliders, peekers behind cover, far — scaled by
// Crowd. Arc: one row of the same kind of target (the original range).
function applyRange(values) {
  var arc = spawner();
  var gal = gallery();
  if (!arc || !gal) return;
  var isGallery = values.layout === 'gallery';
  arc.setAttribute('target-spawner', {
    count: isGallery ? 0 : values.count, distance: values.distance, arc: values.arc, depth: values.depth,
    mover: values.mover, death: values.death, health: values.health, speed: values.speed, shootMs: values.shoot,
  });
  gal.setAttribute('target-gallery', {
    crowd: isGallery ? values.crowd : 0, walkers: isGallery ? values.walkers : 0,
    death: values.death, health: values.health, speed: values.speed, shootMs: values.shoot,
  });
}

var range = defineTunables('range', 'Range', [
  { key: 'layout', label: 'Layout', kind: 'select', value: 'gallery', options: [
    { value: 'gallery', label: 'Gallery' }, { value: 'arc', label: 'Arc' },
  ], info: 'Gallery: near, pop-ups, sliders, peekers behind cover and far targets.\nArc: one row of one kind (Targets, Distance, Arc, Move below).' },
  { key: 'crowd', label: 'Crowd', value: 1, min: 0.5, max: 3, step: 0.5, unit: 'x',
    info: 'Gallery only: how many of everything.' },
  { key: 'walkers', label: 'Walkers', value: 0, min: 0, max: 12, step: 1,
    info: 'Gallery only: silhouettes that walk at you.' },
  { key: 'count', label: 'Targets', value: 5, min: 1, max: 24, step: 1 },
  { key: 'distance', label: 'Distance', value: 6, min: 2, max: 25, step: 1, unit: 'm' },
  { key: 'arc', label: 'Arc', value: 70, min: 0, max: 180, step: 10, unit: '°' },
  { key: 'depth', label: 'Stagger', value: 0, min: 0, max: 6, step: 0.5, unit: 'm' },
  { key: 'mover', label: 'Move', kind: 'select', value: 'none', options: [
    { value: 'none', label: 'Still' }, { value: 'rail', label: 'Rail' }, { value: 'popup', label: 'Pop-up' }, { value: 'walker', label: 'Walk' }, { value: 'peek', label: 'Peek' },
  ] },
  { key: 'speed', label: 'Speed', value: 0.8, min: 0.2, max: 3, step: 0.1, unit: 'm/s' },
  { key: 'death', label: 'Death', kind: 'select', value: 'tip', options: [
    { value: 'tip', label: 'Tip over' }, { value: 'shatter', label: 'Shatter' },
  ] },
  { key: 'health', label: 'Health', value: 3, min: 0.5, max: 20, step: 0.5 },
  { key: 'shoot', label: 'Shoot', kind: 'select', value: 0, options: [
    { value: 0, label: 'Never' }, { value: 4500, label: 'Slow' }, { value: 2000, label: 'Fast' },
  ], info: 'Targets fire slow bullets at your head (their head glows first). Your guns shoot bullets down; a hand deflects one; a fast hand sends it back.' },
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
  return scene.is('vr-mode') ? [] : [{ kind: 'toggle', id: 'range-guns-up', label: 'Hands out (Q)', value: gunsUp }];
});

document.addEventListener('menu-commit', function (evt) {
  if (evt.detail.id === 'range-guns-up') setGunsUp(Boolean(evt.detail.value));
});

export { setGunsUp };
