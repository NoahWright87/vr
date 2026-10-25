// ============================================================
// VISOR FRAME — the one rectangle everything on the visor fits in.
//
// Like the "adjust the picture to your TV" screen in a console game:
// you set one rectangle in your view, once, and the visor menu and every
// HUD slot are laid out inside it. Nothing is placed in metres by hand.
//
// The rectangle is a sheet hung in front of your eyes and bent around
// you. Its settings are what you would actually want to adjust:
//
//   width, height  how much of your view it spans, in degrees, measured
//                  from your eye to its edges
//   lift           how far above (+) or below (-) eye level its middle is
//   bend           0 is a flat sheet; 1 wraps it into a cylinder around
//                  your head, so every column is the same distance away
//                  and faces you
//   bendY          the same, top to bottom; with both at 1 the sheet is
//                  nearly a sphere around your eye
//   distance       how far away its middle is, in metres — where both
//                  eyes converge on it
//
// Content is laid out on the flat sheet (metres, before bending) and
// bent with it, so a square corner slot stays a square however you bend
// the visor, and the bend is something you see rather than a remapping
// you have to reason about.
//
// No A-Frame in here: this file is the maths and the storage, covered by
// tests/visor-frame.test.js. common/visor-hud.js draws with it.
// ============================================================

var DEG = Math.PI / 180;

export var FRAME_DEFAULTS = {
  width: 72,
  height: 42,
  lift: -2,
  bend: 0.8,
  bendY: 0,
  distance: 1.8,
};

// What each setting may be set to, and how it steps from a menu row.
export var FRAME_LIMITS = {
  width: { min: 30, max: 100, step: 2 },
  height: { min: 20, max: 80, step: 2 },
  lift: { min: -20, max: 20, step: 1 },
  bend: { min: 0, max: 1, step: 0.05 },
  bendY: { min: 0, max: 1, step: 0.05 },
  distance: { min: 0.8, max: 4, step: 0.1 },
};

export function clampFrame(values) {
  var out = {};
  for (var key in FRAME_DEFAULTS) {
    var value = values && Number(values[key]);
    var limit = FRAME_LIMITS[key];
    out[key] = Number.isFinite(value)
      ? Math.min(limit.max, Math.max(limit.min, value))
      : FRAME_DEFAULTS[key];
  }
  return out;
}

// ---------- bending ----------
//
// One axis at a time. A sheet coordinate `s` (metres along the sheet
// from its middle) becomes a sideways offset and a depth: on a circle of
// radius d / bend that passes through the sheet's middle, d metres in
// front of you. bend 1 puts that circle's centre at your eye.
function bendAxis(s, bend, d) {
  if (bend < 1e-4) return { across: s, depth: d, angle: 0 };
  var radius = d / bend;
  var angle = s / radius;
  return {
    across: radius * Math.sin(angle),
    // The circle's centre is radius - d behind the sheet's middle.
    depth: d - radius * (1 - Math.cos(angle)),
    angle: angle,
  };
}

// A point on the sheet, in camera space (x right, y up, -z ahead), before
// lift. Horizontal bend first, then vertical bend about the horizontally
// bent column, so with both on the surface is a torus that is close to a
// sphere around the eye.
export function sheetToLocal(x, y, frame, out) {
  out = out || {};
  var d = frame.distance;
  var h = bendAxis(x, frame.bend, d);
  // Distance of this column from the vertical axis through the eye.
  var reach = Math.sqrt(h.across * h.across + h.depth * h.depth);
  var v = bendAxis(y, frame.bendY, reach);
  // Pull the column in toward the eye by however much the vertical bend
  // shortened it, along its own direction.
  var scale = reach > 1e-6 ? v.depth / reach : 1;
  out.x = h.across * scale;
  out.y = v.across;
  out.z = -h.depth * scale;
  return out;
}

// Apply the frame's lift: the whole sheet pitches about your eye.
export function liftPoint(point, frame, out) {
  out = out || {};
  var a = frame.lift * DEG;
  var c = Math.cos(a);
  var s = Math.sin(a);
  var y = point.y;
  var z = point.z;
  out.x = point.x;
  out.y = y * c - z * s;
  out.z = y * s + z * c;
  return out;
}

export function sheetToCamera(x, y, frame, out) {
  return liftPoint(sheetToLocal(x, y, frame, out), frame, out);
}

// How far off straight ahead (before lift) a sheet point appears, in
// degrees, horizontally and vertically.
export function sheetAngles(x, y, frame) {
  var p = sheetToLocal(x, y, frame);
  return {
    yaw: Math.atan2(p.x, -p.z) / DEG,
    pitch: Math.atan2(p.y, Math.sqrt(p.x * p.x + p.z * p.z)) / DEG,
  };
}

// The sheet half-extents, in metres, whose edges appear at the frame's
// width and height. Solved rather than approximated: angle is monotonic
// in sheet distance, so bisection is exact to well under a millimetre.
function solveHalf(targetDeg, measure) {
  var lo = 0;
  var hi = 0.25;
  while (measure(hi) < targetDeg && hi < 64) hi *= 2;
  for (var i = 0; i < 48; i++) {
    var mid = (lo + hi) / 2;
    if (measure(mid) < targetDeg) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function sheetHalfExtents(frame) {
  var halfW = solveHalf(frame.width / 2, function (x) { return sheetAngles(x, 0, frame).yaw; });
  var halfH = solveHalf(frame.height / 2, function (y) { return sheetAngles(0, y, frame).pitch; });
  return { halfW: halfW, halfH: halfH };
}

// ---------- the slots ----------
//
// Where things go, as rectangles on the sheet: { x, y, w, h } with x/y
// the rectangle's centre. Proportions of the frame's height, so a square
// is square and a taller frame scales everything with it.
//
//   top-left  ───── top ─────  top-right
//                    ·
//              above (hint)
//                 reticle
//              below (hint)
//                    ·
//   bottom-left ── bottom ──  bottom-right
//
// Conventions (suggestions, not rules — see DESIGN.md's HUD section):
// the bottom corners are your hands, the bottom bar is your status, the
// top bar is where you are, the top corners are the map and alerts.
export var SLOT_NAMES = [
  'top-left', 'top', 'top-right',
  'bottom-left', 'bottom', 'bottom-right',
  'above', 'reticle', 'below',
];

var CORNER = 0.32; // corner square, as a share of the frame's height
var BAR = 0.13; // top and bottom bars' height
var GAP = 0.03; // between a bar and the corners beside it
var RETICLE = 0.16;
var HINT_W = 0.9; // reticle hint bands, as a share of the frame's height
var HINT_H = 0.075;
var HINT_GAP = 0.02;

export function layoutSlots(frame) {
  var ext = sheetHalfExtents(frame);
  var W = ext.halfW;
  var H = ext.halfH;
  var full = 2 * H;
  var corner = Math.min(CORNER * full, W * 0.6);
  var bar = BAR * full;
  var gap = GAP * full;
  var barW = Math.max(0, 2 * (W - corner - gap));
  var reticle = RETICLE * full;
  var hintW = HINT_W * full;
  var hintH = HINT_H * full;
  var hintY = reticle / 2 + HINT_GAP * full + hintH / 2;
  return {
    halfW: W,
    halfH: H,
    slots: {
      'top-left': { x: -W + corner / 2, y: H - corner / 2, w: corner, h: corner },
      'top-right': { x: W - corner / 2, y: H - corner / 2, w: corner, h: corner },
      'bottom-left': { x: -W + corner / 2, y: -H + corner / 2, w: corner, h: corner },
      'bottom-right': { x: W - corner / 2, y: -H + corner / 2, w: corner, h: corner },
      top: { x: 0, y: H - bar / 2, w: barW, h: bar },
      bottom: { x: 0, y: -H + bar / 2, w: barW, h: bar },
      reticle: { x: 0, y: 0, w: reticle, h: reticle },
      above: { x: 0, y: hintY, w: hintW, h: hintH },
      below: { x: 0, y: -hintY, w: hintW, h: hintH },
    },
  };
}

// Several widgets sharing one slot split it along its long side, in
// order, each taking its weight's share. Corners stack top to bottom;
// bars run left to right — inward from the edge they sit on would be
// nicer for the corners, but a fixed order is easier to predict.
export function splitSlot(rect, weights, vertical) {
  var total = 0;
  for (var i = 0; i < weights.length; i++) total += weights[i];
  if (!total) return [];
  var parts = [];
  var cursor = vertical ? rect.y + rect.h / 2 : rect.x - rect.w / 2;
  for (var j = 0; j < weights.length; j++) {
    var share = weights[j] / total;
    if (vertical) {
      var h = rect.h * share;
      parts.push({ x: rect.x, y: cursor - h / 2, w: rect.w, h: h });
      cursor -= h;
    } else {
      var w = rect.w * share;
      parts.push({ x: cursor + w / 2, y: rect.y, w: w, h: rect.h });
      cursor += w;
    }
  }
  return parts;
}

// ---------- the visor menu, placed by the frame ----------
//
// The menu sits on one side of the frame: its selected row's inboard end
// a fifth of the way out from the middle, its top and bottom rows
// further out by its "curve" (so a pair would read ") (" round what you
// are looking at; the curve follows the frame's bend), its rows spread
// down most of the frame's height, and its far edge on the frame's edge.
// Its width — which is also its text size — is whatever fits.
//
// Where a row's highlight plate ends, as a share of the panel's width
// from its centre (crossbar-menu draws plates 0.94 wide); visor-menu.js
// places the panel by this edge.
export var MENU_ROW_EDGE = 0.47;

// How far out from straight ahead the panel's far edge is, in degrees,
// for a given layout. The panel is turned to face your eye, so its
// half-width is exactly half its angular width either side of its centre,
// and its centre sits ROW_EDGE of the width beyond the rows' inboard end.
export function menuOuterEdge(position, curve, width) {
  var edgeDeg = Math.atan(MENU_ROW_EDGE * 2 * Math.tan(width / 2 * DEG)) / DEG;
  return position + curve + edgeDeg + width / 2;
}

export function menuLayout(frame) {
  var half = frame.width / 2;
  var position = Math.max(4, half * 0.2);
  var curve = half * 0.22 * frame.bend;
  // Solve for the width whose far edge lands on the frame's edge.
  var lo = 0;
  var hi = 120;
  for (var i = 0; i < 40; i++) {
    var mid = (lo + hi) / 2;
    if (menuOuterEdge(position, curve, mid) < half) lo = mid;
    else hi = mid;
  }
  return {
    position: position,
    curve: curve,
    width: Math.max(8, lo),
    height: frame.height * 0.9,
    lift: frame.lift,
  };
}

// ---------- calibration storage ----------
//
// One shared calibration for every game on this site, plus any game
// that has been switched to its own. Kept in localStorage, which is per
// site: every game here shares it, nothing else can read it, and nothing
// is sent anywhere.
//
//   { shared: {...frame}, games: { '/games/pistols-at-dawn/': {...} },
//     scope: { '/games/pistols-at-dawn/': 'game' } }
export var STORAGE_KEY = 'visor-calibration:v1';

export function gameKey(pathname) {
  var path = String(pathname || '/');
  // '/games/x/index.html' and '/games/x/' are the same game.
  return path.replace(/[^/]*\.html?$/, '');
}

function readStore(storage) {
  try {
    var raw = storage && storage.getItem(STORAGE_KEY);
    var parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      return { shared: parsed.shared || null, games: parsed.games || {}, scope: parsed.scope || {} };
    }
  } catch (err) { /* private mode, blocked storage, corrupt JSON */ }
  return { shared: null, games: {}, scope: {} };
}

function writeStore(storage, store) {
  try { if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(store)); } catch (err) { /* see readStore */ }
}

// What this game should start with, and whether anything was saved at
// all (the first-run prompt uses that).
export function loadCalibration(storage, game) {
  var store = readStore(storage);
  var scope = store.scope[game] === 'game' ? 'game' : 'shared';
  var saved = scope === 'game' ? (store.games[game] || store.shared) : store.shared;
  return { frame: clampFrame(saved || FRAME_DEFAULTS), scope: scope, saved: Boolean(saved) };
}

export function saveCalibration(storage, game, scope, frame) {
  var store = readStore(storage);
  var clean = clampFrame(frame);
  if (scope === 'game') {
    store.games[game] = clean;
    store.scope[game] = 'game';
  } else {
    store.shared = clean;
    delete store.scope[game];
  }
  writeStore(storage, store);
}

// Switching scope keeps both: going to "this game" starts from whatever
// you have now; going back to shared picks the shared one up again and
// leaves this game's copy saved for next time.
export function switchScope(storage, game, scope, current) {
  var store = readStore(storage);
  if (scope === 'game') {
    if (!store.games[game]) store.games[game] = clampFrame(current);
    store.scope[game] = 'game';
    writeStore(storage, store);
    return clampFrame(store.games[game]);
  }
  delete store.scope[game];
  if (!store.shared) store.shared = clampFrame(current);
  writeStore(storage, store);
  return clampFrame(store.shared);
}

// ---------- HUD preferences ----------
//
// How the HUD and its targeting look, rather than where they are. Shared
// by every game (a player who wants a quieter HUD wants it everywhere),
// stored next to the calibration.
//
//   hud        whether the HUD is drawn at all
//   opacity    how strongly, 0..1
//   idleFade   widgets that have not changed for a few seconds dim, and
//              light up again when they do — a car dashboard, not a
//              billboard
//   targeting  'off' | 'asked' | 'always': whether targeting brackets
//              show only when a game asks (holding something you can
//              throw, drawing a bow) or all the time
//   others     how many other candidates get a faint bracket besides the
//              locked one
//   bracket    the bracket's shape
//   rings      the three aim rings' radii, degrees (common/aim-cone.js)
export var PREFERENCES_KEY = 'visor-preferences:v1';

export var BRACKET_STYLES = ['square', 'angle', 'triangle', 'quad'];

export var PREFERENCE_DEFAULTS = {
  hud: true,
  opacity: 0.9,
  idleFade: true,
  targeting: 'asked',
  others: 5,
  bracket: 'square',
  rings: [3, 7, 14],
};

export function cleanPreferences(values) {
  var d = PREFERENCE_DEFAULTS;
  var v = values || {};
  var num = function (value, min, max, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  var rings = Array.isArray(v.rings) && v.rings.length === 3 ? v.rings.map(Number) : d.rings;
  rings = rings.map(function (r, i) { return num(r, 0.5, 30, d.rings[i]); });
  // Each ring at least as wide as the one inside it.
  rings[1] = Math.max(rings[1], rings[0]);
  rings[2] = Math.max(rings[2], rings[1]);
  return {
    hud: typeof v.hud === 'boolean' ? v.hud : d.hud,
    opacity: num(v.opacity, 0.1, 1, d.opacity),
    idleFade: typeof v.idleFade === 'boolean' ? v.idleFade : d.idleFade,
    targeting: ['off', 'asked', 'always'].indexOf(v.targeting) !== -1 ? v.targeting : d.targeting,
    others: Math.round(num(v.others, 0, 10, d.others)),
    bracket: BRACKET_STYLES.indexOf(v.bracket) !== -1 ? v.bracket : d.bracket,
    rings: rings,
  };
}

export function loadPreferences(storage) {
  try {
    var raw = storage && storage.getItem(PREFERENCES_KEY);
    return cleanPreferences(raw ? JSON.parse(raw) : null);
  } catch (err) {
    return cleanPreferences(null);
  }
}

export function savePreferences(storage, prefs) {
  try { if (storage) storage.setItem(PREFERENCES_KEY, JSON.stringify(cleanPreferences(prefs))); } catch (err) { /* see readStore */ }
}

// The sheet distance from the middle at which something appears `deg`
// degrees off centre — horizontally or vertically — for drawing things
// sized in degrees (the aim rings, the visor menu's place) on the sheet.
export function sheetOffsetForAngle(deg, frame, vertical) {
  if (deg <= 0) return 0;
  return solveHalf(deg, vertical
    ? function (y) { return sheetAngles(0, y, frame).pitch; }
    : function (x) { return sheetAngles(x, 0, frame).yaw; });
}
