// ============================================================
// STICK DRIFT — one dead-zone setting for every thumbstick reader.
//
// Worn thumbsticks drift: at rest they report 0.1-0.3 rather than 0,
// and a bump while you move your arm reports more. With a small dead
// zone that walks you slowly across the room and scrolls a menu on its
// own. Fine, slow movement is what walking physically is for, so the
// stick only counts when it is really pushed.
//
// Both the stick's readers use this: locomotion (moving, turning,
// teleport aiming) and menu-stick-control (stepping through a menu).
// The setting is the player's, not the game's, so it is saved in this
// browser and is the same in every game; the visor's settings change it.
//
//   move     stick length below which you do not walk
//   turn     sideways deflection below which you do not (smooth) turn
//   step     deflection a menu step needs
//   release  deflection the stick must fall back under before a menu
//            steps again — above what a drifting stick rests at
//   teleport, teleportCommit  the teleport arc's aim and release
// ============================================================

export var STICK_DRIFT = {
  small: { label: 'Small', move: 0.25, turn: 0.3, step: 0.65, release: 0.3, teleport: 0.55, teleportCommit: 0.15 },
  medium: { label: 'Medium', move: 0.5, turn: 0.55, step: 0.8, release: 0.4, teleport: 0.7, teleportCommit: 0.25 },
  large: { label: 'Large', move: 0.65, turn: 0.7, step: 0.88, release: 0.5, teleport: 0.8, teleportCommit: 0.32 },
};
export var DEFAULT_STICK_DRIFT = 'medium';

// Earlier names for the same idea (locomotion's driftMode).
var ALIASES = { off: 'small', low: 'small', high: 'large' };
var STORAGE_KEY = 'vr.stickDrift';

var current = null;

function resolve(name) {
  name = ALIASES[name] || name;
  return STICK_DRIFT[name] ? name : DEFAULT_STICK_DRIFT;
}

export function getStickDriftName() {
  if (current) return current;
  var saved = null;
  try { saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null; } catch (e) { saved = null; }
  current = resolve(saved);
  return current;
}

export function getStickDrift() {
  return STICK_DRIFT[getStickDriftName()];
}

// Changes it everywhere at once: every reader asks for the current
// values rather than keeping a copy, and anything that does keep one
// (locomotion's schema) listens for `stick-drift-changed` on window.
export function setStickDrift(name) {
  current = resolve(name);
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, current); } catch (e) { /* private mode */ }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('stick-drift-changed', { detail: { name: current, values: STICK_DRIFT[current] } }));
  }
  return STICK_DRIFT[current];
}
