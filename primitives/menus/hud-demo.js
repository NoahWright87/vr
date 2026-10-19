// ============================================================
// HUD DEMO — what the visor HUD can do, with as little faked as possible.
//
// The showcase's HUD section. Pick a style from the visor (HUD style)
// and the HUD rebuilds itself as a shooter, a fantasy RPG, a frontier
// western, a car dashboard, or nearly nothing. Almost every number on it
// is real:
//
//   speed, heading   how fast you are actually moving, which way you face
//   place            whichever station you are standing at
//   minimap          the room, its stations, the targets and props, you
//   ammo             the blaster on the prop bench: grab it and fire it
//                    (it reloads itself); in Fantasy it spends mana
//   health, armour   stand on the spike trap; it regenerates
//   mana, whisky,    the potion: grab it and drink (trigger, or raise it
//   fuel             to your mouth)
//   score            targets hit, by blaster or by grenade
//   brackets         grab the grenade and look at a target: the gaze lock
//                    and its neighbours are bracketed, and a throw is bent
//                    toward the lock (common/aim-targeting.js). The
//                    blaster aims itself the same way, in orange.
//
// None of the gameplay is meant to be good. It is the least that makes
// each readout move for a real reason.
// ============================================================

import {
  HUD_COLORS, drawIcon, drawText, drawBar, drawAmmo, drawCompassTape, drawDial,
  drawIconMeter, drawPanel,
} from '../../common/hud-draw.js';
import '../../common/aim-targeting.js';
import { reachAlong } from '../../common/play-space.js';

var THREE = AFRAME.THREE;
var DEG = Math.PI / 180;
var STYLE_KEY = 'showcase-hud-style';

// ---------- the styles ----------

export var HUD_STYLES = [
  { value: 'shooter', label: 'Shooter' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'frontier', label: 'Frontier' },
  { value: 'driver', label: 'Driver' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'none', label: 'None' },
];

var STYLE = {
  shooter: { capacity: 30, gun: 'ray-gun', potion: 'health-potion', places: ['STATIC PANEL', 'WALL SCREEN', 'PEDESTAL', 'BOXES', 'MIDDLE'] },
  fantasy: { capacity: 0, gun: 'crystal-wand', potion: 'magic-potion', places: ['The Throne Room', 'The Armoury', 'The Shrine', 'The Storeroom', 'The Great Hall'] },
  frontier: { capacity: 6, gun: 'revolver', potion: 'jug', places: ['Main Street', 'The Saloon', 'The Bank', 'The Stable', 'Town Square'] },
  driver: { capacity: 12, gun: 'pistol-gun', potion: 'fuel-tank', places: ['North Gate', 'East Docks', 'West End', 'South Yard', 'Downtown'] },
  minimal: { capacity: 12, gun: 'pistol-gun', potion: 'health-potion', places: ['Static panel', 'Wall screen', 'Pedestal', 'Boxes', 'Middle'] },
  none: { capacity: 12, gun: 'pistol-gun', potion: 'health-potion', places: ['', '', '', '', ''] },
};
var STATION_ORDER = ['front', 'right', 'left', 'back'];
var MANA_PER_CAST = 12;

// ---------- the live state ----------

var demo = {
  style: 'shooter',
  health: 100, ghost: 100, hurtAt: -1e9, downUntil: 0,
  armor: 100, mana: 100, fuel: 100, drunk: 0, score: 0,
  speed: 0, heading: 0, placeIndex: 4,
  lapStart: 0, lapTime: 0, lapRunning: false,
  ammo: 30, reloadUntil: 0, reloadStart: 0,
  sips: 3,
};

function readStyle() {
  try { var v = localStorage.getItem(STYLE_KEY); if (STYLE[v]) return v; } catch (err) { /* private mode */ }
  return 'shooter';
}

function sceneEl() { return document.querySelector('a-scene'); }
function hud() { return sceneEl().systems['visor-hud']; }
function targeting() { return sceneEl().systems['aim-targeting']; }

function inXR() {
  var mode = sceneEl().systems['control-mode'];
  return Boolean(mode && mode.isMode('xr'));
}

// The key that does the primary action, for hints.
function actionKey() {
  if (inXR()) return 'TRIGGER';
  var router = sceneEl().systems['input-router'];
  var family = router && router.getActiveFamily ? router.getActiveFamily() : 'keyboard';
  if (family === 'touch') return 'USE';
  if (family === 'gamepad') return 'RT';
  return 'CLICK';
}

function capacity() {
  return STYLE[demo.style].capacity;
}

// ============================================================
// Props
// ============================================================

// Which prop a hand holds, by its data-hud-item.
function heldItem(side) {
  var hand = document.querySelector('#' + side + '-hand');
  var semantic = hand && hand.components['semantic-hand'];
  var held = semantic && semantic.heldEl;
  return held ? { el: held, kind: held.getAttribute('data-hud-item') || '' } : null;
}

function heldBy(el) {
  var body = el.components['simple-grabbable'];
  return body && body.state === 'held' ? body.handEl : null;
}

// A brief line from the muzzle to wherever the shot went.
function tracer(from, to, color) {
  var el = document.createElement('a-entity');
  el.setAttribute('line', { start: from, end: to, color: color || '#ffe08a', opacity: 0.9 });
  sceneEl().appendChild(el);
  setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 90);
}

function hitTarget(el) {
  var react = el.components['demo-target'];
  if (react) react.hit();
}

// The nearest target a ray passes through, by its aim radius.
function raycastTargets(origin, direction, maxDistance) {
  var system = targeting();
  var best = null;
  var point = new THREE.Vector3();
  var toPoint = new THREE.Vector3();
  system.targets.forEach(function (component) {
    if (!component.el.components['demo-target']) return;
    component.getPoint(point);
    toPoint.copy(point).sub(origin);
    var along = toPoint.dot(direction);
    if (along <= 0 || along > maxDistance) return;
    var miss = toPoint.addScaledVector(direction, -along).length();
    if (miss > component.getRadius()) return;
    if (!best || along < best.along) best = { el: component.el, along: along };
  });
  return best;
}

// The blaster: grab it, pull the trigger. Reloads itself when empty; in
// Fantasy it has no magazine and spends mana instead. While it is held it
// is an aim source of its own, in orange, and its shots go to whatever
// that source has locked — the GTA-style auto-aim, shown by brackets.
AFRAME.registerComponent('demo-blaster', {
  init: function () {
    var self = this;
    this.muzzle = this.el.querySelector('.demo-muzzle');
    this.onTrigger = function () { self.fire(); };
    this.el.addEventListener('simple-grabbed', function (evt) {
      self.handEl = evt.detail.handEl;
      self.handEl.addEventListener('triggerdown', self.onTrigger);
      self.handEl.addEventListener('desktop-trigger-attempt', self.onTrigger);
      targeting().addSource('blaster', { object3D: self.muzzle.object3D, color: '#ff9a4a' });
      targeting().request('demo-blaster', { source: 'blaster' });
    });
    this.el.addEventListener('simple-released', function () { self.drop(); });
  },

  drop: function () {
    if (this.handEl) {
      this.handEl.removeEventListener('triggerdown', this.onTrigger);
      this.handEl.removeEventListener('desktop-trigger-attempt', this.onTrigger);
    }
    this.handEl = null;
    targeting().release('demo-blaster');
    targeting().removeSource('blaster');
  },

  fire: function () {
    var now = sceneEl().time;
    if (demo.downUntil > now) return;
    if (demo.style === 'fantasy') {
      if (demo.mana < MANA_PER_CAST) return;
      demo.mana -= MANA_PER_CAST;
    } else {
      if (demo.reloadUntil > now || demo.ammo <= 0) return;
      demo.ammo--;
      if (demo.ammo === 0) { demo.reloadStart = now; demo.reloadUntil = now + 1500; }
    }
    var origin = new THREE.Vector3();
    var direction = new THREE.Vector3();
    var quat = new THREE.Quaternion();
    this.muzzle.object3D.getWorldPosition(origin);
    this.muzzle.object3D.getWorldQuaternion(quat);
    direction.set(0, 0, -1).applyQuaternion(quat);
    var lock = targeting().getLock('blaster', true);
    if (lock) direction.copy(lock.point).sub(origin).normalize();
    var hit = raycastTargets(origin, direction, 60);
    var end = origin.clone().addScaledVector(direction, hit ? hit.along : 25);
    tracer(origin, end, demo.style === 'fantasy' ? '#b98cff' : '#ffe08a');
    if (hit) hitTarget(hit.el);
  },

  remove: function () { this.drop(); },
});

// The grenade: grab it and the gaze brackets come up; throw it and the
// throw is bent toward the lock — hard in the inner ring, gently in the
// outer. Off a headset, T throws it at what you are looking at.
AFRAME.registerComponent('demo-throwable', {
  init: function () {
    var self = this;
    this.el.addEventListener('simple-grabbed', function () {
      targeting().request('demo-throwable', { source: 'gaze' });
    });
    this.el.addEventListener('simple-released', function () {
      targeting().release('demo-throwable');
      var body = self.el.components['simple-grabbable'];
      var origin = self.el.object3D.getWorldPosition(new THREE.Vector3());
      if (self.tossing) {
        // A keyboard toss: straight at what you are looking at.
        self.tossing = false;
        var camera = sceneEl().camera;
        var forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        body.velocity.copy(forward).multiplyScalar(7);
        body.velocity.y += 2;
      }
      // The lock as of the moment of release (assistThrow scores afresh),
      // pulling hard in the inner ring and barely in the outer.
      var assisted = targeting().assistThrow(origin, body.velocity, [1, 0.6, 0.15], 'gaze', body.data.gravity);
      body.velocity.set(assisted.x, assisted.y, assisted.z);
      self.flying = true;
    });
    this.el.addEventListener('simple-rested', function () {
      if (!self.flying) return;
      self.flying = false;
      // Landed near a target: that counts.
      var here = self.el.object3D.getWorldPosition(new THREE.Vector3());
      var point = new THREE.Vector3();
      targeting().targets.forEach(function (component) {
        if (!component.el.components['demo-target']) return;
        component.getPoint(point);
        point.y = here.y;
        if (point.distanceTo(here) < 1.4) hitTarget(component.el);
      });
    });
  },

  toss: function () {
    var handEl = heldBy(this.el);
    if (!handEl) return;
    this.tossing = true;
    this.el.components['simple-grabbable'].release(handEl);
  },

  tick: function () {
    // A grenade flying past a target hits it on the way.
    if (!this.flying) return;
    var here = this.el.object3D.getWorldPosition(this._here || (this._here = new THREE.Vector3()));
    var point = this._point || (this._point = new THREE.Vector3());
    var self = this;
    targeting().targets.forEach(function (component) {
      if (!self.flying || !component.el.components['demo-target']) return;
      component.getPoint(point);
      if (point.distanceTo(here) < component.getRadius() + 0.1) {
        hitTarget(component.el);
        self.flying = false;
      }
    });
  },
});

// The potion: three sips. What a sip does depends on the style — a
// health potion, mana, whisky, fuel. Trigger drinks; so does holding it
// to your mouth for a moment.
AFRAME.registerComponent('demo-potion', {
  init: function () {
    var self = this;
    this.mouthTime = 0;
    this.onTrigger = function () { self.drink(); };
    this.el.addEventListener('simple-grabbed', function (evt) {
      self.handEl = evt.detail.handEl;
      self.handEl.addEventListener('triggerdown', self.onTrigger);
      self.handEl.addEventListener('desktop-trigger-attempt', self.onTrigger);
    });
    this.el.addEventListener('simple-released', function () { self.drop(); });
  },

  drop: function () {
    if (this.handEl) {
      this.handEl.removeEventListener('triggerdown', this.onTrigger);
      this.handEl.removeEventListener('desktop-trigger-attempt', this.onTrigger);
    }
    this.handEl = null;
  },

  drink: function () {
    if (demo.sips <= 0) return;
    demo.sips--;
    if (demo.style === 'fantasy') demo.mana = Math.min(100, demo.mana + 50);
    else if (demo.style === 'frontier') { demo.drunk = Math.min(1, demo.drunk + 0.3); demo.health = Math.min(100, demo.health + 15); }
    else if (demo.style === 'driver') demo.fuel = Math.min(100, demo.fuel + 50);
    else demo.health = Math.min(100, demo.health + 50);
  },

  tick: function (time, delta) {
    if (!this.handEl || !inXR()) return;
    var camera = sceneEl().camera;
    var mouth = camera.localToWorld(new THREE.Vector3(0, -0.09, -0.06));
    var here = this.el.object3D.getWorldPosition(new THREE.Vector3());
    if (here.distanceTo(mouth) < 0.14) {
      this.mouthTime += delta;
      if (this.mouthTime > 600) { this.mouthTime = -900; this.drink(); }
    } else if (this.mouthTime > 0) {
      this.mouthTime = 0;
    }
  },

  remove: function () { this.drop(); },
});

// A target on a post. Hit it and it spins and scores.
AFRAME.registerComponent('demo-target', {
  init: function () {
    this.spinUntil = 0;
    this.face = this.el.querySelector('.demo-target-face');
    // The face's own turn (its model faces +X); the spin adds to it.
    this.baseYaw = this.face ? this.face.object3D.rotation.y : 0;
  },
  hit: function () {
    var now = this.el.sceneEl.time;
    if (this.spinUntil > now) return;
    this.spinUntil = now + 700;
    demo.score++;
  },
  tick: function (time) {
    if (!this.face) return;
    var left = this.spinUntil - time;
    this.face.object3D.rotation.y = this.baseYaw + (left > 0 ? (1 - left / 700) * Math.PI * 2 : 0);
  },
});

// ============================================================
// The HUD for each style
// ============================================================

var widgets = {};

function placeName() {
  return STYLE[demo.style].places[demo.placeIndex];
}

// One hand's corner: what that hand holds, and its number.
function drawHand(ctx, box) {
  var s = box.state;
  if (!s.kind) return;
  var right = s.side === 'right';
  var w = box.w;
  var iconX = right ? w - 26 : 26;
  var style = STYLE[demo.style];
  if (s.kind === 'blaster') {
    drawIcon(ctx, style.gun, iconX, 28, 42);
    if (demo.style === 'fantasy') {
      drawIcon(ctx, 'sparkles', right ? w - 22 : 22, 74, 30, { color: '#b98cff' });
      drawText(ctx, '×' + s.casts, right ? w - 44 : 44, 74, { size: 30, align: right ? 'right' : 'left', color: s.casts ? HUD_COLORS.text : HUD_COLORS.danger });
    } else if (s.reload >= 0) {
      drawText(ctx, 'RELOAD', right ? w - 4 : 4, 66, { size: 20, align: right ? 'right' : 'left', color: HUD_COLORS.warn });
      drawBar(ctx, 4, 82, w - 8, 9, s.reload, { color: HUD_COLORS.warn, reverse: right });
    } else {
      drawAmmo(ctx, 4, 52, w - 8, 40, s.count, s.capacity, { align: right ? 'right' : 'left' });
    }
  } else if (s.kind === 'grenade') {
    drawIcon(ctx, 'grenade', iconX, 34, 52, { color: HUD_COLORS.good });
    drawText(ctx, '×1', right ? w - 6 : 6, 80, { size: 24, align: right ? 'right' : 'left' });
  } else if (s.kind === 'potion') {
    drawIcon(ctx, style.potion, iconX, 32, 48, { color: s.sips ? HUD_COLORS.text : HUD_COLORS.muted });
    drawIconMeter(ctx, 'drop', 4, 64, w - 8, 26, s.sips, 3, { align: right ? 'right' : 'left', color: '#7fb8ff' });
  }
}

function handState(side) {
  var held = heldItem(side);
  var kind = held ? held.kind : '';
  if (kind === 'box') kind = '';
  var now = sceneEl().time;
  return {
    side: side,
    kind: kind,
    count: demo.ammo,
    capacity: capacity(),
    casts: Math.floor(demo.mana / MANA_PER_CAST),
    reload: demo.reloadUntil > now ? Math.round((now - demo.reloadStart) / (demo.reloadUntil - demo.reloadStart) * 20) / 20 : -1,
    sips: demo.sips,
  };
}

// Shields over health, Halo-style.
function drawShieldHealth(ctx, box) {
  var s = box.state;
  var width = Math.min(box.w * 0.7, 520);
  var x = (box.w - width) / 2;
  drawBar(ctx, x, 10, width, 30, s.armor / 100, { segments: 1, skew: 10, color: '#7fe3ff', ghost: s.armorGhost / 100 });
  drawBar(ctx, x + width * 0.2, 54, width * 0.6, 22, s.health / 100, {
    segments: 8, skew: 6, color: s.health < 30 ? HUD_COLORS.danger : HUD_COLORS.good, ghost: s.ghost / 100,
  });
}

function drawHearts(ctx, box) {
  var s = box.state;
  drawIconMeter(ctx, 'hearts', 4, 18, box.w - 8, 64, s.health / 20, 5, { color: HUD_COLORS.danger });
}

function drawMana(ctx, box) {
  var s = box.state;
  drawIcon(ctx, 'lightning-helix', 28, 50, 44, { color: '#9ec2ff' });
  drawBar(ctx, 56, 34, box.w - 64, 30, s.mana / 100, { segments: 5, skew: 6, color: '#5d8cff' });
}

function drawWhisky(ctx, box) {
  var s = box.state;
  drawIcon(ctx, 'glass-shot', 26, 50, 44, { color: s.drunk > 0.66 ? HUD_COLORS.warn : HUD_COLORS.text });
  drawBar(ctx, 54, 36, box.w - 62, 26, s.drunk, { segments: 3, skew: 6, color: '#e2a14a' });
}

function drawScore(ctx, box) {
  var s = box.state;
  drawIcon(ctx, s.icon, 22, 30, 36, { color: s.color });
  drawText(ctx, s.text, 44, 30, { size: 28, align: 'left', maxWidth: box.w - 48 });
}

function drawPlace(ctx, box) {
  var s = box.state;
  if (!s.name) return;
  drawText(ctx, s.name, box.w / 2, 52, { size: 54, align: 'center', face: 'heading', weight: 900, maxWidth: box.w - 12 });
}

function drawCompass(ctx, box) {
  drawCompassTape(ctx, box.w, box.h, demo.heading, { span: 140, marks: compassMarks() });
}

function drawSpeed(ctx, box) {
  drawDial(ctx, box.w / 2, 54, 36, box.state.speed, 6, { text: box.state.speed.toFixed(1), unit: 'm/s' });
}

function drawFuel(ctx, box) {
  var s = box.state;
  drawIcon(ctx, 'fuel-tank', box.w / 2, 26, 38, { color: s.fuel < 20 ? HUD_COLORS.danger : HUD_COLORS.text });
  drawBar(ctx, 10, 58, box.w - 20, 22, s.fuel / 100, { segments: 4, color: s.fuel < 20 ? HUD_COLORS.danger : HUD_COLORS.warn });
}

function drawClock(ctx, box) {
  drawIcon(ctx, 'pocket-watch', 22, 30, 36);
  drawText(ctx, box.state.text, 44, 30, { size: 28, align: 'left', maxWidth: box.w - 48 });
}

function drawLap(ctx, box) {
  var s = box.state;
  drawIcon(ctx, 'stopwatch', 22, 30, 36, { color: s.running ? HUD_COLORS.accent : HUD_COLORS.text });
  drawText(ctx, s.text, 44, 30, { size: 28, align: 'left', maxWidth: box.w - 48 });
}

function drawThinHealth(ctx, box) {
  var s = box.state;
  var width = Math.min(box.w * 0.4, 300);
  drawBar(ctx, (box.w - width) / 2, 40, width, 14, s.health / 100, { color: s.health < 30 ? HUD_COLORS.danger : HUD_COLORS.text, ghost: s.ghost / 100 });
}

function drawDown(ctx, box) {
  if (!box.state.down) return;
  drawText(ctx, 'DOWN', box.w / 2, 50, { size: 60, align: 'center', face: 'heading', weight: 900, color: HUD_COLORS.danger });
}

// The minimap. `rotate`: forward is up, like a radar; otherwise north is
// up and you are an arrow.
function drawMap(ctx, box) {
  var w = box.w;
  var h = box.h;
  var rotate = box.state.rotate;
  var round = box.state.round;
  var cx = w / 2;
  var cy = h / 2;
  var radius = Math.min(w, h) / 2 - 4;
  var range = 7; // metres from you to the edge
  var scale = radius / range;
  ctx.save();
  if (round) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(6, 14, 22, 0.5)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(127, 227, 255, 0.55)';
    ctx.stroke();
    ctx.clip();
  } else {
    drawPanel(ctx, 2, 2, w - 4, h - 4, { radius: 6, fill: 'rgba(36, 28, 14, 0.5)', stroke: 'rgba(230, 200, 140, 0.6)' });
    ctx.beginPath();
    ctx.rect(4, 4, w - 8, h - 8);
    ctx.clip();
  }
  var me = map.player;
  var angle = rotate ? demo.heading * DEG : 0;
  var cos = Math.cos(angle);
  var sin = Math.sin(angle);
  // World (x east, z south) to map (x right, y down), relative to you.
  var toMap = function (p) {
    var dx = p.x - me.x;
    var dz = p.z - me.z;
    return { x: cx + (dx * cos + dz * sin) * scale, y: cy + (-dx * sin + dz * cos) * scale };
  };
  // Range rings on the radar.
  if (round) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(127, 227, 255, 0.18)';
    [radius / 3, radius * 2 / 3].forEach(function (r) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });
  }
  if (map.room.length > 2) {
    ctx.beginPath();
    map.room.forEach(function (p, i) { var m = toMap(p); if (i) ctx.lineTo(m.x, m.y); else ctx.moveTo(m.x, m.y); });
    ctx.closePath();
    ctx.fillStyle = round ? 'rgba(127, 227, 255, 0.08)' : 'rgba(230, 200, 140, 0.12)';
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = round ? 'rgba(127, 227, 255, 0.5)' : 'rgba(230, 200, 140, 0.7)';
    ctx.stroke();
  }
  var dot = function (p, color, size) {
    var m = toMap(p);
    ctx.beginPath();
    ctx.arc(m.x, m.y, size, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = HUD_COLORS.outline;
    ctx.stroke();
  };
  map.stations.forEach(function (p) { dot(p, 'rgba(238, 246, 255, 0.7)', 3); });
  map.props.forEach(function (p) { dot(p, HUD_COLORS.good, 2.6); });
  if (map.spikes) dot(map.spikes, HUD_COLORS.warn, 3.2);
  map.targets.forEach(function (p) {
    // Off the map: pinned to its edge, so you know which way.
    var m = toMap(p);
    var dx = m.x - cx;
    var dy = m.y - cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    var edge = radius - 5;
    if (d > edge) { m.x = cx + dx / d * edge; m.y = cy + dy / d * edge; }
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = HUD_COLORS.danger;
    ctx.fill();
  });
  // You.
  ctx.save();
  ctx.translate(cx, cy);
  if (!rotate) ctx.rotate(demo.heading * DEG);
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(5.5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5.5, 6);
  ctx.closePath();
  ctx.fillStyle = HUD_COLORS.accent;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = HUD_COLORS.outline;
  ctx.stroke();
  ctx.restore();
  ctx.restore();
  if (!round) drawText(ctx, 'N', cx, 12, { size: 11, align: 'center', color: HUD_COLORS.warn });
}

// Where things are, refreshed each frame for the map and the compass.
var map = { player: { x: 0, z: 0 }, room: [], stations: [], targets: [], props: [], spikes: null };

function compassMarks() {
  // The nearest target, as a mark on the tape.
  var me = map.player;
  var best = null;
  map.targets.forEach(function (p) {
    var d = Math.hypot(p.x - me.x, p.z - me.z);
    if (!best || d < best.d) best = { d: d, p: p };
  });
  if (!best) return [];
  var bearing = Math.atan2(best.p.x - me.x, -(best.p.z - me.z)) / DEG;
  return [{ bearing: bearing, icon: 'archery-target', color: HUD_COLORS.danger }];
}

// Build the HUD for a style from scratch.
function applyStyle(style) {
  var display = hud();
  if (!display) return;
  demo.style = style;
  try { localStorage.setItem(STYLE_KEY, style); } catch (err) { /* private mode */ }
  display.clear();
  widgets = {};
  var add = function (key, slot, options) { widgets[key] = display.add(slot, Object.assign({ id: 'demo-' + key }, options)); };
  if (demo.ammo > capacity()) demo.ammo = capacity();
  if (style === 'none') return;

  if (style !== 'driver') {
    add('handLeft', 'bottom-left', { draw: drawHand, state: { side: 'left' } });
    add('handRight', 'bottom-right', { draw: drawHand, state: { side: 'right' } });
  }
  if (style === 'shooter') {
    add('shields', 'top', { draw: drawShieldHealth });
    add('compass', 'bottom', { draw: drawCompass, fade: false, fps: 30 });
    add('map', 'top-right', { draw: drawMap, state: { rotate: true, round: true }, fade: false, fps: 15 });
    add('score', 'top-left', { draw: drawScore, weight: 0.4, state: { icon: 'crosshair', color: HUD_COLORS.accent } });
    add('down', 'above', { draw: drawDown, fade: false });
  } else if (style === 'fantasy') {
    add('place', 'top', { draw: drawPlace });
    add('hearts', 'bottom', { draw: drawHearts, weight: 1 });
    add('mana', 'bottom', { draw: drawMana, weight: 1.2, order: 1 });
    add('map', 'top-right', { draw: drawMap, state: { rotate: false, round: false }, fade: false, fps: 15 });
    add('armor', 'top-left', { draw: drawScore, weight: 0.4, state: { icon: 'breastplate', color: HUD_COLORS.text } });
    add('down', 'above', { draw: drawDown, fade: false });
  } else if (style === 'frontier') {
    add('place', 'top', { draw: drawPlace });
    add('hearts', 'bottom', { draw: drawHearts });
    add('whisky', 'bottom', { draw: drawWhisky, order: 1, weight: 0.8 });
    add('clock', 'top-right', { draw: drawClock, weight: 0.4, fps: 1 });
    add('score', 'top-left', { draw: drawScore, weight: 0.4, state: { icon: 'wanted-reward', color: HUD_COLORS.warn } });
    add('down', 'above', { draw: drawDown, fade: false });
  } else if (style === 'driver') {
    add('compass', 'top', { draw: drawCompass, fade: false, fps: 30, weight: 1.6 });
    add('place', 'top', { draw: drawPlace, order: 1 });
    add('fuel', 'bottom-left', { draw: drawFuel });
    add('speed', 'bottom-right', { draw: drawSpeed, fps: 20 });
    add('map', 'top-right', { draw: drawMap, state: { rotate: true, round: true }, fade: false, fps: 15 });
    add('lap', 'top-left', { draw: drawLap, weight: 0.4, fps: 10 });
  } else if (style === 'minimal') {
    add('thinHealth', 'bottom', { draw: drawThinHealth });
    add('down', 'above', { draw: drawDown, fade: false });
  }
  update(sceneEl().time, 0);
}

var lastPosition = null;

// Everything live, once a frame; each widget redraws only if what it
// shows actually changed.
function update(time, delta) {
  var scene = sceneEl();
  var camera = scene.camera;
  if (!camera) return;
  var dt = Math.min(delta || 16, 100) / 1000;
  var position = camera.getWorldPosition(new THREE.Vector3());
  var forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  demo.heading = ((Math.atan2(forward.x, -forward.z) / DEG) + 360) % 360;
  if (lastPosition && dt > 0) {
    var moved = Math.hypot(position.x - lastPosition.x, position.z - lastPosition.z) / dt;
    demo.speed += (Math.min(moved, 12) - demo.speed) * Math.min(1, dt * 4);
    if (demo.speed < 0.05) demo.speed = 0;
  }
  lastPosition = position.clone();

  // Where you are: the station you are standing nearest, within 1.3 m.
  var space = scene.systems['play-space'];
  var layout = space && space.getLayout();
  var placeIndex = 4;
  if (layout) {
    var best = 1.3;
    STATION_ORDER.forEach(function (side, i) {
      var p = layout.sides[side];
      var d = Math.hypot(p.x - position.x, p.z - position.z);
      if (d < best) { best = d; placeIndex = i; }
    });
  }
  if (placeIndex !== demo.placeIndex) demo.placeIndex = placeIndex;

  // The lap: from leaving the middle to coming back to it.
  if (placeIndex !== 4 && !demo.lapRunning && demo.speed > 0.2) { demo.lapRunning = true; demo.lapStart = time; }
  if (demo.lapRunning) {
    demo.lapTime = time - demo.lapStart;
    if (placeIndex === 4 && demo.lapTime > 2000) demo.lapRunning = false;
  }

  // Fuel burns as you move.
  demo.fuel = Math.max(0, demo.fuel - demo.speed * dt * 2.5);
  demo.drunk = Math.max(0, demo.drunk - dt * 0.015);
  if (demo.style === 'fantasy') demo.mana = Math.min(100, demo.mana + dt * 4);
  if (demo.reloadUntil && time >= demo.reloadUntil) { demo.reloadUntil = 0; demo.ammo = capacity(); }

  // The spikes.
  var spikes = document.querySelector('#demo-spikes');
  var hurting = false;
  if (spikes && demo.downUntil <= time) {
    var sp = spikes.object3D.getWorldPosition(new THREE.Vector3());
    if (Math.hypot(sp.x - position.x, sp.z - position.z) < 0.5) {
      hurting = true;
      var damage = 30 * dt;
      if (demo.style !== 'minimal' && demo.armor > 0) {
        var absorbed = Math.min(demo.armor, damage * 0.6);
        demo.armor -= absorbed * 1.5;
        damage -= absorbed;
      }
      demo.health = Math.max(0, demo.health - damage);
      demo.hurtAt = time;
      if (demo.health <= 0) demo.downUntil = time + 2500;
    }
  }
  if (demo.downUntil && time >= demo.downUntil) {
    demo.downUntil = 0;
    demo.health = 100;
    demo.armor = 100;
    demo.ghost = 100;
  }
  if (!hurting && time - demo.hurtAt > 3000 && demo.downUntil <= time) {
    demo.health = Math.min(100, demo.health + dt * 8);
    demo.armor = Math.min(100, demo.armor + dt * 12);
  }
  // The damage trail catches up after a moment.
  if (time - demo.hurtAt > 600) demo.ghost += (demo.health - demo.ghost) * Math.min(1, dt * 3);
  if (demo.ghost < demo.health) demo.ghost = demo.health;

  refreshMap(position, layout);
  refreshHints(time);

  var round = function (v, step) { return Math.round(v / step) * step; };
  var set = function (key, state) { if (widgets[key]) widgets[key].set(state); };
  set('handLeft', handState('left'));
  set('handRight', handState('right'));
  set('shields', { armor: round(demo.armor, 1), armorGhost: round(Math.max(demo.armor, demo.ghost - (100 - demo.armor)), 1), health: round(demo.health, 1), ghost: round(demo.ghost, 1) });
  set('hearts', { health: round(demo.health, 2) });
  set('mana', { mana: round(demo.mana, 1) });
  set('whisky', { drunk: round(demo.drunk, 0.02) });
  set('fuel', { fuel: round(demo.fuel, 1) });
  set('speed', { speed: round(demo.speed, 0.1) });
  set('place', { name: placeName() });
  set('down', { down: demo.downUntil > time });
  set('thinHealth', { health: round(demo.health, 1), ghost: round(demo.ghost, 1) });
  if (widgets.thinHealth) widgets.thinHealth.show(demo.health < 99.5 || demo.ghost > demo.health + 0.5);
  if (widgets.score) {
    set('score', { text: demo.style === 'frontier' ? '$' + (demo.score * 25) : String(demo.score) });
  }
  set('armor', { text: Math.round(demo.armor) + '%' });
  var now = new Date();
  set('clock', { text: now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') });
  var seconds = demo.lapTime / 1000;
  set('lap', { running: demo.lapRunning, text: Math.floor(seconds / 60) + ':' + (seconds % 60).toFixed(1).padStart(4, '0') });
  // Continuous: redrawn, but not news.
  ['map', 'compass'].forEach(function (key) { if (widgets[key]) widgets[key].redraw(); });
}

function refreshMap(position, layout) {
  map.player.x = position.x;
  map.player.z = position.z;
  var space = sceneEl().systems['play-space'];
  map.room = space && space.getPoints ? (space.getPoints() || []) : [];
  if ((!map.room || map.room.length < 3) && layout) {
    // The default room: a square round the centre, as the outline draws it.
    var c = layout.center;
    map.room = [{ x: c.x - 1.5, z: c.z - 1.5 }, { x: c.x + 1.5, z: c.z - 1.5 }, { x: c.x + 1.5, z: c.z + 1.5 }, { x: c.x - 1.5, z: c.z + 1.5 }];
  }
  map.stations = layout ? STATION_ORDER.map(function (side) { return layout.sides[side]; }) : [];
  var v = new THREE.Vector3();
  map.targets = Array.prototype.map.call(document.querySelectorAll('[demo-target]'), function (el) {
    el.object3D.getWorldPosition(v);
    return { x: v.x, z: v.z };
  });
  map.props = Array.prototype.map.call(document.querySelectorAll('[data-hud-item]'), function (el) {
    el.object3D.getWorldPosition(v);
    return { x: v.x, z: v.z };
  });
  var spikes = document.querySelector('#demo-spikes');
  if (spikes) { spikes.object3D.getWorldPosition(v); map.spikes = { x: v.x, z: v.z }; }
}

// Hints above and below the reticle for whatever you are holding.
function refreshHints(time) {
  var display = hud();
  var holding = {};
  ['left', 'right'].forEach(function (side) {
    var held = heldItem(side);
    if (held) holding[held.kind] = true;
  });
  var key = actionKey();
  if (holding.blaster) display.setHint('demo-blaster', { key: key, text: demo.style === 'fantasy' ? 'Cast' : 'Fire', slot: 'below' });
  else display.clearHint('demo-blaster');
  if (holding.potion) display.setHint('demo-potion', { key: key, text: demo.sips ? 'Drink' : 'Empty', slot: 'below', priority: 1 });
  else display.clearHint('demo-potion');
  if (holding.grenade) {
    display.setHint('demo-grenade', inXR()
      ? { text: 'Look at a target, then throw', slot: 'below', priority: 2 }
      : { key: 'T', text: 'Throw at target', slot: 'below', priority: 2 });
  } else display.clearHint('demo-grenade');
  if (demo.reloadUntil > time && demo.style !== 'fantasy') display.setHint('demo-reload', { text: 'Reloading', slot: 'above' });
  else display.clearHint('demo-reload');
}

// ============================================================
// Setup
// ============================================================

// Targets on posts round the outside of the room, along the diagonals
// (the stations have the sides), a few metres past its edge so throwing
// at them means really throwing.
var TARGET_SPOTS = [
  { angle: -45, beyond: 2.2, height: 1.4 },
  { angle: 45, beyond: 3.4, height: 1.8 },
  { angle: -25, beyond: 7, height: 2.4 },
  { angle: 135, beyond: 2.6, height: 1.2 },
  { angle: -135, beyond: 4.5, height: 1.6 },
  { angle: 20, beyond: 9, height: 1.1 },
];

function placeTargets() {
  var space = sceneEl().systems['play-space'];
  var layout = space && space.getLayout();
  if (!layout) return;
  var points = space.getPoints && space.getPoints();
  var c = layout.center;
  document.querySelectorAll('[demo-target]').forEach(function (el, i) {
    var spot = TARGET_SPOTS[i % TARGET_SPOTS.length];
    // Angle 0 is ahead (-Z), positive to the right.
    var a = spot.angle * DEG;
    var dir = { x: Math.sin(a), z: -Math.cos(a) };
    var reach = points && points.length > 2 ? reachAlong(points, c, dir) : 1.5 / Math.max(Math.abs(dir.x), Math.abs(dir.z));
    if (!isFinite(reach)) reach = 1.5;
    var d = reach + spot.beyond;
    el.setAttribute('position', { x: c.x + dir.x * d, y: 0, z: c.z + dir.z * d });
    // Facing the middle of the room.
    el.object3D.rotation.y = Math.atan2(-dir.x, -dir.z);
    var face = el.querySelector('.demo-target-face');
    if (face) face.object3D.position.y = spot.height;
    var post = el.querySelector('.demo-target-post');
    if (post) { post.setAttribute('height', spot.height); post.object3D.position.y = spot.height / 2; }
  });
}

function resetProps() {
  document.querySelectorAll('[data-hud-item]').forEach(function (el) {
    var body = el.components['simple-grabbable'];
    if (body) body.resetToSpawn();
  });
  demo.sips = 3;
  demo.ammo = capacity();
  demo.reloadUntil = 0;
}

AFRAME.registerComponent('hud-demo', {
  init: function () {
    this.onKey = function (evt) {
      if (evt.code !== 'KeyT' || evt.repeat) return;
      var active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
      document.querySelectorAll('[demo-throwable]').forEach(function (el) { el.components['demo-throwable'].toss(); });
    };
    window.addEventListener('keydown', this.onKey);
    this.el.addEventListener('play-space-changed', placeTargets);
    var start = function () {
      placeTargets();
      applyStyle(readStyle());
    };
    if (this.el.hasLoaded) start();
    else this.el.addEventListener('loaded', start);
    var onMenu = function (evt) {
      if (evt.detail.id === 'hud-style' && STYLE[evt.detail.value]) applyStyle(evt.detail.value);
    };
    this.el.addEventListener('menu-commit', onMenu);
    this.el.addEventListener('menu-preview', onMenu);
    this.el.addEventListener('menu-action', function (evt) {
      if (evt.detail.id === 'hud-props-reset') resetProps();
    });
  },

  tick: function (time, delta) {
    update(time, delta);
  },

  remove: function () {
    window.removeEventListener('keydown', this.onKey);
  },
});

// For the visor row's starting value and for tests.
export function currentHudStyle() { return demo.style || readStyle(); }
export function hudDemoState() { return demo; }
window.__hudDemo = { state: demo, applyStyle: applyStyle, resetProps: resetProps };
