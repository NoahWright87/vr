// ============================================================
// OBB COLLIDER VISIBILITY — hidden things do not collide.
//
// A-Frame's built-in obb-collider system tests every collider against
// every other one, every frame: n(n-1)/2 full separating-axis box tests,
// and each collider's own tick recomputes its box from a recursive
// updateMatrixWorld(true) of its whole subtree. That is fine for a
// handful of colliders and ruinous for this repo, because the menu
// system (common/menus.js) gives every item on every page its own
// collider so a fingertip can poke it — including all the pages that
// are not open. The menus showcase measured 120 colliders, 114 of them
// hidden: 7,140 box tests a frame, 55ms on a desktop CPU, and a Quest's
// CPU is several times slower. That was the lag.
//
// The rule this applies is the one pointing already follows: you cannot
// poke what you cannot see. A collider is skipped — no box update, no
// pair test — while it or any ancestor has visible === false. Every
// consumer in the repo is a fingertip poking something visible (menu
// items, watch faces, the wall trigger, the pedestal button), so none of
// them changes; they just stop paying for the 114 they could never hit.
//
// Components tick before systems in A-Frame, so an item that becomes
// visible refreshes its box before the system tests it in the same
// frame. An item hidden mid-collision drops out of the next pass and
// gets its obbcollisionended like anything else that stopped touching.
// ============================================================

export function visibleInScene(object3D) {
  for (var o = object3D; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

// The pruned pair test, shaped exactly like the stock one so its
// collision bookkeeping (resetCollisions / registerCollision /
// clearCollisions, and the events they emit) is untouched.
function prunedSystemTick() {
  var all = this.colliderEls;
  if (all.length < 2) return;
  this.resetCollisions();
  var live = this._live || (this._live = []);
  live.length = 0;
  for (var i = 0; i < all.length; i++) {
    var component = all[i].components['obb-collider'];
    var half = component && component.obb && component.obb.halfSize;
    // The stock tick already skips zero-sized boxes (not built yet).
    if (!half || half.x === 0 || half.y === 0 || half.z === 0) continue;
    if (!visibleInScene(all[i].object3D)) continue;
    live.push(component);
  }
  for (var a = 0; a < live.length; a++) {
    for (var b = a + 1; b < live.length; b++) {
      if (live[a].obb.intersectsOBB(live[b].obb)) this.registerCollision(live[a], live[b]);
    }
  }
  this.clearCollisions();
}

function pruneSystem(system) {
  if (!system || system.__visibilityPruned) return;
  system.__visibilityPruned = true;
  // An own property on the instance, not the prototype: A-Frame copies
  // the definition onto each system instance, so patching the class
  // after the scene exists would change nothing.
  system.tick = prunedSystemTick;
}

// Guarded for the node tests, which import menus.js against a stub
// AFRAME with no components and no document.
if (typeof AFRAME !== 'undefined' && AFRAME.components && AFRAME.components['obb-collider'] &&
    typeof document !== 'undefined') {
  var proto = AFRAME.components['obb-collider'].Component.prototype;
  if (!proto.__visibilityPruned) {
    proto.__visibilityPruned = true;
    var stockTick = proto.tick;
    proto.tick = function (time, delta) {
      if (!visibleInScene(this.el.object3D)) return;
      return stockTick.call(this, time, delta);
    };
  }

  var patchScene = function (sceneEl) {
    if (sceneEl && sceneEl.systems) pruneSystem(sceneEl.systems['obb-collider']);
  };
  // Module scripts are deferred, so the scene may already exist — or
  // may not have created its systems yet. Cover both.
  var existing = document.querySelector('a-scene');
  if (existing) {
    patchScene(existing);
    existing.addEventListener('loaded', function () { patchScene(existing); });
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      var sceneEl = document.querySelector('a-scene');
      if (!sceneEl) return;
      patchScene(sceneEl);
      sceneEl.addEventListener('loaded', function () { patchScene(sceneEl); });
    });
  }
}
