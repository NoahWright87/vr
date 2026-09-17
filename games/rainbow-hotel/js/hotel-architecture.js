// Turning a plan (see hotel-layout.js) into A-Frame entities.
//
// Nothing here decides anything: every dimension comes from the plan, so
// changing the shape of the building is a change to the arithmetic, not
// to the model-building. The one thing this file does own is the rule
// that keeps the illusion safe at render time:
//
//   **Nothing in the scene may light or texture the hallway in a way
//   that changes as it moves.**
//
// A directional light is fine -- translating a surface doesn't alter how
// a directional light falls on it, so the hallway's walls look identical
// at every height. A *point* light anywhere near the shaft is not fine,
// and neither is anything that projects a texture in world space, or a
// shadow, or a reflection. The hallway is lit by ambient plus one
// directional light and carries its own emissive ceiling panel, and that
// is deliberate rather than just cheap.

import '../../../common/checkerboard.js';
import { lighten, darken } from '../../../common/color-utils.js';

var HALLWAY_FLOOR = '#6d6a66';
var HALLWAY_WALL = '#b9b3a8';
var HALLWAY_TRIM = '#8a8378';
var HALLWAY_CEILING = '#cfc9bd';

function el (tag, attributes, parent) {
  var node = document.createElement(tag);
  Object.keys(attributes || {}).forEach(function (key) {
    node.setAttribute(key, attributes[key]);
  });
  if (parent) parent.appendChild(node);
  return node;
}

// Every solid surface in the building is one of these. Boxes rather than
// planes throughout: a plane is single-sided and a room the player can
// stand on either side of a wall in (they can, in the hallway) shows up
// the difference immediately.
export function addBox (parent, spec) {
  return el('a-box', {
    position: spec.x.toFixed(4) + ' ' + spec.y.toFixed(4) + ' ' + spec.z.toFixed(4),
    width: Math.max(spec.width, 0.001).toFixed(4),
    height: Math.max(spec.height, 0.001).toFixed(4),
    depth: Math.max(spec.depth, 0.001).toFixed(4),
    material: 'color: ' + spec.color + (spec.flat ? '; shader: flat' : '') +
      (spec.emissive ? '; emissive: ' + spec.emissive + '; emissiveIntensity: ' + (spec.emissiveIntensity || 1) : ''),
    class: spec.className || '',
  }, parent);
}

// A wall with rectangular holes in it, built as the panels around the
// holes. A-Frame has no CSG, and this is the honest way to get a doorway
// or a window: split the wall into the strips that survive.
//
//   axis     -- which horizontal axis the wall runs along
//   at       -- its position on the other horizontal axis (inner face)
//   outward  -- +1/-1: which way its thickness goes from that face
//   openings -- [{ center, width, bottom, top }] along `axis`
export function addWall (parent, spec) {
  var openings = (spec.openings || []).slice().sort(function (a, b) { return a.center - b.center; });
  var crossCenter = spec.at + spec.outward * spec.thickness / 2;
  var panels = [];

  var panel = function (from, to, bottom, top) {
    if (to - from < 1e-4 || top - bottom < 1e-4) return;
    var along = (from + to) / 2;
    var spanned = to - from;
    panels.push(addBox(parent, {
      x: spec.axis === 'x' ? along : crossCenter,
      z: spec.axis === 'x' ? crossCenter : along,
      y: (bottom + top) / 2,
      width: spec.axis === 'x' ? spanned : spec.thickness,
      depth: spec.axis === 'x' ? spec.thickness : spanned,
      height: top - bottom,
      color: spec.color,
      className: spec.className,
      flat: spec.flat,
    }));
  };

  var cursor = spec.from;
  for (var i = 0; i < openings.length; i++) {
    var opening = openings[i];
    var left = opening.center - opening.width / 2;
    var right = opening.center + opening.width / 2;
    if (left > cursor) panel(cursor, left, spec.bottom, spec.top);
    panel(left, right, spec.bottom, opening.bottom);
    panel(left, right, opening.top, spec.top);
    cursor = Math.max(cursor, right);
  }
  panel(cursor, spec.to, spec.bottom, spec.top);
  return panels;
}

// ---------------------------------------------------------------
// A room
// ---------------------------------------------------------------
// Walls run the full floor-to-floor height rather than stopping at the
// ceiling, so that stacking six of them leaves a continuous facade with
// no gaps to see through from outside -- and, on the hallway side, a
// continuous shaft liner whose only openings are the doorways.
export function buildRoom (parent, plan, floor) {
  var settings = plan.settings;
  var thickness = settings.wallThickness;
  var halfRun = plan.runLength / 2;
  var halfDepth = plan.depth / 2;
  var wallTop = settings.floorHeight;

  var room = el('a-entity', {
    position: '0 ' + floor.floorY.toFixed(4) + ' 0',
    class: 'hotel-room hotel-room-' + floor.id,
    'data-floor': String(floor.index),
  }, parent);

  el('a-plane', {
    position: '0 0.002 ' + ((plan.doorPlaneZ + halfDepth) / 2).toFixed(4),
    rotation: '-90 0 0',
    width: plan.runLength.toFixed(4),
    height: (halfDepth - plan.doorPlaneZ).toFixed(4),
    material: 'color: ' + floor.floorColor,
    // The floor is the one place each room states its own colour twice:
    // a checkerboard in a lighter shade of the wall, derived rather than
    // authored (common/checkerboard.js).
    checkerboard: 'color: ' + floor.wall + '; lightA: 0.62; lightB: 0.42; squareSize: 0.42',
    class: 'hotel-room-floor',
  }, room);

  el('a-plane', {
    position: '0 ' + settings.roomHeight.toFixed(4) + ' ' + ((plan.doorPlaneZ + halfDepth) / 2).toFixed(4),
    rotation: '90 0 0',
    width: plan.runLength.toFixed(4),
    height: (halfDepth - plan.doorPlaneZ).toFixed(4),
    material: 'color: ' + lighten(floor.wall, 0.78),
    class: 'hotel-room-ceiling',
  }, room);

  // The wall the hallway is on. Its openings are this floor's doorways:
  // Red has only the one leading up, Purple only the one leading down.
  var doorways = [];
  if (floor.hasUpDoor) doorways.push({ center: plan.doorAX, width: plan.doorWidth, bottom: 0, top: plan.doorHeight });
  if (floor.hasDownDoor) doorways.push({ center: plan.doorBX, width: plan.doorWidth, bottom: 0, top: plan.doorHeight });
  addWall(room, {
    axis: 'x',
    at: plan.doorPlaneZ,
    outward: 1,
    from: -halfRun - thickness,
    to: halfRun + thickness,
    bottom: 0,
    top: wallTop,
    thickness: thickness,
    color: floor.wall,
    className: 'hotel-room-wall hotel-shaft-liner',
    openings: doorways,
  });

  // The three window walls. These stand on the Guardian's own edge, so
  // the sill below each one is the guardrail the spec asks for: the
  // player meets a window ledge at hip height before they ever meet the
  // boundary, and it reads as a building rather than as a wall that is
  // there for reasons nobody will explain.
  var windowBottom = settings.sillHeight;
  var windowTop = Math.min(settings.windowHead, settings.roomHeight - 0.15);
  var inset = settings.windowInset;

  addWall(room, {
    axis: 'x',
    at: halfDepth,
    outward: 1,
    from: -halfRun - thickness,
    to: halfRun + thickness,
    bottom: 0,
    top: wallTop,
    thickness: thickness,
    color: floor.wall,
    className: 'hotel-room-wall',
    openings: [{ center: 0, width: Math.max(plan.runLength - 2 * inset, 0.4), bottom: windowBottom, top: windowTop }],
  });

  [1, -1].forEach(function (side) {
    var span = halfDepth - plan.doorPlaneZ;
    addWall(room, {
      axis: 'z',
      at: side * halfRun,
      outward: side,
      from: plan.doorPlaneZ,
      to: halfDepth,
      bottom: 0,
      top: wallTop,
      thickness: thickness,
      color: floor.wall,
      className: 'hotel-room-wall',
      openings: [{
        center: plan.doorPlaneZ + span / 2,
        width: Math.max(span - 2 * inset, 0.4),
        bottom: windowBottom,
        top: windowTop,
      }],
    });
  });

  // Sills. A shelf at hip height, capped with a darker rail so it reads
  // as a thing to stop at rather than a change of paint.
  var sillColor = lighten(floor.wall, 0.3);
  addBox(room, {
    x: 0, y: windowBottom - 0.05, z: halfDepth - settings.sillDepth / 2,
    width: plan.runLength + 2 * thickness, height: 0.1, depth: settings.sillDepth,
    color: sillColor, className: 'hotel-sill',
  });
  addBox(room, {
    x: 0, y: windowBottom + 0.02, z: halfDepth - settings.sillDepth + 0.02,
    width: plan.runLength + 2 * thickness, height: 0.04, depth: 0.04,
    color: floor.trimColor, className: 'hotel-sill-rail',
  });
  [1, -1].forEach(function (side) {
    var span = halfDepth - plan.doorPlaneZ;
    addBox(room, {
      x: side * (halfRun - settings.sillDepth / 2), y: windowBottom - 0.05, z: plan.doorPlaneZ + span / 2,
      width: settings.sillDepth, height: 0.1, depth: span,
      color: sillColor, className: 'hotel-sill',
    });
    addBox(room, {
      x: side * (halfRun - settings.sillDepth + 0.02), y: windowBottom + 0.02, z: plan.doorPlaneZ + span / 2,
      width: 0.04, height: 0.04, depth: span,
      color: floor.trimColor, className: 'hotel-sill-rail',
    });
  });

  // A skirting band. Cheap, but it is what stops a flat-coloured box
  // from reading as a flat-coloured box.
  addBox(room, {
    x: 0, y: 0.06, z: plan.doorPlaneZ + 0.06,
    width: plan.runLength, height: 0.12, depth: 0.03,
    color: floor.trimColor, className: 'hotel-skirting',
  });

  return room;
}

// ---------------------------------------------------------------
// The hallway -- one of them, reused at every junction
// ---------------------------------------------------------------
// Built once, at its own floor level (local y = 0), and moved vertically
// by hotel-experience.js. It carries its own floor, ceiling and walls so
// that nothing the player can see inside it is fixed to the world.
export function buildHallway (parent, plan) {
  var settings = plan.settings;
  var shell = plan.corridorRect;
  var height = settings.corridorHeight;
  var width = shell.maxX - shell.minX;
  var depth = shell.maxZ - shell.minZ;
  var centerX = (shell.minX + shell.maxX) / 2;
  var centerZ = (shell.minZ + shell.maxZ) / 2;
  var liner = 0.05;

  var hallway = el('a-entity', { id: 'hotel-hallway', class: 'hotel-hallway' }, parent);

  el('a-plane', {
    position: centerX.toFixed(4) + ' 0.002 ' + centerZ.toFixed(4),
    rotation: '-90 0 0',
    width: width.toFixed(4),
    height: depth.toFixed(4),
    material: 'color: ' + HALLWAY_FLOOR,
    checkerboard: 'colorA: #837d76; colorB: #5f5b57; squareSize: 0.34',
    class: 'hotel-hallway-floor',
  }, hallway);

  // A runner down the middle. Together with the pilasters below this is
  // the hallway's optical flow: a corridor of flat grey walls gives the
  // eye nothing to measure its own motion against, and "I walked up to
  // the next floor" needs the walking to register in the first place.
  // All of it is safe to add because it is part of the hallway and moves
  // with it -- detail on the hallway can never betray the rise, only
  // detail fixed to the world could.
  el('a-plane', {
    position: centerX.toFixed(4) + ' 0.006 ' + (shell.minZ + plan.laneWidth / 2).toFixed(4),
    rotation: '-90 0 0',
    width: (width - 0.1).toFixed(4),
    height: (plan.laneWidth * 0.62).toFixed(4),
    material: 'color: #7a4a42',
    class: 'hotel-hallway-runner',
  }, hallway);

  el('a-plane', {
    position: centerX.toFixed(4) + ' ' + height.toFixed(4) + ' ' + centerZ.toFixed(4),
    rotation: '90 0 0',
    width: width.toFixed(4),
    height: depth.toFixed(4),
    material: 'color: ' + HALLWAY_CEILING,
    class: 'hotel-hallway-ceiling',
  }, hallway);

  // The hallway's own outer walls sit just *outside* the plan rectangle,
  // with the static shaft shell further out again and a gap between
  // them. Two surfaces in exactly the same plane would z-fight every
  // time the hallway passed a floor, which is the one artifact in this
  // whole build that would point straight at the trick.
  addBox(hallway, {
    x: centerX, y: height / 2, z: shell.minZ - liner / 2,
    width: width + 2 * liner, height: height, depth: liner,
    color: HALLWAY_WALL, className: 'hotel-hallway-wall',
  });
  [1, -1].forEach(function (side) {
    addBox(hallway, {
      x: (side > 0 ? shell.maxX : shell.minX) + side * liner / 2, y: height / 2, z: centerZ,
      width: liner, height: height, depth: depth,
      color: HALLWAY_WALL, className: 'hotel-hallway-wall',
    });
  });

  // Everything solid inside the strip: the recessed doorway jambs (which
  // together make the hallway's south wall), the piers that create the
  // turns, and any extra ones the settings asked for. All full height,
  // which is what makes the flat floor-plan occlusion analysis in
  // hotel-layout.js exact rather than optimistic.
  plan.blockers.forEach(function (rect, index) {
    addBox(hallway, {
      x: (rect.minX + rect.maxX) / 2,
      y: height / 2,
      z: (rect.minZ + rect.maxZ) / 2,
      width: rect.maxX - rect.minX,
      height: height,
      depth: rect.maxZ - rect.minZ,
      // The first three are the hallway's south wall; everything after
      // is a pier. Piers are darker so they read as things to walk
      // around rather than as a wall that has moved.
      color: index < 3 ? HALLWAY_WALL : darken(HALLWAY_WALL, 0.16),
      className: index < 3 ? 'hotel-hallway-wall' : 'hotel-hallway-pier',
    });
  });

  // Lintels over the two openings, so a doorway is a doorway rather than
  // a full-height slot.
  var stubBandMinZ = shell.minZ + plan.laneWidth;
  [plan.doorAX, plan.doorBX].forEach(function (doorX) {
    addBox(hallway, {
      x: doorX, y: (plan.doorHeight + height) / 2, z: (stubBandMinZ + shell.maxZ) / 2,
      width: plan.doorWidth, height: height - plan.doorHeight, depth: shell.maxZ - stubBandMinZ,
      color: HALLWAY_WALL, className: 'hotel-hallway-lintel',
    });
    addBox(hallway, {
      x: doorX, y: plan.doorHeight, z: shell.maxZ - 0.02,
      width: plan.doorWidth + 0.12, height: 0.06, depth: 0.05,
      color: HALLWAY_TRIM, className: 'hotel-hallway-lintel-trim',
    });
  });

  // A lit ceiling panel rather than a light: a point light in the shaft
  // would change how every wall was shaded as the hallway rose, which is
  // precisely the cue this whole design exists to withhold.
  el('a-plane', {
    position: centerX.toFixed(4) + ' ' + (height - 0.012).toFixed(4) + ' ' + (shell.minZ + plan.laneWidth / 2).toFixed(4),
    rotation: '90 0 0',
    width: (width * 0.7).toFixed(4),
    height: '0.16',
    material: 'color: #fff6df; shader: flat',
    class: 'hotel-hallway-lamp',
  }, hallway);

  // Skirting and a dado rail, for the same reason the rooms have trim.
  addBox(hallway, {
    x: centerX, y: 0.06, z: shell.minZ + 0.03,
    width: width, height: 0.12, depth: 0.05,
    color: HALLWAY_TRIM, className: 'hotel-hallway-skirting',
  });
  addBox(hallway, {
    x: centerX, y: 0.95, z: shell.minZ + 0.035,
    width: width, height: 0.06, depth: 0.06,
    color: HALLWAY_TRIM, className: 'hotel-hallway-dado',
  });

  // Pilasters at a regular spacing, with a lit sconce on every other
  // one. Evenly spaced verticals passing the eye at a known rate is the
  // clearest possible signal of how far you have walked -- which is the
  // input the whole rise is a function of, so it is worth the player
  // being able to feel it.
  var spacing = 0.55;
  var count = Math.max(2, Math.floor(width / spacing));
  for (var i = 0; i <= count; i++) {
    var pilasterX = shell.minX + (width * i) / count;
    addBox(hallway, {
      x: pilasterX, y: height / 2, z: shell.minZ + 0.045,
      width: 0.08, height: height, depth: 0.09,
      color: darken(HALLWAY_WALL, 0.14), className: 'hotel-hallway-pilaster',
    });
    if (i % 2 === 1) {
      addBox(hallway, {
        x: pilasterX, y: 1.78, z: shell.minZ + 0.1,
        width: 0.16, height: 0.2, depth: 0.05,
        color: '#fff2d2', emissive: '#ffdf9c', emissiveIntensity: 0.9,
        className: 'hotel-hallway-sconce',
      });
    }
  }

  return hallway;
}

// ---------------------------------------------------------------
// The shaft shell and facade
// ---------------------------------------------------------------
// The static outside of the building: the three faces enclosing the
// hallway's strip (full building height, so the shaft is never open to
// the sky at the floors the hallway isn't currently at), plus a cornice
// at every floor level.
//
// The cornices are not decoration. Looking down out of a window and
// seeing your own building's ledges stack away below you is most of what
// makes "I am five floors up" land, and it costs six boxes a side.
export function buildFacade (parent, plan) {
  var settings = plan.settings;
  var thickness = settings.wallThickness;
  var halfRun = plan.runLength / 2;
  var halfDepth = plan.depth / 2;
  var shell = plan.corridorRect;
  var top = plan.buildingHeight;
  var facadeColor = '#6f6a63';
  var facade = el('a-entity', { class: 'hotel-facade' }, parent);

  var gap = 0.07;
  addBox(facade, {
    x: 0, y: top / 2, z: shell.minZ - gap - thickness / 2,
    width: plan.runLength + 2 * (gap + thickness), height: top, depth: thickness,
    color: facadeColor, className: 'hotel-shaft-shell',
  });
  [1, -1].forEach(function (side) {
    addBox(facade, {
      x: side * (halfRun + gap + thickness / 2), y: top / 2, z: (shell.minZ - gap + shell.maxZ) / 2,
      width: thickness, height: top, depth: shell.maxZ - shell.minZ + gap,
      color: facadeColor, className: 'hotel-shaft-shell',
    });
  });

  // Roof slab, so the top floor is a top floor.
  addBox(facade, {
    x: 0, y: top + 0.1, z: 0,
    width: plan.runLength + 2 * (gap + thickness) + 0.6, height: 0.2, depth: plan.depth + 2 * thickness + 0.6,
    color: darken(facadeColor, 0.25), className: 'hotel-roof',
  });

  plan.floors.forEach(function (floor) {
    var y = floor.floorY;
    var reach = 0.3;
    addBox(facade, {
      x: 0, y: y - 0.06, z: halfDepth + thickness + reach / 2,
      width: plan.runLength + 2 * thickness + 2 * reach, height: 0.18, depth: reach,
      color: darken(floor.wall, 0.45), className: 'hotel-cornice',
    });
    [1, -1].forEach(function (side) {
      addBox(facade, {
        x: side * (halfRun + thickness + reach / 2), y: y - 0.06, z: (plan.doorPlaneZ + halfDepth) / 2,
        width: reach, height: 0.18, depth: halfDepth - plan.doorPlaneZ + thickness,
        color: darken(floor.wall, 0.45), className: 'hotel-cornice',
      });
    });
  });

  return facade;
}

// ---------------------------------------------------------------
// Outside the windows
// ---------------------------------------------------------------
// A backdrop, nothing more: no collision, no ticking, nothing to walk
// on. Its only job is to answer "how high am I?" without a HUD saying
// so, which it does by putting things at known heights -- tree canopies
// at first-floor eye level, low roofs that are above you from Orange and
// below you from Green, a skyline that only resolves from the top.
//
// Neighbouring buildings get their window rows drawn at *this* building's
// floor spacing, so counting rows on the block opposite is a direct read
// of which floor you are on.
function mulberry32 (seed) {
  var state = seed >>> 0;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One tile is one storey of one bay of windows. Cached per colour --
// fifty buildings sharing five textures rather than holding fifty
// near-identical ones, since A-Frame shares no materials for you.
var facadeTextures = {};
function facadeTexture (base, glass) {
  if (facadeTextures[base]) return facadeTextures[base];
  var canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  var context = canvas.getContext('2d');
  context.fillStyle = base;
  context.fillRect(0, 0, 64, 64);
  context.fillStyle = glass;
  for (var column = 0; column < 3; column++) {
    context.fillRect(7 + column * 20, 14, 12, 26);
  }
  facadeTextures[base] = canvas.toDataURL();
  return facadeTextures[base];
}

export function buildExterior (parent, plan) {
  var settings = plan.settings;
  var exterior = el('a-entity', { class: 'hotel-exterior' }, parent);
  var random = mulberry32(20260917);
  var buildingTop = plan.buildingHeight;

  el('a-plane', {
    position: '0 -0.04 0',
    rotation: '-90 0 0',
    width: '400',
    height: '400',
    material: 'color: #3b3d42',
    class: 'hotel-ground',
  }, exterior);

  // Three rings. Near buildings are shorter than this one on purpose --
  // they are what goes from "above me" to "below me" as the player
  // climbs, and that transition is the whole legibility test.
  var rings = [
    { count: 14, minRadius: 11, maxRadius: 22, minHeight: 3.5, maxHeight: 13 },
    { count: 16, minRadius: 22, maxRadius: 44, minHeight: 7, maxHeight: 26 },
    { count: 18, minRadius: 44, maxRadius: 90, minHeight: 12, maxHeight: 46 },
  ];
  var palette = ['#5d6470', '#6a6259', '#54606b', '#6d6560', '#4f5a64'];

  rings.forEach(function (ring) {
    for (var i = 0; i < ring.count; i++) {
      var angle = (i / ring.count) * Math.PI * 2 + random() * 0.32;
      var radius = ring.minRadius + random() * (ring.maxRadius - ring.minRadius);
      var height = ring.minHeight + random() * (ring.maxHeight - ring.minHeight);
      var width = 3 + random() * 7;
      var depth = 3 + random() * 7;
      var base = palette[Math.floor(random() * palette.length)];
      var x = Math.cos(angle) * radius;
      var z = Math.sin(angle) * radius;

      var neighbour = el('a-box', {
        position: x.toFixed(2) + ' ' + (height / 2).toFixed(2) + ' ' + z.toFixed(2),
        width: width.toFixed(2),
        height: height.toFixed(2),
        depth: depth.toFixed(2),
        class: 'hotel-neighbour',
      }, exterior);
      // Set as an object, not a style string: a data URL contains both
      // ';' and ',', which are exactly the separators A-Frame's
      // single-attribute parser splits on.
      //
      // The vertical repeat is the building's height in *this* building's
      // floor heights, so the window rows opposite line up with the
      // rooms in here and can be counted against them.
      neighbour.setAttribute('material', {
        src: facadeTexture(base, '#2b3138'),
        repeat: {
          x: Math.max(1, Math.round(width / 3.2)),
          y: Math.max(1, Math.round(height / settings.floorHeight)),
        },
      });

      // A parapet, so a roof below you reads as a roof and not as the
      // top face of a box.
      el('a-box', {
        position: x.toFixed(2) + ' ' + (height + 0.25).toFixed(2) + ' ' + z.toFixed(2),
        width: (width + 0.3).toFixed(2),
        height: '0.5',
        depth: (depth + 0.3).toFixed(2),
        material: 'color: ' + darken(base, 0.3),
        class: 'hotel-neighbour-parapet',
      }, exterior);

      // Rooftop clutter, only on the buildings this one can see the top
      // of. Anything taller is a wall from in here, and detailing the
      // roof of something you can never look down on is wasted geometry.
      if (height < buildingTop - 2) {
        var vents = 1 + Math.floor(random() * 3);
        for (var v = 0; v < vents; v++) {
          el('a-box', {
            position: (x + (random() - 0.5) * width * 0.6).toFixed(2) + ' ' +
              (height + 0.75).toFixed(2) + ' ' +
              (z + (random() - 0.5) * depth * 0.6).toFixed(2),
            width: (0.5 + random()).toFixed(2),
            height: (0.6 + random() * 0.9).toFixed(2),
            depth: (0.5 + random()).toFixed(2),
            material: 'color: #7e8288',
            class: 'hotel-rooftop',
          }, exterior);
        }
      }
    }
  });

  // Street level: things whose size the player already knows, so the
  // ground reads as further away each floor up rather than just smaller.
  for (var c = 0; c < 22; c++) {
    var carAngle = random() * Math.PI * 2;
    var carRadius = 8 + random() * 26;
    el('a-box', {
      position: (Math.cos(carAngle) * carRadius).toFixed(2) + ' 0.6 ' + (Math.sin(carAngle) * carRadius).toFixed(2),
      width: '1.8', height: '1.2', depth: '4.2',
      rotation: '0 ' + (random() * 180).toFixed(1) + ' 0',
      material: 'color: ' + ['#a5493f', '#3f6ea5', '#d6d2c8', '#4d4f55'][Math.floor(random() * 4)],
      class: 'hotel-street-clutter',
    }, exterior);
  }

  // Trees, with their canopies at about first-floor eye level: from Red
  // you look up into them, from Orange you look across them, from Yellow
  // you look down on them. Low-poly spheres on purpose -- A-Frame's
  // default sphere is 36x18 segments and about 1300 triangles, which is
  // a lot to spend on a shrub (see DESIGN.md's performance notes).
  for (var t = 0; t < 14; t++) {
    var treeAngle = random() * Math.PI * 2;
    var treeRadius = 7 + random() * 16;
    var treeX = Math.cos(treeAngle) * treeRadius;
    var treeZ = Math.sin(treeAngle) * treeRadius;
    var canopyY = 4.2 + random() * 1.8;
    el('a-cylinder', {
      position: treeX.toFixed(2) + ' ' + (canopyY / 2).toFixed(2) + ' ' + treeZ.toFixed(2),
      radius: '0.22', height: canopyY.toFixed(2),
      'segments-radial': '8', 'segments-height': '1',
      material: 'color: #4a3c2e',
      class: 'hotel-tree',
    }, exterior);
    el('a-sphere', {
      position: treeX.toFixed(2) + ' ' + canopyY.toFixed(2) + ' ' + treeZ.toFixed(2),
      radius: (1.3 + random() * 0.7).toFixed(2),
      'segments-width': '8', 'segments-height': '6',
      material: 'color: ' + ['#3f6b3a', '#4b7a3f', '#365e35'][Math.floor(random() * 3)],
      class: 'hotel-tree',
    }, exterior);
  }

  return exterior;
}

export function buildSky (parent) {
  var canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 128;
  var context = canvas.getContext('2d');
  var gradient = context.createLinearGradient(0, 0, 0, 128);
  gradient.addColorStop(0, '#9fc4e8');
  gradient.addColorStop(0.55, '#cbdcea');
  gradient.addColorStop(1, '#e6e0d4');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 8, 128);
  return el('a-sky', {
    src: canvas.toDataURL(),
    radius: '250',
    'segments-width': '16',
    'segments-height': '12',
    class: 'hotel-sky',
  }, parent);
}

// Builds the whole building under `root`, clearing anything already
// there. Returns the pieces the runtime needs to move.
export function buildHotel (root, plan) {
  while (root.firstChild) root.removeChild(root.firstChild);

  var facade = buildFacade(root, plan);
  var rooms = plan.floors.map(function (floor) { return buildRoom(root, plan, floor); });
  var hallway = buildHallway(root, plan);
  var exterior = buildExterior(root, plan);

  return { facade: facade, rooms: rooms, hallway: hallway, exterior: exterior };
}
