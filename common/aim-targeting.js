// ============================================================
// AIM TARGETING — what you are aiming at, shown with brackets.
//
// Mark anything worth aiming at:
//
//   <a-entity aim-target gltf-model="..."></a-entity>
//   <a-entity aim-target="offset: 0 1.6 0; radius: 0.15; color: #ff5c5c">  (a headshot point)
//
// and the system keeps a lock per aim source — your gaze, always; a gun
// barrel or anything else a game adds (addSource) — chosen by the three
// aim rings (common/aim-cone.js): nearest the centre wins, but only by a
// clear margin over whatever was already locked, so the lock does not
// flicker between two targets side by side. It is re-chosen ten times a
// second, not every frame, and not at all while you are whipping your
// head round, since nobody picks a target mid-turn.
//
// Brackets show the lock in the world, on the target itself (so they are
// at its depth, not doubled):
//
//   the locked target  a bracket at half opacity, white with a black
//                      edge, slowly turning — unmistakable
//   up to N others     faint, still brackets, brighter the nearer they
//                      are to the centre — so you can feel where the lock
//                      will go before it does
//
// The rings themselves are not drawn (except while you adjust them, in
// Visor ▸ Targeting); the brackets stand for them. Whether brackets show
// is the player's call (Visor ▸ Targeting ▸ Brackets: Off / When asked /
// Always); when they show "when asked" is the game's:
//
//   var targeting = sceneEl.systems['aim-targeting'];
//   targeting.request('bow-drawn');        // brackets on while drawn
//   targeting.release('bow-drawn');
//   var lock = targeting.getLock();        // { el, point, distance, ring, ... }
//   var v = targeting.assistThrow(origin, velocity, [1, 0.6, 0.15]);
//
// Each source has its own bracket colour, and a target can override it
// (a weak point in red, armour in grey).
// ============================================================

import {
  scoreCandidates, chooseLock, assistStrength, assistThrow, turnRate, DEFAULT_ASSIST,
} from './aim-cone.js';
import { OVERLAY_RENDER_ORDER } from './menu-crossbar.js';
import './visor-hud.js';

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;
  var DEG = Math.PI / 180;

  // Re-choose the lock this often, ms.
  var SCORE_INTERVAL_MS = 100;
  // Above this turning speed (degrees a second) the lock is left alone.
  var FAST_TURN = 140;
  // A bracket is at least this big in your view, and the locked one
  // turns at this rate.
  var MIN_BRACKET_DEG = 2.4;
  var MAX_BRACKET_DEG = 16;
  var SPIN_DEG_PER_SEC = 40;
  var LOCKED_OPACITY = 0.5;
  // Under the HUD, which is under the visor menu.
  var BRACKET_ORDER = OVERLAY_RENDER_ORDER - 30;
  var BRACKET_PX = 128;

  // ---------- bracket shapes ----------
  //
  // Drawn once per shape onto a small canvas, white over a black edge;
  // each bracket's material tints the white to its colour.
  var shapeTextures = {};
  function shapeTexture(shape) {
    if (shapeTextures[shape]) return shapeTextures[shape];
    var canvas = document.createElement('canvas');
    canvas.width = canvas.height = BRACKET_PX;
    var ctx = canvas.getContext('2d');
    var s = BRACKET_PX;
    var m = s * 0.12; // margin
    var a = s * 0.24; // arm length
    var paths = [];
    if (shape === 'angle') {
      paths.push([[m + a, m + a * 0.6], [m, s / 2], [m + a, s - m - a * 0.6]]);
      paths.push([[s - m - a, m + a * 0.6], [s - m, s / 2], [s - m - a, s - m - a * 0.6]]);
    } else if (shape === 'triangle') {
      // Three chevrons on a triangle round the target, pointing in.
      var r = s / 2 - m;
      [-90, 30, 150].forEach(function (deg) {
        var t = deg * DEG;
        var cx = s / 2 + Math.cos(t) * r;
        var cy = s / 2 + Math.sin(t) * r;
        var px = Math.cos(t + Math.PI / 2) * a * 0.7;
        var py = Math.sin(t + Math.PI / 2) * a * 0.7;
        var ix = -Math.cos(t) * a * 0.55;
        var iy = -Math.sin(t) * a * 0.55;
        paths.push([[cx - px, cy - py], [cx + ix, cy + iy], [cx + px, cy + py]]);
      });
    } else if (shape === 'quad') {
      paths.push([[m, m + a], [m, m], [m + a, m]]);
      paths.push([[s - m - a, m], [s - m, m], [s - m, m + a]]);
      paths.push([[s - m, s - m - a], [s - m, s - m], [s - m - a, s - m]]);
      paths.push([[m + a, s - m], [m, s - m], [m, s - m - a]]);
    } else {
      // [ ]
      paths.push([[m + a, m], [m, m], [m, s - m], [m + a, s - m]]);
      paths.push([[s - m - a, m], [s - m, m], [s - m, s - m], [s - m - a, s - m]]);
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    [['#000000', s * 0.085], ['#ffffff', s * 0.04]].forEach(function (pass) {
      ctx.strokeStyle = pass[0];
      ctx.lineWidth = pass[1];
      paths.forEach(function (points) {
        ctx.beginPath();
        points.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
        ctx.stroke();
      });
    });
    var texture = new THREE.CanvasTexture(canvas);
    if (THREE.SRGBColorSpace) texture.colorSpace = THREE.SRGBColorSpace;
    shapeTextures[shape] = texture;
    return texture;
  }

  // ============================================================
  // COMPONENT: aim-target
  // ============================================================
  AFRAME.registerComponent('aim-target', {
    schema: {
      // Bounding radius in metres; 0 measures the entity once its model
      // has loaded.
      radius: { default: 0 },
      // The point to aim at, in the entity's own space.
      offset: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
      // Overrides the source's bracket colour for this target.
      color: { type: 'string', default: '' },
      // Which sources may lock it ('' = all). Comma-separated source ids.
      sources: { type: 'string', default: '' },
      enabled: { default: true },
    },

    init: function () {
      this.measured = 0;
      this._box = new THREE.Box3();
      this._sphere = new THREE.Sphere();
      var self = this;
      this.onModel = function () { self.measured = 0; };
      this.el.addEventListener('model-loaded', this.onModel);
      this.system = this.el.sceneEl.systems['aim-targeting'];
      this.system.addTarget(this);
    },

    remove: function () {
      this.el.removeEventListener('model-loaded', this.onModel);
      this.system.removeTarget(this);
    },

    allows: function (sourceId) {
      if (!this.data.enabled || !this.el.object3D.visible) return false;
      if (!this.data.sources) return true;
      return this.data.sources.split(',').map(function (s) { return s.trim(); }).indexOf(sourceId) !== -1;
    },

    getPoint: function (out) {
      var o = this.data.offset;
      out.set(o.x, o.y, o.z);
      return this.el.object3D.localToWorld(out);
    },

    getRadius: function () {
      if (this.data.radius > 0) return this.data.radius;
      if (!this.measured) {
        this._box.setFromObject(this.el.object3D);
        this.measured = this._box.isEmpty() ? 0.2 : this._box.getBoundingSphere(this._sphere).radius * 0.75;
      }
      return this.measured;
    },
  });

  // ============================================================
  // SYSTEM: aim-targeting
  // ============================================================
  AFRAME.registerSystem('aim-targeting', {
    schema: {
      // What blocks line of sight: a target behind one of these gets no
      // bracket and no lock. Empty: nothing is checked.
      occluders: { type: 'string', default: '.aim-occluder' },
      maxDistance: { default: 60 },
    },

    init: function () {
      this.targets = [];
      this.sources = {};
      this.requests = {};
      this.brackets = [];
      this.raycaster = new THREE.Raycaster();
      this._origin = new THREE.Vector3();
      this._forward = new THREE.Vector3();
      this._point = new THREE.Vector3();
      this._quat = new THREE.Quaternion();
      this._dir = new THREE.Vector3();
      this._cameraPos = new THREE.Vector3();
      this._cameraQuat = new THREE.Quaternion();
      this.spin = 0;
      var self = this;
      // Your eyes: always a source.
      this.addSource('gaze', {
        color: '#ffffff',
        getPose: function (origin, forward) {
          var camera = self.sceneEl.camera;
          if (!camera) return false;
          camera.getWorldPosition(origin);
          camera.getWorldDirection(forward);
          return true;
        },
      });
    },

    // ---------- targets and sources ----------

    addTarget: function (component) { this.targets.push(component); },

    removeTarget: function (component) {
      var i = this.targets.indexOf(component);
      if (i !== -1) this.targets.splice(i, 1);
      for (var id in this.sources) {
        var source = this.sources[id];
        if (source.lock && source.lock.component === component) source.lock = null;
        source.candidates = source.candidates.filter(function (c) { return c.component !== component; });
      }
    },

    // A source is anything you aim with. options: { getPose(origin,
    // forward) -> bool (Vector3s to fill, world space), color, weights }
    // or { object3D } to aim down an object's -Z.
    addSource: function (id, options) {
      var self = this;
      var getPose = options.getPose;
      if (!getPose && options.object3D) {
        getPose = function (origin, forward) {
          options.object3D.getWorldPosition(origin);
          options.object3D.getWorldQuaternion(self._quat);
          forward.set(0, 0, -1).applyQuaternion(self._quat);
          return true;
        };
      }
      this.sources[id] = {
        id: id, getPose: getPose, color: options.color || '#ffffff',
        weights: options.weights || DEFAULT_ASSIST,
        lock: null, candidates: [], lastScore: -Infinity, lastForward: null, lastTime: 0,
        enabled: options.enabled !== false,
      };
      return this.sources[id];
    },

    removeSource: function (id) {
      if (id !== 'gaze') delete this.sources[id];
    },

    // ---------- when brackets show ----------
    //
    // A game asks for brackets (holding something you can throw, a bow
    // drawn); the player's preference decides whether asking is needed.
    // options: { source: 'gaze', rings: false } — rings: true also draws
    // the three rings, for a game that wants them in view.
    request: function (key, options) {
      this.requests[key] = Object.assign({ source: 'gaze', rings: false }, options);
      var hud = this.sceneEl.systems['visor-hud'];
      if (hud) hud.showRings(key, this.requests[key].rings);
    },

    release: function (key) {
      delete this.requests[key];
      var hud = this.sceneEl.systems['visor-hud'];
      if (hud) hud.showRings(key, false);
    },

    bracketsFor: function (sourceId) {
      var hud = this.sceneEl.systems['visor-hud'];
      var mode = hud ? hud.prefs.targeting : 'asked';
      if (mode === 'off') return false;
      if (mode === 'always' && sourceId === 'gaze') return true;
      for (var key in this.requests) if (this.requests[key].source === sourceId) return true;
      return false;
    },

    rings: function () {
      var hud = this.sceneEl.systems['visor-hud'];
      return hud ? hud.prefs.rings : [3, 7, 14];
    },

    // ---------- the lock ----------

    // The current lock for a source, scoring afresh first if `fresh` (a
    // throw being released wants the lock as of now, not 100 ms ago).
    // Returns null or { el, component, point, distance, ring, angle,
    // closeness, strength(weights, smooth) }.
    getLock: function (sourceId, fresh) {
      var source = this.sources[sourceId || 'gaze'];
      if (!source) return null;
      if (fresh) this.score(source, this.sceneEl.time, true);
      var lock = source.lock;
      if (!lock) return null;
      var rings = this.rings();
      var weights = source.weights;
      return {
        el: lock.component.el,
        component: lock.component,
        point: lock.component.getPoint(new THREE.Vector3()),
        distance: lock.distance,
        ring: lock.ring,
        angle: lock.angle,
        closeness: lock.closeness,
        strength: function (w, smooth) { return assistStrength(lock, w || weights, rings, smooth); },
      };
    },

    // Bend a throw toward the gaze lock (or a source's), by how sure the
    // lock is: `weights` per ring, inner first. Returns a new velocity
    // {x, y, z}; an unlocked throw comes back unchanged.
    assistThrow: function (origin, velocity, weights, sourceId, gravity) {
      var lock = this.getLock(sourceId || 'gaze', true);
      if (!lock) return { x: velocity.x, y: velocity.y, z: velocity.z };
      var strength = lock.strength(weights || DEFAULT_ASSIST);
      return assistThrow(origin, velocity, lock.point, strength, gravity);
    },

    score: function (source, time, force) {
      if (!source.enabled || !source.getPose || !source.getPose(this._origin, this._forward)) {
        source.lock = null;
        source.candidates = [];
        return;
      }
      var dt = (time - source.lastTime) / 1000;
      var turning = source.lastForward && dt > 0 ? turnRate(source.lastForward, this._forward, dt) : 0;
      source.lastForward = { x: this._forward.x, y: this._forward.y, z: this._forward.z };
      source.lastTime = time;
      var rings = this.rings();
      var origin = this._origin;
      if (!force && turning > FAST_TURN) {
        // Mid-turn: keep the lock unless it has left the cone outright.
        if (source.lock) {
          var still = this.measure(source, source.lock.component, rings);
          source.lock = still;
          source.candidates = still ? [still] : [];
        }
        return;
      }
      var list = [];
      for (var i = 0; i < this.targets.length; i++) {
        var component = this.targets[i];
        if (!component.allows(source.id)) continue;
        component.getPoint(this._point);
        list.push({ id: component.el.object3D.id, component: component, x: this._point.x, y: this._point.y, z: this._point.z, radius: component.getRadius() });
      }
      var candidates = scoreCandidates(origin, this._forward, list, { rings: rings, maxDistance: this.data.maxDistance });
      // Line of sight, nearest the centre first, only for as many as could
      // be shown: a target behind a wall is not a target.
      var hud = this.sceneEl.systems['visor-hud'];
      var wanted = 1 + (hud ? hud.prefs.others : 5);
      var occluders = this.occluderObjects();
      var visible = [];
      for (var c = 0; c < candidates.length && visible.length < wanted; c++) {
        if (!occluders.length || this.clear(origin, candidates[c], occluders)) visible.push(candidates[c]);
      }
      candidates = visible.map(function (candidate) {
        candidate.component = candidate.target.component;
        return candidate;
      });
      var chosen = chooseLock(source.lock ? source.lock.id : null, candidates);
      source.lock = chosen;
      source.candidates = candidates;
      source.lastScore = time;
      if (source.id === 'gaze' && hud) hud.setFocusDistance(chosen ? chosen.distance : null);
    },

    // One target's standing for a source, or null if it is out of the cone.
    measure: function (source, component, rings) {
      component.getPoint(this._point);
      var found = scoreCandidates(this._origin, this._forward, [{
        id: component.el.object3D.id, component: component,
        x: this._point.x, y: this._point.y, z: this._point.z, radius: component.getRadius(),
      }], { rings: rings, maxDistance: this.data.maxDistance });
      if (!found.length) return null;
      found[0].component = component;
      return found[0];
    },

    occluderObjects: function () {
      if (!this.data.occluders) return [];
      if (!this._occluderEls || this.sceneEl.time - this._occludersAt > 2000) {
        this._occluderEls = Array.prototype.slice.call(this.sceneEl.querySelectorAll(this.data.occluders));
        this._occludersAt = this.sceneEl.time;
      }
      return this._occluderEls.map(function (el) { return el.object3D; });
    },

    clear: function (origin, candidate, occluders) {
      var target = candidate.target;
      this._dir.set(target.x - origin.x, target.y - origin.y, target.z - origin.z);
      var distance = this._dir.length();
      this._dir.divideScalar(distance || 1);
      this.raycaster.set(origin, this._dir);
      this.raycaster.far = Math.max(0, distance - target.radius);
      var hits = this.raycaster.intersectObjects(occluders, true);
      return hits.length === 0;
    },

    // ---------- brackets ----------

    bracket: function (index) {
      while (this.brackets.length <= index) {
        var material = new THREE.MeshBasicMaterial({
          map: shapeTexture('square'), transparent: true, opacity: 0, depthTest: false, depthWrite: false,
        });
        var mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        mesh.renderOrder = BRACKET_ORDER;
        mesh.frustumCulled = false;
        mesh.visible = false;
        mesh.name = 'aim-bracket';
        this.sceneEl.object3D.add(mesh);
        this.brackets.push({ mesh: mesh, shape: 'square' });
      }
      return this.brackets[index];
    },

    tick: function (time, delta) {
      var hud = this.sceneEl.systems['visor-hud'];
      var shape = hud ? hud.prefs.bracket : 'square';
      var others = hud ? hud.prefs.others : 5;
      var camera = this.sceneEl.camera;
      if (!camera) return;
      camera.getWorldPosition(this._cameraPos);
      camera.getWorldQuaternion(this._cameraQuat);
      this.spin += (delta || 16) / 1000 * SPIN_DEG_PER_SEC * DEG;

      var used = 0;
      for (var id in this.sources) {
        var source = this.sources[id];
        var show = this.bracketsFor(id);
        // Score when something will use it: brackets, or a game that has
        // asked (it may read getLock any moment).
        var needed = show || this.hasRequest(id);
        if (!needed) {
          if (source.lock && id === 'gaze' && hud) hud.setFocusDistance(null);
          source.lock = null;
          source.candidates = [];
          continue;
        }
        if (time - source.lastScore >= SCORE_INTERVAL_MS) this.score(source, time, false);
        if (!show) continue;
        var lockId = source.lock ? source.lock.id : null;
        var drawn = 0;
        for (var c = 0; c < source.candidates.length; c++) {
          var candidate = source.candidates[c];
          var locked = candidate.id === lockId;
          if (!locked && drawn >= others) continue;
          if (!locked) drawn++;
          this.placeBracket(this.bracket(used++), candidate, locked, source, shape);
        }
      }
      for (var b = used; b < this.brackets.length; b++) this.brackets[b].mesh.visible = false;
    },

    hasRequest: function (sourceId) {
      for (var key in this.requests) if (this.requests[key].source === sourceId) return true;
      return false;
    },

    placeBracket: function (bracket, candidate, locked, source, shape) {
      var mesh = bracket.mesh;
      if (bracket.shape !== shape) {
        bracket.shape = shape;
        mesh.material.map = shapeTexture(shape);
        mesh.material.needsUpdate = true;
      }
      var component = candidate.component;
      component.getPoint(mesh.position);
      var distance = mesh.position.distanceTo(this._cameraPos);
      // Sized to the target as you see it, within limits, plus a margin.
      var angular = Math.max(MIN_BRACKET_DEG, Math.min(MAX_BRACKET_DEG, candidate.angularRadius * 2 * 1.35));
      mesh.scale.setScalar(2 * distance * Math.tan(angular / 2 * DEG));
      mesh.quaternion.copy(this._cameraQuat);
      if (locked) mesh.rotateZ(this.spin);
      mesh.material.color.set(component.data.color || source.color);
      // The locked one at half; others faint, brighter toward the centre.
      mesh.material.opacity = locked ? LOCKED_OPACITY : 0.06 + 0.26 * candidate.closeness;
      mesh.visible = true;
    },
  });
}
