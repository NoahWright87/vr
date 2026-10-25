// ============================================================
// SHOOTER — a range behind you, a table in front of it, and a gun case.
//
// The HUD is the Halo-ish one: shields over health along the top, a
// compass along the bottom, a radar top right, hits top left, and each
// hand's gun and its ammo in that hand's corner. Grab the gun case and
// its menu changes what is on the table — which gun, its scope and
// silencer, how many grenades — the way a game's loadout screen would,
// but on a thing in the room rather than a wall of buttons.
// ============================================================

import { registerMenuPage } from '../../common/menu-crossbar.js';
import {
  HUD_COLORS, drawIcon, drawText, drawBar, drawAmmo, drawCompassTape,
} from '../../common/hud-draw.js';
import { hud, heldItem, holding, actionKey, inXR, resetProps } from './tour-core.js';

var THREE = AFRAME.THREE;
var DEG = Math.PI / 180;
var KIT = '../../assets/models/kenney/blaster-kit/';

// Each gun's model sits so its grip is at the hand and its barrel points
// down the hand's -Z (the kit's models face different ways).
var GUNS = {
  rifle: { label: 'Rifle', model: 'blaster-a', rotY: 180, pos: '0 0.06 -0.054', muzzle: '0 0.075 -0.2', capacity: 30, icon: 'ray-gun' },
  smg: { label: 'SMG', model: 'blaster-d', rotY: 180, pos: '0 0.04 -0.024', muzzle: '0 0.06 -0.21', capacity: 45, icon: 'ray-gun' },
  pistol: { label: 'Pistol', model: 'blaster-h', rotY: 0, pos: '0 0.03 -0.1', muzzle: '0 0.06 -0.23', capacity: 12, icon: 'pistol-gun' },
};

var state = {
  gun: 'rifle', scope: 'none', silencer: false, grenades: 2,
  ammo: 30, reloadUntil: 0, reloadStart: 0,
  shield: 100, health: 100, ghost: 100, hurtAt: -1e9, hits: 0,
};

function capacity() { return GUNS[state.gun].capacity; }

// ---------- the gun case's menu ----------

registerMenuPage('gun-case', {
  title: 'GUN CASE',
  items: [
    {
      kind: 'select', id: 'case-gun', label: 'Gun', value: 'rifle',
      options: Object.keys(GUNS).map(function (id) { return { value: id, label: GUNS[id].label }; }),
      info: ['LOADOUT', 'Changes the gun on the', 'table. The ammo counter', 'follows: 30, 45, or a', 'pistol\'s 12.'],
    },
    {
      kind: 'select', id: 'case-scope', label: 'Scope', value: 'none',
      options: [{ value: 'none', label: 'None' }, { value: 'scope-small', label: 'Small' }, { value: 'scope-large-a', label: 'Large' }],
    },
    { kind: 'toggle', id: 'case-silencer', label: 'Silencer', value: false },
    { kind: 'number', id: 'case-grenades', label: 'Grenades', value: 2, min: 0, max: 3, step: 1 },
    {
      kind: 'info', id: 'case-about', label: 'About this case',
      info: ['A MENU IN A PROP', 'Reach for the case and', 'grab: its menu opens', 'above it. Scroll to', 'preview, back out to', 'keep. Grab again, or', 'look away, to close.'],
    },
  ],
});

function setEl() { return document.querySelector('#set-shooter'); }

function applyLoadout() {
  var gun = GUNS[state.gun];
  var gunEl = document.querySelector('#shooter-gun');
  var model = gunEl.querySelector('.tour-gun-model');
  model.setAttribute('gltf-model', KIT + gun.model + '.glb');
  model.setAttribute('rotation', '0 ' + gun.rotY + ' 0');
  model.setAttribute('position', gun.pos);
  gunEl.querySelector('.tour-muzzle').setAttribute('position', gun.muzzle);
  var scope = gunEl.querySelector('.shooter-scope');
  scope.object3D.visible = state.scope !== 'none';
  if (state.scope !== 'none') scope.setAttribute('gltf-model', KIT + state.scope + '.glb');
  gunEl.querySelector('.shooter-silencer').object3D.visible = state.silencer;
  gunEl.setAttribute('tour-gun', 'tracer', state.silencer ? '#9fb3c8' : '#ffe08a');
  document.querySelectorAll('.shooter-grenade').forEach(function (el, i) {
    var show = i < state.grenades;
    el.object3D.visible = show;
    el.setAttribute('hint-zone', 'enabled', show);
  });
  if (state.ammo > capacity()) state.ammo = capacity();
}

function onCaseRow(evt) {
  var id = evt.detail.id;
  var value = evt.detail.value;
  if (id === 'case-gun') { state.gun = value; state.ammo = GUNS[value].capacity; state.reloadUntil = 0; }
  else if (id === 'case-scope') state.scope = value;
  else if (id === 'case-silencer') state.silencer = value;
  else if (id === 'case-grenades') state.grenades = value;
  else return;
  applyLoadout();
}

// ---------- the HUD ----------

var widgets = {};

function drawShieldHealth(ctx, box) {
  var s = box.state;
  var width = Math.min(box.w * 0.7, 520);
  var x = (box.w - width) / 2;
  drawBar(ctx, x, 10, width, 30, s.shield / 100, { skew: 10, color: '#7fe3ff' });
  drawBar(ctx, x + width * 0.2, 54, width * 0.6, 22, s.health / 100, {
    segments: 8, skew: 6, color: s.health < 30 ? HUD_COLORS.danger : HUD_COLORS.good, ghost: s.ghost / 100,
  });
}

function drawHits(ctx, box) {
  drawIcon(ctx, 'crosshair', 22, 30, 36, { color: HUD_COLORS.accent });
  drawText(ctx, String(box.state.hits), 44, 30, { size: 28, align: 'left', maxWidth: box.w - 48 });
}

function drawCompass(ctx, box) {
  drawCompassTape(ctx, box.w, box.h, box.state.heading, { span: 140 });
}

// A radar: forward is up, targets are red, you are the middle.
var radarTargets = [];
function drawRadar(ctx, box) {
  var cx = box.w / 2;
  var cy = box.h / 2;
  var radius = Math.min(cx, cy) - 4;
  var range = 12;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(6, 14, 22, 0.5)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(127, 227, 255, 0.55)';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(127, 227, 255, 0.18)';
  [radius / 3, radius * 2 / 3].forEach(function (r) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); });
  // The radar's sweep, a quarter turn a second.
  var sweep = (box.time / 1000) * Math.PI / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, sweep - 0.5, sweep);
  ctx.closePath();
  ctx.fillStyle = 'rgba(127, 227, 255, 0.12)';
  ctx.fill();
  radarTargets.forEach(function (t) {
    var d = Math.min(t.distance / range, 1) * (radius - 5);
    var a = t.bearing * DEG;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(a) * d, cy - Math.cos(a) * d, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = HUD_COLORS.danger;
    ctx.fill();
  });
  ctx.beginPath();
  ctx.moveTo(cx, cy - 7);
  ctx.lineTo(cx + 5, cy + 5);
  ctx.lineTo(cx - 5, cy + 5);
  ctx.closePath();
  ctx.fillStyle = HUD_COLORS.accent;
  ctx.fill();
}

function drawHand(ctx, box) {
  var s = box.state;
  if (!s.kind) return;
  var right = s.side === 'right';
  var w = box.w;
  var iconX = right ? w - 26 : 26;
  if (s.kind === 'gun') {
    drawIcon(ctx, s.icon, iconX, 24, 38);
    drawText(ctx, s.name, right ? w - 50 : 50, 24, { size: 16, align: right ? 'right' : 'left', color: HUD_COLORS.muted, maxWidth: w - 54 });
    if (s.reload >= 0) {
      drawText(ctx, 'RELOAD', right ? w - 4 : 4, 62, { size: 20, align: right ? 'right' : 'left', color: HUD_COLORS.warn });
      drawBar(ctx, 4, 80, w - 8, 9, s.reload, { color: HUD_COLORS.warn, reverse: right });
    } else {
      drawAmmo(ctx, 4, 50, w - 8, 40, s.count, s.capacity, { align: right ? 'right' : 'left' });
    }
  } else if (s.kind === 'grenade') {
    drawIcon(ctx, 'grenade', iconX, 34, 52, { color: HUD_COLORS.good });
    drawText(ctx, '×' + s.grenades, right ? w - 6 : 6, 80, { size: 24, align: right ? 'right' : 'left' });
  }
}

function handState(side, time) {
  var held = heldItem(side);
  var kind = held ? held.kind : '';
  var gun = GUNS[state.gun];
  return {
    side: side, kind: kind === 'gun' || kind === 'grenade' ? kind : '',
    icon: gun.icon, name: gun.label + (state.scope !== 'none' ? ' · scope' : '') + (state.silencer ? ' · quiet' : ''),
    count: state.ammo, capacity: gun.capacity, grenades: state.grenades,
    reload: state.reloadUntil > time ? Math.round((time - state.reloadStart) / (state.reloadUntil - state.reloadStart) * 20) / 20 : -1,
  };
}

// ---------- the demo ----------

var scratch = { forward: new THREE.Vector3(), camera: new THREE.Vector3(), target: new THREE.Vector3() };
var lastRadarAt = -Infinity;

export default {
  id: 'shooter',
  label: 'Shooter',
  title: 'SHOOTER',
  blurb: ['SHOOTER', 'A range behind you, and', 'the HUD a shooter would', 'have: shields, ammo,', 'radar, compass, and', 'auto-aim brackets.', '', 'A gun case opens a', 'loadout menu.'],
  place: 'The range',

  rows: function () {
    return [
      { kind: 'info', id: 'shooter-f-shields', label: 'Shields and health', info: ['SHIELDS AND HEALTH', 'Top of the visor, where', 'Halo keeps them. Take', 'a hit to see the shield', 'drop first, then health,', 'with a pale trail of', 'what was just lost.'] },
      { kind: 'action', id: 'shooter-hit', label: 'Take a hit', info: ['TAKE A HIT', 'Knocks some shield off,', 'then health. The shield', 'recharges after three', 'quiet seconds.'] },
      { kind: 'info', id: 'shooter-f-ammo', label: 'Ammo in the hand corner', info: ['AMMO', 'The corner on the side', 'of the hand holding the', 'gun. A magazine is a', 'round and a number; it', 'reloads itself when', 'empty.'] },
      { kind: 'info', id: 'shooter-f-brackets', label: 'Auto-aim brackets', info: ['AUTO-AIM', 'While you hold the gun,', 'what it would hit is', 'bracketed in orange, and', 'the shot goes there.', 'Nearby targets get faint', 'brackets of their own.'] },
      { kind: 'info', id: 'shooter-f-throw', label: 'Grenade throw assist', info: ['THROW ASSIST', 'Hold a grenade and look', 'at a target: white', 'brackets. Throw, and', 'the throw bends toward', 'the bracketed one.'] },
      { kind: 'info', id: 'shooter-f-radar', label: 'Radar and compass', info: ['RADAR AND COMPASS', 'Radar top right, forward', 'up; the compass strip', 'along the bottom, with', 'the heading you face.'] },
      { kind: 'info', id: 'shooter-f-case', label: 'The gun case menu', info: ['THE GUN CASE', 'Beside the table. Reach', 'for it and grab: a menu', 'opens on the case and', 'changes what is on the', 'table.'] },
      { kind: 'action', id: 'shooter-reset', label: 'Reset the range' },
    ];
  },

  onAction: function (id) {
    if (id === 'shooter-hit') {
      var damage = 35;
      var absorbed = Math.min(state.shield, damage);
      state.shield -= absorbed;
      state.health = Math.max(5, state.health - (damage - absorbed) * 1.2);
      state.hurtAt = sceneTime();
    } else if (id === 'shooter-reset') {
      resetProps(setEl());
      state.ammo = capacity();
      state.reloadUntil = 0;
      state.hits = 0;
    }
  },

  enter: function () {
    document.addEventListener('menu-commit', onCaseRow);
    document.addEventListener('menu-preview', onCaseRow);
    applyLoadout();
  },

  exit: function () {
    document.removeEventListener('menu-commit', onCaseRow);
    document.removeEventListener('menu-preview', onCaseRow);
    resetProps(setEl());
    var pm = document.querySelector('#shooter-case').components['projected-menu'];
    if (pm) pm.close();
  },

  hud: function (display) {
    widgets = {
      shields: display.add('top', { id: 'shooter-shields', draw: drawShieldHealth }),
      compass: display.add('bottom', { id: 'shooter-compass', draw: drawCompass, fade: false, fps: 20, ppd: 18 }),
      radar: display.add('top-right', { id: 'shooter-radar', draw: drawRadar, fade: false, fps: 15 }),
      hits: display.add('top-left', { id: 'shooter-hits', draw: drawHits, weight: 0.4 }),
      left: display.add('bottom-left', { id: 'shooter-left', draw: drawHand, state: { side: 'left' } }),
      right: display.add('bottom-right', { id: 'shooter-right', draw: drawHand, state: { side: 'right' } }),
    };
  },

  canFire: function () {
    var now = sceneTime();
    if (state.reloadUntil > now || state.ammo <= 0) return false;
    state.ammo--;
    if (state.ammo === 0) { state.reloadStart = now; state.reloadUntil = now + 1500; }
    return true;
  },

  onHit: function () { state.hits++; },

  tick: function (time, delta) {
    var dt = Math.min(delta || 16, 100) / 1000;
    if (state.reloadUntil && time >= state.reloadUntil) { state.reloadUntil = 0; state.ammo = capacity(); }
    if (time - state.hurtAt > 3000) {
      state.shield = Math.min(100, state.shield + dt * 30);
      state.health = Math.min(100, state.health + dt * 4);
    }
    if (time - state.hurtAt > 600) state.ghost += (state.health - state.ghost) * Math.min(1, dt * 3);
    if (state.ghost < state.health) state.ghost = state.health;

    var camera = hud().sceneEl.camera;
    camera.getWorldDirection(scratch.forward);
    camera.getWorldPosition(scratch.camera);
    var heading = ((Math.atan2(scratch.forward.x, -scratch.forward.z) / DEG) + 360) % 360;
    if (time - lastRadarAt > 60) {
      lastRadarAt = time;
      radarTargets = Array.prototype.map.call(setEl().querySelectorAll('[tour-target]'), function (el) {
        el.object3D.getWorldPosition(scratch.target);
        var dx = scratch.target.x - scratch.camera.x;
        var dz = scratch.target.z - scratch.camera.z;
        var bearing = Math.atan2(dx, -dz) / DEG - heading;
        return { distance: Math.hypot(dx, dz), bearing: bearing };
      });
      widgets.radar.redraw();
    }
    var r = function (v) { return Math.round(v); };
    widgets.shields.set({ shield: r(state.shield), health: r(state.health), ghost: r(state.ghost) });
    widgets.hits.set({ hits: state.hits });
    widgets.compass.set({ heading: Math.round(heading) });
    widgets.left.set(handState('left', time));
    widgets.right.set(handState('right', time));

    var display = hud();
    if (holding('gun')) display.setHint('shooter-gun', { key: actionKey(), text: 'Fire', slot: 'below' });
    else display.clearHint('shooter-gun');
    if (holding('grenade')) {
      display.setHint('shooter-grenade', inXR()
        ? { text: 'Look at a target, then throw', slot: 'below', priority: 2 }
        : { key: 'T', text: 'Throw at target', slot: 'below', priority: 2 });
    } else display.clearHint('shooter-grenade');
    if (state.reloadUntil > time) display.setHint('shooter-reload', { text: 'Reloading', slot: 'above' });
    else display.clearHint('shooter-reload');
  },

  clearHints: function (display) {
    ['shooter-gun', 'shooter-grenade', 'shooter-reload'].forEach(function (id) { display.clearHint(id); });
  },
};

function sceneTime() { return document.querySelector('a-scene').time; }

