# Punch Pop — long-term design notes

The eventual goal, in Noah's words: give the player a growing set of
ridiculous, over-the-top punching-based powers that are secretly
full-body fitness moves. Fun and "feel like a damn superhero" come
first; "secretly a workout" is the trick underneath it. Moves should
be chainable into combos, e.g.: lunge into a group of enemies, uppercut
a few into the air, stand up suddenly to jump after them, punch each
one mid-air, then smash back down into another group on the ground.

This file is a running design/roadmap doc, not a spec — capturing the
concept and enough technical feasibility notes for whoever (probably
future-Claude) picks this up next to have a running start. None of the
"not yet implemented" ideas below should be built speculatively; wait
until they're actually asked for.

## Built so far

- Punches lunge the player in the swing direction (`punch-locomotion`).
- Uppercuts (steep-upward swings that started down near the waist)
  launch the player airborne. Detection has gone through a few
  iterations — see `punch-tracker`'s wind-up/extending check and
  `punch-locomotion`'s uppercut classification — and is now tunable
  live from the watch menu's AIR tab (Uppercut Power, Max Air Speed,
  Uppercut Angle, Max Start Height) rather than only in code.
- Downward swings while airborne crash the player down ("smash").
  Currently affects only the player, not enemies/cubes.
- Cubes have independent movement behavior (bob/chase/patrol/wander),
  though none of it reacts to being hit beyond popping.
- Gravity is tunable (watch menu, PUNCH tab) — lower values give a
  floatier, more super-heroic feel, which matters a lot for anything
  below that involves being airborne on purpose (juggling, jumps).

## Ideas for future moves (not yet implemented)

### Uppercuts toss enemies airborne, not just the player
Currently an uppercut punch that connects with a cube just pops it
like any other hit — no launch. Extending this needs cubes to have
real velocity/gravity of their own (not just the current
behavior-driven position tweening in `cube-behavior`), so a hit cube
can be given an upward impulse and then fall under gravity like the
player does, instead of just disappearing. Open question Noah raised
and hasn't resolved: should the *player* still also launch on every
uppercut once enemies do too, or does landing a juggle-starting
uppercut on an enemy skip/reduce the self-launch? Leave both wired up
as separate, easy-to-toggle behaviors rather than picking one.

### Squat-then-stand-quickly → jump (+ shockwave)
Detect: head Y position drops below some threshold at low vertical
velocity (the squat/crouch), then head Y velocity crosses a speed
threshold upward (the quick stand). This is structurally very similar
to how `punch-tracker` already detects a hand "swing" from velocity +
hysteresis (`armed`/`triggerSpeed`/`resetSpeed`) — likely the same
pattern applied to `#head`'s own `punch-tracker` instance, which
already exists and tracks head velocity (currently only used for the
"lean into your punch" bonus in `punch-locomotion`), just needs its
own edge-detection wired up. Shockwave: an expanding ring mesh
(scale-up + fade animation) plus a radius-based knockback/pop check
against nearby cubes on landing — similar in shape to `punch-game`'s
`checkHand` distance test, but centered on the rig instead of a hand,
checked once rather than every tick.

### Arm circles → force field
Detect small-radius circular hand motion sustained over roughly a
second: track a short rolling window of recent hand positions (a small
ring buffer, a few hundred ms), and check whether they trace something
loop-shaped — e.g. total signed angular displacement around the
window's centroid approaching ±360°, or the path revisiting close to
its own start point without much net drift in any one direction.
Probably want to require *both* hands doing this with arms extended
outward, to avoid it triggering during normal punching/settling
motion. Force field is presumably a temporary
invincibility/knockback-aura entity centered on the rig, maybe scaling
with how long the circling is sustained.

### Lunging pose → dash
This is a *pose* held for a moment (one arm extended forward, the
other pulled back, head lowered), not a fast *swing* — a different
detection shape than everything else here, which all keys off
`punch-tracker`'s velocity/speed machinery. Needs its own
"are both hands + head roughly in this relative configuration right
now" check, probably sampled continuously rather than edge-triggered,
firing once when the pose is confirmed held for some minimum duration.
The dash itself should probably feel different from a punch impulse —
more like a direct, sustained velocity-set/burst than a single
decaying impulse, since it's meant to read as a controlled dash rather
than a lunge.

### Squat + downward two-arm swing → ground-pound smash
Combine the squat detection above with a downward swing (already have
the ingredients: `punch-locomotion`'s existing downward-swing-while-
airborne "smash" case, and the squat detection from the jump idea).
On landing, apply a radius-based AoE knockback/pop to nearby cubes —
distinct from `punch-target`'s existing per-cube proximity+force pop,
since this one is a shockwave from the impact point and shouldn't
require direct fist contact with each cube.

## Chaining / combos

None of the individual moves above strictly need to know about each
other, but the rig's `grounded` flag (already tracked in
`punch-locomotion`) is probably worth promoting to a more explicit
"am I currently mid-air-combo" state once more than one or two of
these exist, so e.g. an uppercut landing on an enemy while the player
is already airborne from their own jump can be told apart from an
uppercut thrown from standing on the ground — likely relevant for
tuning how these moves stack rather than for basic detection.

## Settings already exposed in the watch menu (as of this writing)

- **PUNCH tab**: Move Speed, Gravity, Reset Arena
- **FOES tab**: Cube Count, Cube Behavior (bob/chase/patrol/wander/mixed)
- **AIR tab**: Uppercut Power, Max Air Speed, Uppercut Angle, Max Start Height
- **SETUP tab**: per-wrist watch Facing (6 axis+sign choices) and Roll (45° steps)
- **MORE tab**: Resume, Exit VR, Debug Axes (RGB=XYZ gizmo on both fists)

Each new move idea above should probably get its own tab (or a shared
"MOVES" tab if the watch panel starts running out of tab-bar width) as
it's built, following the same tabbed-panel pattern already in place
(`createTabbedPanel` / `buildSettingsTabs` in `games/punch-pop/index.html`).
