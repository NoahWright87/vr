import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SAFE_RECT,
  DESKTOP_SAFE_RECT,
  fitSafeRect,
  pointInPolygon,
  polygonCentroid,
  rectsAgree,
  transformPoints,
  rectArea,
  polygonExtent,
  describeError,
} from '../common/guardian-bounds.js';

function square (halfX, halfZ, centerX, centerZ) {
  var cx = centerX || 0;
  var cz = centerZ || 0;
  return [
    { x: cx - halfX, z: cz - halfZ },
    { x: cx + halfX, z: cz - halfZ },
    { x: cx + halfX, z: cz + halfZ },
    { x: cx - halfX, z: cz + halfZ },
  ];
}

function rotate (points, degrees) {
  var radians = degrees * Math.PI / 180;
  return points.map(function (point) {
    return {
      x: point.x * Math.cos(radians) - point.z * Math.sin(radians),
      z: point.x * Math.sin(radians) + point.z * Math.cos(radians),
    };
  });
}

test('a plain square boundary becomes itself, minus the safety inset', () => {
  var rect = fitSafeRect(square(1.5, 1.25), { inset: 0.2 });
  assert.ok(Math.abs(rect.sizeX - 2.6) < 0.01, 'x: ' + rect.sizeX);
  assert.ok(Math.abs(rect.sizeZ - 2.1) < 0.01, 'z: ' + rect.sizeZ);
  assert.ok(Math.abs(rect.centerX) < 0.01);
  assert.ok(Math.abs(rect.centerZ) < 0.01);
  assert.equal(rect.source, 'webxr');
});

test('an off-centre boundary keeps its centre', () => {
  var rect = fitSafeRect(square(1.4, 1.4, 0.8, -1.2), { inset: 0.15 });
  assert.ok(Math.abs(rect.centerX - 0.8) < 0.05, 'x: ' + rect.centerX);
  assert.ok(Math.abs(rect.centerZ + 1.2) < 0.05, 'z: ' + rect.centerZ);
});

test('a boundary drawn at an angle is fitted at that angle rather than shrunk to fit the axes', () => {
  // Someone who drew their Guardian along the walls of a room that isn't
  // square to their tracking origin should not lose most of their floor.
  var angled = rotate(square(1.5, 1.2), 30);
  var fitted = fitSafeRect(angled, { inset: 0.1 });
  assert.ok(Math.abs(Math.abs(fitted.rotationY) - 30) < 2 || Math.abs(Math.abs(fitted.rotationY) - 60) < 2,
    'picked up the boundary rotation, got ' + fitted.rotationY);
  assert.ok(rectArea(fitted) > 5.5, 'kept most of the floor, got ' + rectArea(fitted).toFixed(2) + ' m2');

  // The axis-aligned answer for the same polygon is much worse, which is
  // the whole reason the rotation search exists.
  var axisOnly = fitSafeRect(angled, { inset: 0.1, samplesPerEdge: 6 });
  assert.ok(rectArea(axisOnly) >= rectArea(fitted) - 1e-6);
});

test('a desk-shaped bite out of one corner is fitted around, not stepped over', () => {
  var notched = [
    { x: -1.5, z: -1.5 }, { x: 1.5, z: -1.5 }, { x: 1.5, z: 0.6 },
    { x: 0.6, z: 0.6 }, { x: 0.6, z: 1.5 }, { x: -1.5, z: 1.5 },
  ];
  assert.equal(pointInPolygon({ x: 1.0, z: 1.0 }, notched), false, 'the bite really is outside');

  var rect = fitSafeRect(notched, { inset: 0.1, minSize: 1 });
  assert.ok(rect, 'found a rectangle');
  [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (sign) {
    var corner = { x: rect.centerX + sign[0] * rect.sizeX / 2, z: rect.centerZ + sign[1] * rect.sizeZ / 2 };
    assert.equal(pointInPolygon(corner, notched), true, 'corner ' + JSON.stringify(corner) + ' is inside');
  });
  assert.ok(rect.sizeX < 2.8, 'and it really did give ground to the bite, got ' + rect.sizeX.toFixed(2));
});

test('a boundary with a deep bite out of the middle reports a small rectangle, or none', () => {
  // The fit is anchored on the boundary's centre and grown outward, so a
  // U-shaped Guardian -- a pillar in the middle of the room, say -- has
  // no large centred rectangle to find. Being told "1.6m is all I can
  // promise" is the right answer; sliding the rectangle off to one side
  // to find a bigger one would be a fair improvement, but guessing is
  // not, so it refuses instead.
  var deep = [
    { x: -1.5, z: -1.5 }, { x: 1.5, z: -1.5 }, { x: 1.5, z: 1.5 },
    { x: 0.4, z: 1.5 }, { x: 0.4, z: 0.2 }, { x: -0.4, z: 0.2 }, { x: -0.4, z: 1.5 },
    { x: -1.5, z: 1.5 },
  ];
  assert.equal(fitSafeRect(deep, { inset: 0.1, minSize: 1.6 }), null);
  var small = fitSafeRect(deep, { inset: 0.1, minSize: 0.3 });
  assert.ok(small && small.sizeZ < 1, 'what it does find is small: ' + (small && small.sizeZ.toFixed(2)));
});

test('unusable boundary readings are refused rather than guessed at', () => {
  assert.equal(fitSafeRect([], {}), null, 'empty');
  assert.equal(fitSafeRect([{ x: 0, z: 0 }, { x: 1, z: 1 }], {}), null, 'two points is not a polygon');
  // The documented Quest failure: a stale, too-small square.
  assert.equal(fitSafeRect(square(0.3, 0.3), { inset: 0.15, minSize: 1.6 }), null, 'a 0.6m square is not a play space');
  assert.equal(fitSafeRect([{ x: NaN, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }], {}), null, 'garbage in');
});

test('bounds points are moved into the space the renderer is actually using', () => {
  // Column-major, a half-turn about Y plus a 2m shift along +X.
  var matrix = [
    -1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, -1, 0,
    2, 0, 0, 1,
  ];
  var moved = transformPoints([{ x: 1, y: 0, z: 1 }], matrix);
  assert.ok(Math.abs(moved[0].x - 1) < 1e-9, 'x: ' + moved[0].x);
  assert.ok(Math.abs(moved[0].z + 1) < 1e-9, 'z: ' + moved[0].z);
  // No transform at all is the identity, not a crash.
  assert.deepEqual(transformPoints([{ x: 3, y: 9, z: -4 }], null), [{ x: 3, z: -4 }]);
});

test('the area-weighted centroid ignores how densely the boundary was clicked', () => {
  // The same square, but with a run of extra points crowded along one
  // edge -- the mean of the vertices drifts toward them, the real
  // centroid does not.
  var crowded = [
    { x: -1, z: -1 }, { x: -0.6, z: -1 }, { x: -0.2, z: -1 }, { x: 0.2, z: -1 },
    { x: 0.6, z: -1 }, { x: 1, z: -1 }, { x: 1, z: 1 }, { x: -1, z: 1 },
  ];
  var centroid = polygonCentroid(crowded);
  assert.ok(Math.abs(centroid.x) < 1e-6);
  assert.ok(Math.abs(centroid.z) < 1e-6, 'z drifted to ' + centroid.z);

  var mean = crowded.reduce(function (sum, point) { return sum + point.z; }, 0) / crowded.length;
  assert.ok(Math.abs(mean) > 0.4, 'the naive mean really does drift');
});

test('agreement between successive readings has a centimetre-scale tolerance', () => {
  var base = { centerX: 0, centerZ: 0, sizeX: 3, sizeZ: 2.4, rotationY: 0 };
  assert.equal(rectsAgree(base, Object.assign({}, base, { sizeX: 3.01 })), true);
  assert.equal(rectsAgree(base, Object.assign({}, base, { sizeX: 3.2 })), false);
  assert.equal(rectsAgree(base, Object.assign({}, base, { rotationY: 1 })), true);
  assert.equal(rectsAgree(base, Object.assign({}, base, { rotationY: 8 })), false);
  assert.equal(rectsAgree(base, null), false);
});

test('the fallback rectangles are sized for who they are for', () => {
  // The headset fallback errs small: too big puts the player through a
  // real wall. The flat-screen one has no wall to worry about.
  assert.ok(DEFAULT_SAFE_RECT.sizeX <= 2.8 && DEFAULT_SAFE_RECT.sizeZ <= 2.8);
  assert.ok(rectArea(DESKTOP_SAFE_RECT) > rectArea(DEFAULT_SAFE_RECT));
  assert.equal(DEFAULT_SAFE_RECT.source, 'fallback');
  assert.equal(DESKTOP_SAFE_RECT.source, 'desktop');
});

test('the raw boundary extent is reported separately from the fitted rectangle', () => {
  // "I can see a 3.4 x 2.9 boundary but cannot fit a rectangle in it" and
  // "I never saw a boundary" need different fixes, and from inside a
  // headset they look identical unless both numbers are shown.
  var polygon = square(1.7, 1.45);
  var extent = polygonExtent(polygon);
  assert.ok(Math.abs(extent.sizeX - 3.4) < 1e-9);
  assert.ok(Math.abs(extent.sizeZ - 2.9) < 1e-9);
  assert.equal(polygonExtent([]), null);
  assert.equal(polygonExtent(null), null);
});

test('rejection reasons survive into something readable', () => {
  // DOMException puts the useful half in `name`, plain Errors in
  // `message`, and some browsers reject with a bare string. A readout
  // saying "[object Object]" would be worse than saying nothing.
  assert.equal(describeError({ name: 'NotSupportedError', message: 'bounded-floor unavailable' }),
    'NotSupportedError: bounded-floor unavailable');
  assert.equal(describeError({ name: 'NotSupportedError' }), 'NotSupportedError');
  assert.equal(describeError(new Error('nope')), 'Error: nope');
  assert.equal(describeError('plain string'), 'plain string');
  assert.equal(describeError(null), 'unknown');
});
