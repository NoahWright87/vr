import assert from 'node:assert/strict';
import test from 'node:test';

import { checkerRepeat } from '../common/checkerboard.js';
import { hexToRgb, rgbToHex, mixColors, lighten, darken } from '../common/color-utils.js';

test('the checker repeat keeps squares the same real size whatever the surface', () => {
  // A 0.5m square across a 20m floor is 20 squares, so 10 tiles.
  assert.equal(checkerRepeat(20, 0.5), 20);
  assert.equal(checkerRepeat(10, 0.5), 10);
  assert.equal(checkerRepeat(3.2, 0.4), 4);
  // A surface with no usable extent tiles once rather than infinitely --
  // a texture repeated Infinity times is a black smear, not a floor.
  assert.equal(checkerRepeat(0, 0.5), 1);
  assert.equal(checkerRepeat(undefined, 0.5), 1);
  assert.equal(checkerRepeat(2, 0), 2, 'a zero square size falls back to the default');
});

test('hex parsing takes the forms an author actually writes', () => {
  assert.deepEqual(hexToRgb('#ff8000'), { r: 255, g: 128, b: 0 });
  assert.deepEqual(hexToRgb('ff8000'), { r: 255, g: 128, b: 0 });
  assert.deepEqual(hexToRgb('#f80'), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb('  #FF8000 '), { r: 255, g: 128, b: 0 });
});

test('a bad colour returns null instead of throwing', () => {
  // These run inside component schemas, where a throw takes the whole
  // scene down during init rather than just looking wrong.
  assert.equal(hexToRgb('nonsense'), null);
  assert.equal(hexToRgb(''), null);
  assert.equal(hexToRgb(undefined), null);
  assert.equal(mixColors('#fff', 'nope', 0.5), null);
  assert.equal(rgbToHex(null), null);
});

test('mixing is a straight blend, and clamps outside 0..1', () => {
  assert.equal(mixColors('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixColors('#000000', '#ffffff', 0), '#000000');
  assert.equal(mixColors('#000000', '#ffffff', 1), '#ffffff');
  assert.equal(mixColors('#000000', '#ffffff', 5), '#ffffff');
  assert.equal(mixColors('#000000', '#ffffff', -1), '#000000');
});

test('lighten and darken stay on the same hue, which is what the room/floor pairing needs', () => {
  var wall = '#b5302a';
  var floor = lighten(wall, 0.58);
  var trim = darken(wall, 0.3);
  var wallRgb = hexToRgb(wall);
  var floorRgb = hexToRgb(floor);
  var trimRgb = hexToRgb(trim);
  assert.ok(floorRgb.r > wallRgb.r && floorRgb.g > wallRgb.g && floorRgb.b > wallRgb.b);
  assert.ok(trimRgb.r < wallRgb.r && trimRgb.g < wallRgb.g && trimRgb.b < wallRgb.b);
  // Red still dominates in all three.
  [wallRgb, floorRgb, trimRgb].forEach(function (rgb) {
    assert.ok(rgb.r > rgb.g && rgb.r > rgb.b);
  });
});
