// ============================================================
// ACTION FEEDBACK — named haptic patterns and synthesized sounds.
//
//   import { haptic, sound } from '../common/action-feedback.js';
//   haptic(handEl, 'hit-heavy');
//   sound('clang', worldPoint);
//
// Haptics go through common/haptics.js (which handles both Quest
// actuator APIs). Hand tracking has no haptics, so nothing may depend
// on them — they only ever add to what's seen and heard.
//
// Sounds (shot, boom, click, thump, clang, shatter, block, parry,
// whoosh) are synthesized with Web Audio, the way Pistols at Dawn does
// it: no assets. A voice cap keeps autofire from spawning hundreds of
// nodes, and positional sounds go through a PannerNode whose listener
// follows the camera.
// ============================================================

import { pulseHaptics } from './haptics.js';
import { defineTunables } from './tunables.js';

// Each pattern is a list of [intensity 0..1, duration ms] pulses; an
// intensity of 0 is a gap.
export var HAPTIC_PATTERNS = {
  shot: [[0.3, 22]],
  'hit-light': [[0.45, 30]],
  'hit-heavy': [[1, 55], [0, 25], [0.5, 40]],
  block: [[0.75, 45]],
  parry: [[1, 30], [0, 35], [1, 45]],
  kill: [[0.6, 40], [0, 30], [0.9, 80]],
  threat: [[0.3, 35], [0, 60], [0.3, 35]],
  hurt: [[1, 120]],
};

// Pulses as { at, intensity, duration } with start times, scaled.
export function scheduleHaptic(name, strength) {
  var pattern = HAPTIC_PATTERNS[name];
  if (!pattern) return [];
  var out = [];
  var at = 0;
  pattern.forEach(function (step) {
    var intensity = Math.min(1, step[0] * (strength === undefined ? 1 : strength));
    if (intensity > 0) out.push({ at: at, intensity: intensity, duration: step[1] });
    at += step[1];
  });
  return out;
}

var tune = defineTunables('feedback', 'Feedback', [
  { key: 'volume', label: 'Volume', value: 0.7, min: 0, max: 100, step: 5, unit: '%', scale: 100 },
  { key: 'haptics', label: 'Haptics', value: 1, min: 0, max: 200, step: 10, unit: '%', scale: 100 },
  { key: 'sound', label: 'Sound', kind: 'toggle', value: true },
], function (values) {
  if (master) master.gain.value = values.volume;
});

export function haptic(handEl, name, strength) {
  if (!handEl) return;
  var scale = tune.values.haptics * (strength === undefined ? 1 : strength);
  if (scale <= 0) return;
  scheduleHaptic(name, scale).forEach(function (pulse) {
    if (pulse.at === 0) pulseHaptics(handEl, pulse.intensity, pulse.duration);
    else setTimeout(function () { pulseHaptics(handEl, pulse.intensity, pulse.duration); }, pulse.at);
  });
}

// ---------- sound ----------

var ctx = null;
var master = null;
var noise = null;
var voices = 0;
var MAX_VOICES = 24;

function audio() {
  if (ctx) return ctx;
  var AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = tune.values.volume;
  master.connect(ctx.destination);
  // One second of white noise, reused by every noisy sound.
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  var data = noise.getChannelData(0);
  for (var i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return ctx;
}

// Browsers only start audio after a user gesture.
if (typeof document !== 'undefined') {
  var unlock = function () {
    var c = audio();
    if (c && c.state === 'suspended') c.resume();
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (type) { document.addEventListener(type, unlock, { capture: true }); });
  document.addEventListener('enter-vr', unlock, true);
}

// Where a sound goes: a panner at `position`, or straight to master.
function output(c, position) {
  if (!position) return master;
  var panner = c.createPanner();
  panner.panningModel = 'equalpower';
  panner.distanceModel = 'inverse';
  panner.refDistance = 1.5;
  panner.rolloffFactor = 0.8;
  if (panner.positionX) {
    panner.positionX.value = position.x; panner.positionY.value = position.y; panner.positionZ.value = position.z;
  } else {
    panner.setPosition(position.x, position.y, position.z);
  }
  panner.connect(master);
  return panner;
}

function envelope(c, node, t, peak, attack, decay) {
  var g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  node.connect(g);
  return g;
}

function noiseBurst(c, out, t, type, freq, q, peak, decay) {
  var src = c.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  var filter = c.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  src.connect(filter);
  envelope(c, filter, t, peak, 0.002, decay).connect(out);
  src.start(t, Math.random() * 0.5, decay + 0.05);
  return src;
}

function tone(c, out, t, type, f0, f1, peak, decay) {
  var osc = c.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, t + decay);
  envelope(c, osc, t, peak, 0.003, decay).connect(out);
  osc.start(t);
  osc.stop(t + decay + 0.05);
  return osc;
}

var SOUNDS = {
  shot: function (c, out, t) {
    tone(c, out, t, 'sine', 140, 45, 0.6, 0.09);
    return noiseBurst(c, out, t, 'bandpass', 1400 + Math.random() * 300, 0.7, 0.9, 0.12);
  },
  thump: function (c, out, t) {
    noiseBurst(c, out, t, 'lowpass', 700, 0.7, 0.5, 0.06);
    return tone(c, out, t, 'sine', 160, 50, 0.9, 0.14);
  },
  clang: function (c, out, t) {
    var last;
    [520, 1310, 2150].forEach(function (f, i) {
      last = tone(c, out, t, 'sine', f * (0.97 + Math.random() * 0.06), 0, 0.25 / (i + 1), 0.5 - i * 0.12);
    });
    noiseBurst(c, out, t, 'highpass', 3000, 0.5, 0.2, 0.03);
    return last;
  },
  shatter: function (c, out, t) {
    var last;
    for (var i = 0; i < 4; i++) last = noiseBurst(c, out, t + i * 0.035 * Math.random() * 2, 'highpass', 2500 + Math.random() * 2500, 0.8, 0.5, 0.08);
    tone(c, out, t, 'triangle', 220, 90, 0.3, 0.12);
    return last;
  },
  block: function (c, out, t) {
    noiseBurst(c, out, t, 'bandpass', 900, 1.2, 0.6, 0.07);
    return tone(c, out, t, 'square', 260, 180, 0.15, 0.08);
  },
  parry: function (c, out, t) {
    tone(c, out, t, 'sine', 1800, 0, 0.3, 0.45);
    return tone(c, out, t, 'sine', 2710, 0, 0.18, 0.35);
  },
  boom: function (c, out, t) {
    tone(c, out, t, 'sine', 110, 35, 0.9, 0.18);
    noiseBurst(c, out, t, 'lowpass', 1400, 0.6, 0.9, 0.22);
    return noiseBurst(c, out, t, 'bandpass', 700, 0.5, 0.6, 0.3);
  },
  click: function (c, out, t) {
    return tone(c, out, t, 'square', 2400, 1800, 0.12, 0.02);
  },
  whoosh: function (c, out, t) {
    return noiseBurst(c, out, t, 'bandpass', 600, 0.6, 0.35, 0.18);
  },
};

export function sound(name, position) {
  if (!tune.values.sound || !SOUNDS[name]) return false;
  var c = audio();
  if (!c || c.state !== 'running' || voices >= MAX_VOICES) return false;
  voices++;
  var last = SOUNDS[name](c, output(c, position), c.currentTime);
  var done = false;
  var release = function () { if (!done) { done = true; voices--; } };
  if (last) last.onended = release;
  setTimeout(release, 1500); // in case onended never fires
  return true;
}

// The listener follows the camera so positional sounds come from the
// right place.
if (typeof AFRAME !== 'undefined' && !AFRAME.systems['action-feedback']) {
  var THREE = AFRAME.THREE;
  AFRAME.registerSystem('action-feedback', {
    init: function () {
      this.pos = new THREE.Vector3();
      this.fwd = new THREE.Vector3();
      this.up = new THREE.Vector3();
      this.quat = new THREE.Quaternion();
    },
    tick: function () {
      if (!ctx || ctx.state !== 'running') return;
      var cam = this.el.camera;
      if (!cam) return;
      cam.getWorldPosition(this.pos);
      cam.getWorldQuaternion(this.quat);
      this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
      this.up.set(0, 1, 0).applyQuaternion(this.quat);
      var l = ctx.listener;
      if (l.positionX) {
        l.positionX.value = this.pos.x; l.positionY.value = this.pos.y; l.positionZ.value = this.pos.z;
        l.forwardX.value = this.fwd.x; l.forwardY.value = this.fwd.y; l.forwardZ.value = this.fwd.z;
        l.upX.value = this.up.x; l.upY.value = this.up.y; l.upZ.value = this.up.z;
      } else {
        l.setPosition(this.pos.x, this.pos.y, this.pos.z);
        l.setOrientation(this.fwd.x, this.fwd.y, this.fwd.z, this.up.x, this.up.y, this.up.z);
      }
    },
  });
}
