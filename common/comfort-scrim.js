// ============================================================
// COMFORT SCRIM — a dark wash around the edges of your view.
//
// Two jobs, one wash. It makes floating menu text readable against a
// bright or busy world, and it cuts down the motion you see in your
// peripheral vision while you move with the stick — which is most of what
// makes smooth locomotion sickening. The player chooses when it shows:
//
//   never          off
//   menus          while a menu you have up (the visor, the watch, a prop
//                  panel) is open
//   moving         while you are moved virtually: the stick, smooth
//                  turning, a vehicle. Not when you move your own head.
//   menus-moving   either
//   always         all the time
//
// and how it looks: sides (left and right) or a tunnel (all round), how
// far in from the edge it reaches, how dark it gets and how soft its inner
// edge is. The settings are the player's, saved in this browser and the
// same in every game; every visor has them under Visor ▸ Scrim.
//
// It is drawn on the screen, not in the room (screenSpaceAll in
// menu-crossbar.js), so "the edge of your view" is the edge of each eye's
// display on any headset, and the wash sits at the same place in both eyes
// the way a real vignette does. Only the band around the clear middle is
// geometry: the middle of the view is never blended over, which a Quest's
// GPU would pay for every frame.
//
// It is symmetric by construction — one mesh, one profile — which is the
// fix for the old menu scrim that was faded on one side and solid on the
// other.
// ============================================================

import { OVERLAY_RENDER_ORDER, screenSpaceAll } from './menu-crossbar.js';

export var SCRIM_SHOW = [
  { value: 'never', label: 'Never' },
  { value: 'menus', label: 'In menus' },
  { value: 'moving', label: 'When moving' },
  { value: 'menus-moving', label: 'Menus + moving' },
  { value: 'always', label: 'Always' },
];
export var SCRIM_SHAPES = [
  { value: 'sides', label: 'Sides' },
  { value: 'tunnel', label: 'Tunnel' },
];

// size: how far in from the edge of view it reaches, as a fraction of the
// way to the middle. softness: how much of that is a fade rather than
// solid. darkness: its opacity where it is solid.
export var SCRIM_DEFAULTS = { show: 'moving', shape: 'sides', size: 0.35, darkness: 0.75, softness: 0.7 };

var STORAGE_KEY = 'vr.scrim';

function clamp(value, min, max, fallback) {
  var n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function oneOf(list, value, fallback) {
  return list.some(function (option) { return option.value === value; }) ? value : fallback;
}

export function cleanScrim(values) {
  var v = values || {};
  var d = SCRIM_DEFAULTS;
  return {
    show: oneOf(SCRIM_SHOW, v.show, d.show),
    shape: oneOf(SCRIM_SHAPES, v.shape, d.shape),
    size: clamp(v.size, 0.05, 0.9, d.size),
    darkness: clamp(v.darkness, 0.1, 1, d.darkness),
    softness: clamp(v.softness, 0.05, 1, d.softness),
  };
}

export function loadScrim() {
  try {
    var saved = typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY);
    return cleanScrim(saved ? JSON.parse(saved) : null);
  } catch (e) {
    return cleanScrim(null);
  }
}

export function saveScrim(settings) {
  try { if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
}

// The wash's opacity at a point of the view, x and y from -1 to 1 at the
// edges. Clear inside 1 - size; fading over `softness` of the band; solid
// (at `darkness`) beyond. Smoothstepped, so the inner edge has no line.
export function scrimAlpha(x, y, settings) {
  var s = settings;
  var d = s.shape === 'tunnel' ? Math.hypot(x, y) : Math.abs(x);
  var inner = 1 - s.size;
  var solid = inner + s.size * s.softness;
  if (d <= inner) return 0;
  if (d >= solid) return s.darkness;
  var t = (d - inner) / (solid - inner);
  return s.darkness * t * t * (3 - 2 * t);
}

// How much of the time the wash should be up, 0 or 1, before fading.
export function scrimWanted(show, state) {
  if (show === 'always') return 1;
  if (show === 'menus') return state.menu ? 1 : 0;
  if (show === 'moving') return state.moving ? 1 : 0;
  if (show === 'menus-moving') return state.menu || state.moving ? 1 : 0;
  return 0;
}

// Virtual motion: how the player's rig (the camera's parent — everything
// that moves you except your own head) moved between two samples
// ({ x, y, z, yaw, t } in metres, radians and ms). A teleport or a snap
// turn is one frame's jump, far faster than anyone is moved smoothly, and
// is not "moving": there is no flow to see.
export var MOTION = {
  minSpeed: 0.35, // m/s
  maxSpeed: 25,
  minTurn: 0.35, // rad/s
  maxTurn: 12,
};

export function readMotion(previous, sample, options) {
  var o = Object.assign({}, MOTION, options);
  if (!previous) return { speed: 0, turn: 0, moving: false };
  var dt = (sample.t - previous.t) / 1000;
  if (!(dt > 0)) return { speed: 0, turn: 0, moving: false };
  var speed = Math.hypot(sample.x - previous.x, sample.y - previous.y, sample.z - previous.z) / dt;
  var dyaw = sample.yaw - previous.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  var turn = Math.abs(dyaw) / dt;
  var moved = speed >= o.minSpeed && speed <= o.maxSpeed;
  var turned = o.turns !== false && turn >= o.minTurn && turn <= o.maxTurn;
  var jumped = speed > o.maxSpeed || turn > o.maxTurn;
  return { speed: speed, turn: turn, moving: !jumped && (moved || turned) };
}

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  // Below the HUD's widgets and the visor menu, which sit at and just
  // under OVERLAY_RENDER_ORDER, so text stays on top of the wash.
  var SCRIM_ORDER = OVERLAY_RENDER_ORDER - 50;
  var FADE_IN_MS = 180;
  var FADE_OUT_MS = 500;
  // Motion has to have stopped this long before the wash starts to fade,
  // so one still frame mid-walk does not flicker it.
  var MOVING_HOLD_MS = 250;
  var TEXTURE = 128;

  AFRAME.registerSystem('comfort-scrim', {
    schema: {
      // A scene whose rig is moved on purpose without the player knowing —
      // redirected walking — must not announce it with a wash.
      ignoreMotion: { default: false },
    },

    init: function () {
      this.settings = loadScrim();
      this.level = 0;
      this.preview = false;
      this.movingUntil = 0;
      this.previous = null;
      this._position = new THREE.Vector3();
      this._quaternion = new THREE.Quaternion();
      this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
      var self = this;
      this.sceneEl.addEventListener('loaded', function () { self.build(); });
    },

    build: function () {
      var cameraEl = this.sceneEl.camera && this.sceneEl.camera.el;
      // (this.el is the scene: a system's own entity is the scene.)
      if (!cameraEl || this.scrimEl) return;
      var el = document.createElement('a-entity');
      el.setAttribute('id', 'comfort-scrim');
      this.canvas = document.createElement('canvas');
      this.canvas.width = TEXTURE;
      this.canvas.height = TEXTURE;
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.material = new THREE.MeshBasicMaterial({
        color: 0x000000, map: this.texture, transparent: true, opacity: 0,
        depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      });
      this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
      this.mesh.renderOrder = SCRIM_ORDER;
      this.mesh.visible = false;
      el.setObject3D('mesh', this.mesh);
      cameraEl.appendChild(el);
      this.scrimEl = el;
      this.aspect = 1;
      this.redraw();
      // The whole viewport, in each eye: NDC -1..1 across, which is two
      // units of local width.
      screenSpaceAll(el, { anchor: { x: 0, y: 0 }, width: 2, localWidth: 2 });
    },

    // ---------- settings ----------

    getSettings: function () {
      return Object.assign({}, this.settings);
    },

    // `save: false` for a value being scrolled (it previews), true when it
    // is committed.
    setSettings: function (values, options) {
      this.settings = cleanScrim(Object.assign({}, this.settings, values));
      if (!options || options.save !== false) saveScrim(this.settings);
      this.redraw();
      this.sceneEl.emit('comfort-scrim-changed', { settings: this.getSettings() }, false);
    },

    // Shown regardless of `show` while you are tuning it, so you can see
    // what you are changing.
    setPreview: function (preview) {
      this.preview = Boolean(preview);
    },

    describe: function () {
      var s = this.settings;
      var label = function (list, value) {
        for (var i = 0; i < list.length; i++) if (list[i].value === value) return list[i].label;
        return value;
      };
      var pct = function (v) { return Math.round(v * 100) + '%'; };
      return 'Scrim ' + label(SCRIM_SHOW, s.show) + '  ' + label(SCRIM_SHAPES, s.shape) +
        '\nSize ' + pct(s.size) + '  Dark ' + pct(s.darkness) + '  Soft ' + pct(s.softness);
    },

    // ---------- drawing ----------

    // The profile into the texture, and the band of geometry it needs: the
    // clear middle is left out entirely.
    redraw: function () {
      if (!this.canvas) return;
      var s = this.settings;
      var ctx = this.canvas.getContext('2d');
      var image = ctx.createImageData(TEXTURE, TEXTURE);
      for (var j = 0; j < TEXTURE; j++) {
        // Texture rows run top to bottom, and y is up. The mesh is stretched
        // to the view's own height (applyAspect), so -1..1 is edge to edge
        // both ways and a tunnel follows the shape of the display.
        var y = (1 - (2 * (j + 0.5)) / TEXTURE);
        for (var i = 0; i < TEXTURE; i++) {
          var x = (2 * (i + 0.5)) / TEXTURE - 1;
          image.data[(j * TEXTURE + i) * 4 + 3] = Math.round(255 * scrimAlpha(x, y, s));
        }
      }
      ctx.putImageData(image, 0, 0);
      this.texture.needsUpdate = true;

      // The clear middle: |x| < inner, and for a tunnel also |y| < inner —
      // the square inside the clear circle, which is inner / sqrt(2).
      var inner = 1 - s.size;
      var hole = s.shape === 'tunnel' ? { x: inner / Math.SQRT2, y: inner / Math.SQRT2 } : { x: inner, y: 1 };
      var old = this.mesh.geometry;
      this.mesh.geometry = frameGeometry(hole.x, hole.y);
      old.dispose();
      this.applyAspect();
    },

    // The view is `aspect` (height over width, in tangent terms) as tall as
    // it is wide: scale the unit square to that, so -1..1 in y is the top
    // and bottom of the display.
    applyAspect: function () {
      if (this.mesh) this.mesh.scale.set(1, this.aspect, 1);
    },

    viewAspect: function () {
      var renderer = this.sceneEl.renderer;
      var camera = this.sceneEl.camera;
      if (renderer && renderer.xr && renderer.xr.isPresenting) {
        var xrCamera = renderer.xr.getCamera();
        if (xrCamera && xrCamera.cameras && xrCamera.cameras[0]) camera = xrCamera.cameras[0];
      }
      var p = camera && camera.projectionMatrix && camera.projectionMatrix.elements;
      // p[0] = 1 / tan(half width), p[5] = 1 / tan(half height).
      return p && p[5] ? p[0] / p[5] : 1;
    },

    // ---------- when ----------

    menuUp: function () {
      var sticks = this.sceneEl.systems['menu-stick-control'];
      if (!sticks) return false;
      for (var i = 0; i < sticks.menus.length; i++) {
        var component = sticks.menus[i];
        // A menu you have up — the visor, the watch, a panel grown out of
        // a prop — not a panel that simply stands in the room.
        if (component.menu && component.menu.isOpen && component.data.closeBehavior === 'hide') return true;
      }
      return false;
    },

    sampleMotion: function (time) {
      var cameraEl = this.sceneEl.camera && this.sceneEl.camera.el;
      var rig = cameraEl && cameraEl.object3D.parent;
      if (!rig) return false;
      rig.updateMatrixWorld();
      rig.getWorldPosition(this._position);
      rig.getWorldQuaternion(this._quaternion);
      this._euler.setFromQuaternion(this._quaternion);
      var sample = { x: this._position.x, y: this._position.y, z: this._position.z, yaw: this._euler.y, t: time };
      var mode = this.sceneEl.systems['control-mode'];
      // Off a headset, turning the view with the mouse turns the rig; that
      // is looking, not being moved.
      var xr = Boolean(mode && mode.isMode('xr'));
      var motion = readMotion(this.previous, sample, { turns: xr });
      this.previous = sample;
      return motion.moving;
    },

    tick: function (time, delta) {
      if (!this.mesh) return;
      if (!this.data.ignoreMotion && this.sampleMotion(time)) this.movingUntil = time + MOVING_HOLD_MS;
      var wanted = this.preview ? 1 : scrimWanted(this.settings.show, {
        menu: this.menuUp(),
        moving: time < this.movingUntil,
      });
      var step = (delta || 16) / (wanted > this.level ? FADE_IN_MS : FADE_OUT_MS);
      this.level = wanted > this.level ? Math.min(wanted, this.level + step) : Math.max(wanted, this.level - step);
      this.material.opacity = this.level;
      this.mesh.visible = this.level > 0.001;
      if (!this.mesh.visible) return;
      var aspect = this.viewAspect();
      if (Math.abs(aspect - this.aspect) > 0.001) {
        this.aspect = aspect;
        this.applyAspect();
      }
    },
  });

  // A unit square (-1..1) with a rectangular hole of half-size hx, hy in
  // the middle, as up to four quads, UVs matching positions. A hole that
  // reaches the top and bottom (hy >= 1) leaves just the two sides.
  function frameGeometry(hx, hy) {
    var quads = [];
    hx = Math.max(0, Math.min(1, hx));
    hy = Math.max(0, Math.min(1, hy));
    quads.push([-1, -1, -hx, 1], [hx, -1, 1, 1]);
    if (hy < 1) quads.push([-hx, hy, hx, 1], [-hx, -1, hx, -hy]);
    var positions = [];
    var uvs = [];
    var indices = [];
    quads.forEach(function (q, k) {
      var corners = [[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]];
      corners.forEach(function (c) {
        positions.push(c[0], c[1], 0);
        uvs.push((c[0] + 1) / 2, (c[1] + 1) / 2);
      });
      var a = k * 4;
      indices.push(a, a + 1, a + 2, a, a + 2, a + 3);
    });
    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    return geometry;
  }
}
