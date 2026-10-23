// ============================================================
// FANTASY — a training yard: a wand, a chest, and an orc to practise on.
//
// The HUD is an RPG's: hearts and a mana bar along the bottom, a parchment
// map with north up, the place's name in a banner as you arrive, armour
// while you carry a shield, and — the one that only shows when it means
// something — the orc's own health along the top while you have it
// targeted. The chest is the armoury: grab it to open a menu that changes
// the wand's spell, gives you a shield, and puts potions on the table.
// ============================================================

import { registerMenuPage } from '../../common/menu-crossbar.js';
import {
  HUD_COLORS, drawIcon, drawText, drawBar, drawIconMeter, drawPanel,
} from '../../common/hud-draw.js';
import { hud, heldItem, holding, actionKey, resetProps, targeting, sceneEl } from './tour-core.js';

var THREE = AFRAME.THREE;
var DEG = Math.PI / 180;

var SPELLS = {
  arcane: { label: 'Arcane', colour: '#b98cff', cost: 12, icon: 'sparkles' },
  fire: { label: 'Fire', colour: '#ff7a3c', cost: 20, icon: 'lightning-helix' },
  frost: { label: 'Frost', colour: '#8fd8ff', cost: 15, icon: 'drop' },
};

var state = {
  spell: 'arcane', shield: 'none', potions: 2,
  health: 100, ghost: 100, hurtAt: -1e9, mana: 100, armour: 100,
  orc: 100, orcDownUntil: 0, orcSeenUntil: 0, arrivedAt: 0,
};

registerMenuPage('chest', {
  title: 'ARMOURY',
  items: [
    {
      kind: 'select', id: 'chest-spell', label: 'Wand spell', value: state.spell,
      options: Object.keys(SPELLS).map(function (id) { return { value: id, label: SPELLS[id].label }; }),
      info: ['WAND SPELL', 'What the wand casts, and', 'what it costs: the mana', 'bar shows how many', 'casts you have left.'],
    },
    {
      kind: 'select', id: 'chest-shield', label: 'Shield', value: state.shield,
      options: [{ value: 'none', label: 'None' }, { value: 'shield-round', label: 'Round' }, { value: 'shield-rectangle', label: 'Tower' }],
      info: ['SHIELD', 'Carry one and an armour', 'reading appears top left;', 'it takes hits before your', 'hearts do.'],
    },
    { kind: 'number', id: 'chest-potions', label: 'Potions', value: state.potions, min: 0, max: 3, step: 1 },
  ],
});

function setEl() { return document.querySelector('#set-fantasy'); }

function applyArmoury() {
  var spell = SPELLS[state.spell];
  var wand = document.querySelector('#fantasy-wand');
  wand.setAttribute('tour-gun', { tracer: spell.colour, color: spell.colour });
  wand.querySelector('.fantasy-wand-tip').setAttribute('material', { color: spell.colour, emissive: spell.colour });
  var shield = document.querySelector('#fantasy-shield');
  shield.object3D.visible = state.shield !== 'none';
  shield.setAttribute('hint-zone', 'enabled', state.shield !== 'none');
  if (state.shield !== 'none') shield.querySelector('.fantasy-shield-model').setAttribute('gltf-model', '../../assets/models/kenney/mini-dungeon/' + state.shield + '.glb');
  document.querySelectorAll('.fantasy-potion').forEach(function (el, i) {
    var show = i < state.potions;
    el.object3D.visible = show;
    el.setAttribute('hint-zone', 'enabled', show);
  });
}

function onChest(evt) {
  var id = evt.detail.id;
  var v = evt.detail.value;
  if (id === 'chest-spell') state.spell = v;
  else if (id === 'chest-shield') state.shield = v;
  else if (id === 'chest-potions') state.potions = v;
  else return;
  applyArmoury();
}

// ---------- the HUD ----------

var widgets = {};

function drawHearts(ctx, box) {
  drawIconMeter(ctx, 'hearts', 4, 18, box.w - 8, 64, box.state.health / 20, 5, { color: HUD_COLORS.danger });
}

function drawMana(ctx, box) {
  drawIcon(ctx, 'lightning-helix', 28, 50, 44, { color: '#9ec2ff' });
  drawBar(ctx, 56, 34, box.w - 64, 30, box.state.mana / 100, { segments: 5, skew: 6, color: '#5d8cff' });
}

function drawBanner(ctx, box) {
  drawText(ctx, box.state.name, box.w / 2, 52, { size: 54, align: 'center', face: 'heading', weight: 900, maxWidth: box.w - 12 });
}

// The target's own health: only while you have it bracketed.
function drawEnemy(ctx, box) {
  var s = box.state;
  var width = Math.min(box.w * 0.5, 360);
  var x = (box.w - width) / 2;
  drawIcon(ctx, 'death-skull', x - 26, 50, 36, { color: HUD_COLORS.danger });
  drawText(ctx, s.down ? 'Orc — down' : 'Training orc', x, 22, { size: 22, align: 'left', color: HUD_COLORS.text });
  drawBar(ctx, x, 42, width, 22, s.orc / 100, { segments: 4, skew: 6, color: HUD_COLORS.danger });
}

function drawArmour(ctx, box) {
  drawIcon(ctx, 'breastplate', 22, 30, 36);
  drawText(ctx, Math.round(box.state.armour) + '%', 44, 30, { size: 28, align: 'left', maxWidth: box.w - 48 });
}

var mapMarks = { me: { x: 0, z: 0, heading: 0 }, marks: [] };
function drawParchment(ctx, box) {
  var w = box.w;
  var h = box.h;
  drawPanel(ctx, 2, 2, w - 4, h - 4, { radius: 6, fill: 'rgba(36, 28, 14, 0.55)', stroke: 'rgba(230, 200, 140, 0.6)' });
  var scale = (w - 16) / 10; // ten metres across
  var cx = w / 2;
  var cy = h / 2;
  mapMarks.marks.forEach(function (m) {
    ctx.beginPath();
    ctx.arc(cx + (m.x - mapMarks.me.x) * scale, cy + (m.z - mapMarks.me.z) * scale, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = m.colour;
    ctx.fill();
  });
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(mapMarks.me.heading * DEG);
  ctx.beginPath();
  ctx.moveTo(0, -8); ctx.lineTo(5.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-5.5, 6);
  ctx.closePath();
  ctx.fillStyle = HUD_COLORS.accent;
  ctx.fill();
  ctx.restore();
  drawText(ctx, 'N', cx, 12, { size: 11, align: 'center', color: HUD_COLORS.warn });
}

function drawHand(ctx, box) {
  var s = box.state;
  if (!s.kind) return;
  var right = s.side === 'right';
  var w = box.w;
  var iconX = right ? w - 26 : 26;
  if (s.kind === 'wand') {
    drawIcon(ctx, 'crystal-wand', iconX, 28, 42, { color: s.colour });
    drawIcon(ctx, s.icon, right ? w - 22 : 22, 74, 28, { color: s.colour });
    drawText(ctx, '×' + s.casts, right ? w - 44 : 44, 74, { size: 30, align: right ? 'right' : 'left', color: s.casts ? HUD_COLORS.text : HUD_COLORS.danger });
  } else if (s.kind === 'potion') {
    drawIcon(ctx, 'magic-potion', iconX, 34, 52, { color: '#9ec2ff' });
    drawText(ctx, 'Mana', right ? w - 6 : 6, 80, { size: 20, align: right ? 'right' : 'left', color: HUD_COLORS.muted });
  } else if (s.kind === 'shield') {
    drawIcon(ctx, 'checked-shield', iconX, 34, 52);
  }
}

function handState(side) {
  var held = heldItem(side);
  var spell = SPELLS[state.spell];
  return {
    side: side, kind: held ? held.kind : '',
    colour: spell.colour, icon: spell.icon, casts: Math.floor(state.mana / spell.cost),
  };
}

// ---------- the demo ----------

var scratch = { forward: new THREE.Vector3(), camera: new THREE.Vector3(), v: new THREE.Vector3() };
var lastMapAt = -Infinity;

export default {
  id: 'fantasy',
  label: 'Fantasy',
  title: 'FANTASY',
  blurb: ['FANTASY', 'A training yard with a', 'wand, potions, and an', 'orc to practise on.', '', 'Hearts, a mana bar, a', 'map, and the orc\'s own', 'health while you aim at', 'it. A chest opens the', 'armoury menu.'],

  rows: function () {
    return [
      { kind: 'info', id: 'fantasy-f-hearts', label: 'Hearts and mana', info: ['HEARTS AND MANA', 'Along the bottom. Each', 'cast spends mana; a', 'potion puts it back.'] },
      { kind: 'action', id: 'fantasy-hit', label: 'Let the orc swing', info: ['TAKE A HIT', 'The orc swings back.', 'A shield takes it first:', 'watch the armour top', 'left, then your hearts.'] },
      { kind: 'info', id: 'fantasy-f-target', label: 'Target health', info: ['TARGET HEALTH', 'Hold the wand and aim at', 'the orc: its health bar', 'appears along the top,', 'and goes again when you', 'look away. A readout', 'that only shows when it', 'means something.'] },
      { kind: 'info', id: 'fantasy-f-banner', label: 'Place banner', info: ['PLACE BANNER', 'Where you are, in the', 'heading face, as you', 'arrive; then it fades.'] },
      { kind: 'info', id: 'fantasy-f-map', label: 'Parchment map', info: ['MAP', 'Top right, north up, you', 'as the arrow. The orc in', 'red, the chest in gold.'] },
      { kind: 'info', id: 'fantasy-f-chest', label: 'The armoury chest', info: ['THE CHEST', 'Beside the table. Grab', 'it to open the armoury:', 'the wand\'s spell, a', 'shield, potions.'] },
      { kind: 'action', id: 'fantasy-reset', label: 'Reset the yard' },
    ];
  },

  onAction: function (id) {
    if (id === 'fantasy-hit') {
      var damage = 30;
      if (state.shield !== 'none' && state.armour > 0) {
        var absorbed = Math.min(state.armour, damage * 0.7);
        state.armour -= absorbed;
        damage -= absorbed;
      }
      state.health = Math.max(10, state.health - damage);
      state.hurtAt = sceneEl().time;
    } else if (id === 'fantasy-reset') {
      resetProps(setEl());
      state.mana = 100;
      state.health = 100;
      state.armour = 100;
      state.orc = 100;
      state.orcDownUntil = 0;
    }
  },

  enter: function () {
    document.addEventListener('menu-commit', onChest);
    document.addEventListener('menu-preview', onChest);
    applyArmoury();
    state.arrivedAt = sceneEl().time;
  },

  exit: function () {
    document.removeEventListener('menu-commit', onChest);
    document.removeEventListener('menu-preview', onChest);
    resetProps(setEl());
    var pm = document.querySelector('#fantasy-chest').components['projected-menu'];
    if (pm) pm.close();
  },

  hud: function (display) {
    widgets = {
      hearts: display.add('bottom', { id: 'fantasy-hearts', draw: drawHearts }),
      mana: display.add('bottom', { id: 'fantasy-mana', draw: drawMana, order: 1, weight: 1.2 }),
      banner: display.add('top', { id: 'fantasy-banner', draw: drawBanner, state: { name: 'The Training Yard' } }),
      enemy: display.add('top', { id: 'fantasy-enemy', draw: drawEnemy, fade: false, visible: false }),
      armour: display.add('top-left', { id: 'fantasy-armour', draw: drawArmour, weight: 0.4, visible: false }),
      map: display.add('top-right', { id: 'fantasy-map', draw: drawParchment, fade: false, fps: 15 }),
      left: display.add('bottom-left', { id: 'fantasy-left', draw: drawHand, state: { side: 'left' } }),
      right: display.add('bottom-right', { id: 'fantasy-right', draw: drawHand, state: { side: 'right' } }),
    };
  },

  canFire: function () {
    var cost = SPELLS[state.spell].cost;
    if (state.mana < cost) return false;
    state.mana -= cost;
    return true;
  },

  onHit: function (el) {
    if (el.id !== 'fantasy-orc' || state.orcDownUntil) return;
    state.orc = Math.max(0, state.orc - (state.spell === 'fire' ? 40 : 25));
    state.orcSeenUntil = sceneEl().time + 4000;
    if (state.orc === 0) state.orcDownUntil = sceneEl().time + 3000;
  },

  onDrink: function (el) {
    if (!el.object3D.visible) return;
    state.mana = Math.min(100, state.mana + 50);
    state.health = Math.min(100, state.health + 20);
    // A potion is used up: out of your hand (so its trigger stops
    // listening) and back in the chest.
    var body = el.components['simple-grabbable'];
    if (body.state === 'held') body.release(body.handEl);
    body.resetToSpawn();
    state.potions = Math.max(0, state.potions - 1);
    applyArmoury();
  },

  tick: function (time, delta) {
    var dt = Math.min(delta || 16, 100) / 1000;
    state.mana = Math.min(100, state.mana + dt * 3);
    if (time - state.hurtAt > 600) state.ghost += (state.health - state.ghost) * Math.min(1, dt * 3);
    if (state.ghost < state.health) state.ghost = state.health;
    // The orc falls over, then gets back up.
    var orc = document.querySelector('#fantasy-orc .tour-face');
    if (state.orcDownUntil) {
      orc.object3D.rotation.x = Math.min(Math.PI / 2, orc.object3D.rotation.x + dt * 4);
      if (time > state.orcDownUntil) { state.orcDownUntil = 0; state.orc = 100; orc.object3D.rotation.x = 0; }
    }

    // The orc's bar: while a wand lock is on it, or for a moment after a hit.
    var lock = holding('wand') && targeting().getLock('gun-fantasy-wand');
    var onOrc = lock && lock.el.id === 'fantasy-orc';
    if (onOrc) state.orcSeenUntil = time + 1500;
    widgets.enemy.show(state.orcSeenUntil > time);
    widgets.enemy.set({ orc: Math.round(state.orc), down: Boolean(state.orcDownUntil) });
    widgets.banner.show(time - state.arrivedAt < 5000 && !(state.orcSeenUntil > time));
    widgets.armour.show(state.shield !== 'none');
    widgets.armour.set({ armour: Math.round(state.armour) });
    widgets.hearts.set({ health: Math.round(state.health / 2) * 2 });
    widgets.mana.set({ mana: Math.round(state.mana) });
    widgets.left.set(handState('left'));
    widgets.right.set(handState('right'));

    if (time - lastMapAt > 66) {
      lastMapAt = time;
      var camera = sceneEl().camera;
      camera.getWorldPosition(scratch.camera);
      camera.getWorldDirection(scratch.forward);
      mapMarks.me = { x: scratch.camera.x, z: scratch.camera.z, heading: Math.atan2(scratch.forward.x, -scratch.forward.z) / DEG };
      mapMarks.marks = [['#fantasy-orc', HUD_COLORS.danger], ['#fantasy-chest', HUD_COLORS.warn]].map(function (m) {
        document.querySelector(m[0]).object3D.getWorldPosition(scratch.v);
        return { x: scratch.v.x, z: scratch.v.z, colour: m[1] };
      });
      widgets.map.redraw();
    }

    var display = hud();
    if (holding('wand')) display.setHint('fantasy-wand', { key: actionKey(), text: 'Cast ' + SPELLS[state.spell].label, slot: 'below' });
    else display.clearHint('fantasy-wand');
    if (holding('potion')) display.setHint('fantasy-potion', { key: actionKey(), text: 'Drink', slot: 'below', priority: 1 });
    else display.clearHint('fantasy-potion');
  },

  clearHints: function (display) {
    display.clearHint('fantasy-wand');
    display.clearHint('fantasy-potion');
  },
};
