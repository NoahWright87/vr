// ============================================================
// MENU PREFERENCES — the player's own say over how menus behave, the
// same in every game (saved in this browser).
//
//   touchMenus  Menus you open by touching or grabbing something (a loot
//               box, a gun case): 'menu' lets each menu decide whether it
//               closes when the hand that opened it goes away (its
//               projected-menu `autoClose`); 'stay' keeps them all open
//               until closed; 'close' closes them all when you let go.
// ============================================================

var STORAGE_KEY = 'vr.touchMenus';
export var TOUCH_MENU_OPTIONS = [
  { value: 'menu', label: 'Each menu decides' },
  { value: 'stay', label: 'Stay open' },
  { value: 'close', label: 'Close when let go' },
];

var touchMenus = null;

function valid(value) {
  return TOUCH_MENU_OPTIONS.some(function (option) { return option.value === value; });
}

export function getTouchMenus() {
  if (touchMenus) return touchMenus;
  var saved = null;
  try { saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null; } catch (e) { saved = null; }
  touchMenus = valid(saved) ? saved : 'menu';
  return touchMenus;
}

export function setTouchMenus(value) {
  touchMenus = valid(value) ? value : 'menu';
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, touchMenus); } catch (e) { /* private mode */ }
  return touchMenus;
}
