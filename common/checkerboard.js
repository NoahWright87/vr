// A checkerboard surface, generated at runtime onto a <canvas> and tiled
// across whatever entity it is attached to.
//
// Punch Pop's room and the menu showcase's floor both already did this,
// each with their own local copy of "make a 64px canvas, fill two
// rects, tile it". Rainbow Hotel needs six of them in six different
// colours, which is the point where a third copy stops being cheaper
// than a shared component -- so this is that copy, promoted.
//
// The two tile colours are normally *derived* from one base colour
// rather than authored as a pair: Rainbow Hotel's rule is "each room's
// floor is a checkerboard in a lighter shade of that room's own wall
// colour", so `color` is the wall colour and `lightA`/`lightB` say how
// far each square is pushed toward white. Authoring `colorA`/`colorB`
// directly still works for surfaces that aren't following that rule.

import { lighten } from './color-utils.js';

// One tile of the texture is a 2x2 arrangement of squares, so a tile
// covers two squares in each direction. Everything that converts
// "metres per square" into a texture repeat count has to divide by this.
var SQUARES_PER_TILE = 2;
var CANVAS_SIZE = 64;

// Draws the classic two-tone tile. Split out from the component so the
// drawing has one home even if something later wants a checker texture
// without an entity to hang it on.
export function paintCheckerTile (canvas, colorA, colorB) {
  var context = canvas.getContext('2d');
  var half = canvas.width / 2;
  context.fillStyle = colorA;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = colorB;
  context.fillRect(0, 0, half, half);
  context.fillRect(half, half, half, half);
  return canvas;
}

// Given a surface's extent in metres and a target square size, how many
// times does the tile repeat? Pure, so the sizing rule is testable
// without a renderer. A zero/absent extent falls back to 1 rather than
// Infinity -- a texture that tiles once is wrong-looking, a texture that
// tiles Infinity times is a black smear.
export function checkerRepeat (extent, squareSize) {
  var size = Number(squareSize) > 0 ? Number(squareSize) : 0.5;
  var span = Number(extent) > 0 ? Number(extent) : 0;
  if (!span) return 1;
  return Math.max(1, Math.round(span / (size * SQUARES_PER_TILE)));
}

if (typeof AFRAME !== 'undefined') {
  AFRAME.registerComponent('checkerboard', {
    schema: {
      // The surface's "own" colour. Both square colours are derived from
      // it unless colorA/colorB are given explicitly.
      color: { default: '#888888' },
      lightA: { default: 0.62 },
      lightB: { default: 0.40 },
      colorA: { default: '' },
      colorB: { default: '' },
      // Metres per square. The repeat count is computed from the
      // entity's own geometry so the squares stay the same real-world
      // size whatever the surface is sized to -- which is what gives a
      // room its sense of scale, and is exactly the thing a hand-tuned
      // `repeat: 20 20` loses the moment the floor is resized.
      squareSize: { default: 0.5 },
      // Explicit override, for surfaces whose geometry isn't a useful
      // guide (or that aren't square-on to the texture).
      repeat: { type: 'vec2', default: { x: 0, y: 0 } },
    },

    init: function () {
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = CANVAS_SIZE;
      this.texture = null;
      this.onLoaded = this.apply.bind(this);
      this.el.addEventListener('loaded', this.onLoaded);
      // Geometry can be swapped after the fact (the hotel resizes its
      // rooms when a real Guardian rectangle arrives), and the repeat
      // count is derived from it, so re-apply whenever it changes.
      this.el.addEventListener('componentchanged', this.onComponentChanged.bind(this));
    },

    remove: function () {
      this.el.removeEventListener('loaded', this.onLoaded);
      if (this.texture) this.texture.dispose();
    },

    onComponentChanged: function (evt) {
      if (evt.detail && evt.detail.name === 'geometry') this.apply();
    },

    update: function () {
      this.apply();
    },

    // Reads the entity's geometry for its in-world extent. A plane
    // carries width/height; a box carries width/depth for the face that
    // is usually the one being walked on. Anything else falls back to
    // the explicit repeat.
    surfaceExtent: function () {
      var geometry = this.el.getAttribute('geometry') || {};
      var across = Number(geometry.width) || 0;
      var along = Number(geometry.depth) || Number(geometry.height) || 0;
      return { x: across, y: along };
    },

    apply: function () {
      var mesh = this.el.getObject3D('mesh');
      if (!mesh || !mesh.material) return;

      var data = this.data;
      var colorA = data.colorA || lighten(data.color, data.lightA) || '#cccccc';
      var colorB = data.colorB || lighten(data.color, data.lightB) || '#999999';
      paintCheckerTile(this.canvas, colorA, colorB);

      if (!this.texture) {
        this.texture = new AFRAME.THREE.CanvasTexture(this.canvas);
        this.texture.wrapS = this.texture.wrapT = AFRAME.THREE.RepeatWrapping;
      }
      this.texture.needsUpdate = true;

      var extent = this.surfaceExtent();
      var repeatX = data.repeat.x > 0 ? data.repeat.x : checkerRepeat(extent.x, data.squareSize);
      var repeatY = data.repeat.y > 0 ? data.repeat.y : checkerRepeat(extent.y, data.squareSize);
      this.texture.repeat.set(repeatX, repeatY);

      mesh.material.map = this.texture;
      mesh.material.needsUpdate = true;
    },
  });
}
