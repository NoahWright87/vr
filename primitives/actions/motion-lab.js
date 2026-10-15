// ============================================================
// MOTION LAB — the Action Lab's first station.
//
// Shows what common/motion-sense.js reads from your body, live, and
// its numbers are visor rows (Tuning > Motion, from motion-sense
// itself). It's for tuning by feel: stand still and watch energy stay
// down, throw a jab and watch it jump, reach for the visor and check it
// doesn't.
// ============================================================

import { describeMotion } from '../../common/motion-sense.js';

// ---------- the panel ----------

var PANEL_W = 1.3;
var BAR_W = 0.8;
var BAR_H = 0.05;
var REST_COLOR = '#8aa0c8';
var PRESENTED_COLOR = '#5fe08a';

function makeBar(parent, y, label, color) {
  var row = document.createElement('a-entity');
  row.setAttribute('position', '0 ' + y + ' 0.01');
  var text = document.createElement('a-text');
  text.setAttribute('value', label);
  text.setAttribute('align', 'right');
  text.setAttribute('color', '#cfe0ff');
  text.setAttribute('width', 0.9);
  text.setAttribute('position', (-BAR_W / 2 - 0.03) + ' 0 0');
  var track = document.createElement('a-plane');
  track.setAttribute('width', BAR_W);
  track.setAttribute('height', BAR_H);
  track.setAttribute('color', '#1b2233');
  track.setAttribute('shader', 'flat');
  var fill = document.createElement('a-plane');
  fill.setAttribute('width', BAR_W);
  fill.setAttribute('height', BAR_H);
  fill.setAttribute('color', color);
  fill.setAttribute('shader', 'flat');
  fill.setAttribute('position', '0 0 0.002');
  row.appendChild(text);
  row.appendChild(track);
  row.appendChild(fill);
  parent.appendChild(row);
  return { fill: fill, row: row };
}

// A thin vertical line on a bar, for a threshold.
function makeTick(bar, color) {
  var tick = document.createElement('a-plane');
  tick.setAttribute('width', 0.006);
  tick.setAttribute('height', BAR_H * 1.6);
  tick.setAttribute('color', color);
  tick.setAttribute('shader', 'flat');
  tick.setAttribute('position', '0 0 0.004');
  bar.row.appendChild(tick);
  return tick;
}

function setBar(bar, value) {
  var v = Math.max(0, Math.min(1, value));
  var o = bar.fill.object3D;
  o.scale.x = Math.max(v, 0.0001);
  o.position.x = -BAR_W / 2 + (BAR_W * v) / 2;
}

function setTick(tick, value) {
  tick.object3D.position.x = -BAR_W / 2 + BAR_W * Math.max(0, Math.min(1, value));
}

AFRAME.registerComponent('motion-lab', {
  schema: {
    rig: { type: 'selector' },
    textHz: { default: 10 },
  },

  init: function () {
    var el = this.el;
    var plate = document.createElement('a-plane');
    plate.setAttribute('width', PANEL_W);
    plate.setAttribute('height', 0.95);
    plate.setAttribute('color', '#0b1020');
    plate.setAttribute('opacity', 0.85);
    plate.setAttribute('shader', 'flat');
    plate.setAttribute('position', '0.1 -0.2 0');
    el.appendChild(plate);

    // Speed bars run to 2x "full" so a hard punch still shows headroom;
    // extension bars to 120% so full reach isn't pinned at the end.
    this.bars = {
      energy: makeBar(el, 0.18, 'Energy', '#ffb547'),
      leftSpeed: makeBar(el, 0.08, 'L speed', '#7fb2ff'),
      rightSpeed: makeBar(el, 0.0, 'R speed', '#7fb2ff'),
      leftForward: makeBar(el, -0.1, 'L reach', '#b58cff'),
      rightForward: makeBar(el, -0.18, 'R reach', '#b58cff'),
    };
    this.ticks = {
      leftOn: makeTick(this.bars.leftForward, PRESENTED_COLOR),
      rightOn: makeTick(this.bars.rightForward, PRESENTED_COLOR),
      leftFull: makeTick(this.bars.leftSpeed, '#ffffff'),
      rightFull: makeTick(this.bars.rightSpeed, '#ffffff'),
    };

    this.text = document.createElement('a-text');
    this.text.setAttribute('align', 'left');
    this.text.setAttribute('color', '#ffd27a');
    this.text.setAttribute('width', 1.1);
    this.text.setAttribute('wrap-count', 60);
    this.text.setAttribute('anchor', 'left');
    this.text.setAttribute('baseline', 'top');
    this.text.setAttribute('position', '-0.5 -0.27 0.01');
    el.appendChild(this.text);

    this.markers = {
      left: document.querySelector('#left-hand .hand-marker'),
      right: document.querySelector('#right-hand .hand-marker'),
    };
    this.presented = { left: null, right: null };
    this.sinceText = Infinity;
  },

  sense: function () {
    var rig = this.data.rig;
    return rig && rig.components['motion-sense'];
  },

  tick: function (time, dt) {
    var sense = this.sense();
    if (!sense) return;
    var state = sense.state;
    var s = state.settings;
    var speedScale = 2 * s.handFull;

    setBar(this.bars.energy, state.energy);
    setBar(this.bars.leftSpeed, state.left.relativeSpeed / speedScale);
    setBar(this.bars.rightSpeed, state.right.relativeSpeed / speedScale);
    setBar(this.bars.leftForward, state.left.extension.forward / 1.2);
    setBar(this.bars.rightForward, state.right.extension.forward / 1.2);
    setTick(this.ticks.leftOn, s.presentOn / 1.2);
    setTick(this.ticks.rightOn, s.presentOn / 1.2);
    setTick(this.ticks.leftFull, s.handFull / speedScale);
    setTick(this.ticks.rightFull, s.handFull / speedScale);

    ['left', 'right'].forEach(function (side) {
      var presented = state[side].presented;
      var marker = this.markers[side];
      if (marker && presented !== this.presented[side]) {
        marker.setAttribute('color', presented ? PRESENTED_COLOR : REST_COLOR);
      }
      this.presented[side] = presented;
    }, this);

    // Text is an SDF mesh rebuild, so not every frame.
    this.sinceText += dt || 0;
    if (this.sinceText < 1000 / this.data.textHz) return;
    this.sinceText = 0;
    var text = describeMotion(state);
    this.text.setAttribute('value', text);
  },
});
