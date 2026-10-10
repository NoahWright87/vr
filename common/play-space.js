// ============================================================
// PLAY SPACE — the room you are actually standing in.
//
// WebXR describes a room-scale boundary through a bounded-floor
// reference space: a polygon of points, in metres at floor level,
// relative to that space's own origin. This module reads it once per
// change, moves it into the scene's space, and answers one question a
// scene can build on: if the room has four sides, where is the middle of
// each, and how far can you reach toward it from the middle of the room?
//
// The boundary lab draws the polygon itself, to check it against the
// headset's own guardian. The menus showcase stands a thing against each
// side of it, so nothing is placed through a real wall.
//
// Off a headset, or on one that does not report a boundary (a
// stationary guardian, a browser without bounded-floor), the room is a
// default square around where you start. A scene laid out against that
// square is laid out sensibly on a desktop and gets refitted to the real
// room the moment a headset supplies one.
//
// The geometry is plain functions with no A-Frame in them, so it is
// covered by `node --test` (tests/play-space.test.js).
// ============================================================

// "Front" is the way you face when the session starts: three.js's −Z.
// Sides go round clockwise seen from above.
export var SIDES = {
  front: { x: 0, z: -1 },
  right: { x: 1, z: 0 },
  back: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
};

// A 3 x 3 m room. Big enough to walk between four stations, small enough
// that a desktop player reaches every one of them in a few steps.
export var DEFAULT_HALF_SIZE = 1.5;

export function defaultRoom(halfSize) {
  var h = halfSize === undefined ? DEFAULT_HALF_SIZE : halfSize;
  return [
    { x: -h, y: 0, z: -h },
    { x: h, y: 0, z: -h },
    { x: h, y: 0, z: h },
    { x: -h, y: 0, z: h },
  ];
}

// Area-weighted centre of the floor polygon. A plain average of the
// points would be dragged toward whichever side the headset happened to
// describe with more of them — a curved stretch of guardian is a lot of
// points along one wall.
export function centroidOf(points) {
  var area = 0;
  var cx = 0;
  var cz = 0;
  for (var i = 0; i < points.length; i++) {
    var a = points[i];
    var b = points[(i + 1) % points.length];
    var cross = a.x * b.z - b.x * a.z;
    area += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    // Degenerate (a line, a point): fall back to the average.
    var sx = 0;
    var sz = 0;
    for (var j = 0; j < points.length; j++) { sx += points[j].x; sz += points[j].z; }
    var n = Math.max(1, points.length);
    return { x: sx / n, z: sz / n };
  }
  area *= 0.5;
  return { x: cx / (6 * area), z: cz / (6 * area) };
}

// How far from `origin` along `dir` (unit, on the floor) before leaving
// the polygon: the nearest crossing of the ray with any edge. Measuring
// along the ray rather than taking the polygon's bounding box is what
// keeps an L-shaped room from putting something in the missing corner.
export function reachAlong(points, origin, dir) {
  var best = Infinity;
  for (var i = 0; i < points.length; i++) {
    var a = points[i];
    var b = points[(i + 1) % points.length];
    var ex = b.x - a.x;
    var ez = b.z - a.z;
    var denom = dir.x * ez - dir.z * ex;
    if (Math.abs(denom) < 1e-9) continue;
    var ax = a.x - origin.x;
    var az = a.z - origin.z;
    var t = (ax * ez - az * ex) / denom;
    var u = (ax * dir.z - az * dir.x) / denom;
    if (t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 && t < best) best = t;
  }
  return best;
}

// Where each side's station goes: `inset` metres in from the boundary,
// along the line from the room's centre to that side, facing back toward
// the centre. Never closer to the centre than `minReach`, because a tiny
// boundary is better served by things you have to step past than by four
// things stacked on top of you.
export function layoutSides(points, options) {
  var opts = options || {};
  var inset = opts.inset === undefined ? 0.45 : opts.inset;
  var minReach = opts.minReach === undefined ? 0.7 : opts.minReach;
  var room = points && points.length >= 3 ? points : defaultRoom(opts.halfSize);
  var center = centroidOf(room);
  var sides = {};
  Object.keys(SIDES).forEach(function (name) {
    var dir = SIDES[name];
    var reach = reachAlong(room, center, dir);
    if (!isFinite(reach)) reach = opts.halfSize === undefined ? DEFAULT_HALF_SIZE : opts.halfSize;
    var distance = Math.max(minReach, reach - inset);
    var x = center.x + dir.x * distance;
    var z = center.z + dir.z * distance;
    sides[name] = {
      x: x,
      z: z,
      reach: reach,
      distance: distance,
      // Radians about +Y that turn an entity's +Z (the way a plane or a
      // panel faces) toward the centre of the room.
      yaw: Math.atan2(center.x - x, center.z - z),
    };
  });
  return { center: center, sides: sides };
}

// ============================================================
// SYSTEM: play-space
//
// Owns the bounded-floor request for the scene, so two things that want
// the room do not each open their own. Emits on the scene:
//
//   play-space-changed  {points, source, layout}   points in scene space
//   play-space-status   {state, status, detail}    for anything that
//                                                  reports on it in words
//
// `source` is 'default' until a headset supplies a boundary, then
// 'boundary'. Leaving XR keeps the last room rather than snapping back
// to the square: the furniture should not move because you took the
// headset off.
// ============================================================
if (typeof AFRAME !== 'undefined' && AFRAME.registerSystem && !AFRAME.systems['play-space']) {
  AFRAME.registerSystem('play-space', {
    schema: {
      halfSize: { default: DEFAULT_HALF_SIZE },
      inset: { default: 0.45 },
      minReach: { default: 0.7 },
    },

    init: function () {
      var THREE = AFRAME.THREE;
      this.session = null;
      this.boundedSpace = null;
      this.pending = false;
      this.matrix = new THREE.Matrix4();
      this.point = new THREE.Vector3();
      this.lastMatrix = null;
      this.source = 'default';
      this.points = defaultRoom(this.data.halfSize);
      this.layout = this.computeLayout();
      this.state = 'inactive';
      this.status = 'Enter VR to detect';
      this.detail = 'The cyan ground outline will match\nthe headset\'s reported play space.';

      this.onEnterVR = this.start.bind(this);
      this.onExitVR = this.stop.bind(this);
      this.el.addEventListener('enter-vr', this.onEnterVR);
      this.el.addEventListener('exit-vr', this.onExitVR);
    },

    computeLayout: function () {
      return layoutSides(this.points, {
        inset: this.data.inset,
        minReach: this.data.minReach,
        halfSize: this.data.halfSize,
      });
    },

    // The current room, for anything that arrives after the last change.
    getLayout: function () { return this.layout; },
    getPoints: function () { return this.points; },

    setStatus: function (state, status, detail) {
      this.state = state;
      this.status = status;
      this.detail = detail;
      this.el.emit('play-space-status', { state: state, status: status, detail: detail }, false);
    },

    setPoints: function (points, source) {
      this.points = points;
      this.source = source;
      this.layout = this.computeLayout();
      this.el.emit('play-space-changed', { points: points, source: source, layout: this.layout }, false);
    },

    start: function () {
      var renderer = this.el.renderer;
      var session = renderer && renderer.xr && renderer.xr.getSession && renderer.xr.getSession();
      if (!session || this.pending || this.session === session) return;
      this.pending = true;
      this.session = session;
      this.setStatus('requesting', 'Requesting headset boundary…', 'Reading the room-scale play space\nfrom this XR session.');

      var self = this;
      session.requestReferenceSpace('bounded-floor').then(function (space) {
        if (self.session !== session) return;
        self.pending = false;
        self.boundedSpace = space;
        if (space.addEventListener) space.addEventListener('reset', function () { self.lastMatrix = null; });
        if (!space.boundsGeometry || space.boundsGeometry.length < 3) {
          self.setStatus('missing', 'No boundary geometry supplied', 'This headset/browser supports XR,\nbut did not expose a play-space outline.');
          return;
        }
        self.setStatus('detected', 'Boundary detected', 'Align the cyan outline with your\nheadset safety boundary.');
        session.requestAnimationFrame(function onXRFrame(time, frame) {
          if (self.session !== session) return;
          self.updateFromFrame(frame);
          session.requestAnimationFrame(onXRFrame);
        });
      }).catch(function () {
        if (self.session !== session) return;
        self.pending = false;
        self.setStatus('unavailable', 'Boundary unavailable', 'This headset or browser does not\nprovide bounded-floor play-space data.');
      });
    },

    stop: function () {
      this.session = null;
      this.boundedSpace = null;
      this.pending = false;
      this.lastMatrix = null;
      this.setStatus('inactive', 'Enter VR to detect', 'The cyan outline appears only when\na headset supplies boundary data.');
    },

    // The bounds are in the bounded-floor space; the scene is in whatever
    // space the renderer presents from (local-floor). The pose between
    // the two can change when the headset re-centres, so this re-runs
    // whenever it does, and only then.
    updateFromFrame: function (frame) {
      var renderer = this.el.renderer;
      var baseSpace = renderer && renderer.xr && renderer.xr.getReferenceSpace && renderer.xr.getReferenceSpace();
      if (!baseSpace || !this.boundedSpace) return;
      var pose = frame.getPose(this.boundedSpace, baseSpace);
      if (!pose) return;

      this.matrix.fromArray(pose.transform.matrix);
      var elements = this.matrix.elements;
      var last = this.lastMatrix;
      if (last && elements.every(function (value, index) { return Math.abs(value - last[index]) < 0.0001; })) return;
      this.lastMatrix = elements.slice();

      var bounds = this.boundedSpace.boundsGeometry;
      var points = [];
      var minX = Infinity;
      var maxX = -Infinity;
      var minZ = Infinity;
      var maxZ = -Infinity;
      for (var i = 0; i < bounds.length; i++) {
        var bound = bounds[i];
        minX = Math.min(minX, bound.x);
        maxX = Math.max(maxX, bound.x);
        minZ = Math.min(minZ, bound.z);
        maxZ = Math.max(maxZ, bound.z);
        this.point.set(bound.x, bound.y, bound.z).applyMatrix4(this.matrix);
        points.push({ x: this.point.x, y: this.point.y, z: this.point.z });
      }
      this.setPoints(points, 'boundary');
      this.setStatus(
        'detected',
        'Boundary detected · ' + bounds.length + ' corners',
        (maxX - minX).toFixed(1) + ' × ' + (maxZ - minZ).toFixed(1) + ' m play-space bounds\nCyan line = exact detected outline.'
      );
    },

    remove: function () {
      this.el.removeEventListener('enter-vr', this.onEnterVR);
      this.el.removeEventListener('exit-vr', this.onExitVR);
    },
  });

  // Stand an entity against one side of the room, facing the middle.
  // Only x, z and yaw are written; height stays whatever the markup says.
  AFRAME.registerComponent('play-space-station', {
    schema: {
      side: { default: 'front', oneOf: ['front', 'right', 'back', 'left'] },
    },

    init: function () {
      this.system = this.el.sceneEl.systems['play-space'];
      this.onChanged = this.place.bind(this);
      this.el.sceneEl.addEventListener('play-space-changed', this.onChanged);
      this.place();
    },

    update: function () { this.place(); },

    place: function () {
      if (!this.system) return;
      var side = this.system.getLayout().sides[this.data.side];
      if (!side) return;
      var object3D = this.el.object3D;
      object3D.position.x = side.x;
      object3D.position.z = side.z;
      object3D.rotation.y = side.yaw;
      this.el.emit('play-space-station-placed', { side: this.data.side, station: side }, false);
    },

    remove: function () {
      this.el.sceneEl.removeEventListener('play-space-changed', this.onChanged);
    },
  });

  // The room's edge drawn on the floor, at the scene root rather than
  // under the rig: smooth or teleport locomotion moves the rig, while the
  // boundary is in the XR reference space, so the scene root is where it
  // stays put against the real room. Corners get a dot each, since an
  // irregular guardian is easiest to check against at its corners.
  AFRAME.registerComponent('play-space-outline', {
    schema: {
      color: { type: 'color', default: '#22d3ee' },
      opacity: { default: 0.95 },
      corners: { default: true },
      // Whether to draw the stand-in square too. The boundary lab only
      // wants the real thing; the showcase draws the square faintly so a
      // desktop player can see the room it is laid out in.
      showDefault: { default: false },
      defaultOpacity: { default: 0.3 },
    },

    init: function () {
      var THREE = AFRAME.THREE;
      this.space = this.el.sceneEl.systems['play-space'];
      this.geometry = new THREE.BufferGeometry();
      this.cornerGeometry = new THREE.BufferGeometry();
      this.outline = new THREE.LineLoop(
        this.geometry,
        new THREE.LineBasicMaterial({ color: this.data.color, transparent: true, opacity: this.data.opacity, depthTest: false })
      );
      this.cornerDots = new THREE.Points(
        this.cornerGeometry,
        new THREE.PointsMaterial({ color: '#f8fafc', size: 0.055, sizeAttenuation: true, depthTest: false })
      );
      this.outline.renderOrder = this.cornerDots.renderOrder = 1;
      this.outline.visible = this.cornerDots.visible = false;
      this.renderRoot = this.el.sceneEl.object3D;
      this.renderRoot.add(this.outline);
      this.renderRoot.add(this.cornerDots);

      var self = this;
      this.onChanged = function (evt) { self.draw(evt.detail.points, evt.detail.source); };
      this.onStatus = function (evt) {
        // The real outline belongs to a live session; taking the headset
        // off takes it away (or back to the square, if that is shown).
        if (evt.detail.state !== 'inactive' || !self.space) return;
        if (self.data.showDefault) self.draw(defaultRoom(self.space.data.halfSize), 'default');
        else self.outline.visible = self.cornerDots.visible = false;
      };
      this.el.sceneEl.addEventListener('play-space-changed', this.onChanged);
      this.el.sceneEl.addEventListener('play-space-status', this.onStatus);
      if (this.space) this.draw(this.space.getPoints(), this.space.source);
    },

    draw: function (points, source) {
      var isDefault = source !== 'boundary';
      if (isDefault && !this.data.showDefault) {
        this.outline.visible = this.cornerDots.visible = false;
        return;
      }
      var positions = new Float32Array(points.length * 3);
      for (var i = 0; i < points.length; i++) {
        positions[i * 3] = points[i].x;
        // Just above the floor, so the line is not z-fighting it.
        positions[i * 3 + 1] = (points[i].y || 0) + 0.028;
        positions[i * 3 + 2] = points[i].z;
      }
      this.geometry.setAttribute('position', new AFRAME.THREE.Float32BufferAttribute(positions, 3));
      this.cornerGeometry.setAttribute('position', new AFRAME.THREE.Float32BufferAttribute(positions, 3));
      this.geometry.computeBoundingSphere();
      this.cornerGeometry.computeBoundingSphere();
      this.outline.material.opacity = isDefault ? this.data.defaultOpacity : this.data.opacity;
      this.outline.visible = true;
      this.cornerDots.visible = this.data.corners && !isDefault;
    },

    remove: function () {
      this.el.sceneEl.removeEventListener('play-space-changed', this.onChanged);
      this.el.sceneEl.removeEventListener('play-space-status', this.onStatus);
      this.renderRoot.remove(this.outline);
      this.renderRoot.remove(this.cornerDots);
      this.geometry.dispose();
      this.cornerGeometry.dispose();
      this.outline.material.dispose();
      this.cornerDots.material.dispose();
    },
  });

  // Keep something at a fixed spot relative to a station without
  // parenting it there — a grab box has to stay a child of the scene so
  // picking it up and dropping it work, but its resting place is "on that
  // platform", wherever the platform ends up. Anything that remembers
  // where it started (simple-grabbable's reset point) is told too, so
  // Reset puts it back on the platform rather than where the platform
  // used to be.
  AFRAME.registerComponent('play-space-anchor', {
    schema: {
      station: { type: 'selector' },
      offset: { type: 'vec3' },
    },

    init: function () {
      this.onPlaced = this.place.bind(this);
      this.bindStation();
      this.place();
    },

    update: function (oldData) {
      if (oldData && oldData.station !== this.data.station) this.bindStation();
      this.place();
    },

    bindStation: function () {
      if (this.stationEl) this.stationEl.removeEventListener('play-space-station-placed', this.onPlaced);
      this.stationEl = this.data.station;
      if (this.stationEl) this.stationEl.addEventListener('play-space-station-placed', this.onPlaced);
    },

    place: function () {
      var station = this.stationEl;
      if (!station || !station.object3D) return;
      var offset = this.data.offset;
      station.object3D.updateMatrixWorld(true);
      var world = station.object3D.localToWorld(new AFRAME.THREE.Vector3(offset.x, offset.y, offset.z));
      var parent = this.el.object3D.parent;
      var local = parent ? parent.worldToLocal(world.clone()) : world;
      var grabbable = this.el.components['simple-grabbable'];
      if (grabbable && grabbable.spawnPosition) grabbable.spawnPosition.copy(local);
      // A box in someone's hand stays there; it goes home on Reset.
      if (!grabbable || grabbable.state !== 'held') this.el.object3D.position.copy(local);
    },

    remove: function () {
      if (this.stationEl) this.stationEl.removeEventListener('play-space-station-placed', this.onPlaced);
    },
  });
}
