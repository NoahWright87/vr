// ============================================================
// RACING — a toy car on a track on the table behind you.
//
// Grab the remote and hold its trigger to drive; the car goes round its
// fixed track like a slot car. The HUD is a dashboard for the car, not
// for you: its speed on a dial, an overhead map of the track with the
// car on it, lap times, and — top left — a live picture from a camera on
// the car, rendered small and a few times a second, to show the visor can
// carry a second view of the world. The toolbox beside the track opens a
// menu that changes the car: its colour, its top speed, where its camera
// sits.
// ============================================================

import { registerMenuPage } from '../../common/menu-crossbar.js';
import { HUD_COLORS, drawIcon, drawText, drawDial, drawPanel } from '../../common/hud-draw.js';
import { hud, holding, actionKey, inXR, resetProps, sceneEl } from './tour-core.js';

var THREE = AFRAME.THREE;

// The track: a stadium (two straights joined by half circles), in the
// track's own space — metres on the table, x across, z along.
var STRAIGHT = 0.7;
var RADIUS = 0.27;
var LENGTH = 2 * STRAIGHT + 2 * Math.PI * RADIUS;
// Toy speed to the speed the dial shows: a 1:24 model, in km/h.
var SCALE_KMH = 3.6 * 24;
// The car camera's picture, and how often it is redrawn.
var FEED_SIZE = 224;
var FEED_MS = 66;

var COLOURS = [
  { value: '#e8443a', label: 'Red' }, { value: '#2f7fe8', label: 'Blue' },
  { value: '#3cc46a', label: 'Green' }, { value: '#f2c230', label: 'Yellow' }, { value: '#eeeeee', label: 'White' },
];

var state = {
  colour: '#e8443a', topSpeed: 1.1, camera: 'bonnet',
  s: 0, speed: 0, throttle: false,
  lap: 0, lapStart: 0, lastLap: 0, bestLap: 0,
};

// Where the car is `s` metres round the track.
function trackXZ(s, out) {
  s = ((s % LENGTH) + LENGTH) % LENGTH;
  var half = STRAIGHT / 2;
  var arc = Math.PI * RADIUS;
  if (s < STRAIGHT) {
    // Down the right-hand straight, away from you (-z).
    out.x = RADIUS; out.z = half - s;
  } else if (s < STRAIGHT + arc) {
    var a = (s - STRAIGHT) / RADIUS;
    out.x = RADIUS * Math.cos(a); out.z = -half - RADIUS * Math.sin(a);
  } else if (s < 2 * STRAIGHT + arc) {
    out.x = -RADIUS; out.z = -half + (s - STRAIGHT - arc);
  } else {
    var b = (s - 2 * STRAIGHT - arc) / RADIUS;
    out.x = -RADIUS * Math.cos(b); out.z = half + RADIUS * Math.sin(b);
  }
  return out;
}

// ...and which way it faces: `heading` is the rotation about +Y that
// turns the car's -Z (its nose) along the track. From the path itself,
// so the two cannot disagree.
var ahead = {};
export function trackPoint(s, out) {
  out = trackXZ(s, out || {});
  trackXZ(s + 0.002, ahead);
  out.heading = Math.atan2(-(ahead.x - out.x), -(ahead.z - out.z));
  return out;
}

registerMenuPage('toolbox', {
  title: 'TOOLBOX',
  items: [
    { kind: 'select', id: 'toolbox-colour', label: 'Paint', value: state.colour, options: COLOURS },
    {
      kind: 'number', id: 'toolbox-speed', label: 'Top speed', value: state.topSpeed, min: 0.4, max: 2, step: 0.1,
      format: function (v) { return Math.round(v * SCALE_KMH) + ' km/h'; },
      info: ['TOP SPEED', 'In the car\'s own scale:', 'a 1:24 model, so a', 'metre a second on the', 'table reads 86 km/h.'],
    },
    {
      kind: 'select', id: 'toolbox-camera', label: 'Car camera', value: state.camera,
      options: [{ value: 'bonnet', label: 'Bonnet' }, { value: 'chase', label: 'Chase' }, { value: 'off', label: 'Off' }],
      info: ['CAR CAMERA', 'The picture top left of', 'your visor: a second', 'camera on the car,', 'drawn small and a few', 'times a second.'],
    },
    { kind: 'action', id: 'toolbox-reset', label: 'Put the car back' },
  ],
});

function setEl() { return document.querySelector('#set-racing'); }
function carEl() { return document.querySelector('#racing-car'); }

// ---------- the scene ----------

var built = false;
var feed = null;

function buildTrack() {
  if (built) return;
  built = true;
  var track = document.querySelector('#racing-track').object3D;
  // The road: a ribbon along the path.
  var width = 0.09;
  var steps = 160;
  var positions = [];
  var p = {};
  for (var i = 0; i <= steps; i++) {
    trackPoint(i / steps * LENGTH, p);
    // Across the road: the nose direction turned a quarter.
    var nx = Math.cos(p.heading);
    var nz = -Math.sin(p.heading);
    positions.push(p.x + nx * width / 2, 0.002, p.z + nz * width / 2, p.x - nx * width / 2, 0.002, p.z - nz * width / 2);
  }
  var indices = [];
  for (var j = 0; j < steps; j++) {
    var a = j * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  var geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  var road = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.9, side: THREE.DoubleSide }));
  track.add(road);
  // The start line.
  var line = new THREE.Mesh(new THREE.PlaneGeometry(width, 0.012), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  line.rotation.x = -Math.PI / 2;
  trackPoint(0, p);
  line.position.set(p.x, 0.004, p.z);
  track.add(line);

  // The car camera: a second camera on the car, drawn into a small
  // texture that the HUD shows like any other widget.
  feed = {
    target: new THREE.WebGLRenderTarget(FEED_SIZE, FEED_SIZE),
    camera: new THREE.PerspectiveCamera(70, 1, 0.01, 40),
    clearColour: new THREE.Color(),
    last: -Infinity,
  };
  carEl().object3D.add(feed.camera);
  placeCamera();
}

function placeCamera() {
  if (!feed) return;
  if (state.camera === 'chase') {
    feed.camera.position.set(0, 0.09, 0.22);
    feed.camera.rotation.set(-0.3, 0, 0);
  } else {
    // Just ahead of the nose, so the car's own body is not in the shot.
    feed.camera.position.set(0, 0.045, -0.06);
    feed.camera.rotation.set(-0.12, 0, 0);
  }
}

function paint() {
  carEl().querySelectorAll('.racing-paint').forEach(function (el) { el.setAttribute('color', state.colour); });
}

function placeCar() {
  var p = trackPoint(state.s);
  var car = carEl().object3D;
  car.position.set(p.x, 0.012, p.z);
  car.rotation.y = p.heading;
}

// Draw the car camera's picture. Everything on your face (the HUD, the
// visor menu, the cursor) is under the camera entity, so that is hidden
// for the moment it takes; XR is switched off for the draw so it goes to
// the texture rather than to the headset.
function renderFeed(time) {
  if (!feed || state.camera === 'off' || time - feed.last < FEED_MS) return;
  feed.last = time;
  var scene = sceneEl();
  var renderer = scene.renderer;
  var head = scene.camera.el.object3D;
  var xr = renderer.xr.enabled;
  var previous = renderer.getRenderTarget();
  renderer.getClearColor(feed.clearColour);
  var clearAlpha = renderer.getClearAlpha();
  head.visible = false;
  renderer.xr.enabled = false;
  // The sky is far beyond this little camera's reach, so the picture is
  // cleared to the sky's colour instead of to nothing.
  renderer.setClearColor(document.querySelector('#showcase-sky').getAttribute('color') || '#0d1526', 1);
  renderer.setRenderTarget(feed.target);
  renderer.clear();
  renderer.render(scene.object3D, feed.camera);
  renderer.setRenderTarget(previous);
  renderer.setClearColor(feed.clearColour, clearAlpha);
  renderer.xr.enabled = xr;
  head.visible = true;
}

// ---------- driving ----------
//
// The remote's trigger: the real trigger in a headset; off one, hold the
// mouse button or Space while the remote is in your hand.
var unlisten = null;
function listenToRemote(handEl) {
  var down = function () { state.throttle = true; };
  var up = function () { state.throttle = false; };
  var key = function (evt) { if (evt.code === 'Space') { evt.preventDefault(); state.throttle = evt.type === 'keydown'; } };
  var pointer = function (evt) { if (evt.pointerType === 'mouse' && evt.button === 0) state.throttle = evt.type === 'pointerdown'; };
  handEl.addEventListener('triggerdown', down);
  handEl.addEventListener('triggerup', up);
  window.addEventListener('keydown', key);
  window.addEventListener('keyup', key);
  window.addEventListener('pointerdown', pointer);
  window.addEventListener('pointerup', pointer);
  unlisten = function () {
    handEl.removeEventListener('triggerdown', down);
    handEl.removeEventListener('triggerup', up);
    window.removeEventListener('keydown', key);
    window.removeEventListener('keyup', key);
    window.removeEventListener('pointerdown', pointer);
    window.removeEventListener('pointerup', pointer);
    state.throttle = false;
  };
}

function onGrab(evt) { listenToRemote(evt.detail.handEl); }
function onRelease() { if (unlisten) unlisten(); unlisten = null; }

function onToolbox(evt) {
  var id = evt.detail.id;
  var v = evt.detail.value;
  if (id === 'toolbox-colour') { state.colour = v; paint(); }
  else if (id === 'toolbox-speed') state.topSpeed = v;
  else if (id === 'toolbox-camera') { state.camera = v; placeCamera(); if (widgets.feed) widgets.feed.show(v !== 'off'); }
}

function resetCar() {
  state.s = 0;
  state.speed = 0;
  state.lap = 0;
  state.lastLap = 0;
  state.bestLap = 0;
  state.lapStart = sceneEl().time;
  placeCar();
}

// ---------- the HUD ----------

var widgets = {};
var mapPath = null;

function drawSpeed(ctx, box) {
  drawDial(ctx, box.w / 2, 54, 36, box.state.kmh, Math.round(2 * SCALE_KMH), { text: String(box.state.kmh), unit: 'km/h' });
}

function seconds(ms) { return ms ? (ms / 1000).toFixed(2) + 's' : '--'; }

function drawLaps(ctx, box) {
  var s = box.state;
  drawIcon(ctx, 'stopwatch', 22, 22, 32, { color: HUD_COLORS.accent });
  drawText(ctx, seconds(s.current), 44, 22, { size: 24, align: 'left', maxWidth: box.w - 48 });
  drawText(ctx, 'LAST ' + seconds(s.last), 6, 56, { size: 16, align: 'left', color: HUD_COLORS.muted, maxWidth: box.w - 10 });
  drawText(ctx, 'BEST ' + seconds(s.best), 6, 80, { size: 16, align: 'left', color: s.best ? HUD_COLORS.good : HUD_COLORS.muted, maxWidth: box.w - 10 });
}

function drawLapCount(ctx, box) {
  drawText(ctx, 'LAP ' + box.state.lap, box.w / 2, 52, { size: 54, align: 'center', face: 'heading', weight: 900 });
}

// The track from above, the car on it.
function drawMap(ctx, box) {
  var w = box.w;
  var h = box.h;
  drawPanel(ctx, 2, 2, w - 4, h - 4, { radius: 8, fill: 'rgba(6, 14, 22, 0.55)', stroke: 'rgba(127, 227, 255, 0.5)' });
  var scale = (h - 24) / (STRAIGHT + 2 * RADIUS);
  var cx = w / 2;
  var cy = h / 2;
  if (!mapPath) {
    mapPath = [];
    var p = {};
    for (var i = 0; i <= 64; i++) { trackPoint(i / 64 * LENGTH, p); mapPath.push([p.x, p.z]); }
  }
  ctx.beginPath();
  mapPath.forEach(function (q, i) { var x = cx + q[0] * scale; var y = cy + q[1] * scale; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(214, 230, 255, 0.35)';
  ctx.stroke();
  var car = trackPoint(box.state.s);
  ctx.beginPath();
  ctx.arc(cx + car.x * scale, cy + car.z * scale, 5, 0, Math.PI * 2);
  ctx.fillStyle = box.state.colour;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = HUD_COLORS.outline;
  ctx.stroke();
}

// ---------- the demo ----------

export default {
  id: 'racing',
  label: 'Racing',
  title: 'RACING',
  blurb: ['RACING', 'A toy car on a track', 'behind you. Grab the', 'remote, hold the trigger.', '', 'The HUD is the car\'s:', 'speed, a track map, lap', 'times, and a live view', 'from a camera on it.'],

  rows: function () {
    return [
      { kind: 'info', id: 'racing-f-drive', label: 'Drive the car', info: ['DRIVE', 'Turn round (Facing), grab', 'the remote on the table,', 'and hold its trigger.', 'Off a headset: F to grab,', 'then hold the mouse', 'button or Space.'] },
      { kind: 'info', id: 'racing-f-speed', label: 'Speedometer', info: ['SPEEDOMETER', 'Bottom right: the car\'s', 'speed, as its 1:24 scale', 'would have it.'] },
      { kind: 'info', id: 'racing-f-map', label: 'Track map', info: ['TRACK MAP', 'Top right: the track', 'from above and the car', 'on it, live.'] },
      { kind: 'info', id: 'racing-f-camera', label: 'Car camera', info: ['CAR CAMERA', 'Top left: what a camera', 'on the car sees. A', 'second view of the world', 'on your visor, small and', 'a few times a second so', 'it stays cheap.'] },
      { kind: 'info', id: 'racing-f-laps', label: 'Lap times', info: ['LAP TIMES', 'Bottom left: this lap,', 'the last, and the best.', 'The lap count is along', 'the top.'] },
      { kind: 'info', id: 'racing-f-toolbox', label: 'The toolbox menu', info: ['THE TOOLBOX', 'Beside the track. Grab', 'it: paint, top speed and', 'the car camera\'s place.'] },
      { kind: 'action', id: 'racing-reset', label: 'Put the car back' },
    ];
  },

  onAction: function (id) {
    if (id === 'racing-reset') resetCar();
  },

  enter: function () {
    buildTrack();
    paint();
    resetCar();
    var remote = document.querySelector('#racing-remote');
    remote.addEventListener('simple-grabbed', onGrab);
    remote.addEventListener('simple-released', onRelease);
    document.addEventListener('menu-commit', onToolbox);
    document.addEventListener('menu-preview', onToolbox);
    document.addEventListener('menu-action', onToolboxAction);
  },

  exit: function () {
    var remote = document.querySelector('#racing-remote');
    remote.removeEventListener('simple-grabbed', onGrab);
    remote.removeEventListener('simple-released', onRelease);
    onRelease();
    document.removeEventListener('menu-commit', onToolbox);
    document.removeEventListener('menu-preview', onToolbox);
    document.removeEventListener('menu-action', onToolboxAction);
    resetProps(setEl());
    var pm = document.querySelector('#racing-toolbox').components['projected-menu'];
    if (pm) pm.close();
  },

  hud: function (display) {
    widgets = {
      speed: display.add('bottom-right', { id: 'racing-speed', draw: drawSpeed, fps: 20 }),
      laps: display.add('bottom-left', { id: 'racing-laps', draw: drawLaps, fps: 10 }),
      lap: display.add('top', { id: 'racing-lap', draw: drawLapCount }),
      map: display.add('top-right', { id: 'racing-map', draw: drawMap, fade: false, fps: 15 }),
      feed: feed ? display.add('top-left', { id: 'racing-feed', texture: feed.target.texture, fade: false }) : null,
    };
    if (widgets.feed) widgets.feed.show(state.camera !== 'off');
  },

  tick: function (time, delta) {
    var dt = Math.min(delta || 16, 100) / 1000;
    var accel = state.throttle ? 1.6 : 0;
    state.speed += (accel - state.speed * (state.throttle ? 1.6 / state.topSpeed : 1.2)) * dt;
    if (state.speed < 0.005 && !state.throttle) state.speed = 0;
    var before = state.s;
    state.s += state.speed * dt;
    if (Math.floor(state.s / LENGTH) > Math.floor(before / LENGTH)) {
      var lapTime = time - state.lapStart;
      if (state.lap > 0) {
        state.lastLap = lapTime;
        if (!state.bestLap || lapTime < state.bestLap) state.bestLap = lapTime;
      }
      state.lap++;
      state.lapStart = time;
    }
    placeCar();
    renderFeed(time);

    widgets.speed.set({ kmh: Math.round(state.speed * SCALE_KMH) });
    widgets.laps.set({ current: state.lap ? Math.round((time - state.lapStart) / 10) * 10 : 0, last: state.lastLap, best: state.bestLap });
    widgets.lap.set({ lap: state.lap });
    widgets.map.set({ s: Math.round(state.s * 50) / 50, colour: state.colour });

    var display = hud();
    if (holding('remote')) display.setHint('racing-drive', { key: inXR() ? actionKey() : 'CLICK', text: 'Hold to drive', slot: 'below' });
    else display.clearHint('racing-drive');
  },

  clearHints: function (display) { display.clearHint('racing-drive'); },

  // The car camera's render target and camera, for tests.
  carFeed: function () { return feed; },
};

function onToolboxAction(evt) {
  if (evt.detail.id === 'toolbox-reset') resetCar();
}
