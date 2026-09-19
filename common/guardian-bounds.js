// Reading the player's real play-space boundary, and turning it into
// something geometry can safely be built against.
//
// WebXR gives you `session.requestReferenceSpace('bounded-floor')`, whose
// `boundsGeometry` is a polygon of points on the floor. On Quest that is
// the Guardian the player drew. Two things make it awkward to use
// directly, and this module exists to absorb both:
//
//   1. It is not reliable on the first read. Quest Browser can hand back
//      an empty array, or a stale small square, for the first handful of
//      frames after the session starts. So the system below polls for a
//      while and keeps the best answer it has seen rather than trusting
//      frame one.
//   2. It is a polygon, not a rectangle, and it is not necessarily
//      aligned with the reference space's axes. Anything that wants to
//      lay out rooms needs "a rectangle that is definitely inside the
//      boundary", which is what fitSafeRect computes -- including the
//      rotation that makes that rectangle as large as possible, so a
//      Guardian drawn at 30 degrees to the tracking origin doesn't cost
//      the player most of their floor.
//
// Everything above the AFRAME guard is pure and DOM-free so the fitting
// rules can be unit tested without a headset or a renderer.

// What to build against when there is no boundary to read: desktop, a
// 3DoF browser, or a headset that refused the bounded-floor feature.
// Roughly a modest room-scale square, and deliberately on the small side
// -- a fallback that is bigger than the player's real space puts them
// through a wall, a fallback that is smaller only wastes floor.
export var DEFAULT_SAFE_RECT = {
  centerX: 0,
  centerZ: 0,
  sizeX: 2.6,
  sizeZ: 2.6,
  rotationY: 0,
  source: 'fallback',
};

// On a browser with no immersive-VR device at all there is no real room
// to stay inside, so the conservative rectangle above is only costing
// the viewer floor space. A flat-screen visitor gets a roomier one --
// the moment a headset is present, DEFAULT_SAFE_RECT is what's used
// until the real boundary arrives.
export var DESKTOP_SAFE_RECT = {
  centerX: 0,
  centerZ: 0,
  sizeX: 3.4,
  sizeZ: 3.2,
  rotationY: 0,
  source: 'desktop',
};

// WebXR hands back a column-major 4x4 in `pose.transform.matrix`. The
// bounds polygon is expressed in the bounded-floor space, which is not
// the space A-Frame renders in (that stays local-floor), so every point
// has to come through this on its way to being useful.
export function transformPoints (points, matrix) {
  if (!matrix) return points.map(function (point) { return { x: point.x, z: point.z }; });
  return points.map(function (point) {
    var x = point.x || 0;
    var y = point.y || 0;
    var z = point.z || 0;
    return {
      x: matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
      z: matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
    };
  });
}

// Standard even-odd ray cast. Points exactly on an edge are not
// guaranteed either way, which is fine here: every caller has already
// applied a safety inset, so the boundary itself is never the answer.
export function pointInPolygon (point, polygon) {
  var inside = false;
  for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    var a = polygon[i];
    var b = polygon[j];
    var straddles = (a.z > point.z) !== (b.z > point.z);
    if (!straddles) continue;
    var crossingX = (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x;
    if (point.x < crossingX) inside = !inside;
  }
  return inside;
}

function rotatePoint (point, radians) {
  var cos = Math.cos(radians);
  var sin = Math.sin(radians);
  return {
    x: point.x * cos - point.z * sin,
    z: point.x * sin + point.z * cos,
  };
}

function boundingBox (polygon) {
  var minX = Infinity;
  var maxX = -Infinity;
  var minZ = Infinity;
  var maxZ = -Infinity;
  for (var i = 0; i < polygon.length; i++) {
    minX = Math.min(minX, polygon[i].x);
    maxX = Math.max(maxX, polygon[i].x);
    minZ = Math.min(minZ, polygon[i].z);
    maxZ = Math.max(maxZ, polygon[i].z);
  }
  return { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
}

// Area-weighted centroid (the shoelace one), falling back to the mean of
// the vertices for a degenerate polygon. The mean of the vertices alone
// is a bad centre for a Guardian: people draw far more points along the
// side they were walking carefully than along a straight wall, and the
// mean drifts toward whichever side got the most clicks.
export function polygonCentroid (polygon) {
  var twiceArea = 0;
  var x = 0;
  var z = 0;
  for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    var a = polygon[j];
    var b = polygon[i];
    var cross = a.x * b.z - b.x * a.z;
    twiceArea += cross;
    x += (a.x + b.x) * cross;
    z += (a.z + b.z) * cross;
  }
  if (Math.abs(twiceArea) < 1e-9) {
    var sumX = 0;
    var sumZ = 0;
    for (var k = 0; k < polygon.length; k++) {
      sumX += polygon[k].x;
      sumZ += polygon[k].z;
    }
    return { x: sumX / polygon.length, z: sumZ / polygon.length };
  }
  return { x: x / (3 * twiceArea), z: z / (3 * twiceArea) };
}

// Samples a candidate rectangle's perimeter, not just its corners: a
// Guardian with a notch bitten out of one side (a desk, a radiator) can
// clear all four corners while still cutting through an edge.
function rectangleFits (polygon, centerX, centerZ, halfX, halfZ, samplesPerEdge) {
  var steps = Math.max(2, samplesPerEdge);
  for (var i = 0; i <= steps; i++) {
    var t = -1 + 2 * (i / steps);
    var edgePoints = [
      { x: centerX + halfX * t, z: centerZ - halfZ },
      { x: centerX + halfX * t, z: centerZ + halfZ },
      { x: centerX - halfX, z: centerZ + halfZ * t },
      { x: centerX + halfX, z: centerZ + halfZ * t },
    ];
    for (var e = 0; e < edgePoints.length; e++) {
      if (!pointInPolygon(edgePoints[e], polygon)) return false;
    }
  }
  return true;
}

// The largest axis-aligned rectangle (in this polygon's own frame) that
// fits inside it, found by shrinking the bounding box about a fixed
// centre. Binary search rather than a closed form because the polygon is
// arbitrary; 24 halvings puts the answer well inside a millimetre, which
// is far below the precision the boundary itself has.
function largestRectAbout (polygon, center, samplesPerEdge) {
  var box = boundingBox(polygon);
  var halfX = (box.maxX - box.minX) / 2;
  var halfZ = (box.maxZ - box.minZ) / 2;
  if (!(halfX > 0) || !(halfZ > 0)) return null;
  if (!pointInPolygon(center, polygon)) return null;

  var low = 0;
  var high = 1;
  for (var i = 0; i < 24; i++) {
    var mid = (low + high) / 2;
    if (rectangleFits(polygon, center.x, center.z, halfX * mid, halfZ * mid, samplesPerEdge)) low = mid;
    else high = mid;
  }
  if (low <= 0) return null;
  return { centerX: center.x, centerZ: center.z, sizeX: 2 * halfX * low, sizeZ: 2 * halfZ * low };
}

// Candidate orientations to try the rectangle in. Zero (the tracking
// space's own axes) is always tried; so is the direction of each long
// edge of the polygon, since a Guardian drawn along the walls of a room
// gives its own best axis away in its longest edges. Angles are folded
// into [0, 90) because a rectangle at 100 degrees is the same rectangle
// at 10 with its sides swapped.
function candidateAngles (polygon) {
  var angles = [0];
  var seen = { 0: true };
  for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    var dx = polygon[i].x - polygon[j].x;
    var dz = polygon[i].z - polygon[j].z;
    if (Math.hypot(dx, dz) < 0.25) continue;
    var angle = Math.atan2(dz, dx) % (Math.PI / 2);
    if (angle < 0) angle += Math.PI / 2;
    var key = angle.toFixed(3);
    if (seen[key]) continue;
    seen[key] = true;
    angles.push(angle);
  }
  return angles;
}

// The whole job: polygon in, "a rectangle you can safely build a room
// inside" out. `inset` is taken off every side after fitting, so the
// returned rectangle has real clearance from the drawn boundary rather
// than touching it.
export function fitSafeRect (points, options) {
  var settings = options || {};
  var inset = settings.inset === undefined ? 0.18 : settings.inset;
  var minSize = settings.minSize === undefined ? 1.6 : settings.minSize;
  var samplesPerEdge = settings.samplesPerEdge === undefined ? 6 : settings.samplesPerEdge;

  var polygon = (points || []).filter(function (point) {
    return point && isFinite(point.x) && isFinite(point.z);
  }).map(function (point) {
    return { x: point.x, z: point.z };
  });
  if (polygon.length < 3) return null;

  var best = null;
  var angles = candidateAngles(polygon);
  for (var a = 0; a < angles.length; a++) {
    var angle = angles[a];
    var rotated = polygon.map(function (point) { return rotatePoint(point, -angle); });
    var box = boundingBox(rotated);
    var centers = [
      polygonCentroid(rotated),
      { x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 },
    ];
    for (var c = 0; c < centers.length; c++) {
      var fitted = largestRectAbout(rotated, centers[c], samplesPerEdge);
      if (!fitted) continue;
      var sizeX = fitted.sizeX - 2 * inset;
      var sizeZ = fitted.sizeZ - 2 * inset;
      if (sizeX < minSize || sizeZ < minSize) continue;
      var area = sizeX * sizeZ;
      if (best && area <= best.area) continue;
      // Back out of the rotated frame so the centre is expressed in the
      // caller's coordinates; the rotation itself is handed back for the
      // caller to apply to whatever it builds.
      var center = rotatePoint({ x: fitted.centerX, z: fitted.centerZ }, angle);
      best = {
        area: area,
        rect: {
          centerX: center.x,
          centerZ: center.z,
          sizeX: sizeX,
          sizeZ: sizeZ,
          rotationY: -angle * 180 / Math.PI,
          source: 'webxr',
        },
      };
    }
  }
  return best ? best.rect : null;
}

export function rectArea (rect) {
  return rect ? rect.sizeX * rect.sizeZ : 0;
}

// The four corners of a fitted rectangle, in the frame the rectangle was
// measured in. The sign convention matches the rotation a scene graph
// applies for the same `rotationY`, so anything drawn from these lands
// exactly where geometry built under that rotation does -- which is the
// whole point of having one function for it rather than two hand-rolled
// copies that disagree by a sign.
export function rectCorners (rect) {
  if (!rect) return [];
  var radians = (rect.rotationY || 0) * Math.PI / 180;
  var cos = Math.cos(radians);
  var sin = Math.sin(radians);
  var halfX = rect.sizeX / 2;
  var halfZ = rect.sizeZ / 2;
  return [[-halfX, -halfZ], [halfX, -halfZ], [halfX, halfZ], [-halfX, halfZ]].map(function (corner) {
    return {
      x: rect.centerX + corner[0] * cos + corner[1] * sin,
      z: rect.centerZ - corner[0] * sin + corner[1] * cos,
    };
  });
}

// The bounding box of whatever the headset actually handed over, before
// any fitting. Worth reporting on its own: "I can see a 3.4 x 2.9
// boundary but can't fit a rectangle in it" and "I never saw a boundary"
// are different problems with different fixes.
export function polygonExtent (polygon) {
  if (!polygon || polygon.length < 2) return null;
  var box = boundingBox(polygon);
  return {
    sizeX: box.maxX - box.minX,
    sizeZ: box.maxZ - box.minZ,
    centerX: (box.minX + box.maxX) / 2,
    centerZ: (box.minZ + box.maxZ) / 2,
  };
}

// DOMException carries its useful part in `name`, plain Errors in
// `message`, and some browsers reject with a bare string.
export function describeError (error) {
  if (!error) return 'unknown';
  if (typeof error === 'string') return error;
  var name = error.name || '';
  var message = error.message || '';
  if (name && message) return name + ': ' + message;
  return name || message || String(error);
}

// Two rectangles agree if nothing about them moved by more than a
// centimetre or two. Used to decide the boundary has settled rather
// than counting frames alone.
export function rectsAgree (a, b, tolerance) {
  if (!a || !b) return false;
  var epsilon = tolerance === undefined ? 0.02 : tolerance;
  return Math.abs(a.centerX - b.centerX) <= epsilon &&
    Math.abs(a.centerZ - b.centerZ) <= epsilon &&
    Math.abs(a.sizeX - b.sizeX) <= epsilon &&
    Math.abs(a.sizeZ - b.sizeZ) <= epsilon &&
    Math.abs(a.rotationY - b.rotationY) <= 1.5;
}

if (typeof AFRAME !== 'undefined') {
  AFRAME.registerSystem('guardian-bounds', {
    schema: {
      // Metres taken off every side of the fitted rectangle. Anything
      // built against the result is therefore this far inside the drawn
      // boundary before its own wall thickness is counted.
      inset: { default: 0.18 },
      // Deliberately low. A play space that only holds a 1.3m rectangle
      // is a cramped hotel, but a cramped hotel that lines up with the
      // room beats a roomy one that doesn't -- and the rectangle is the
      // only thing anchoring the building to where the player actually
      // is. Too-small is the caller's problem to warn about, not this
      // module's to refuse.
      minSize: { default: 1.2 },
      // How long to keep re-reading after the session starts before
      // giving up and committing to the best answer so far. Quest can
      // hand back nothing at all for the first frames, and has been seen
      // handing back a stale small square before the real one.
      settleFrames: { default: 180 },
      // Wall-clock backstop for the same thing, so a session that never
      // produces a readable frame still resolves instead of leaving
      // everything downstream waiting forever on an event that is never
      // coming.
      settleMs: { default: 8000 },
      // Consecutive agreeing reads that end the poll early.
      stableReads: { default: 12 },
      // Once settled, how often to check the boundary is still where it
      // was. Twice a second is far below anything a person would
      // notice and far above anything that costs a frame.
      recheckFrames: { default: 30 },
      // How far the rectangle has to move before that re-read is worth
      // republishing. Below this it is measurement noise, and each
      // publish rebuilds a building.
      driftTolerance: { default: 0.05 },
    },

    init: function () {
      this.rect = Object.assign({}, DEFAULT_SAFE_RECT);
      this.override = null;
      this.boundedSpace = null;
      this.requestPending = false;
      this.candidate = null;
      this.committed = false;
      this.rawPolygon = null;
      this.watched = [];
      this.resetDiagnostics();

      this.sinceRecheck = 0;

      var self = this;
      this.sceneEl.addEventListener('enter-vr', function () { self.beginPolling(); });
      this.sceneEl.addEventListener('exit-vr', function () {
        self.unwatchAll();
        self.boundedSpace = null;
        self.diag.sessionActive = false;
      });

      if (navigator.xr && navigator.xr.isSessionSupported) {
        navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
          self.diag.xrSupported = supported;
          if (!supported && !self.override) self.publish(DESKTOP_SAFE_RECT);
        }).catch(function (error) {
          self.diag.xrSupported = false;
          self.diag.spaceError = 'isSessionSupported: ' + describeError(error);
          if (!self.override) self.publish(DESKTOP_SAFE_RECT);
        });
      } else {
        // No WebXR at all: this is a flat screen, so use the roomier
        // rectangle. Deferred a tick so listeners registered during the
        // same scene init still hear it.
        this.diag.xrSupported = false;
        setTimeout(function () { if (!self.override) self.publish(DESKTOP_SAFE_RECT); }, 0);
      }
    },

    // Everything that happened on the way to the current rectangle, in a
    // form something can put in front of the player's eyes. This exists
    // because the first headset test of this module failed *silently* --
    // three separate places could bail out without a word, and from
    // inside the headset all of them look identical to "it just built
    // the wrong room".
    resetDiagnostics: function () {
      this.diag = {
        xrSupported: this.diag ? this.diag.xrSupported : null,
        sessionActive: false,
        spaceState: 'idle',
        spaceError: '',
        rawPoints: 0,
        rawExtent: null,
        framesSeen: 0,
        poseFailures: 0,
        fitFailures: 0,
        goodReads: 0,
        agreeingReads: 0,
        // Carried across polls on purpose: a re-poll caused by a
        // recentre would otherwise wipe the count of recentres.
        resets: this.diag ? this.diag.resets : 0,
        drifts: this.diag ? this.diag.drifts : 0,
        committed: false,
        finishedBecause: '',
      };
    },

    // Recentring invalidates everything measured before it.
    //
    // Holding the Oculus button moves the origin of the local-floor space
    // the scene renders in. The boundary polygon was converted into that
    // space once, at the moment it was read, and nothing re-reads it --
    // so from the recentre onwards the rectangle describes where the room
    // *was* relative to an origin that has since moved. The building
    // stays exactly where it was put while the player and their real
    // walls move out from under it, which is the "not even close"
    // failure, and nothing on screen would say a thing about it.
    //
    // WebXR announces this: the reference space fires `reset`. Both
    // spaces are watched because the one that fires depends on which
    // origin moved, and re-reading costs a second of polling.
    //
    // The listeners have to be *removed* along with the space they are
    // on, which the first version of this did not do. Re-polling asks
    // for a fresh bounded-floor space, so each recentre left a live
    // listener on an orphaned space and added one more; the next real
    // recentre then fired on both and spawned two more. It doubles. A
    // headset session reported "recentred x44" off about five real
    // button presses, with the boundary re-polling continuously the
    // whole time.
    watchForRecentre: function () {
      var renderer = this.sceneEl.renderer;
      var base = renderer && renderer.xr && renderer.xr.getReferenceSpace && renderer.xr.getReferenceSpace();
      this.watchSpace(base);
      this.watchSpace(this.boundedSpace);
    },

    watchSpace: function (space) {
      if (!space || !space.addEventListener) return;
      for (var i = 0; i < this.watched.length; i++) {
        if (this.watched[i].space === space) return;
      }
      var self = this;
      var handler = function () {
        self.diag.resets++;
        // One recentre fires on every space that moved, and a burst of
        // them is one event, not several. A poll already in flight will
        // pick up the new origin on its own.
        if (self.committed) self.retry();
      };
      space.addEventListener('reset', handler);
      this.watched.push({ space: space, handler: handler });
    },

    unwatchSpace: function (space) {
      if (!space) return;
      for (var i = this.watched.length - 1; i >= 0; i--) {
        if (this.watched[i].space !== space) continue;
        if (space.removeEventListener) space.removeEventListener('reset', this.watched[i].handler);
        this.watched.splice(i, 1);
      }
    },

    unwatchAll: function () {
      while (this.watched.length) this.unwatchSpace(this.watched[0].space);
    },

    diagnostics: function () {
      return Object.assign({}, this.diag, {
        rect: this.rect,
        polygon: this.rawPolygon,
        overridden: Boolean(this.override),
      });
    },

    // Lets the page force a rectangle (the pre-VR settings panel does
    // this, and so does any desktop run) without pretending it came from
    // WebXR. An override always wins: if someone has said "my space is
    // 3x2.4", believing a stale Guardian read over them is worse than
    // useless.
    setOverrideRect: function (rect) {
      if (!rect) {
        this.override = null;
        return;
      }
      this.override = Object.assign({ rotationY: 0 }, rect, { source: 'override' });
      this.publish(this.override);
    },

    beginPolling: function () {
      this.committed = false;
      this.candidate = null;
      this.rawPolygon = null;
      this.sinceRecheck = 0;
      this.resetDiagnostics();
      this.diag.sessionActive = true;
      this.deadline = (typeof performance !== 'undefined' ? performance.now() : Date.now()) + this.data.settleMs;
      this.requestBoundedSpace();
    },

    // Lets the player ask for another go without leaving VR.
    retry: function () {
      // The space about to be discarded takes its listener with it, or
      // every retry leaves one more behind. See watchForRecentre.
      this.unwatchSpace(this.boundedSpace);
      this.boundedSpace = null;
      this.requestPending = false;
      this.beginPolling();
    },

    requestBoundedSpace: function () {
      if (this.boundedSpace || this.requestPending) return;
      var session = this.sceneEl.renderer && this.sceneEl.renderer.xr && this.sceneEl.renderer.xr.getSession();
      if (!session || !session.requestReferenceSpace) {
        this.diag.spaceState = 'no session yet';
        return;
      }
      var self = this;
      this.requestPending = true;
      this.diag.spaceState = 'requesting';
      session.requestReferenceSpace('bounded-floor').then(function (space) {
        self.boundedSpace = space;
        self.requestPending = false;
        self.diag.spaceState = 'granted';
      }).catch(function (error) {
        // A headset that didn't grant bounded-floor -- a stationary
        // boundary, boundary turned off, or a browser without it -- is a
        // supported case, and the fallback rectangle runs the experience.
        //
        // What it must NOT do is end the poll quietly, which is what the
        // first version did: it committed on the spot, published the
        // fallback, and everything downstream carried on as though a real
        // boundary had been read. From inside a headset that is
        // indistinguishable from the boundary simply being ignored. Now
        // it records why and leaves the poll to time out on its own, so
        // the readout has something to say.
        self.requestPending = false;
        self.diag.spaceState = 'rejected';
        self.diag.spaceError = describeError(error);
      });
    },

    readOnce: function (frame) {
      if (!this.boundedSpace || !frame || !frame.getPose) return null;
      var geometry = this.boundedSpace.boundsGeometry;
      this.diag.rawPoints = geometry ? geometry.length : 0;
      if (!geometry || geometry.length < 3) return null;

      var baseSpace = this.sceneEl.renderer.xr.getReferenceSpace();
      var pose = null;
      try {
        pose = frame.getPose(this.boundedSpace, baseSpace);
      } catch (error) {
        this.diag.poseFailures++;
        this.diag.spaceError = 'getPose: ' + describeError(error);
        return null;
      }
      if (!pose) {
        this.diag.poseFailures++;
        return null;
      }

      var polygon = transformPoints(geometry, pose.transform ? pose.transform.matrix : null);
      this.rawPolygon = polygon;
      this.diag.rawExtent = polygonExtent(polygon);

      var fitted = fitSafeRect(polygon, { inset: this.data.inset, minSize: this.data.minSize });
      // Distinguish "read the boundary but couldn't fit a rectangle in
      // it" from "never read the boundary". They need completely
      // different fixes and they used to look the same.
      if (!fitted) this.diag.fitFailures++;
      else this.diag.goodReads++;
      return fitted;
    },

    tick: function () {
      if (this.override) return;
      if (!this.sceneEl.is('vr-mode')) return;
      // Deliberately before the committed check: a recentre matters most
      // *after* the boundary has settled, which is when nothing else here
      // is still watching.
      this.watchForRecentre();
      if (this.committed) return this.recheck();
      this.requestBoundedSpace();

      var frame = this.sceneEl.frame;
      if (!frame) return;
      this.diag.framesSeen++;

      var reading = this.readOnce(frame);
      if (reading) {
        // Keep the largest plausible rectangle seen rather than the most
        // recent one. The documented Quest failure is a *small* stale
        // square arriving first, so "biggest wins" and "most recent
        // wins" disagree in exactly the case that matters.
        if (!this.candidate || rectArea(reading) > rectArea(this.candidate) + 0.02) {
          this.candidate = reading;
          this.diag.agreeingReads = 0;
        } else if (rectsAgree(reading, this.candidate)) {
          this.diag.agreeingReads++;
        }
      }

      var now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      var settled = this.candidate && this.diag.agreeingReads >= this.data.stableReads;
      var outOfFrames = this.diag.framesSeen >= this.data.settleFrames;
      var outOfTime = this.deadline && now >= this.deadline;
      if (!settled && !outOfFrames && !outOfTime) return;

      this.committed = true;
      this.diag.committed = true;
      this.diag.finishedBecause = settled ? 'settled' : (outOfFrames ? 'frame limit' : 'timed out');
      this.publish(this.candidate || this.rect);
    },

    // The boundary is never finished being read.
    //
    // Committing once and never looking again is what made every
    // staleness bug in this module invisible from inside a headset. A
    // recentre, a tracking recovery, a Guardian redrawn mid-session --
    // each leaves the committed rectangle describing a room that has
    // since moved, with the building standing exactly where it was put
    // and nothing anywhere saying so. Relying on the `reset` event alone
    // is not enough either: it assumes the headset announces every way
    // the origin can move, and the failure mode when it doesn't is
    // silent and total.
    //
    // So the settled rectangle is re-measured a couple of times a second
    // for as long as the session lasts, and republished only when it has
    // actually moved. The cost is one polygon transform per check, plus
    // a fit on the rare checks that disagree.
    recheck: function () {
      this.sinceRecheck++;
      if (this.sinceRecheck < this.data.recheckFrames) return;
      this.sinceRecheck = 0;
      var reading = this.readOnce(this.sceneEl.frame);
      if (!reading) return;
      if (rectsAgree(reading, this.rect, this.data.driftTolerance)) return;
      this.diag.drifts++;
      this.candidate = reading;
      this.publish(reading);
    },

    publish: function (rect) {
      this.rect = Object.assign({}, rect);
      this.sceneEl.emit('guardian-bounds', {
        rect: this.rect,
        diagnostics: this.diagnostics(),
      }, false);
    },
  });
}
