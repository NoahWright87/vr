// ============================================================
// INTENT — what the hands mean, from motion alone.
//
// Pure functions over common/motion-sense.js state. No buttons, no
// poses. For now: strikes (a punch forward, an uppercut), generalized
// from Punch Pop's punch-tracker (see games/punch-pop/TODO.md for how
// it was arrived at — two redesigns of velocity thresholds before
// extension fractions worked).
//
// Each hand runs one state machine per axis (forward, up):
//
//   armed      the hand is in, below armAt of reach
//   extending  it crossed armAt; the swing's stats start accumulating
//   committed  it got past commitAt fast enough (relative speed) while
//              motion energy was up: this IS a strike. Emitted early,
//              so assists have the rest of the extension to act in.
//   hold       it landed (reached full extension, or stopped), or it
//              was a slow reach that never committed. Nothing more
//              until the hand comes back in below armAt.
//
// A slow reach never commits: that is the guard against the false
// positives that sank Punch Pop's comfort — reaching for the visor,
// gesturing, scratching your nose. A body turn with an arm out cannot
// even start one, because extension is turn-immune (motion-sense).
//
// Events: { type: 'strike', hand, axis, phase: 'commit'|'land'|'cancel',
//           t, speed (peak, m/s), travel (m), headTravel (m),
//           direction (rig-local unit vector of the hand's motion) }
//
// Tested by tests/intent.test.js.
// ============================================================

export var DEFAULT_STRIKE_SETTINGS = {
  armAt: 0.4, // extension fraction that arms a strike
  commitAt: 0.55, // ...past which a fast enough hand commits
  commitSpeed: 1.5, // m/s, head-relative
  commitEnergy: 0.3, // motion energy needed to commit
  fullForward: 0.9, // forward extension that lands a punch
  fullUp: 0.8, // vertical extension that lands an uppercut
  stopSpeed: 0.6, // m/s: a committed hand that slows below this has landed
  maxReachMs: 700, // an uncommitted extension older than this is a reach
};

var AXES = ['forward', 'up'];
var SIDES = ['left', 'right'];

function copy(v) { return { x: v.x, y: v.y, z: v.z }; }
function dist(a, b) { var dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return Math.sqrt(dx * dx + dy * dy + dz * dz); }
function unit(v) {
  var l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: -1 };
}

function createAxis() {
  return { state: 'armed', start: null, startHead: null, startT: 0, maxSpeed: 0, direction: null };
}

export function createStrikeDetector(settings) {
  var d = { settings: Object.assign({}, DEFAULT_STRIKE_SETTINGS, settings || {}), hands: {} };
  SIDES.forEach(function (side) {
    d.hands[side] = { forward: createAxis(), up: createAxis() };
  });
  return d;
}

// Is the hand's motion more along this axis than the other?
function alongAxis(hand, motion, axis) {
  var v = hand.relativeVelocity;
  var forward = v.x * motion.facing.x + v.z * motion.facing.z;
  var up = v.y;
  return axis === 'forward' ? forward >= up : up > forward;
}

function fraction(hand, axis) {
  return axis === 'forward' ? hand.extension.forward : hand.extension.up;
}

function event(side, axis, phase, a, hand, head, t) {
  return {
    type: 'strike', hand: side, axis: axis, phase: phase, t: t,
    speed: a.maxSpeed,
    travel: a.start ? dist(hand.position, a.start) : 0,
    headTravel: a.startHead ? dist(head.position, a.startHead) : 0,
    direction: a.direction ? copy(a.direction) : null,
  };
}

// Advance with this frame's motion-sense state. Returns the events
// (usually none).
export function updateStrikes(detector, motion) {
  var s = detector.settings;
  var events = [];
  SIDES.forEach(function (side) {
    var hand = motion[side];
    var axes = detector.hands[side];
    if (!hand.tracked) {
      AXES.forEach(function (axis) {
        if (axes[axis].state === 'committed') events.push(event(side, axis, 'cancel', axes[axis], hand, motion.head, motion.t));
        axes[axis] = createAxis();
      });
      return;
    }
    AXES.forEach(function (axis) {
      var a = axes[axis];
      var other = axes[axis === 'forward' ? 'up' : 'forward'];
      var f = fraction(hand, axis);
      var full = axis === 'forward' ? s.fullForward : s.fullUp;

      if (a.state === 'armed') {
        if (f >= s.armAt) {
          a.state = 'extending';
          a.start = copy(hand.position);
          a.startHead = copy(motion.head.position);
          a.startT = motion.t;
          a.maxSpeed = hand.relativeSpeed;
          a.direction = null;
        }
        return;
      }

      if (a.state === 'hold') {
        if (f < s.armAt) a.state = 'armed';
        return;
      }

      a.maxSpeed = Math.max(a.maxSpeed, hand.relativeSpeed);

      if (f < s.armAt) {
        if (a.state === 'committed') events.push(event(side, axis, 'cancel', a, hand, motion.head, motion.t));
        a.state = 'armed';
        return;
      }

      if (a.state === 'extending') {
        // One strike per hand at a time: a diagonal that commits on one
        // axis doesn't also throw the other. And the hand has to be
        // moving mostly along this axis, so an uppercut from a low guard
        // (already well out in front) isn't read as a jab.
        if (other.state !== 'committed' && f >= s.commitAt && hand.relativeSpeed >= s.commitSpeed &&
            motion.energy >= s.commitEnergy && alongAxis(hand, motion, axis)) {
          a.state = 'committed';
          a.direction = unit(hand.relativeVelocity);
          events.push(event(side, axis, 'commit', a, hand, motion.head, motion.t));
        } else if (f >= full || motion.t - a.startT > s.maxReachMs) {
          a.state = 'hold'; // a reach, not a strike
        }
        return;
      }

      if (a.state === 'committed' && (f >= full || hand.relativeSpeed < s.stopSpeed)) {
        events.push(event(side, axis, 'land', a, hand, motion.head, motion.t));
        a.state = 'hold';
      }
    });
  });
  return events;
}

// Whether a hand has a strike in flight right now, and on which axis.
export function committedAxis(detector, side) {
  var axes = detector.hands[side];
  if (axes.forward.state === 'committed') return 'forward';
  if (axes.up.state === 'committed') return 'up';
  return null;
}

// How hard: Punch Pop's computeMagnitude idea — peak speed, how far the
// hand travelled, and how far the head moved (stepping into it). Roughly
// 0.3 for a lazy jab, 1 for a solid one, up to 2.5 for a lunging hook.
export function strikeForce(e) {
  var f = (e.speed || 0) / 4 + (e.travel || 0) * 0.8 + (e.headTravel || 0) * 2;
  return Math.max(0.3, Math.min(2.5, f));
}
