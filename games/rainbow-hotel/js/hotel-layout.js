// The Rainbow Hotel's plan, as arithmetic.
//
// Everything here is pure: a Guardian-sized rectangle goes in, and a
// full description of six stacked rooms and the one hallway that joins
// them comes out -- rectangles, door positions, how far along the walk
// any point in the hallway is, and the stretch of that walk over which
// the hallway is allowed to rise. No A-Frame, no DOM, so the rules that
// make the illusion work can be tested at a terminal instead of guessed
// at in a headset.
//
// ---------------------------------------------------------------
// The trick, stated once
// ---------------------------------------------------------------
// Six rooms are stacked vertically at *the same* floor-plan position:
// room 0 at y=0, room 1 at y=floorHeight, and so on. They all sit inside
// the player's real Guardian rectangle. A strip along one edge of that
// rectangle is reserved -- no room ever occupies it -- and one hallway
// box slides up and down inside that strip.
//
// When the player is standing in a room, the hallway is parked at that
// room's floor level, so both of the room's doorways line up with the
// hallway's own two openings. Walking the hallway from one opening to
// the other raises it by exactly one floor height, so the opening you
// walk out of is a floor above the one you walked in through. The rise
// is driven by *how far along the hallway you have walked*, never by a
// timer, which makes it fully reversible: turn around and it comes back
// down, and the opening you came in by has re-aligned by the time you
// can see it again.
//
// The only thing protecting all of this is that a misaligned opening is
// never visible. That is what `occlusionWindow` computes, by brute force
// over the actual wall rectangles: the rise is confined to the stretch
// of walk from which *neither* doorway can be seen. If the hallway's
// turns aren't enough to hide them, the window collapses, and the plan
// says so (`rise.tight`) instead of quietly shipping a hallway that
// gives the game away.

import { lighten, darken } from '../../../common/color-utils.js';

// Wall colours, in walking order. Each room's floor is a checkerboard in
// a lighter shade of its own wall colour -- see common/checkerboard.js,
// which derives the pair rather than taking two authored colours.
export var ROOMS = [
  { id: 'red', name: 'Red', wall: '#b5302a' },
  { id: 'orange', name: 'Orange', wall: '#cd6a18' },
  { id: 'yellow', name: 'Yellow', wall: '#c5a915' },
  { id: 'green', name: 'Green', wall: '#3c8f4c' },
  { id: 'blue', name: 'Blue', wall: '#2c68ad' },
  { id: 'purple', name: 'Purple', wall: '#71459b' },
];

export var DEFAULT_SETTINGS = {
  // Vertical. floorHeight is the rise per hallway walk; roomHeight is
  // the ceiling inside a room. The difference is the slab, and the slab
  // is what the facade outside the windows uses to show floors apart.
  floorHeight: 3.6,
  roomHeight: 2.6,
  corridorHeight: 2.3,
  doorHeight: 2.05,

  // The hallway, as one parameterised piece.
  //   laneWidth  -- how wide the walkable run is
  //   stubDepth  -- how far each doorway is recessed off that run
  //   passGap    -- the gap a pier leaves for the player to get past
  //   baffles    -- extra turns beyond the two pairs that always stand
  //                 at the doorways. 0 is the spec's baseline ("one turn
  //                 at the doorway threshold, one straight run"); more
  //                 is the tighter-spiral end of the same dial.
  // Widened after the first headset test, which reported the hallway as
  // "ridiculously cramped" and hard to navigate. The earlier numbers
  // were chosen to buy occlusion margin, and they do -- but a hallway a
  // person has to shuffle through sideways fails the thing this POC is
  // actually measuring, which is whether walking it feels like walking
  // to another floor. Occlusion is bought back with turns instead.
  laneWidth: 1.32,
  stubDepth: 0.5,
  passGap: 0.8,
  baffles: 0,
  baffleThickness: 0.1,

  doorWidth: 0.7,
  // How far apart the two doorways sit along the shared wall, as a
  // fraction of the space available. 1 puts them in opposite corners
  // (the spec's baseline); lower pulls them toward the middle, which
  // shortens the run and leaves blank wall at the ends.
  doorSpread: 1,
  doorMargin: 0.1,
  // Safety factor on the computed pier spacing (see requiredShieldGap).
  // 1 is the bare geometric minimum; above 1 buys slack against a player
  // leaning, crouching, or viewing from somewhere a flat floor-plan
  // analysis didn't think of.
  shieldSafety: 1.6,

  wallThickness: 0.12,
  // The window sill doubles as the guardrail the spec asks for at the
  // Guardian edge: architecture rather than an invisible wall.
  sillHeight: 0.95,
  sillDepth: 0.2,
  windowHead: 2.25,
  windowInset: 0.32,

  // Metres of walk held back on each side of the measured occlusion
  // window before the rise is allowed to start.
  riseSafety: 0.06,
  // Resolution of the walked-distance field and the occlusion scan.
  gridCell: 0.05,
};

function clamp (value, low, high) {
  return Math.max(low, Math.min(high, value));
}

export function smoothstep (t) {
  var x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function rect (minX, maxX, minZ, maxZ) {
  return { minX: minX, maxX: maxX, minZ: minZ, maxZ: maxZ };
}

export function rectContains (r, x, z) {
  return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

// Slab-method segment/AABB test. Rectangles are shrunk by a hair before
// testing, so a sightline running exactly along a jamb face counts as
// *not* blocked -- when in doubt, assume the player can see, because
// guessing wrong in that direction costs a slightly shorter rise, and
// guessing wrong in the other direction costs the illusion.
export function segmentHitsRect (ax, az, bx, bz, r, epsilon) {
  var pad = epsilon === undefined ? 1e-4 : epsilon;
  var minX = r.minX + pad;
  var maxX = r.maxX - pad;
  var minZ = r.minZ + pad;
  var maxZ = r.maxZ - pad;
  if (minX >= maxX || minZ >= maxZ) return false;

  var tMin = 0;
  var tMax = 1;
  var axes = [
    { origin: ax, delta: bx - ax, low: minX, high: maxX },
    { origin: az, delta: bz - az, low: minZ, high: maxZ },
  ];
  for (var i = 0; i < axes.length; i++) {
    var axis = axes[i];
    if (Math.abs(axis.delta) < 1e-9) {
      if (axis.origin < axis.low || axis.origin > axis.high) return false;
      continue;
    }
    var t1 = (axis.low - axis.origin) / axis.delta;
    var t2 = (axis.high - axis.origin) / axis.delta;
    if (t1 > t2) { var swap = t1; t1 = t2; t2 = swap; }
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return false;
  }
  return true;
}

function blocked (blockers, x, z) {
  for (var i = 0; i < blockers.length; i++) {
    if (rectContains(blockers[i], x, z)) return true;
  }
  return false;
}

// ---------------------------------------------------------------
// How far along the walk am I?
// ---------------------------------------------------------------
// Not "distance along a centreline". A hallway with piers in it has
// pockets that are a step from a doorway in walked terms and half a
// hallway from it in straight-line terms -- the alcove beside the first
// doorway is one. Projecting that alcove onto the nearest centreline
// segment puts it in the middle of the walk, which is not a measurement
// quibble: the rise is a function of this number, so being wrong there
// means the hallway is half a floor up while the player is still close
// enough to the doorway to see straight through it. (Found by asking the
// occlusion scan where its worst case was, rather than by playing it.)
//
// So progress is a geodesic: Dijkstra out from the first doorway across
// the hallway's open floor, on a grid, going *around* the piers the way
// a person has to. Bilinear sampling of that field is what the runtime
// reads every frame.
function MinHeap () {
  this.keys = [];
  this.values = [];
}
MinHeap.prototype.push = function (key, value) {
  this.keys.push(key);
  this.values.push(value);
  var index = this.keys.length - 1;
  while (index > 0) {
    var parent = (index - 1) >> 1;
    if (this.keys[parent] <= this.keys[index]) break;
    this.swap(parent, index);
    index = parent;
  }
};
MinHeap.prototype.swap = function (a, b) {
  var key = this.keys[a]; this.keys[a] = this.keys[b]; this.keys[b] = key;
  var value = this.values[a]; this.values[a] = this.values[b]; this.values[b] = value;
};
MinHeap.prototype.pop = function () {
  var top = this.values[0];
  var lastKey = this.keys.pop();
  var lastValue = this.values.pop();
  if (this.keys.length) {
    this.keys[0] = lastKey;
    this.values[0] = lastValue;
    var index = 0;
    for (;;) {
      var left = index * 2 + 1;
      var right = left + 1;
      var smallest = index;
      if (left < this.keys.length && this.keys[left] < this.keys[smallest]) smallest = left;
      if (right < this.keys.length && this.keys[right] < this.keys[smallest]) smallest = right;
      if (smallest === index) break;
      this.swap(smallest, index);
      index = smallest;
    }
  }
  return top;
};

var NEIGHBOURS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export function buildWalkField (shell, blockers, from, to, cell) {
  var step = cell || 0.05;
  var columns = Math.max(2, Math.round((shell.maxX - shell.minX) / step));
  var rows = Math.max(2, Math.round((shell.maxZ - shell.minZ) / step));
  var cellX = (shell.maxX - shell.minX) / columns;
  var cellZ = (shell.maxZ - shell.minZ) / rows;
  var distance = new Float64Array(columns * rows).fill(Infinity);
  var open = new Uint8Array(columns * rows);

  var centerOf = function (ix, iz) {
    return { x: shell.minX + (ix + 0.5) * cellX, z: shell.minZ + (iz + 0.5) * cellZ };
  };
  var indexOf = function (x, z) {
    var ix = clamp(Math.floor((x - shell.minX) / cellX), 0, columns - 1);
    var iz = clamp(Math.floor((z - shell.minZ) / cellZ), 0, rows - 1);
    return iz * columns + ix;
  };

  for (var iz = 0; iz < rows; iz++) {
    for (var ix = 0; ix < columns; ix++) {
      var point = centerOf(ix, iz);
      open[iz * columns + ix] = blocked(blockers, point.x, point.z) ? 0 : 1;
    }
  }

  // A doorway centre can land on a blocked cell if the grid happens to
  // straddle a jamb; nudge to the nearest open cell rather than giving up.
  var nearestOpen = function (index) {
    if (index >= 0 && open[index]) return index;
    var sx = index % columns;
    var sz = (index / columns) | 0;
    for (var radius = 1; radius < 8; radius++) {
      for (var dz = -radius; dz <= radius; dz++) {
        for (var dx = -radius; dx <= radius; dx++) {
          var nx = sx + dx;
          var nz = sz + dz;
          if (nx < 0 || nz < 0 || nx >= columns || nz >= rows) continue;
          if (open[nz * columns + nx]) return nz * columns + nx;
        }
      }
    }
    return -1;
  };
  var start = nearestOpen(indexOf(from.x, from.z));
  var goal = nearestOpen(indexOf(to.x, to.z));

  var field = {
    columns: columns,
    rows: rows,
    originX: shell.minX,
    originZ: shell.minZ,
    cellX: cellX,
    cellZ: cellZ,
    distance: distance,
    open: open,
    total: 0,
    connected: false,
    centerOf: centerOf,
  };
  if (start < 0 || goal < 0) return field;

  var orthogonalX = cellX;
  var orthogonalZ = cellZ;
  var diagonal = Math.hypot(cellX, cellZ);

  distance[start] = 0;
  var heap = new MinHeap();
  heap.push(0, start);
  while (heap.keys.length) {
    var current = heap.pop();
    var currentDistance = distance[current];
    var cx = current % columns;
    var cz = (current / columns) | 0;
    for (var n = 0; n < NEIGHBOURS.length; n++) {
      var stepX = NEIGHBOURS[n][0];
      var stepZ = NEIGHBOURS[n][1];
      var nx = cx + stepX;
      var nz = cz + stepZ;
      if (nx < 0 || nz < 0 || nx >= columns || nz >= rows) continue;
      var neighbour = nz * columns + nx;
      if (!open[neighbour]) continue;
      // A diagonal move is only legal when both of its orthogonal
      // neighbours are open, so a walk can't slip through the corner of
      // a pier that a real body would have to go round.
      if (stepX && stepZ && (!open[cz * columns + nx] || !open[nz * columns + cx])) continue;
      var stepLength = stepX && stepZ ? diagonal : (stepX ? orthogonalX : orthogonalZ);
      var candidate = currentDistance + stepLength;
      if (candidate >= distance[neighbour]) continue;
      distance[neighbour] = candidate;
      heap.push(candidate, neighbour);
    }
  }

  field.total = distance[goal];
  field.connected = isFinite(field.total) && field.total > 0;
  return field;
}

// Bilinear read of the walked-distance field, skipping cells inside
// walls so a sample taken close to a pier isn't dragged toward infinity.
// Returns a fraction of the whole walk.
export function progressAt (field, x, z) {
  if (!field.connected) return 0;
  var fx = (x - field.originX) / field.cellX - 0.5;
  var fz = (z - field.originZ) / field.cellZ - 0.5;
  var ix = Math.floor(fx);
  var iz = Math.floor(fz);
  var tx = clamp(fx - ix, 0, 1);
  var tz = clamp(fz - iz, 0, 1);

  var weighted = 0;
  var weight = 0;
  var nearest = Infinity;
  var nearestSeparation = Infinity;
  for (var dz = 0; dz <= 1; dz++) {
    for (var dx = 0; dx <= 1; dx++) {
      var cx = clamp(ix + dx, 0, field.columns - 1);
      var cz = clamp(iz + dz, 0, field.rows - 1);
      var value = field.distance[cz * field.columns + cx];
      if (!isFinite(value)) continue;
      var w = (dx ? tx : 1 - tx) * (dz ? tz : 1 - tz);
      weighted += value * w;
      weight += w;
      var separation = Math.hypot(cx - fx, cz - fz);
      if (separation < nearestSeparation) { nearestSeparation = separation; nearest = value; }
    }
  }
  var metres = weight > 1e-6 ? weighted / weight : nearest;
  if (!isFinite(metres)) return 0;
  return clamp(metres / field.total, 0, 1);
}

// Is any part of the doorway at `doorX` visible from this point on the
// hallway floor? Samples across the opening rather than testing its
// centre, because the edge of a doorway is what gives a misalignment
// away first.
export function doorVisibleFrom (plan, x, z, doorX, samples) {
  var count = samples === undefined ? 9 : samples;
  var half = plan.doorWidth / 2 - 0.005;
  var targetZ = plan.doorPlaneZ - 1e-3;
  for (var i = 0; i < count; i++) {
    var t = count === 1 ? 0.5 : i / (count - 1);
    var targetX = doorX - half + 2 * half * t;
    var hit = false;
    for (var b = 0; b < plan.blockers.length; b++) {
      if (segmentHitsRect(x, z, targetX, targetZ, plan.blockers[b])) { hit = true; break; }
    }
    if (!hit) return true;
  }
  return false;
}

// The stretch of the walk over which the hallway may rise.
//
// Brute force on purpose. Rather than reasoning about sightlines and
// hoping, every reachable spot on the hallway floor is asked two
// questions: how far along the walk are you, and can you see either
// doorway from here? The rise is then confined to the gap between the
// last place the first doorway is visible and the first place the second
// one is -- which is, by construction, the only stretch where a
// misaligned opening cannot be caught.
export function occlusionWindow (plan) {
  var field = plan.walk;
  var lastSawA = 0;
  var firstSawB = 1;
  var sawA = false;
  var sawB = false;

  for (var iz = 0; iz < field.rows; iz++) {
    for (var ix = 0; ix < field.columns; ix++) {
      var index = iz * field.columns + ix;
      if (!isFinite(field.distance[index])) continue;
      var point = field.centerOf(ix, iz);
      var s = clamp(field.distance[index] / field.total, 0, 1);
      if (doorVisibleFrom(plan, point.x, point.z, plan.doorAX)) {
        sawA = true;
        if (s > lastSawA) lastSawA = s;
      }
      if (doorVisibleFrom(plan, point.x, point.z, plan.doorBX)) {
        sawB = true;
        if (s < firstSawB) firstSawB = s;
      }
    }
  }

  var safety = plan.settings.riseSafety / Math.max(field.total, 0.001);
  var start = (sawA ? lastSawA : 0) + safety;
  var end = (sawB ? firstSawB : 1) - safety;
  var margin = end - start;
  if (margin > 0.02) {
    return { start: start, end: end, margin: margin, tight: false };
  }
  // No honest window. Rather than refuse to build, fall back to a
  // centred one and flag it: the experience still runs, the settings
  // panel says this hallway is too short or too open for these numbers,
  // and the person in the headset finds out by catching it -- which is
  // exactly what this POC exists to find out.
  var middle = (start + end) / 2;
  return {
    start: clamp(middle - 0.08, 0, 1),
    end: clamp(middle + 0.08, 0, 1),
    margin: margin,
    tight: true,
  };
}

export function riseFraction (plan, s) {
  var rise = plan.rise;
  if (rise.end <= rise.start) return s >= rise.end ? 1 : 0;
  return smoothstep((s - rise.start) / (rise.end - rise.start));
}

// How far apart the two piers at a doorway have to stand before no
// sightline at all can reach that doorway from further down the run.
//
// Working, in the hallway's cross-section (north wall at z=0, the shared
// room wall at z=CW, the walkable run ending at z=W):
//
//   * to clear the north pier a line must pass south of it at that
//     pier's x, so z > W - passGap there;
//   * to clear the jamb pier it must pass north of it at *its* x, so
//     z < passGap there;
//   * heading toward the doorway z only increases, so the line has to
//     climb from under passGap to over W - passGap across the gap
//     between the piers -- at most (2*passGap - W) of climb;
//   * but to land on the far edge of the doorway it must climb from
//     under passGap all the way to CW over the remaining
//     (doorWidth + half a pier) of run, so its slope is at least
//     (CW - passGap) / (doorWidth + thickness/2).
//
// Those two demands become unsatisfiable together once
//     gap >= (doorWidth + thickness/2) * (2*passGap - W) / (CW - passGap)
//
// Note what happens as passGap falls toward W/2: the numerator goes to
// zero and the required spacing vanishes, because the two gaps stop
// overlapping and nothing can thread them. That is also the point at
// which the *player* can no longer get through, which is why passGap is
// floored just above half the lane width and the piers stand apart
// rather than facing each other.
export function requiredShieldGap (geometry) {
  var overlap = 2 * geometry.passGap - geometry.laneWidth;
  if (overlap <= 0) return 0;
  var climb = geometry.corridorDepth - geometry.passGap;
  if (climb <= 0) return Infinity;
  return (geometry.doorWidth + geometry.thickness / 2) * overlap / climb;
}

// ---------------------------------------------------------------
// The plan itself
// ---------------------------------------------------------------
// Built in a canonical frame: the hallway always runs along +X at the
// -Z edge, and the rooms always fill the rest. Fitting that frame onto
// the player's real Guardian rectangle -- which may be any proportion,
// at any angle -- is one rotation applied to the whole building,
// computed here and handed back as `rootRotationY`.
export function planHotel (safeRect, overrides) {
  var settings = Object.assign({}, DEFAULT_SETTINGS, overrides || {});
  var source = safeRect || {};
  var sizeX = Math.max(1.6, Number(source.sizeX) || 2.6);
  var sizeZ = Math.max(1.6, Number(source.sizeZ) || 2.6);

  // The hallway costs depth off one axis, so spend it on the longer one:
  // taking a 1.5m strip off a 3.5m side leaves a usable room, taking it
  // off a 2.5m side leaves a corridor with a view. That does mean the
  // hallway runs along the *shorter* axis, and therefore that the walk
  // is the shorter one -- a trade this POC exists to measure.
  var swing = sizeX <= sizeZ ? 0 : 90;
  var runLength = Math.min(sizeX, sizeZ);
  var depth = Math.max(sizeX, sizeZ);

  // Keep the reserved strip from eating the room in a small play space:
  // at most half the depth goes to the hallway.
  var wantedCorridorDepth = settings.laneWidth + settings.stubDepth;
  var corridorDepth = Math.min(wantedCorridorDepth, depth * 0.5);
  var scale = corridorDepth / wantedCorridorDepth;
  var laneWidth = settings.laneWidth * scale;
  var stubDepth = settings.stubDepth * scale;
  // The pass gap is the width of the squeeze past each pier, and it is
  // where comfort and concealment pull against each other: wide is
  // pleasant to walk and lets sightlines through, narrow hides the
  // doorways and is a shuffle. Both ends are computed here and the
  // search below picks between them.
  var tightestPass = laneWidth / 2 + 0.05;
  // 0.7m is about the narrowest gap worth asking someone in a headset to
  // walk through, and it does not scale down with the play space the way
  // the lane does -- a person is the same width in a small room. Ask for
  // it whenever the lane can give it; the search below decides whether
  // it can be kept.
  var comfortablePass = clamp(
    Math.max(settings.passGap * scale, Math.min(0.7, laneWidth - 0.08)),
    tightestPass,
    laneWidth - 0.08
  );

  var halfRun = runLength / 2;
  var halfDepth = depth / 2;
  var stripMinZ = -halfDepth;
  var doorPlaneZ = stripMinZ + corridorDepth;

  // Two doorways and two pairs of piers all have to fit along one short
  // wall, so in a small play space the doorway narrows rather than
  // squeezing the piers out: a narrow archway still reads as a doorway,
  // whereas a hallway with no turns in it stops working at all.
  var comfortableDoor = Math.min(settings.doorWidth, runLength * 0.26);
  var doorMargin = Math.min(settings.doorMargin, runLength * 0.05);

  var corridorRect = rect(-halfRun, halfRun, stripMinZ, doorPlaneZ);
  var roomRect = rect(-halfRun, halfRun, doorPlaneZ, halfDepth);
  var stubBandMinZ = stripMinZ + laneWidth;

  // Piers: thin fins that turn a straight run into 90-degree turns
  // without costing any more play space than the gap the player walks
  // through -- which matters, because in a Guardian-sized footprint
  // there is no depth to spend on a real dog-leg.
  //
  // Each doorway gets a *pair*, and the pair is what makes the illusion
  // safe. One pier extends the doorway's jamb out into the run from the
  // south wall; the second stands off it a short way, from the north
  // wall. See requiredShieldGap for why that combination is unpassable
  // by a sightline while staying passable by a person.
  //
  // One pier alone does not do this. It casts only a partial shadow, so
  // the far edge of the doorway stays visible from most of a short run
  // -- which measured as having no safe rise window at all.
  var thickness = settings.baffleThickness;
  var wantedInterior = Math.max(0, Math.round(settings.baffles));

  // One complete hallway for a given squeeze width and doorway width.
  // Split out as a function because both of those get *searched* below
  // rather than simply chosen -- see the candidate loop.
  function layOut (passGap, doorWidth) {
    var maxOffset = halfRun - doorWidth / 2 - doorMargin;
    var doorOffset = Math.max(doorWidth * 0.75, maxOffset * clamp(settings.doorSpread, 0.2, 1));
    var doorAX = -doorOffset;
    var doorBX = doorOffset;

    // Everything solid standing inside the hallway's strip. The recessed
    // doorway jambs come first: three blocks filling the stub band
    // everywhere the two openings aren't.
    var blockers = [
      rect(-halfRun, doorAX - doorWidth / 2, stubBandMinZ, doorPlaneZ),
      rect(doorAX + doorWidth / 2, doorBX - doorWidth / 2, stubBandMinZ, doorPlaneZ),
      rect(doorBX + doorWidth / 2, halfRun, stubBandMinZ, doorPlaneZ),
    ].filter(function (r) { return r.maxX - r.minX > 1e-4; });

    var southBaffle = function (centerX) {
      return rect(centerX - thickness / 2, centerX + thickness / 2, stripMinZ + passGap, doorPlaneZ);
    };
    var northBaffle = function (centerX) {
      return rect(centerX - thickness / 2, centerX + thickness / 2, stripMinZ, stripMinZ + laneWidth - passGap);
    };

    var jambAX = doorAX + doorWidth / 2 + thickness / 2;
    var jambBX = doorBX - doorWidth / 2 - thickness / 2;
    var shieldGap = requiredShieldGap({
      laneWidth: laneWidth,
      corridorDepth: corridorDepth,
      passGap: passGap,
      doorWidth: doorWidth,
      thickness: thickness,
    }) * settings.shieldSafety + 0.04;
    // Leave a short straight stretch between the two pairs for the rise
    // to happen over; if the run can't afford the piers at all, build
    // without them and let occlusionWindow report the damage.
    var affordable = (jambBX - jambAX - 0.24) / 2 - thickness;
    var shielded = affordable > 0.05;
    shieldGap = Math.min(shieldGap, Math.max(affordable, 0));

    blockers.push(southBaffle(jambAX));
    blockers.push(southBaffle(jambBX));
    var shieldAX = jambAX + shieldGap + thickness;
    var shieldBX = jambBX - shieldGap - thickness;
    if (shielded) {
      blockers.push(northBaffle(shieldAX));
      blockers.push(northBaffle(shieldBX));
    }

    // `settings.baffles` adds further piers between the two pairs,
    // alternating sides so the walk weaves: the tighter-spiral end of the
    // dial, for comparing how many turns a transition actually needs.
    //
    // These project deeper than the doorway piers do, and that is the
    // whole point. The doorway pair leaves gaps that overlap slightly, so
    // a person can walk almost straight between them; do the same here and
    // the extra piers change nothing at all -- not the walked distance,
    // not the occlusion -- which is exactly what the first version of this
    // measured. Sized so consecutive gaps *don't* overlap, the player has
    // to weave around each one, and both numbers move.
    var interiorGap = clamp(Math.min(passGap, laneWidth - passGap), 0.42, laneWidth - 0.08);
    var interiorSouth = function (centerX) {
      return rect(centerX - thickness / 2, centerX + thickness / 2, stripMinZ + interiorGap, doorPlaneZ);
    };
    var interiorNorth = function (centerX) {
      return rect(centerX - thickness / 2, centerX + thickness / 2, stripMinZ, stripMinZ + laneWidth - interiorGap);
    };
    var interiorStart = shielded ? shieldAX : jambAX;
    var interiorSpan = (shielded ? shieldBX : jambBX) - interiorStart;
    var interiorPiers = function (count) {
      var piers = [];
      if (interiorSpan <= 0.3) return piers;
      for (var i = 0; i < count; i++) {
        var centerX = interiorStart + interiorSpan * ((i + 1) / (count + 1));
        // The player comes off the doorway's north pier hugging the south
        // side, so a south fin is the one that makes them turn first.
        piers.push(i % 2 === 0 ? interiorSouth(centerX) : interiorNorth(centerX));
      }
      return piers;
    };

    // Ask for as many extra turns as will still leave a way through.
    // Piers that don't overlap are what makes the dial bite (above), and
    // enough of them in a short run will wall the hallway off completely
    // -- so rather than shipping a sealed hallway and a warning, back off
    // until it is walkable and say how many actually fitted.
    var interiorCount = wantedInterior;
    var walk = null;
    var finalBlockers = blockers;
    for (;;) {
      var candidate = blockers.concat(interiorPiers(interiorCount));
      walk = buildWalkField(
        corridorRect,
        candidate,
        { x: doorAX, z: doorPlaneZ - 0.02 },
        { x: doorBX, z: doorPlaneZ - 0.02 },
        settings.gridCell
      );
      if (walk.connected || interiorCount === 0) {
        finalBlockers = candidate;
        break;
      }
      interiorCount--;
    }

    return {
      passGap: passGap,
      doorWidth: doorWidth,
      doorAX: doorAX,
      doorBX: doorBX,
      blockers: finalBlockers,
      shielded: shielded,
      shieldGap: shieldGap,
      jambAX: jambAX,
      jambBX: jambBX,
      shieldAX: shieldAX,
      shieldBX: shieldBX,
      walk: walk,
      interiorCount: interiorSpan > 0.3 ? interiorCount : 0,
    };
  }

  // ---------------------------------------------------------------
  // Choosing between comfort and concealment
  // ---------------------------------------------------------------
  // The first headset test called the hallway "ridiculously cramped",
  // and widening the squeeze does fix that -- but it also lets
  // sightlines past the piers, and in a small play space that leaves no
  // stretch of the walk where the rise can happen unseen. Both matter,
  // so neither is hard-coded: the widest comfortable hallway is tried
  // first, and it only gets narrower if that is what it takes to keep
  // the floor change hidden. Concealment wins because it is the thing
  // this POC exists to test; comfort is then taken as far as it can be.
  //
  // What is given up, if anything, is recorded and warned about rather
  // than absorbed silently.
  var attempts = [];
  for (var pass = comfortablePass; pass > tightestPass + 0.02; pass -= 0.06) {
    attempts.push({ passGap: pass, doorWidth: comfortableDoor });
  }
  attempts.push({ passGap: tightestPass, doorWidth: comfortableDoor });
  // Still no luck: a narrower doorway is the next cheapest thing to
  // give, since its far edge is what stays visible longest down the run.
  for (var door = comfortableDoor - 0.06; door >= 0.52; door -= 0.06) {
    attempts.push({ passGap: tightestPass, doorWidth: door });
  }

  var chosen = null;
  var chosenWindow = null;
  var mostComfortable = null;
  var mostComfortableWindow = null;
  for (var a = 0; a < attempts.length; a++) {
    var trial = layOut(attempts[a].passGap, attempts[a].doorWidth);
    if (!trial.walk.connected) continue;
    var window = occlusionWindow({
      walk: trial.walk,
      blockers: trial.blockers,
      doorWidth: trial.doorWidth,
      doorAX: trial.doorAX,
      doorBX: trial.doorBX,
      doorPlaneZ: doorPlaneZ,
      settings: settings,
    });
    if (!mostComfortable) {
      mostComfortable = trial;
      mostComfortableWindow = window;
    }
    if (!window.tight) {
      chosen = trial;
      chosenWindow = window;
      break;
    }
  }
  // Nothing hid the doorways at any squeeze. Build the comfortable one
  // and let the warnings say the transition is catchable here.
  if (!chosen) {
    chosen = mostComfortable || layOut(comfortablePass, comfortableDoor);
    chosenWindow = mostComfortableWindow || occlusionWindow({
      walk: chosen.walk,
      blockers: chosen.blockers,
      doorWidth: chosen.doorWidth,
      doorAX: chosen.doorAX,
      doorBX: chosen.doorBX,
      doorPlaneZ: doorPlaneZ,
      settings: settings,
    });
  }

  var passGap = chosen.passGap;
  var doorWidth = chosen.doorWidth;
  var doorAX = chosen.doorAX;
  var doorBX = chosen.doorBX;
  var blockers = chosen.blockers;
  var shielded = chosen.shielded;
  var shieldGap = chosen.shieldGap;
  var jambAX = chosen.jambAX;
  var jambBX = chosen.jambBX;
  var shieldAX = chosen.shieldAX;
  var shieldBX = chosen.shieldBX;
  var walk = chosen.walk;
  var interiorCount = chosen.interiorCount;

  var floorCount = ROOMS.length;
  var floors = ROOMS.map(function (room, index) {
    return Object.assign({}, room, {
      index: index,
      floorY: index * settings.floorHeight,
      floorColor: lighten(room.wall, 0.58),
      floorShade: lighten(room.wall, 0.36),
      trimColor: darken(room.wall, 0.3),
      // Red is a dead end at the bottom, Purple a dead end at the top.
      hasUpDoor: index < floorCount - 1,
      hasDownDoor: index > 0,
    });
  });

  var plan = {
    settings: settings,
    rootRotationY: (Number(source.rotationY) || 0) + swing,
    rootX: Number(source.centerX) || 0,
    rootZ: Number(source.centerZ) || 0,
    safeRect: { sizeX: sizeX, sizeZ: sizeZ, source: source.source || 'fallback' },
    runLength: runLength,
    depth: depth,
    corridorDepth: corridorDepth,
    laneWidth: laneWidth,
    stubDepth: stubDepth,
    passGap: passGap,
    corridorRect: corridorRect,
    roomRect: roomRect,
    roomDepth: roomRect.maxZ - roomRect.minZ,
    doorPlaneZ: doorPlaneZ,
    doorWidth: doorWidth,
    doorAX: doorAX,
    doorBX: doorBX,
    doorHeight: settings.doorHeight,
    blockers: blockers,
    shielded: shielded,
    shieldGap: shieldGap,
    // The four piers, by x. Exposed because "walk the hallway the way a
    // person would" needs to know which side of each one to pass on --
    // the headless drive test does exactly that.
    jambAX: jambAX,
    jambBX: jambBX,
    shieldAX: shieldAX,
    shieldBX: shieldBX,
    stubBandMinZ: stubBandMinZ,
    floors: floors,
    floorHeight: settings.floorHeight,
    buildingHeight: floorCount * settings.floorHeight,
  };

  plan.walk = walk;
  plan.connected = walk.connected;
  plan.bafflesRequested = wantedInterior;
  // A run with no straight stretch between the two doorway pairs has
  // nowhere to put an extra turn at all, however many were asked for.
  plan.bafflesApplied = interiorCount;
  plan.rise = chosenWindow;
  // How much of the comfortable hallway had to be given back to keep the
  // floor change hidden. Zero is the happy case.
  plan.passGapGivenUp = Math.max(0, comfortablePass - passGap);
  plan.doorWidthGivenUp = Math.max(0, comfortableDoor - doorWidth);
  // A room shallower than this is a ledge, not a room: the hallway has
  // eaten the play space. Surfaced rather than clamped, because the
  // honest answer is "your Guardian is too small for these settings".
  plan.roomTooShallow = plan.roomDepth < 1.1;
  plan.warnings = planWarnings(plan);
  return plan;
}

// What a person setting this up should be told before they put the
// headset on. These are the cases where the geometry still builds and
// still runs, but something about it is known to be worse than it looks
// -- exactly the sort of thing that otherwise gets discovered as "it
// felt off and I don't know why" after a play session.
export function planWarnings (plan) {
  var warnings = [];
  if (!plan.connected) {
    warnings.push('The hallway is sealed: the piers leave no route through. Widen the pass gap or narrow the lane.');
  }
  if (plan.bafflesApplied < plan.bafflesRequested) {
    warnings.push('Only ' + plan.bafflesApplied + ' of the ' + plan.bafflesRequested +
      ' extra turns fitted -- any more and there is no way through this hallway.');
  }
  if (plan.rise.tight) {
    warnings.push('No safe stretch to rise over: at these settings a doorway stays visible for the whole walk, so the floor change is catchable. A bigger play space, a narrower doorway, or a deeper doorway recess all help.');
  }
  if (plan.roomTooShallow) {
    warnings.push('Rooms are only ' + plan.roomDepth.toFixed(2) + 'm deep -- the hallway has taken most of the play space.');
  }
  if (plan.passGapGivenUp > 0.02 || plan.doorWidthGivenUp > 0.02) {
    warnings.push('Narrowed the hallway squeeze to ' + plan.passGap.toFixed(2) + 'm' +
      (plan.doorWidthGivenUp > 0.02 ? ' and the doorways to ' + plan.doorWidth.toFixed(2) + 'm' : '') +
      ' to keep the floor change hidden. A wider play space buys the comfort back.');
  } else if (plan.passGap < 0.68) {
    warnings.push('The gap past each pier is only ' + plan.passGap.toFixed(2) + 'm -- narrow enough to have to turn sideways for.');
  }
  // The honest version of the trade, stated once with a number on it.
  // Room depth, a hallway wide enough to walk, and a transition that
  // can't be caught are three claims on the same rectangle, and below
  // roughly 3.2m on the shorter side there isn't enough of it to settle
  // all three. Saying so beats quietly picking one to sacrifice.
  if (plan.runLength < 3.2 && plan.rise.tight) {
    warnings.push('At ' + plan.runLength.toFixed(2) + 'm across, this play space can have a comfortable hallway or a hidden floor change, but not both. It needs about 3.2m on its shorter side for both. Narrowing the doorway or the pier gap trades comfort back for concealment.');
  }
  return warnings;
}

// The runtime's per-frame question: how far along the walk is this
// floor-plan point?
export function hallwayProgress (plan, x, z) {
  return progressAt(plan.walk, x, z);
}

// Convenience for the readout: how much of the walk is spent rising, in
// metres, and how fast the hallway climbs at its quickest. The second
// number is reported but deliberately *not* tuned against -- the rise is
// invisible by construction (no window, no shadow, nothing moving
// relative to the player), so its speed has no comfort cost. If that
// turns out to be wrong in a headset, this is the first number to look
// at.
export function riseProfile (plan, walkSpeed) {
  var speed = walkSpeed || 0.9;
  var riseDistance = (plan.rise.end - plan.rise.start) * plan.walk.total;
  // smoothstep's derivative peaks at 1.5 over its own [0,1] domain.
  var peak = riseDistance > 0 ? 1.5 * plan.floorHeight * speed / riseDistance : Infinity;
  return {
    walkLength: plan.walk.total,
    riseDistance: riseDistance,
    peakVerticalSpeed: peak,
    occlusionMargin: plan.rise.margin,
  };
}
