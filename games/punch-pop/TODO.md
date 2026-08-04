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

The punch → movement pipeline went through a full redesign (previous
iterations tried a per-frame "is the hand extending away from the
head" heuristic plus a separate hard-coded uppercut/smash
classification; both are gone now). Current model, in
`punch-tracker`/`punch-locomotion`:

1. A hand swing is tracked start-to-finish as a small state machine
   (`punch-tracker`): once speed crosses `triggerSpeed`, it accumulates
   max speed, hand path length, and head path length (via the head's
   own `punch-tracker` instance) until speed drops back to
   `resetSpeed` (or a swing runs unreasonably long) — at which point it
   emits a "punch" with the *net displacement* direction from swing
   start to swing end, plus those three accumulated stats.
2. `punch-locomotion` only allows a lunge if that direction is within
   `lookConeAngle` of the camera's actual look direction — the fix for
   accidental-backward-punches (a cock-back's net direction essentially
   never matches where you're looking) and, as a side effect, what
   makes punching in *any* direction — including straight up — work
   uniformly, since there's no separate uppercut angle/height gate
   anymore.
3. If a live cube is within `lockOnConeAngle` of your aim and close
   enough (`baseLockRange`, extended a bit by how big the swing was),
   the punch snaps onto it ("lock-on"); otherwise the movement
   direction is the punch direction blended halfway with the look
   direction.
4. Impulse magnitude combines max hand speed, hand travel distance, and
   head travel distance (`speedFactor`/`handDistFactor`/`headDistFactor`),
   scaled by `powerMultiplier` ("Move Speed" in the menu).

Downward swings no longer get a special "smash" boost — a downward
punch is just a punch whose computed direction happens to point down,
handled by the same unified system. If that turns out to feel like it
needs *more* juice than the unified formula gives it, that's a
candidate for a future targeted addition, not a revert to special-casing.

Other things in place:
- Cubes have health and take damage from `computeMagnitude` (same
  formula as player lunge distance) instead of popping in one hit;
  color desaturates toward gray as health drops (HSL saturation only,
  hue/lightness held constant), and they die once fully drained.
- Every hit — lethal or not — paints a splat of the cube's own color
  onto a shared floor-sized canvas overlay (`#splat-layer`), sized by
  damage dealt, with a scattered multi-blob burst on the killing blow.
  Splats accumulate for the whole session (cleared only by Reset
  Arena), so the floor visibly fills up with color the longer you
  play. World-position-to-canvas-pixel mapping goes through an actual
  raycast against the overlay mesh (`worldToSplatPixel`) rather than a
  hand-derived formula, on purpose — see the README's note on the
  `getWorldDirection`/`lookAt` bug for why "just derive the axes" was
  worth avoiding a third time.
- Cubes have independent movement behavior (bob/chase/patrol/wander),
  though none of it reacts to being hit beyond popping.
- Gravity is tunable (menu, PUNCH tab) — lower values give a floatier,
  more super-heroic feel, which matters a lot for anything below that
  involves being airborne on purpose (juggling, jumps).
- An optional in-view stats HUD (menu, MORE tab → Show Stats) shows the
  last punch's max speed / hand distance / head distance / computed
  magnitude / angle-to-look / lock state — a playtesting aid for seeing
  what the targeting system actually did, not something meant to stay
  on for normal play.

## Ideas for future moves (not yet implemented)

### Uppercuts (or any punch) toss enemies airborne, not just the player
Currently a punch that connects with a cube just pops it, regardless of
direction — no launch, even now that the player can be launched in any
direction including straight up. Extending this needs cubes to have
real velocity/gravity of their own (not just the current
behavior-driven position tweening in `cube-behavior`), so a hit cube
can be given an impulse in the punch's direction and then fall under
gravity like the player does, instead of just disappearing. This
should compose naturally with the unified direction/magnitude system
above — the same `finalDir`/`magnitude` already computed for the
player's own lunge is the obvious thing to also apply to whatever gets
hit. Open question Noah raised and hasn't resolved: should the
*player* still also launch on every hit once enemies do too, or does
landing a juggle-starting punch on an enemy skip/reduce the
self-launch? Leave both wired up as separate, easy-to-toggle behaviors
rather than picking one.

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
Combine the squat detection above with a downward swing — a downward
punch already sends the player crashing down under the unified
direction system (no special case needed for that part anymore). What
this idea adds on top is a landing effect: apply a radius-based AoE
knockback/pop to nearby cubes on impact — distinct from
`punch-target`'s existing per-cube proximity+force pop, since this one
is a shockwave from the impact point and shouldn't require direct fist
contact with each cube.

## Chaining / combos

None of the individual moves above strictly need to know about each
other, but the rig's `grounded` flag (already tracked in
`punch-locomotion`) is probably worth promoting to a more explicit
"am I currently mid-air-combo" state once more than one or two of
these exist, so e.g. an uppercut landing on an enemy while the player
is already airborne from their own jump can be told apart from an
uppercut thrown from standing on the ground — likely relevant for
tuning how these moves stack rather than for basic detection.

## Settings already exposed in the menu (as of this writing)

The menu itself changed shape too: it's now one bigger panel fixed in
world space, spawned a couple feet in front of the player and facing
them, rather than a small per-wrist panel — see the README for why.

- **PUNCH tab**: Move Speed, Gravity, Max Speed, Reset Arena
- **FOES tab**: Cube Count, Cube Behavior (bob/chase/patrol/wander/mixed)
- **AIM tab**: Look Cone, Lock-On Cone, Lock Range — tuning for the
  look-gated/lock-on targeting system described above
- **MORE tab**: Resume, Exit VR, Show Stats

Each new move idea above should probably get its own tab as it's
built, following the same tabbed-panel pattern already in place
(`createTabbedPanel` / `buildSettingsTabs` in `games/punch-pop/index.html`).
