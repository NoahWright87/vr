// Drawing the floor by hand, because the automatic read got it wrong.
//
// The Guardian rectangle that `common/guardian-bounds.js` computes turned
// out, in a headset, not to land inside the real boundary at all -- "not
// even close". Until that is understood, the useful thing is a floor you
// can see and a floor you can correct: four draggable corners, drawn flat
// on the ground, next to what the automatic read believes.
//
// It is also the measurement that settles the question. Corner positions
// captured this way come from the controller's own pose -- the same pose
// stream that moves the player through the world -- so they cannot be
// wrong about which reference space they are in. If the hand-placed quad
// and the automatically-fitted rectangle disagree, that disagreement is
// the bug, localised to the bounded-floor read rather than anywhere else.
//
// Controls, in a headset:
//   any face button (A/B/X/Y)  toggle edit mode
//   grip                       grab the highlighted corner and move it
//   trigger (while editing)    put all four corners back where the
//                              automatic read says they should be
//
// Outside a headset the camera stands in for the controller, so the whole
// thing can be driven headlessly.

import { rectCorners } from '../../../common/guardian-bounds.js';
import '../../../common/checkerboard.js';

var STORAGE_KEY = 'rainbow-hotel-floor-v1';

// Where a ray from the controller meets the floor. Returns null when it
// points away from the floor entirely, rather than handing back a point
// behind the player's shoulder.
export function rayFloorHit (origin, direction, planeY) {
  if (!origin || !direction) return null;
  var length = Math.hypot(direction.x, direction.y, direction.z);
  if (length < 1e-9) return null;
  var dy = direction.y / length;
  if (Math.abs(dy) < 1e-6) return null;
  var distance = (planeY - origin.y) / dy;
  if (distance <= 0) return null;
  return {
    x: origin.x + (direction.x / length) * distance,
    z: origin.z + (direction.z / length) * distance,
    distance: distance,
  };
}

// Which corner is being pointed at, if any. Nearest wins, and nothing
// wins if the pointer is further than `radius` from all of them -- so
// aiming at open floor doesn't highlight the corner across the room.
export function nearestHandle (point, corners, radius) {
  if (!point || !corners) return -1;
  var best = -1;
  var bestDistance = radius;
  for (var i = 0; i < corners.length; i++) {
    var distance = Math.hypot(corners[i].x - point.x, corners[i].z - point.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

export function quadExtent (corners) {
  if (!corners || corners.length < 3) return null;
  var minX = Infinity;
  var maxX = -Infinity;
  var minZ = Infinity;
  var maxZ = -Infinity;
  corners.forEach(function (corner) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minZ = Math.min(minZ, corner.z);
    maxZ = Math.max(maxZ, corner.z);
  });
  return { sizeX: maxX - minX, sizeZ: maxZ - minZ, centerX: (minX + maxX) / 2, centerZ: (minZ + maxZ) / 2 };
}

// The four edge lengths, in order. This is what the readout shows
// rather than the axis-aligned span, because a rectangle turned 18
// degrees has a bounding box half a metre bigger than itself in both
// directions -- which reads, wrongly, as "the floor is too big" next to
// a Guardian you are standing in.
export function quadSides (corners) {
  if (!corners || corners.length !== 4) return null;
  return corners.map(function (corner, i) {
    var next = corners[(i + 1) % 4];
    return Math.hypot(next.x - corner.x, next.z - corner.z);
  });
}

// Shoelace. Reported in the readout so a quad dragged inside-out (which
// is easy to do with four free corners) is visible as a number going
// wrong rather than as a floor that renders strangely.
export function quadArea (corners) {
  if (!corners || corners.length < 3) return 0;
  var total = 0;
  for (var i = 0, j = corners.length - 1; i < corners.length; j = i++) {
    total += (corners[j].x + corners[i].x) * (corners[j].z - corners[i].z);
  }
  return Math.abs(total / 2);
}

export function readStoredCorners () {
  try {
    var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved) || saved.length !== 4) return null;
    if (!saved.every(function (c) { return c && isFinite(c.x) && isFinite(c.z); })) return null;
    return saved.map(function (c) { return { x: c.x, z: c.z }; });
  } catch (error) {
    return null;
  }
}

export function writeStoredCorners (corners) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(corners));
  } catch (error) {
    // Corners still apply for this session.
  }
}

// Only a hand-dragged corner is ever saved. Saving the automatic read
// too would be self-defeating: the next load would find four corners in
// storage, take them for a correction, and stop following the Guardian
// for good -- on a device where the Guardian is the thing being tested.
export function clearStoredCorners () {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    // Nothing saved is the same outcome.
  }
}

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  AFRAME.registerComponent('floor-calibration', {
    schema: {
      leftHand: { type: 'selector' },
      rightHand: { type: 'selector' },
      rig: { type: 'selector' },
      camera: { type: 'selector' },
      // How close the pointer has to land to a corner to pick it up.
      // Generous: these are floor targets seen at a shallow angle from
      // standing height, where a couple of degrees of wrist is tens of
      // centimetres on the ground.
      grabRadius: { default: 0.35 },
      handleRadius: { default: 0.09 },
      hoverRadius: { default: 0.16 },
    },

    init: function () {
      this.editing = false;
      this.corners = readStoredCorners();
      this.fromStorage = Boolean(this.corners);
      this.held = null;
      this.hovered = -1;
      this.dirty = true;
      this.planeY = 0;
      this.drawnY = NaN;

      this.rigEl = this.data.rig || document.querySelector('#player-rig');
      this.cameraEl = this.data.camera || document.querySelector('#head-camera');
      this.hands = [this.data.leftHand, this.data.rightHand].filter(Boolean);
      if (!this.hands.length) {
        this.hands = [document.querySelector('#left-hand'), document.querySelector('#right-hand')].filter(Boolean);
      }

      this.root = document.createElement('a-entity');
      this.root.setAttribute('id', 'floor-calibration-root');
      this.el.sceneEl.appendChild(this.root);

      this.buildGround();
      this.buildFill();
      this.outline = [];
      this.handles = [];
      for (var i = 0; i < 4; i++) {
        this.outline.push(this.makeBar('#5ce8a0'));
        this.handles.push(this.makeHandle(i));
      }
      this.buildPointers();

      var self = this;
      var onFace = function () { self.setEditing(!self.editing); };
      var onGripDown = function (event) { self.grab(event.target); };
      var onGripUp = function () { self.release(); };
      var onTrigger = function () { if (self.editing) self.resetToAutomatic(); };

      this.hands.forEach(function (hand) {
        ['abuttondown', 'bbuttondown', 'xbuttondown', 'ybuttondown'].forEach(function (name) {
          hand.addEventListener(name, onFace);
        });
        hand.addEventListener('gripdown', onGripDown);
        hand.addEventListener('gripup', onGripUp);
        hand.addEventListener('triggerdown', onTrigger);
      });

      // Keyboard equivalents, so the whole flow can be exercised without
      // a headset: E toggles editing, T resets to the automatic read.
      window.addEventListener('keydown', function (event) {
        if (event.key === 'e' || event.key === 'E') onFace();
        if (event.key === 't' || event.key === 'T') onTrigger();
      });

      this.el.sceneEl.addEventListener('guardian-bounds', function () {
        // Only follow the automatic read while nobody has corrected it.
        if (!self.fromStorage) self.resetToAutomatic();
        self.dirty = true;
      });
      this.setEditing(false);
    },

    // The empty lot. With the building down there is otherwise no floor
    // at all, and a green rectangle floating in front of a flat sky
    // gives the eye nothing to judge it against -- no sense of how big a
    // metre is, or whether you are standing inside the thing or beside
    // it. One-metre squares answer both at a glance. Reuses the same
    // checkerboard component the rooms' floors are made of.
    buildGround: function () {
      this.ground = document.createElement('a-plane');
      this.ground.setAttribute('width', '24');
      this.ground.setAttribute('height', '24');
      this.ground.setAttribute('rotation', '-90 0 0');
      this.ground.setAttribute('checkerboard', 'color: #7c8798; lightA: 0.18; lightB: 0.04; squareSize: 1');
      this.root.appendChild(this.ground);
      this.lotVisible = true;
    },

    buildFill: function () {
      this.fillGeometry = new THREE.BufferGeometry();
      // Four corners, two triangles, rewritten in place every time a
      // corner moves rather than rebuilt.
      this.fillGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      this.fillGeometry.setIndex([0, 1, 2, 0, 2, 3]);
      var material = new THREE.MeshBasicMaterial({
        color: new THREE.Color('#2f8f66'),
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      this.fillEl = document.createElement('a-entity');
      this.root.appendChild(this.fillEl);
      this.fillEl.setObject3D('mesh', new THREE.Mesh(this.fillGeometry, material));
    },

    makeBar: function (color) {
      var bar = document.createElement('a-box');
      bar.setAttribute('height', '0.02');
      bar.setAttribute('depth', '0.05');
      bar.setAttribute('width', '1');
      bar.setAttribute('material', 'color: ' + color + '; shader: flat');
      this.root.appendChild(bar);
      return bar;
    },

    makeHandle: function (index) {
      var handle = document.createElement('a-circle');
      handle.setAttribute('radius', String(this.data.handleRadius));
      handle.setAttribute('rotation', '-90 0 0');
      handle.setAttribute('material', 'color: #ffd45e; shader: flat; side: double; opacity: 0.9; transparent: true');
      handle.setAttribute('data-corner', String(index));
      this.root.appendChild(handle);
      return handle;
    },

    buildPointers: function () {
      var self = this;
      this.pointers = this.hands.map(function () {
        var beam = document.createElement('a-box');
        beam.setAttribute('width', '0.008');
        beam.setAttribute('height', '0.008');
        beam.setAttribute('depth', '1');
        beam.setAttribute('material', 'color: #7fd0ff; shader: flat');
        self.root.appendChild(beam);

        var dot = document.createElement('a-circle');
        dot.setAttribute('radius', '0.035');
        dot.setAttribute('rotation', '-90 0 0');
        dot.setAttribute('material', 'color: #7fd0ff; shader: flat; side: double');
        self.root.appendChild(dot);

        return { beam: beam, dot: dot, hit: null };
      });
      // No tracked controllers (a flat-screen run): the camera is the
      // pointer, so the same code path can be driven and tested without
      // a headset rather than only existing for one.
      if (!this.pointers.length && this.cameraEl) {
        var beam = document.createElement('a-box');
        beam.setAttribute('width', '0.008');
        beam.setAttribute('height', '0.008');
        beam.setAttribute('depth', '1');
        beam.setAttribute('material', 'color: #7fd0ff; shader: flat');
        this.root.appendChild(beam);
        var dot = document.createElement('a-circle');
        dot.setAttribute('radius', '0.035');
        dot.setAttribute('rotation', '-90 0 0');
        dot.setAttribute('material', 'color: #7fd0ff; shader: flat; side: double');
        this.root.appendChild(dot);
        this.pointers = [{ beam: beam, dot: dot, hit: null, fallback: true }];
      }
    },

    // The source of each pointer, in world space. A tracked controller
    // when there is one, the head otherwise.
    pointerSources: function () {
      var sources = [];
      this.hands.forEach(function (hand, index) {
        if (!hand || !hand.object3D || !hand.object3D.visible) return;
        // tracked-controls is only attached once a matching controller
        // has actually turned up, so it -- not the entity's presence in
        // the markup -- is what says a hand is being held.
        var tracked = hand.components['tracked-controls'];
        if (!tracked || !tracked.controller) return;
        sources.push({ el: hand, slot: index });
      });
      if (!sources.length && this.cameraEl) sources.push({ el: this.cameraEl, slot: 0 });
      return sources;
    },

    setEditing: function (editing) {
      this.editing = Boolean(editing);
      if (!this.editing) this.release();
      this.handles.forEach(function (handle) { handle.setAttribute('visible', this.editing); }, this);
      this.pointers.forEach(function (pointer) {
        pointer.beam.setAttribute('visible', this.editing);
        pointer.dot.setAttribute('visible', this.editing);
      }, this);
      this.el.sceneEl.emit('floor-calibration-mode', { editing: this.editing }, false);
    },

    automaticCorners: function () {
      var guardian = this.el.sceneEl.systems['guardian-bounds'];
      var rect = guardian && guardian.rect;
      if (!rect) return null;
      return rectCorners(rect);
    },

    resetToAutomatic: function () {
      var corners = this.automaticCorners();
      if (!corners || corners.length !== 4) return;
      this.corners = corners;
      this.fromStorage = false;
      clearStoredCorners();
      this.dirty = true;
    },

    grab: function (handEl) {
      if (!this.editing || this.hovered < 0) return;
      var slot = handEl ? this.hands.indexOf(handEl) : -1;
      this.held = { index: this.hovered, slot: slot < 0 ? 0 : slot };
    },

    release: function () {
      if (!this.held) return;
      this.held = null;
      this.fromStorage = true;
      if (this.corners) writeStoredCorners(this.corners);
    },

    // The floor sits on the rig, so it follows whatever height the rig is
    // at -- which is 0 while the hotel is switched off, and a storey when
    // it isn't.
    floorY: function () {
      return (this.rigEl ? this.rigEl.object3D.position.y : 0) + 0.01;
    },

    tick: function () {
      if (!this.corners) {
        this.resetToAutomatic();
        if (!this.corners) return;
      }
      this.planeY = this.floorY();
      // The floor it is drawn on moves with the player when the building
      // is standing, and everything here is positioned in world space.
      if (Math.abs(this.planeY - this.drawnY) > 1e-4) this.dirty = true;

      // The lot is only there in place of the building. Left up while
      // the hotel is standing it would be a grey plane cutting through
      // whichever storey the player was on.
      var hotel = this.el.sceneEl.components['rainbow-hotel'];
      var lot = !(hotel && hotel.built);
      if (lot !== this.lotVisible) {
        this.lotVisible = lot;
        this.ground.setAttribute('visible', lot);
        this.dirty = true;
      }

      if (this.editing) this.updatePointers();
      if (this.dirty) this.redraw();
    },

    updatePointers: function () {
      var sources = this.pointerSources();
      var hovered = -1;
      var self = this;
      var origin = new THREE.Vector3();
      var quaternion = new THREE.Quaternion();
      var forward = new THREE.Vector3();

      this.pointers.forEach(function (pointer) {
        pointer.beam.setAttribute('visible', false);
        pointer.dot.setAttribute('visible', false);
      });

      sources.forEach(function (source) {
        var pointer = self.pointers[source.slot] || self.pointers[0];
        if (!pointer) return;
        source.el.object3D.getWorldPosition(origin);
        source.el.object3D.getWorldQuaternion(quaternion);
        // Explicitly rotating -Z rather than trusting getWorldDirection,
        // which returns +Z for a plain Object3D and has bitten this repo
        // more than once -- see DESIGN.md.
        forward.set(0, 0, -1).applyQuaternion(quaternion);

        var hit = rayFloorHit(origin, forward, self.planeY);
        pointer.hit = hit;
        if (!hit) return;

        var handleIndex = nearestHandle(hit, self.corners, self.data.grabRadius);
        if (handleIndex >= 0 && hovered < 0) hovered = handleIndex;

        pointer.beam.setAttribute('visible', true);
        pointer.dot.setAttribute('visible', true);
        pointer.beam.setAttribute('depth', Math.max(hit.distance, 0.05).toFixed(3));
        pointer.beam.object3D.position.set(
          (origin.x + hit.x) / 2,
          (origin.y + self.planeY) / 2,
          (origin.z + hit.z) / 2
        );
        // A plain Object3D's lookAt aims its +Z at the target, which is
        // exactly what a beam built along Z wants.
        pointer.beam.object3D.lookAt(hit.x, self.planeY, hit.z);
        pointer.dot.object3D.position.set(hit.x, self.planeY + 0.004, hit.z);
      });

      // A held corner follows the hand that grabbed it, and ignores
      // proximity until that hand lets go -- otherwise dragging a corner
      // past its neighbour would hand it over mid-drag.
      if (this.held) {
        var holder = this.pointers[this.held.slot];
        // The grabbing hand may have no ray on the floor -- it is not
        // tracked at all on a flat screen, where the head does the
        // pointing. Any pointer that is actually hitting the floor beats
        // a corner that refuses to move.
        if (!holder || !holder.hit) {
          for (var p = 0; p < this.pointers.length; p++) {
            if (this.pointers[p].hit) { holder = this.pointers[p]; break; }
          }
        }
        if (holder && holder.hit) {
          this.corners[this.held.index] = { x: holder.hit.x, z: holder.hit.z };
          this.dirty = true;
        }
        hovered = this.held.index;
      }

      if (hovered !== this.hovered) {
        this.hovered = hovered;
        this.dirty = true;
      }
    },

    redraw: function () {
      this.dirty = false;
      var corners = this.corners;
      var y = this.planeY;
      this.drawnY = y;

      // Just under the rectangle, so the fill reads as paint on a floor
      // rather than as a sheet hovering over one.
      this.ground.object3D.position.set(0, y - 0.02, 0);

      var positions = this.fillGeometry.getAttribute('position');
      for (var i = 0; i < 4; i++) {
        positions.setXYZ(i, corners[i].x, y + 0.002, corners[i].z);
      }
      positions.needsUpdate = true;
      this.fillGeometry.computeBoundingSphere();

      for (var e = 0; e < 4; e++) {
        var from = corners[e];
        var to = corners[(e + 1) % 4];
        var length = Math.hypot(to.x - from.x, to.z - from.z);
        var bar = this.outline[e];
        bar.setAttribute('width', Math.max(length, 0.01).toFixed(3));
        bar.object3D.position.set((from.x + to.x) / 2, y + 0.01, (from.z + to.z) / 2);
        bar.object3D.rotation.set(0, -Math.atan2(to.z - from.z, to.x - from.x), 0);
      }

      for (var h = 0; h < 4; h++) {
        var handle = this.handles[h];
        var hot = h === this.hovered;
        handle.setAttribute('radius', String(hot ? this.data.hoverRadius : this.data.handleRadius));
        handle.setAttribute('material', 'color: ' + (hot ? '#fff2b0' : '#ffd45e') +
          '; shader: flat; side: double; opacity: ' + (hot ? '1' : '0.9') + '; transparent: true');
        handle.object3D.position.set(corners[h].x, y + 0.012, corners[h].z);
      }
    },

    // For the readout.
    report: function () {
      return {
        editing: this.editing,
        hovered: this.hovered,
        holding: this.held ? this.held.index : -1,
        corners: this.corners,
        extent: quadExtent(this.corners),
        sides: quadSides(this.corners),
        area: quadArea(this.corners),
        edited: this.fromStorage,
      };
    },
  });
}
