// ============================================================
// COMFORT BUDGET — the faster you physically move, the more the game
// may do without you noticing. Stillness earns nothing.
//
// Punch Pop moved the player whenever its classifier was confident, and
// a confident false positive while standing still is exactly what makes
// people sick. Here a system may only *request* an assist; what it is
// granted is a gain on the player's real motion this frame:
//
//   hand drift   the virtual hand may move toward its assist target by
//                handGain × how far the real hand moved this frame —
//                and only while motion energy is up. A still hand
//                cannot drift. Returning to the real hand follows the
//                same rule (no energy needed), so you never watch your
//                hand slide back.
//   view yaw     yawGain × how far the head turned this frame. Zero head
//                rotation, zero yaw. Off by default (yawGain 0).
//   travel       moveGain × how far the head moved. Off by default.
//
// See docs/actions/comfort-budget.spec.md. The core is pure and tested
// by tests/comfort-budget.test.js.
// ============================================================

import { defineTunables } from './tunables.js';
import { registerReadout } from './debug-hud.js';

export var DEFAULT_BUDGET = {
  master: 1, // scales every channel
  handGain: 0.6, // drift allowed per metre of real hand travel
  handEnergy: 0.2, // motion energy below which a hand may not drift away
  handMax: 0.15, // m; the furthest a virtual hand may ever be from the real one
  recenterGain: 0.8, // return allowed per metre of real hand travel
  yawGain: 0, // view yaw allowed per degree of real head yaw
  moveGain: 0, // rig travel allowed per metre of real head travel
};

function len(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }

// How strongly motion energy allows growth: 0 at or below the floor,
// rising to 1 at full energy.
export function energyFactor(energy, floor) {
  if (energy <= floor) return 0;
  return Math.min(1, (energy - floor) / Math.max(1 - floor, 1e-6));
}

// Move `offset` (the virtual hand's offset from the real one) toward
// `desired` by what this frame's real hand travel allows.
//   offset, desired: {x,y,z}   handTravel: metres the real hand moved
//   energy: 0..1               settings: DEFAULT_BUDGET-shaped
// Returns { offset, wanted, granted } — wanted and granted in metres.
export function stepHandOffset(offset, desired, handTravel, energy, settings) {
  var s = settings || DEFAULT_BUDGET;
  var to = { x: desired.x - offset.x, y: desired.y - offset.y, z: desired.z - offset.z };
  var wanted = len(to);
  if (wanted < 1e-6) return { offset: { x: offset.x, y: offset.y, z: offset.z }, wanted: 0, granted: 0 };
  // Growing the gap needs energy; closing it only needs motion.
  var growing = len(desired) > len(offset) + 1e-6;
  var allowance = growing
    ? s.master * s.handGain * handTravel * energyFactor(energy, s.handEnergy)
    : s.master * s.recenterGain * handTravel;
  var step = Math.min(wanted, Math.max(0, allowance));
  var k = step / wanted;
  var next = { x: offset.x + to.x * k, y: offset.y + to.y * k, z: offset.z + to.z * k };
  var l = len(next);
  if (l > s.handMax) {
    next.x *= s.handMax / l; next.y *= s.handMax / l; next.z *= s.handMax / l;
  }
  return { offset: next, wanted: wanted, granted: step };
}

// Signed degrees of view yaw allowed this frame toward `requestedDeg`.
export function grantYaw(requestedDeg, headYawDeltaDeg, settings) {
  var s = settings || DEFAULT_BUDGET;
  var cap = s.master * s.yawGain * Math.abs(headYawDeltaDeg);
  return Math.max(-cap, Math.min(cap, requestedDeg));
}

// Metres of rig travel allowed this frame toward `requestedM` (>= 0).
export function grantMove(requestedM, headTravelM, settings) {
  var s = settings || DEFAULT_BUDGET;
  return Math.max(0, Math.min(requestedM, s.master * s.moveGain * headTravelM));
}

// ---------- the shared page-wide settings and ledger ----------

var tune = defineTunables('comfort', 'Comfort', [
  { key: 'master', label: 'Assist', value: DEFAULT_BUDGET.master, min: 0, max: 300, step: 10, unit: '%', scale: 100,
    info: 'Scales every assist. 0% turns them all off.' },
  { key: 'handGain', label: 'Hand gain', value: DEFAULT_BUDGET.handGain, min: 0, max: 200, step: 10, unit: '%', scale: 100,
    info: 'How far a virtual hand may drift, per cm your real hand moves.' },
  { key: 'handEnergy', label: 'Hand floor', value: DEFAULT_BUDGET.handEnergy, min: 0, max: 100, step: 5, unit: '%', scale: 100,
    info: 'Motion energy needed before a hand may drift away at all.' },
  { key: 'handMax', label: 'Hand max', value: DEFAULT_BUDGET.handMax, min: 0, max: 40, step: 1, unit: 'cm', scale: 100 },
  { key: 'recenterGain', label: 'Return', value: DEFAULT_BUDGET.recenterGain, min: 10, max: 300, step: 10, unit: '%', scale: 100,
    info: 'How fast a drifted hand comes back, per cm your real hand moves.' },
  { key: 'yawGain', label: 'View yaw', value: DEFAULT_BUDGET.yawGain, min: 0, max: 50, step: 5, unit: '%', scale: 100,
    info: 'View turn allowed per degree your head turns. 0 = never turn the view.' },
]);

export function budgetSettings() { return tune.values; }

// A rolling one-second ledger per channel, for the readout: what
// assists asked for and what they got.
var ledger = {};
export function recordAssist(channel, wanted, granted) {
  var now = typeof performance !== 'undefined' ? performance.now() : 0;
  var entry = ledger[channel] || (ledger[channel] = []);
  entry.push({ t: now, wanted: wanted, granted: granted });
  while (entry.length && entry[0].t < now - 1000) entry.shift();
}

export function describeLedger() {
  var keys = Object.keys(ledger).sort();
  if (!keys.length) return 'no assists yet';
  return keys.map(function (k) {
    var w = 0, g = 0;
    ledger[k].forEach(function (e) { w += e.wanted; g += e.granted; });
    return k + ': wanted ' + (w * 100).toFixed(1) + 'cm got ' + (g * 100).toFixed(1) + 'cm /s';
  }).join('\n');
}

registerReadout('comfort', 'Comfort', describeLedger);
