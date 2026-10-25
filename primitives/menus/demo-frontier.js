// ============================================================
// FRONTIER — a saloon table, a fence of bottles, and a wanted board.
//
// A western's HUD: a six-shooter's cylinder in your gun hand's corner,
// hearts and a whisky glass along the bottom, the bounty you have earned
// and a pocket watch up top. The wanted board is a menu of bounties; pick
// one and the sheriff briefs you — a talking portrait in the corner of
// your visor, with his words typed out along the top, the way a strategy
// game or a sci-fi shooter puts someone on your comms.
// ============================================================

import { registerMenuPage } from '../../common/menu-crossbar.js';
import {
  HUD_COLORS, drawIcon, drawText, drawBar, drawAmmo, drawIconMeter, roundRect,
} from '../../common/hud-draw.js';
import { hud, heldItem, holding, actionKey, resetProps, sceneEl } from './tour-core.js';

var BOUNTIES = {
  bart: { label: 'Black Bart', reward: 500, line: 'Black Bart held up the noon stage and shot the driver. Five hundred dollars, and I want him breathing.' },
  kate: { label: 'Calamity Kate', reward: 300, line: 'Calamity Kate cleaned out the bank in Dry Creek. Three hundred. She shoots first, so you had better.' },
  doc: { label: 'Doc Hollow', reward: 250, line: 'Doc Hollow sold half this town snake oil. Two hundred fifty, and bring back the money.' },
};

var state = {
  ammo: 6, reloadUntil: 0, reloadStart: 0,
  health: 100, drunk: 0, bounty: 0, bottles: 0,
  talk: null, talkStart: 0, talkUntil: 0,
};

registerMenuPage('wanted', {
  title: 'WANTED',
  items: Object.keys(BOUNTIES).map(function (id) {
    var b = BOUNTIES[id];
    return {
      kind: 'action', id: 'wanted-' + id, label: b.label + ' $' + b.reward,
      info: ['WANTED', b.label.toUpperCase(), '$' + b.reward + ' reward', '', 'Take it, and the sheriff', 'briefs you over the', 'visor.'],
    };
  }),
});

function setEl() { return document.querySelector('#set-frontier'); }

function onWanted(evt) {
  var id = evt.detail.id;
  if (id.indexOf('wanted-') !== 0) return;
  var bounty = BOUNTIES[id.slice('wanted-'.length)];
  if (!bounty) return;
  var now = sceneEl().time;
  state.talk = bounty;
  state.talkStart = now;
  // A reading pace, then a few seconds to finish reading it.
  state.talkUntil = now + bounty.line.length * 45 + 3000;
}

// ---------- the HUD ----------

var widgets = {};

function talkProgress(time) {
  if (!state.talk) return { chars: 0, talking: false };
  var chars = Math.min(state.talk.line.length, Math.floor((time - state.talkStart) / 45));
  return { chars: chars, talking: chars < state.talk.line.length };
}

// The sheriff: drawn, not a picture, so his mouth can move while he talks
// and his eyes can blink.
function drawPortrait(ctx, box) {
  var w = box.w;
  var h = box.h;
  var s = box.state;
  roundRect(ctx, 3, 3, w - 6, h - 6, 8);
  ctx.fillStyle = 'rgba(40, 26, 14, 0.75)';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = 'rgba(230, 190, 120, 0.8)';
  ctx.stroke();
  var cx = w / 2;
  var cy = h * 0.52;
  // Shoulders, coat.
  ctx.fillStyle = '#5a3a22';
  ctx.beginPath();
  ctx.ellipse(cx, h * 0.98, w * 0.36, h * 0.24, 0, Math.PI, 0);
  ctx.fill();
  // The star.
  drawIcon(ctx, 'sparkles', cx - w * 0.16, h * 0.86, 12, { color: HUD_COLORS.warn, outline: false });
  // Face.
  ctx.fillStyle = '#e0aa7e';
  ctx.beginPath();
  ctx.ellipse(cx, cy, w * 0.2, h * 0.25, 0, 0, Math.PI * 2);
  ctx.fill();
  // Hat: brim and crown.
  ctx.fillStyle = '#3b2717';
  ctx.beginPath();
  ctx.ellipse(cx, cy - h * 0.2, w * 0.36, h * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  roundRect(ctx, cx - w * 0.17, cy - h * 0.4, w * 0.34, h * 0.2, 6);
  ctx.fill();
  // Eyes, which blink.
  ctx.fillStyle = '#1d140c';
  var blink = s.blink ? 0.6 : 3;
  ctx.fillRect(cx - w * 0.1 - 2, cy - h * 0.04, 5, blink);
  ctx.fillRect(cx + w * 0.1 - 3, cy - h * 0.04, 5, blink);
  // Moustache.
  ctx.fillStyle = '#6b4a2e';
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.07, w * 0.12, h * 0.03, 0, 0, Math.PI * 2);
  ctx.fill();
  // Mouth: open and shut while he talks.
  ctx.fillStyle = '#4a1d14';
  ctx.beginPath();
  ctx.ellipse(cx, cy + h * 0.13, w * 0.06, Math.max(1, h * 0.04 * s.mouth), 0, 0, Math.PI * 2);
  ctx.fill();
  drawText(ctx, 'SHERIFF', cx, h - 12, { size: 13, align: 'center', color: 'rgba(240, 220, 180, 0.95)' });
}

function drawSubtitle(ctx, box) {
  var s = box.state;
  if (!s.text) {
    drawText(ctx, 'Main Street', box.w / 2, 52, { size: 54, align: 'center', face: 'heading', weight: 900, maxWidth: box.w - 12 });
    return;
  }
  // The line typed out so far, in two rows if it needs them.
  var words = s.text.split(' ');
  var rows = [''];
  ctx.font = '700 26px "B612", system-ui, sans-serif';
  words.forEach(function (word) {
    var row = rows[rows.length - 1];
    var next = row ? row + ' ' + word : word;
    if (ctx.measureText(next).width > box.w - 20 && row) rows.push(word);
    else rows[rows.length - 1] = next;
  });
  rows = rows.slice(-2);
  rows.forEach(function (row, i) {
    drawText(ctx, row, box.w / 2, rows.length === 1 ? 50 : 30 + i * 40, { size: 26, align: 'center', color: '#f4e2c0' });
  });
}

function drawBounty(ctx, box) {
  drawIcon(ctx, 'wanted-reward', 22, 30, 36, { color: HUD_COLORS.warn });
  drawText(ctx, '$' + box.state.bounty, 44, 30, { size: 28, align: 'left', maxWidth: box.w - 48 });
}

function drawClock(ctx, box) {
  drawIcon(ctx, 'pocket-watch', 22, 30, 36);
  drawText(ctx, box.state.text, 44, 30, { size: 28, align: 'left', maxWidth: box.w - 48 });
}

function drawHearts(ctx, box) {
  drawIconMeter(ctx, 'hearts', 4, 18, box.w - 8, 64, box.state.health / 20, 5, { color: HUD_COLORS.danger });
}

function drawWhisky(ctx, box) {
  var drunk = box.state.drunk;
  drawIcon(ctx, 'glass-shot', 26, 50, 44, { color: drunk > 0.66 ? HUD_COLORS.warn : HUD_COLORS.text });
  drawBar(ctx, 54, 36, box.w - 62, 26, drunk, { segments: 3, skew: 6, color: '#e2a14a' });
}

function drawHand(ctx, box) {
  var s = box.state;
  if (!s.kind) return;
  var right = s.side === 'right';
  var w = box.w;
  var iconX = right ? w - 26 : 26;
  if (s.kind === 'revolver') {
    drawIcon(ctx, 'revolver', iconX, 26, 40);
    if (s.reload >= 0) {
      drawText(ctx, 'RELOAD', right ? w - 4 : 4, 66, { size: 20, align: right ? 'right' : 'left', color: HUD_COLORS.warn });
      drawBar(ctx, 4, 82, w - 8, 9, s.reload, { color: HUD_COLORS.warn, reverse: right });
    } else {
      // Six or fewer: every round in the cylinder, spent ones dim.
      drawAmmo(ctx, 4, 50, w - 8, 40, s.count, 6, { align: right ? 'right' : 'left' });
    }
  } else if (s.kind === 'whisky') {
    drawIcon(ctx, 'brandy-bottle', iconX, 34, 52, { color: '#e2a14a' });
    drawText(ctx, 'Whisky', right ? w - 6 : 6, 80, { size: 20, align: right ? 'right' : 'left', color: HUD_COLORS.muted });
  }
}

function handState(side, time) {
  var held = heldItem(side);
  return {
    side: side, kind: held ? held.kind : '', count: state.ammo,
    reload: state.reloadUntil > time ? Math.round((time - state.reloadStart) / (state.reloadUntil - state.reloadStart) * 20) / 20 : -1,
  };
}

// ---------- the demo ----------

export default {
  id: 'frontier',
  label: 'Frontier',
  title: 'FRONTIER',
  blurb: ['FRONTIER', 'A saloon table, a fence', 'of bottles, and a wanted', 'board.', '', 'A six-shooter\'s cylinder,', 'a whisky glass, a pocket', 'watch, and a sheriff who', 'talks to you from the', 'corner of your visor.'],

  rows: function () {
    return [
      { kind: 'info', id: 'frontier-f-portrait', label: 'Talking portrait', info: ['TALKING PORTRAIT', 'Take a bounty from the', 'wanted board: the sheriff', 'appears top left and', 'talks, his words typed', 'out along the top.'] },
      { kind: 'info', id: 'frontier-f-cylinder', label: 'Six-shooter cylinder', info: ['THE CYLINDER', 'Six rounds or fewer show', 'as the rounds themselves,', 'spent ones dim. Shoot', 'the bottles on the fence.'] },
      { kind: 'info', id: 'frontier-f-whisky', label: 'Whisky glass', info: ['WHISKY', 'Drink from the bottle', '(trigger, or hold it to', 'your mouth): the glass', 'fills, then empties as', 'it wears off.'] },
      { kind: 'info', id: 'frontier-f-bounty', label: 'Bounty and watch', info: ['BOUNTY AND WATCH', 'Top left: dollars earned,', 'ten a bottle. Top right:', 'the real time, on a', 'pocket watch.'] },
      { kind: 'info', id: 'frontier-f-board', label: 'The wanted board', info: ['THE WANTED BOARD', 'Beside the table. Grab', 'it: each poster is a', 'row, with the reward in', 'the sidecar.'] },
      { kind: 'action', id: 'frontier-reset', label: 'Set up the bottles' },
    ];
  },

  onAction: function (id) {
    if (id !== 'frontier-reset') return;
    resetProps(setEl());
    setEl().querySelectorAll('.frontier-bottle').forEach(function (el) { el.object3D.visible = true; });
    state.ammo = 6;
    state.reloadUntil = 0;
  },

  enter: function () {
    document.addEventListener('menu-action', onWanted);
  },

  exit: function () {
    document.removeEventListener('menu-action', onWanted);
    resetProps(setEl());
    state.talk = null;
    var pm = document.querySelector('#frontier-board').components['projected-menu'];
    if (pm) pm.close();
  },

  hud: function (display) {
    widgets = {
      portrait: display.add('top-left', { id: 'frontier-portrait', draw: drawPortrait, weight: 2.2, fade: false, fps: 12, visible: false }),
      bounty: display.add('top-left', { id: 'frontier-bounty', draw: drawBounty, order: 1, weight: 0.8 }),
      subtitle: display.add('top', { id: 'frontier-subtitle', draw: drawSubtitle }),
      clock: display.add('top-right', { id: 'frontier-clock', draw: drawClock, weight: 0.4, fps: 1 }),
      hearts: display.add('bottom', { id: 'frontier-hearts', draw: drawHearts }),
      whisky: display.add('bottom', { id: 'frontier-whisky', draw: drawWhisky, order: 1, weight: 0.8 }),
      left: display.add('bottom-left', { id: 'frontier-left', draw: drawHand, state: { side: 'left' } }),
      right: display.add('bottom-right', { id: 'frontier-right', draw: drawHand, state: { side: 'right' } }),
    };
  },

  canFire: function () {
    var now = sceneEl().time;
    if (state.reloadUntil > now || state.ammo <= 0) return false;
    state.ammo--;
    if (state.ammo === 0) { state.reloadStart = now; state.reloadUntil = now + 1800; }
    return true;
  },

  onHit: function (el) {
    if (!el.classList.contains('frontier-bottle')) return;
    // Shattered: gone for a few seconds.
    el.object3D.visible = false;
    state.bounty += 10;
    setTimeout(function () { el.object3D.visible = true; }, 4000);
  },

  onDrink: function () {
    state.drunk = Math.min(1, state.drunk + 0.25);
    state.health = Math.min(100, state.health + 10);
  },

  tick: function (time, delta) {
    var dt = Math.min(delta || 16, 100) / 1000;
    if (state.reloadUntil && time >= state.reloadUntil) { state.reloadUntil = 0; state.ammo = 6; }
    state.drunk = Math.max(0, state.drunk - dt * 0.02);

    var talk = talkProgress(time);
    var speaking = Boolean(state.talk) && time < state.talkUntil;
    if (!speaking && state.talk && time >= state.talkUntil) state.talk = null;
    widgets.portrait.show(speaking);
    if (speaking) {
      widgets.portrait.set({
        // The mouth flaps while words are still coming.
        mouth: talk.talking ? Math.round((0.5 + 0.5 * Math.sin(time / 70)) * 4) / 4 : 0,
        blink: (time % 3200) < 140,
      });
    }
    widgets.subtitle.set({ text: speaking ? state.talk.line.slice(0, talk.chars) : '' });
    widgets.bounty.set({ bounty: state.bounty });
    var now = new Date();
    widgets.clock.set({ text: now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') });
    widgets.hearts.set({ health: Math.round(state.health / 2) * 2 });
    widgets.whisky.set({ drunk: Math.round(state.drunk * 50) / 50 });
    widgets.left.set(handState('left', time));
    widgets.right.set(handState('right', time));

    var display = hud();
    if (holding('revolver')) display.setHint('frontier-revolver', { key: actionKey(), text: 'Fire', slot: 'below' });
    else display.clearHint('frontier-revolver');
    if (holding('whisky')) display.setHint('frontier-whisky', { key: actionKey(), text: 'Drink', slot: 'below', priority: 1 });
    else display.clearHint('frontier-whisky');
    if (state.reloadUntil > time) display.setHint('frontier-reload', { text: 'Reloading', slot: 'above' });
    else display.clearHint('frontier-reload');
  },

  clearHints: function (display) {
    ['frontier-revolver', 'frontier-whisky', 'frontier-reload'].forEach(function (id) { display.clearHint(id); });
  },
};
