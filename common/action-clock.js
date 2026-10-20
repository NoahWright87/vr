// ============================================================
// ACTION CLOCK — one place that decides how fast the world runs.
//
// Every action component integrates with the clock's dt rather than the
// raw tick delta, so two things become possible without touching them:
//
//   Bullet time. timeScale slows enemies, projectiles and effects. It
//   never slows the player — their head, hands and virtual hands run on
//   real time — because in VR you can't slow a body down, and slowing
//   its rendering is nauseating. The world is slow and you are fast.
//
//   Hit-stop. A struck target freezes for a few tens of milliseconds.
//   Only that target: a global freeze would stall your view and hands.
//
//   var clock = sceneEl.systems['action-clock'];
//   var dt = clock.dt(this.el, rawDtMs);   // world time, ms
//   clock.hitStop(targetEl, 60);
//   clock.setTimeScale(0.3, 250);          // ramp to 30% over 250 ms
//
// The core is plain functions, tested by tests/action-clock.test.js.
// ============================================================

import { defineTunables } from './tunables.js';

export function createClock() {
  return {
    now: 0, // real ms since the clock started
    worldNow: 0, // scaled ms
    timeScale: 1,
    from: 1,
    to: 1,
    rampStart: 0,
    rampMs: 0,
    stops: new Map(), // key -> real ms until which it's frozen
  };
}

export function setTimeScale(clock, scale, rampMs) {
  clock.from = clock.timeScale;
  clock.to = Math.max(0, scale);
  clock.rampStart = clock.now;
  clock.rampMs = Math.max(0, rampMs || 0);
  if (!clock.rampMs) clock.timeScale = clock.to;
}

// Advance by one real frame. Returns the world dt for this frame.
export function advanceClock(clock, realDtMs) {
  var dt = Math.max(0, realDtMs || 0);
  clock.now += dt;
  if (clock.timeScale !== clock.to) {
    var t = clock.rampMs ? Math.min(1, (clock.now - clock.rampStart) / clock.rampMs) : 1;
    // Ease in-out so the slide into and out of slow motion is smooth.
    var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    clock.timeScale = clock.from + (clock.to - clock.from) * e;
    if (t >= 1) clock.timeScale = clock.to;
  }
  var worldDt = dt * clock.timeScale;
  clock.worldNow += worldDt;
  clock.stops.forEach(function (until, key) {
    if (until <= clock.now) clock.stops.delete(key);
  });
  return worldDt;
}

export function hitStop(clock, key, ms) {
  var until = clock.now + Math.max(0, ms);
  var existing = clock.stops.get(key) || 0;
  clock.stops.set(key, Math.max(existing, until));
}

export function isStopped(clock, key) {
  var until = clock.stops.get(key);
  return until !== undefined && until > clock.now;
}

// The dt something should integrate with this frame: zero while it is
// hit-stopped, real time for the player, scaled time for the world.
export function scaledDt(clock, realDtMs, key, isPlayer) {
  if (key !== undefined && isStopped(clock, key)) return 0;
  return isPlayer ? realDtMs : realDtMs * clock.timeScale;
}

if (typeof AFRAME !== 'undefined' && !AFRAME.systems['action-clock']) {
  var tune = defineTunables('time', 'Time', [
    { key: 'slowmo', label: 'Slow-mo', kind: 'select', value: 1, options: [
      { value: 1, label: 'Off' }, { value: 0.5, label: '50%' }, { value: 0.25, label: '25%' }, { value: 0.1, label: '10%' },
    ] },
    { key: 'hitStopMs', label: 'Hit stop', value: 60, min: 0, max: 200, step: 10, unit: 'ms' },
    { key: 'rampMs', label: 'Ramp', value: 250, min: 0, max: 1000, step: 50, unit: 'ms' },
  ], function (values, key) {
    if (key === 'slowmo' || key === null) {
      var scene = document.querySelector('a-scene');
      var system = scene && scene.systems['action-clock'];
      if (system) system.setTimeScale(values.slowmo, values.rampMs);
    }
  });

  AFRAME.registerSystem('action-clock', {
    init: function () {
      this.clock = createClock();
      this.tune = tune;
      this.realDt = 0;
      this.worldDt = 0;
      setTimeScale(this.clock, tune.values.slowmo, 0);
    },

    // Systems tick before components, so every component sees this
    // frame's values.
    tick: function (time, dt) {
      // Tab-switch or loading hitches arrive as one huge delta; never
      // integrate more than 50 ms in a step.
      this.realDt = Math.min(dt || 0, 50);
      this.worldDt = advanceClock(this.clock, this.realDt);
    },

    // World time for `el` this frame, in ms (0 while it's hit-stopped).
    dt: function (el) { return scaledDt(this.clock, this.realDt, el, false); },
    // Real time, for anything that is the player.
    playerDt: function () { return this.realDt; },
    hitStop: function (el, ms) { hitStop(this.clock, el, ms === undefined ? tune.values.hitStopMs : ms); },
    isStopped: function (el) { return isStopped(this.clock, el); },
    setTimeScale: function (scale, rampMs) { setTimeScale(this.clock, scale, rampMs === undefined ? tune.values.rampMs : rampMs); },
    timeScale: function () { return this.clock.timeScale; },
  });
}
