// ============================================================
// DEBUG DRAW — immediate-mode lines, one draw call.
//
// Any system can draw what it's thinking — a hitbox, a targeting cone,
// a velocity — for the current frame only:
//
//   var dd = sceneEl.systems['debug-draw'];
//   if (dd.on('targeting')) dd.cone(apex, dir, angle, length, '#ff0');
//
// Everything drawn in a frame goes into one preallocated
// THREE.LineSegments (grown when needed, never rebuilt per frame), so
// the overlay costs one draw call however much is on it. A channel that
// is off costs nothing as long as callers check on() first.
//
// Channels are named by the systems that use them and toggled from the
// visor (see common/action-debug.js). Toggles persist per page.
//
// The shape writers are plain functions over a Float32Array and are
// tested by tests/debug-draw.test.js.
// ============================================================

// ---------- shape writers (pure) ----------
// Each writes line-segment endpoint pairs into `out` (xyz per vertex)
// starting at vertex `at`, and returns the new vertex count. They never
// write past `capacity` vertices; callers grow first if they need to.

function basis(dir) {
  // Two unit vectors perpendicular to dir (and to each other).
  var ax = Math.abs(dir.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  var u = cross(dir, ax);
  normalize(u);
  var w = cross(dir, u);
  normalize(w);
  return { u: u, w: w };
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function normalize(a) {
  var l = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) || 1;
  a.x /= l; a.y /= l; a.z /= l;
  return a;
}

export function writeLine(out, at, a, b) {
  var i = at * 3;
  out[i] = a.x; out[i + 1] = a.y; out[i + 2] = a.z;
  out[i + 3] = b.x; out[i + 4] = b.y; out[i + 5] = b.z;
  return at + 2;
}

// A circle of radius r around center, in the plane spanned by u and w.
export function writeCircle(out, at, center, r, u, w, segments) {
  var n = segments || 16;
  var prev = null;
  for (var i = 0; i <= n; i++) {
    var t = (i / n) * Math.PI * 2;
    var c = Math.cos(t) * r;
    var s = Math.sin(t) * r;
    var p = { x: center.x + u.x * c + w.x * s, y: center.y + u.y * c + w.y * s, z: center.z + u.z * c + w.z * s };
    if (prev) at = writeLine(out, at, prev, p);
    prev = p;
  }
  return at;
}

// Three great circles.
export function writeSphere(out, at, center, r, segments) {
  var X = { x: 1, y: 0, z: 0 }, Y = { x: 0, y: 1, z: 0 }, Z = { x: 0, y: 0, z: 1 };
  at = writeCircle(out, at, center, r, X, Y, segments);
  at = writeCircle(out, at, center, r, Y, Z, segments);
  at = writeCircle(out, at, center, r, X, Z, segments);
  return at;
}

// Two end rings plus four side lines.
export function writeCapsule(out, at, a, b, r, segments) {
  var axis = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  var len = Math.sqrt(axis.x * axis.x + axis.y * axis.y + axis.z * axis.z);
  if (len < 1e-6) return writeSphere(out, at, a, r, segments);
  normalize(axis);
  var bw = basis(axis);
  at = writeCircle(out, at, a, r, bw.u, bw.w, segments);
  at = writeCircle(out, at, b, r, bw.u, bw.w, segments);
  [bw.u, bw.w, { x: -bw.u.x, y: -bw.u.y, z: -bw.u.z }, { x: -bw.w.x, y: -bw.w.y, z: -bw.w.z }].forEach(function (d) {
    at = writeLine(out, at,
      { x: a.x + d.x * r, y: a.y + d.y * r, z: a.z + d.z * r },
      { x: b.x + d.x * r, y: b.y + d.y * r, z: b.z + d.z * r });
  });
  // Caps: a half-circle over each end, in both side planes.
  [bw.u, bw.w].forEach(function (side) {
    at = writeArc(out, at, a, r, side, { x: -axis.x, y: -axis.y, z: -axis.z }, segments);
    at = writeArc(out, at, b, r, side, axis, segments);
  });
  return at;
}

// Half circle from -side through `bulge` to +side.
function writeArc(out, at, center, r, side, bulge, segments) {
  var n = Math.max(4, Math.round((segments || 16) / 2));
  var prev = null;
  for (var i = 0; i <= n; i++) {
    var t = (i / n) * Math.PI;
    var c = -Math.cos(t) * r;
    var s = Math.sin(t) * r;
    var p = { x: center.x + side.x * c + bulge.x * s, y: center.y + side.y * c + bulge.y * s, z: center.z + side.z * c + bulge.z * s };
    if (prev) at = writeLine(out, at, prev, p);
    prev = p;
  }
  return at;
}

// A cone: four edge lines from the apex and a ring at the far end.
export function writeCone(out, at, apex, dir, angle, length, segments) {
  var d = normalize({ x: dir.x, y: dir.y, z: dir.z });
  var bw = basis(d);
  var r = Math.tan(Math.min(angle, Math.PI / 2 - 0.01)) * length;
  var end = { x: apex.x + d.x * length, y: apex.y + d.y * length, z: apex.z + d.z * length };
  at = writeCircle(out, at, end, r, bw.u, bw.w, segments);
  [bw.u, bw.w, { x: -bw.u.x, y: -bw.u.y, z: -bw.u.z }, { x: -bw.w.x, y: -bw.w.y, z: -bw.w.z }].forEach(function (s) {
    at = writeLine(out, at, apex, { x: end.x + s.x * r, y: end.y + s.y * r, z: end.z + s.z * r });
  });
  return at;
}

export function writeCross(out, at, p, size) {
  var h = size / 2;
  at = writeLine(out, at, { x: p.x - h, y: p.y, z: p.z }, { x: p.x + h, y: p.y, z: p.z });
  at = writeLine(out, at, { x: p.x, y: p.y - h, z: p.z }, { x: p.x, y: p.y + h, z: p.z });
  at = writeLine(out, at, { x: p.x, y: p.y, z: p.z - h }, { x: p.x, y: p.y, z: p.z + h });
  return at;
}

// Vertices each shape needs, so the batch can grow before writing.
export var VERTS = {
  line: 2,
  circle: function (seg) { return (seg || 16) * 2; },
  sphere: function (seg) { return (seg || 16) * 6; },
  capsule: function (seg) {
    var n = seg || 16;
    var half = Math.max(4, Math.round(n / 2));
    return n * 4 + 8 + half * 8;
  },
  cone: function (seg) { return (seg || 16) * 2 + 8; },
  cross: 6,
};

// ---------- the A-Frame system ----------

var STORAGE_KEY = 'debug-draw:channels';

export var DEBUG_CHANNELS = [
  { id: 'hitboxes', label: 'Hitboxes' },
  { id: 'targeting', label: 'Targeting' },
  { id: 'motion', label: 'Motion' },
  { id: 'assist', label: 'Assist' },
  { id: 'intent', label: 'Intent' },
  { id: 'attacks', label: 'Attacks' },
];

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['debug-draw']) {
  var THREE = AFRAME.THREE;

  AFRAME.registerSystem('debug-draw', {
    init: function () {
      this.capacity = 0;
      this.count = 0;
      this.frameTime = -1;
      this.channels = {};
      this.color = new THREE.Color();
      this.loadChannels();

      this.geometry = new THREE.BufferGeometry();
      this.allocate(4096);
      // Drawn over everything: an overlay you can't see through a wall
      // doesn't answer "where is the hitbox".
      this.material = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false,
      });
      this.lines = new THREE.LineSegments(this.geometry, this.material);
      this.lines.frustumCulled = false;
      this.lines.renderOrder = 10000;
      this.lines.name = 'debug-draw';
      this.el.object3D.add(this.lines);
    },

    allocate: function (capacity) {
      var positions = new Float32Array(capacity * 3);
      var colors = new Float32Array(capacity * 3);
      if (this.positions) {
        positions.set(this.positions.subarray(0, this.count * 3));
        colors.set(this.colors.subarray(0, this.count * 3));
      }
      this.positions = positions;
      this.colors = colors;
      this.capacity = capacity;
      this.positionAttr = new THREE.BufferAttribute(positions, 3);
      this.colorAttr = new THREE.BufferAttribute(colors, 3);
      this.positionAttr.setUsage(THREE.DynamicDrawUsage);
      this.colorAttr.setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute('position', this.positionAttr);
      this.geometry.setAttribute('color', this.colorAttr);
    },

    loadChannels: function () {
      try {
        var saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (saved && typeof saved === 'object') this.channels = saved;
      } catch (e) { this.channels = {}; }
    },

    on: function (channel) { return Boolean(this.channels[channel]); },

    setChannel: function (channel, enabled) {
      this.channels[channel] = Boolean(enabled);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.channels)); } catch (e) { /* not persisted */ }
      this.el.emit('debug-channel-changed', { channel: channel, enabled: Boolean(enabled) }, false);
    },

    // Called by every draw: the first draw of a new frame clears the
    // last one's, whichever system happens to tick first.
    begin: function (vertices) {
      var time = this.el.time;
      if (time !== this.frameTime) {
        this.frameTime = time;
        this.count = 0;
      }
      if (this.count + vertices > this.capacity) {
        var next = this.capacity;
        while (this.count + vertices > next) next *= 2;
        this.allocate(next);
      }
      return this.count;
    },

    end: function (from, to, color) {
      this.color.set(color || '#ffffff');
      for (var i = from; i < to; i++) {
        this.colors[i * 3] = this.color.r;
        this.colors[i * 3 + 1] = this.color.g;
        this.colors[i * 3 + 2] = this.color.b;
      }
      this.count = to;
      this.positionAttr.needsUpdate = true;
      this.colorAttr.needsUpdate = true;
      this.geometry.setDrawRange(0, this.count);
    },

    line: function (a, b, color) { var at = this.begin(2); this.end(at, writeLine(this.positions, at, a, b), color); },
    sphere: function (c, r, color, seg) { var at = this.begin(VERTS.sphere(seg)); this.end(at, writeSphere(this.positions, at, c, r, seg), color); },
    capsule: function (a, b, r, color, seg) { var at = this.begin(VERTS.capsule(seg)); this.end(at, writeCapsule(this.positions, at, a, b, r, seg), color); },
    cone: function (apex, dir, angle, length, color, seg) { var at = this.begin(VERTS.cone(seg)); this.end(at, writeCone(this.positions, at, apex, dir, angle, length, seg), color); },
    cross: function (p, size, color) { var at = this.begin(VERTS.cross); this.end(at, writeCross(this.positions, at, p, size), color); },
    circle: function (c, r, u, w, color, seg) { var at = this.begin(VERTS.circle(seg)); this.end(at, writeCircle(this.positions, at, c, r, u, w, seg), color); },

    // A frame nobody drew in still has last frame's lines in the buffer;
    // empty it before rendering.
    tick: function (time) {
      if (time !== this.frameTime && this.count) {
        this.count = 0;
        this.geometry.setDrawRange(0, 0);
      }
    },
  });
}
