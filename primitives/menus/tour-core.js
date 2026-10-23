// ============================================================
// TOUR CORE — what every demo in the menus tour shares.
//
// The tour (tour.js) is one menu in front of you that picks a demo; each
// demo (demo-*.js) puts a HUD on the visor and a small scene behind you,
// with props that use menus the way a game would: a gun case you grab to
// open, a toolbox, a chest, a wanted board. Nothing needs walking to.
//
// This file holds the plumbing they share: which demo is active, the
// input-hint helpers, and the prop components. The props only know how
// to be held, fired, thrown, drunk from or hit; what any of that MEANS is
// the active demo's call (its canFire, onDrink, onHit), so one gun or
// one bottle serves every demo.
// ============================================================

import '../../common/aim-targeting.js';

var THREE = AFRAME.THREE;

export var tour = {
  // The demo object currently shown, or null at the demo list.
  active: null,
};

export function sceneEl() { return document.querySelector('a-scene'); }
export function hud() { return sceneEl().systems['visor-hud']; }
export function targeting() { return sceneEl().systems['aim-targeting']; }

export function inXR() {
  var mode = sceneEl().systems['control-mode'];
  return Boolean(mode && mode.isMode('xr'));
}

// The key that does the primary action, for hints.
export function actionKey() {
  if (inXR()) return 'TRIGGER';
  var router = sceneEl().systems['input-router'];
  var family = router && router.getActiveFamily ? router.getActiveFamily() : 'keyboard';
  if (family === 'touch') return 'USE';
  if (family === 'gamepad') return 'RT';
  return 'CLICK';
}

export function grabKey() {
  if (inXR()) return 'GRIP';
  var router = sceneEl().systems['input-router'];
  var family = router && router.getActiveFamily ? router.getActiveFamily() : 'keyboard';
  if (family === 'gamepad') return 'LB';
  if (family === 'touch') return 'GRAB';
  return 'F';
}

// What each hand holds, by the prop's data-tour-item.
export function heldItem(side) {
  var hand = document.querySelector('#' + side + '-hand');
  var semantic = hand && hand.components['semantic-hand'];
  var held = semantic && semantic.heldEl;
  return held ? { el: held, kind: held.getAttribute('data-tour-item') || '' } : null;
}

export function holding(kind) {
  var left = heldItem('left');
  var right = heldItem('right');
  return Boolean((left && left.kind === kind) || (right && right.kind === kind));
}

function heldBy(el) {
  var body = el.components['simple-grabbable'];
  return body && body.state === 'held' ? body.handEl : null;
}

export function visibleInHierarchy(object3D) {
  for (var node = object3D; node; node = node.parent) if (!node.visible) return false;
  return true;
}

// Put every prop in a demo's set back where it started (and out of any
// hand), for leaving a demo or its Reset row.
export function resetProps(setEl) {
  setEl.querySelectorAll('[simple-grabbable]').forEach(function (el) {
    el.components['simple-grabbable'].resetToSpawn();
  });
}

// A brief line from the muzzle to wherever the shot went.
export function tracer(from, to, color) {
  var el = document.createElement('a-entity');
  el.setAttribute('line', { start: from, end: to, color: color || '#ffe08a', opacity: 0.9 });
  sceneEl().appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 90);
}

// The nearest visible tour target a ray passes through.
export function raycastTargets(origin, direction, maxDistance) {
  var best = null;
  var point = new THREE.Vector3();
  var toPoint = new THREE.Vector3();
  targeting().targets.forEach(function (component) {
    if (!component.el.components['tour-target'] || !visibleInHierarchy(component.el.object3D)) return;
    component.getPoint(point);
    toPoint.copy(point).sub(origin);
    var along = toPoint.dot(direction);
    if (along <= 0 || along > maxDistance) return;
    var miss = toPoint.addScaledVector(direction, -along).length();
    if (miss > component.getRadius()) return;
    if (!best || along < best.along) best = { el: component.el, along: along };
  });
  return best;
}

// Listen for the "trigger" of whichever hand holds a prop: the real
// trigger in a headset, a click off one. Returns the unlisten function.
function onTrigger(handEl, down, up) {
  handEl.addEventListener('triggerdown', down);
  handEl.addEventListener('desktop-trigger-attempt', down);
  if (up) handEl.addEventListener('triggerup', up);
  return function () {
    handEl.removeEventListener('triggerdown', down);
    handEl.removeEventListener('desktop-trigger-attempt', down);
    if (up) handEl.removeEventListener('triggerup', up);
  };
}

// ============================================================
// A gun. Grab it, pull the trigger. The active demo decides whether it
// can fire (canFire spends the ammo or the mana); the gun handles aim:
// while held it is an aim source of its own, bracketing in its colour,
// and its shot goes to what that source has locked — GTA-style auto-aim.
// ============================================================
AFRAME.registerComponent('tour-gun', {
  schema: {
    color: { default: '#ff9a4a' },
    tracer: { default: '#ffe08a' },
  },

  init: function () {
    var self = this;
    this.muzzle = this.el.querySelector('.tour-muzzle') || this.el;
    this.sourceId = 'gun-' + (this.el.id || 'x');
    this.el.addEventListener('simple-grabbed', function (evt) {
      self.unlisten = onTrigger(evt.detail.handEl, function () { self.fire(); });
      targeting().addSource(self.sourceId, { object3D: self.muzzle.object3D, color: self.data.color });
      targeting().request(self.sourceId, { source: self.sourceId });
    });
    this.el.addEventListener('simple-released', function () { self.drop(); });
  },

  drop: function () {
    if (this.unlisten) this.unlisten();
    this.unlisten = null;
    targeting().release(this.sourceId);
    targeting().removeSource(this.sourceId);
  },

  fire: function () {
    var demo = tour.active;
    if (!demo || !demo.canFire || !demo.canFire(this.el)) return;
    var origin = new THREE.Vector3();
    var direction = new THREE.Vector3();
    var quat = new THREE.Quaternion();
    this.muzzle.object3D.getWorldPosition(origin);
    this.muzzle.object3D.getWorldQuaternion(quat);
    direction.set(0, 0, -1).applyQuaternion(quat);
    var lock = targeting().getLock(this.sourceId, true);
    if (lock) direction.copy(lock.point).sub(origin).normalize();
    var hit = raycastTargets(origin, direction, 60);
    tracer(origin, origin.clone().addScaledVector(direction, hit ? hit.along : 25), this.data.tracer);
    if (hit) hit.el.emit('tour-hit', { by: this.el }, false);
  },

  remove: function () { this.drop(); },
});

// ============================================================
// A thing you throw. Held, it brings up the gaze brackets; thrown, the
// throw is bent toward the gaze lock — hard in the inner ring, barely in
// the outer (aim-targeting assistThrow). Off a headset, T throws it at
// what you are looking at.
// ============================================================
AFRAME.registerComponent('tour-throwable', {
  init: function () {
    var self = this;
    this.el.addEventListener('simple-grabbed', function () {
      targeting().request('tour-throwable', { source: 'gaze' });
    });
    this.el.addEventListener('simple-released', function () {
      targeting().release('tour-throwable');
      var body = self.el.components['simple-grabbable'];
      var origin = self.el.object3D.getWorldPosition(new THREE.Vector3());
      if (self.tossing) {
        self.tossing = false;
        var forward = new THREE.Vector3();
        sceneEl().camera.getWorldDirection(forward);
        body.velocity.copy(forward).multiplyScalar(7);
        body.velocity.y += 2;
      }
      var assisted = targeting().assistThrow(origin, body.velocity, [1, 0.6, 0.15], 'gaze', body.data.gravity);
      body.velocity.set(assisted.x, assisted.y, assisted.z);
      self.flying = true;
    });
    this.el.addEventListener('simple-rested', function () { self.flying = false; });
    this.onKey = function (evt) {
      if (evt.code !== 'KeyT' || evt.repeat || !heldBy(self.el)) return;
      self.tossing = true;
      self.el.components['simple-grabbable'].release(heldBy(self.el));
    };
    window.addEventListener('keydown', this.onKey);
    this._here = new THREE.Vector3();
    this._point = new THREE.Vector3();
  },

  tick: function () {
    if (!this.flying) return;
    var here = this.el.object3D.getWorldPosition(this._here);
    var point = this._point;
    var self = this;
    targeting().targets.forEach(function (component) {
      if (!self.flying || !component.el.components['tour-target'] || !visibleInHierarchy(component.el.object3D)) return;
      component.getPoint(point);
      if (point.distanceTo(here) < component.getRadius() + 0.12) {
        component.el.emit('tour-hit', { by: self.el }, false);
        self.flying = false;
      }
    });
  },

  remove: function () { window.removeEventListener('keydown', this.onKey); },
});

// ============================================================
// Something you drink from: pull the trigger, or hold it to your mouth
// for a moment. The active demo's onDrink says what a sip does.
// ============================================================
AFRAME.registerComponent('tour-drink', {
  init: function () {
    var self = this;
    this.mouthTime = 0;
    this._mouth = new THREE.Vector3();
    this._here = new THREE.Vector3();
    this.el.addEventListener('simple-grabbed', function (evt) {
      self.handEl = evt.detail.handEl;
      self.unlisten = onTrigger(evt.detail.handEl, function () { self.drink(); });
    });
    this.el.addEventListener('simple-released', function () {
      if (self.unlisten) self.unlisten();
      self.unlisten = null;
      self.handEl = null;
    });
  },

  drink: function () {
    var demo = tour.active;
    if (demo && demo.onDrink) demo.onDrink(this.el);
  },

  tick: function (time, delta) {
    if (!this.handEl || !inXR()) return;
    sceneEl().camera.localToWorld(this._mouth.set(0, -0.09, -0.06));
    this.el.object3D.getWorldPosition(this._here);
    if (this._here.distanceTo(this._mouth) < 0.14) {
      this.mouthTime += delta;
      if (this.mouthTime > 600) { this.mouthTime = -900; this.drink(); }
    } else if (this.mouthTime > 0) {
      this.mouthTime = 0;
    }
  },

  remove: function () { if (this.unlisten) this.unlisten(); },
});

// ============================================================
// Something to hit. It spins once (its .tour-face child, if any) and
// tells the active demo, which keeps the score. A hit while it is still
// spinning does not count twice.
// ============================================================
AFRAME.registerComponent('tour-target', {
  schema: { name: { default: '' } },

  init: function () {
    var self = this;
    this.spinUntil = 0;
    this.face = this.el.querySelector('.tour-face');
    this.baseYaw = this.face ? this.face.object3D.rotation.y : 0;
    this.el.addEventListener('tour-hit', function (evt) {
      var now = self.el.sceneEl.time;
      if (self.spinUntil > now) return;
      self.spinUntil = now + 700;
      var demo = tour.active;
      if (demo && demo.onHit) demo.onHit(self.el, evt.detail && evt.detail.by);
    });
  },

  tick: function (time) {
    if (!this.face || this.spinUntil < time - 50) return;
    var left = this.spinUntil - time;
    this.face.object3D.rotation.y = this.baseYaw + (left > 0 ? (1 - left / 700) * Math.PI * 2 : 0);
  },
});

// ============================================================
// A prop that opens a menu when you grab it — a gun case, a toolbox, a
// chest. Reach for it and the hint says Open; grab, and the crossbar
// panel above it (projected-menu in laser mode, joined by
// projected-crossbar) comes up facing you; grab again, look away, or
// press E/Esc off a headset, and it goes. A panel you can point at, poke,
// or drive with the stick of a hand held near it.
// ============================================================
AFRAME.registerComponent('grab-to-open', {
  dependencies: ['projected-menu'],
  init: function () {
    var self = this;
    this.onAction = function (evt) {
      if (evt.detail.action !== 'grab') return;
      var pm = self.el.components['projected-menu'];
      if (pm.active) pm.close();
      else pm.open();
    };
    this.el.addEventListener('semantic-action', this.onAction);
  },
  remove: function () { this.el.removeEventListener('semantic-action', this.onAction); },
});
