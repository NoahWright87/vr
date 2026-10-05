import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOMS,
  DEFAULT_SETTINGS,
  planHotel,
  riseFraction,
  riseProfile,
  hallwayProgress,
  doorVisibleFrom,
  requiredShieldGap,
  occlusionWindow,
  segmentHitsRect,
  smoothstep,
} from '../games/rainbow-hotel/js/hotel-layout.js';

var SPACES = [
  { label: '2.2 x 2.2', sizeX: 2.2, sizeZ: 2.2 },
  { label: '2.6 x 2.6', sizeX: 2.6, sizeZ: 2.6 },
  { label: '3.0 x 3.0', sizeX: 3.0, sizeZ: 3.0 },
  { label: '3.4 x 3.2', sizeX: 3.4, sizeZ: 3.2 },
  { label: '4.0 x 3.0', sizeX: 4.0, sizeZ: 3.0 },
];

test('six colour-coded floors, with dead ends at both ends of the sequence', () => {
  assert.deepEqual(ROOMS.map((room) => room.name), ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple']);
  var plan = planHotel({ sizeX: 3, sizeZ: 3 });
  assert.equal(plan.floors.length, 6);
  assert.equal(plan.floors[0].hasDownDoor, false, 'Red is the bottom dead end');
  assert.equal(plan.floors[0].hasUpDoor, true);
  assert.equal(plan.floors[5].hasUpDoor, false, 'Purple is the top dead end');
  assert.equal(plan.floors[5].hasDownDoor, true);
  plan.floors.slice(1, 5).forEach(function (floor) {
    assert.equal(floor.hasUpDoor && floor.hasDownDoor, true, floor.name + ' has both doorways');
  });
  plan.floors.forEach(function (floor, index) {
    assert.equal(floor.floorY, index * plan.floorHeight);
  });
});

test('each floor is a lighter shade of its own wall colour, not an authored pair', () => {
  var plan = planHotel({ sizeX: 3, sizeZ: 3 });
  plan.floors.forEach(function (floor) {
    assert.match(floor.floorColor, /^#[0-9a-f]{6}$/);
    assert.notEqual(floor.floorColor, floor.wall);
    // Lighter in every channel than the wall it came from.
    for (var channel = 1; channel < 7; channel += 2) {
      var wall = parseInt(floor.wall.slice(channel, channel + 2), 16);
      var floorChannel = parseInt(floor.floorColor.slice(channel, channel + 2), 16);
      assert.ok(floorChannel > wall, floor.name + ' floor channel is lighter than its wall');
    }
  });
});

test('every room and the whole hallway fit inside the play space', () => {
  SPACES.forEach(function (space) {
    var plan = planHotel(space);
    var halfRun = Math.min(space.sizeX, space.sizeZ) / 2;
    var halfDepth = Math.max(space.sizeX, space.sizeZ) / 2;
    assert.ok(plan.corridorRect.minX >= -halfRun - 1e-9, space.label);
    assert.ok(plan.corridorRect.maxX <= halfRun + 1e-9, space.label);
    assert.ok(plan.corridorRect.minZ >= -halfDepth - 1e-9, space.label);
    assert.ok(plan.roomRect.maxZ <= halfDepth + 1e-9, space.label);
    // The hallway strip and the rooms never overlap in plan: that is the
    // whole reason the hallway can pass through every floor level.
    assert.ok(plan.corridorRect.maxZ <= plan.roomRect.minZ + 1e-9, space.label);
  });
});

test('the hallway is walkable end to end at every play-space size', () => {
  SPACES.forEach(function (space) {
    var plan = planHotel(space);
    assert.equal(plan.connected, true, space.label + ' has a route through');
    assert.ok(plan.walk.total > 1, space.label + ' has a walk of real length');
    assert.ok(plan.passGap > 0.4, space.label + ' leaves a gap a person fits through');
  });
});

test('walked distance is a geodesic, not a distance to a centreline', () => {
  var plan = planHotel({ sizeX: 3, sizeZ: 3 });
  // The alcove between the first doorway's two piers is a step away from
  // that doorway in walked terms. Measured against a centreline it lands
  // halfway down the hallway instead, which would let the rise start
  // while the doorway is still in view -- the bug this field exists to
  // avoid.
  var alcove = hallwayProgress(plan, (plan.jambAX + plan.shieldAX) / 2, plan.corridorRect.minZ + plan.passGap * 0.5);
  assert.ok(alcove < 0.45, 'alcove beside the first doorway reads as early in the walk, got ' + alcove);

  var atDoorA = hallwayProgress(plan, plan.doorAX, plan.doorPlaneZ - 0.02);
  var atDoorB = hallwayProgress(plan, plan.doorBX, plan.doorPlaneZ - 0.02);
  assert.ok(atDoorA < 0.05, 'the first doorway is the start of the walk');
  assert.ok(atDoorB > 0.95, 'the second doorway is the end of it');
});

test('the rise is confined to the stretch where neither doorway can be seen', () => {
  SPACES.forEach(function (space) {
    var plan = planHotel(space);
    assert.equal(plan.rise.tight, false, space.label + ' has an honest occlusion window');

    var field = plan.walk;
    var offences = [];
    for (var iz = 0; iz < field.rows; iz++) {
      for (var ix = 0; ix < field.columns; ix++) {
        var index = iz * field.columns + ix;
        if (!isFinite(field.distance[index])) continue;
        var point = field.centerOf(ix, iz);
        var rise = riseFraction(plan, field.distance[index] / field.total);
        if (rise <= 1e-6 || rise >= 1 - 1e-6) continue;
        if (doorVisibleFrom(plan, point.x, point.z, plan.doorAX) ||
            doorVisibleFrom(plan, point.x, point.z, plan.doorBX)) {
          offences.push({ x: +point.x.toFixed(3), z: +point.z.toFixed(3), rise: +rise.toFixed(3) });
        }
      }
    }
    assert.deepEqual(offences, [], space.label + ': spots where a doorway is visible mid-rise');
  });
});

test('standing in either doorway recess, the hallway is exactly level with a floor', () => {
  var plan = planHotel({ sizeX: 3, sizeZ: 3 });
  var field = plan.walk;
  var checked = 0;
  for (var iz = 0; iz < field.rows; iz++) {
    for (var ix = 0; ix < field.columns; ix++) {
      var index = iz * field.columns + ix;
      if (!isFinite(field.distance[index])) continue;
      var point = field.centerOf(ix, iz);
      if (point.z < plan.corridorRect.minZ + plan.laneWidth) continue;
      checked++;
      var rise = riseFraction(plan, field.distance[index] / field.total);
      assert.ok(rise <= 1e-6 || rise >= 1 - 1e-6,
        'rise ' + rise.toFixed(3) + ' inside a doorway recess at ' + point.x.toFixed(2) + ',' + point.z.toFixed(2));
    }
  }
  assert.ok(checked > 20, 'actually sampled the doorway recesses');
});

test('a single pier at a doorway is not enough -- the pair is what hides it', () => {
  // The same plan with the second (stand-off) pier of each pair removed
  // has doorways visible from most of the run, which is how the paired
  // arrangement was arrived at in the first place.
  //
  // Measured where it bites. Which play spaces those are is itself worth
  // pinning down, so the second half of this test checks the other end.
  var plan = planHotel({ sizeX: 2.6, sizeZ: 2.6 });
  var withoutShields = Object.assign({}, plan, {
    blockers: plan.blockers.filter(function (rect) {
      return !(Math.abs(rect.minX - (plan.shieldAX - plan.settings.baffleThickness / 2)) < 1e-6 ||
        Math.abs(rect.minX - (plan.shieldBX - plan.settings.baffleThickness / 2)) < 1e-6);
    }),
  });
  assert.equal(withoutShields.blockers.length, plan.blockers.length - 2, 'removed exactly the two stand-off piers');

  // What matters is not how many spots can see the doorway, but how far
  // along the walk the furthest of them is -- that point is what sets
  // where the rise is allowed to begin.
  var field = plan.walk;
  var furthestSeeing = function (candidate) {
    var furthest = 0;
    for (var iz = 0; iz < field.rows; iz++) {
      for (var ix = 0; ix < field.columns; ix++) {
        var index = iz * field.columns + ix;
        if (!isFinite(field.distance[index])) continue;
        var point = field.centerOf(ix, iz);
        var s = field.distance[index] / field.total;
        if (s > furthest && doorVisibleFrom(candidate, point.x, point.z, plan.doorAX)) furthest = s;
      }
    }
    return furthest;
  };

  assert.ok(furthestSeeing(plan) < furthestSeeing(withoutShields) - 0.05,
    'the pair pulls the last sighting of the doorway back down the run');
  assert.equal(plan.rise.tight, false, 'with the pair there is a safe stretch');
  assert.equal(occlusionWindow(withoutShields).tight, true,
    'and with only the jamb pier there is none at all');
});

test('the stand-off pier earns its place in a small space and is redundant in a large one', () => {
  // Worth knowing rather than assuming: the second pier of each pair is
  // what rescues a cramped play space, but once the doorway recess is
  // deep enough and the run long enough, the jamb pier alone already
  // hides the doorway and the stand-off adds nothing but lost run. That
  // is why it is sized from the geometry (requiredShieldGap) instead of
  // being a fixed piece of the hallway.
  var strip = function (plan) {
    var thickness = plan.settings.baffleThickness;
    return Object.assign({}, plan, {
      blockers: plan.blockers.filter(function (rect) {
        return !(Math.abs(rect.minX - (plan.shieldAX - thickness / 2)) < 1e-6 ||
          Math.abs(rect.minX - (plan.shieldBX - thickness / 2)) < 1e-6);
      }),
    });
  };

  var small = planHotel({ sizeX: 2.6, sizeZ: 2.6 });
  assert.equal(small.rise.tight, false);
  assert.equal(occlusionWindow(strip(small)).tight, true, 'small space depends on the pair');

  var large = planHotel({ sizeX: 4.5, sizeZ: 4 });
  assert.equal(large.rise.tight, false);
  assert.equal(occlusionWindow(strip(large)).tight, false, 'large space does not');
});

test('the required pier spacing matches the geometry it was derived from', () => {
  var geometry = { laneWidth: 1.1, corridorDepth: 1.5, passGap: 0.6, doorWidth: 0.7, thickness: 0.1 };
  // (0.7 + 0.05) * (1.2 - 1.1) / (1.5 - 0.6)
  assert.ok(Math.abs(requiredShieldGap(geometry) - 0.75 * 0.1 / 0.9) < 1e-9);
  // Once the two gaps no longer overlap, nothing can thread them at any
  // spacing at all.
  assert.equal(requiredShieldGap(Object.assign({}, geometry, { passGap: 0.55 })), 0);
});

test('the rise curve starts and finishes flat, and never runs backwards', () => {
  var plan = planHotel({ sizeX: 3, sizeZ: 3 });
  assert.equal(riseFraction(plan, 0), 0);
  assert.equal(riseFraction(plan, plan.rise.start), 0);
  assert.equal(riseFraction(plan, 1), 1);
  assert.equal(riseFraction(plan, plan.rise.end), 1);
  var previous = -1;
  for (var s = 0; s <= 1.0001; s += 0.01) {
    var value = riseFraction(plan, s);
    assert.ok(value >= previous - 1e-9, 'rise is monotonic at s=' + s.toFixed(2));
    previous = value;
  }
  assert.equal(smoothstep(0.5), 0.5);
});

test('a play space too small for the settings is reported, not silently shipped', () => {
  var cramped = planHotel({ sizeX: 1.7, sizeZ: 1.7 });
  assert.ok(cramped.warnings.length > 0, 'something is said about it');
  assert.ok(cramped.rise.tight || cramped.roomTooShallow);

  var roomy = planHotel({ sizeX: 3.4, sizeZ: 3.2 });
  assert.deepEqual(roomy.warnings, [], 'a normal play space has nothing to warn about');
});

test('the building is rotated so the hallway runs along the shorter axis', () => {
  // Spending the hallway's depth on the longer side is what keeps the
  // rooms usable; the cost is that the walk is the shorter dimension.
  var wide = planHotel({ sizeX: 4, sizeZ: 2.5 });
  assert.equal(wide.rootRotationY, 90);
  assert.equal(wide.runLength, 2.5);
  assert.equal(wide.depth, 4);

  var deep = planHotel({ sizeX: 2.5, sizeZ: 4 });
  assert.equal(deep.rootRotationY, 0);
  assert.equal(deep.runLength, 2.5);

  // A Guardian drawn at an angle carries its own rotation through.
  var angled = planHotel({ sizeX: 2.5, sizeZ: 4, rotationY: -22 });
  assert.equal(angled.rootRotationY, -22);
});

test('the reported rise profile matches the plan it came from', () => {
  var plan = planHotel({ sizeX: 3.4, sizeZ: 3.2 });
  var profile = riseProfile(plan, 0.9);
  assert.equal(profile.walkLength, plan.walk.total);
  assert.ok(Math.abs(profile.riseDistance - (plan.rise.end - plan.rise.start) * plan.walk.total) < 1e-9);
  assert.equal(profile.occlusionMargin, plan.rise.margin);
  assert.ok(profile.riseDistance > 0.2, 'there is a real stretch of walk to rise over');
});

test('segment/rectangle blocking treats a graze as visible rather than hidden', () => {
  var box = { minX: 0, maxX: 1, minZ: 0, maxZ: 1 };
  assert.equal(segmentHitsRect(-1, 0.5, 2, 0.5, box), true, 'straight through');
  assert.equal(segmentHitsRect(-1, 2, 2, 2, box), false, 'clear of it');
  // Exactly along the face: when in doubt the player can see.
  assert.equal(segmentHitsRect(-1, 1, 2, 1, box), false);
});

test('defaults are the spec baseline: one turn at each threshold, no extra piers', () => {
  assert.equal(DEFAULT_SETTINGS.baffles, 0);
  var plan = planHotel({ sizeX: 4, sizeZ: 3.5 });
  // Three wall blocks making the hallway's south wall, plus the two
  // pairs of piers at the doorways.
  assert.equal(plan.blockers.length, 7);
  assert.equal(plan.shielded, true);
  assert.equal(plan.bafflesApplied, 0);

  var withExtras = planHotel({ sizeX: 4, sizeZ: 3.5 }, { baffles: 2 });
  assert.equal(withExtras.bafflesApplied, 2, 'the turn count is a parameter on one hallway, not a second hallway');
  assert.equal(withExtras.blockers.length, 9);
});

test('a play space too small for both keeps the floor change hidden and says what it cost', () => {
  // Comfort and concealment are claims on the same rectangle. The
  // planner tries the widest comfortable hallway first and only narrows
  // it if that is what it takes to keep the transition hidden -- because
  // a catchable transition fails the thing this POC is testing, while a
  // tight squeeze merely annoys.
  var roomy = planHotel({ sizeX: 4, sizeZ: 3.5 });
  assert.equal(roomy.rise.tight, false);
  assert.ok(roomy.passGap >= 0.7, 'a big enough space keeps a comfortable squeeze, got ' + roomy.passGap.toFixed(2));
  assert.ok(roomy.passGapGivenUp < 0.02, 'and gives nothing up for it');
  assert.deepEqual(roomy.warnings, []);

  var cramped = planHotel({ sizeX: 2.4, sizeZ: 2.4 });
  assert.equal(cramped.rise.tight, false, 'concealment is still intact');
  assert.ok(cramped.passGapGivenUp > 0.02, 'but comfort was traded for it');
  assert.ok(cramped.passGap < roomy.passGap);
  assert.ok(
    cramped.warnings.some(function (warning) { return /narrowed the hallway squeeze/i.test(warning); }),
    'and the trade is reported: ' + JSON.stringify(cramped.warnings)
  );
});
