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
   scaled by `powerMultiplier` ("Move Speed" in the menu). For a
   lock-on lunge specifically, the applied magnitude is additionally
   capped by distance to the target (`LOCK_DISTANCE_FACTOR` /
   `LOCK_MIN_MAGNITUDE`) — playtesting found that finishing off a cube
   at point-blank range with the *uncapped* magnitude flung the player
   past/through it, which read as "the game moves me around
   unexpectedly" during close-range combos.

Playtesting also turned up a real detection bug: rig-local hand
*position* doesn't rotate with the player's physical body (only
punch-locomotion's own translation moves it), so turning around while
holding a hand out sweeps that hand through a wide arc in tracking
space — the same velocity signature as a real swing, causing phantom
lunges nobody threw. Fixed by comparing the swing-trigger threshold
against the hand's velocity *relative to the head's own current
velocity* (`punch-tracker`'s `headBlend` schema field, "Turn Filter" in
the menu, default 100%) rather than raw hand velocity — a real punch
still shows a large hand-vs-head differential since the head stays
roughly still, while a body turn mostly cancels out since hand and head
sweep through a correlated arc together. Important detail: only the
*trigger* uses the head-relative speed — `maxSpeed` (and therefore
impulse magnitude/damage) still accumulates from *raw* hand speed, so a
real punch thrown while stepping/leaning in doesn't get discounted for
the crime of the head also moving forward a bit.

Downward swings no longer get a special "smash" boost — a downward
punch is just a punch whose computed direction happens to point down,
handled by the same unified system. If that turns out to feel like it
needs *more* juice than the unified formula gives it, that's a
candidate for a future targeted addition, not a revert to special-casing.

Other things in place:
- Enemies are simple humanoids now, not floating cubes: a legs/torso/
  head stack of boxes on a container entity (`punch-game.spawnCube`)
  whose own position is the character's feet/ground-contact point —
  always y=0 at rest, no floating spawn height, no idle bob. The
  container has no geometry of its own; `punch-target` recolors
  `el.bodyParts` (the three child meshes) instead of the container's
  own material, and `punch-game.checkHand` hit-tests each body part
  independently so a punch at any height connects with something real.
  A future step is real skeleton/ragdoll models; this is deliberately
  just enough to read as a combatant for now.
- Cubes have health and take damage from `computeMagnitude` (same
  formula as player lunge distance) instead of popping in one hit;
  color desaturates toward gray as health drops (HSL saturation only,
  hue/lightness held constant, applied to every body part), and they
  die once fully drained. Default `cubeHealth` dropped 100 → 50 after
  playtesting found a sustainable (not maximal-effort) punch only dented
  a 100-health bar a little — the fight needs to feel winnable within a
  realistic physical stamina budget.
- **Found via testing, not playtesting — worth flagging**:
  `punch-game.init()` used to cache `this.locomotion =
  this.rig.components['punch-locomotion']` once. A-Frame doesn't
  guarantee component-init order across sibling entities, and when this
  raced ahead of `punch-locomotion`'s own `init()`, `this.locomotion`
  stayed `undefined` for the whole session — `checkHand` silently fell
  back to raw hand speed as damage with none of `computeMagnitude`'s
  distance/power scaling, invisibly, no error. Likely a real (separate
  from the health-value tuning above) contributor to "it takes forever
  to kill one of these." Fixed by looking the component up fresh at the
  point of use in `checkHand` instead of caching a possibly-premature
  reference. If you ever cache another entity's component reference in
  `init()`, either verify the ordering is actually safe or just don't —
  a fresh `.components['x']` lookup at use-time is cheap and immune to
  this whole class of bug.
- A non-lethal hit physically launches the cube
  (`cube-behavior.applyKnockback`), primarily **straight away from the
  player** — not a raw reflection of the hand's instantaneous velocity,
  which can be pretty wobbly mid-swing — angled only a little by the
  actual swing direction (`KNOCKBACK_ANGLE_BLEND`). The swing's vertical
  component contributes partial credit as launch/slam
  (`KNOCKBACK_VERTICAL_FACTOR`): upward hits send the target a little
  airborne, downward hits add a little downward velocity, which against
  an already-grounded target immediately feeds the impact-damage system
  below. Speed scales with hit force (**Knockback Force**, SPLAT tab)
  but stays much gentler than the player's own lunge speed. Runs in
  place of that cube's normal chase/patrol/wander/idle movement while
  still sliding, and paints a thin trail in its own color while doing so
  (**Trail** toggle). Once a knockback settles, `cube-behavior`
  re-anchors its patrol/wander reference point to wherever the cube
  actually ended up — otherwise a cube punched away from its spawn spot
  would slide to a stop and then calmly walk itself back there once
  behavior resumed, a milder echo of the "magically resets" bug below.
  A cube slid into another live cube (`punch-game.checkCubeCollisions`)
  transfers some damage and velocity on to it, capped to once per second
  per specific pair via a timestamped cooldown map — otherwise two
  cubes resting against each other would loop into infinite mutual
  damage.
- **"Move fast and break things"**: a cube's knockback velocity that
  gets suddenly zeroed by a hard surface (room-bounds wall clamp, or
  landing on the floor while still falling — both in
  `cube-behavior.tick()`) deals impact damage proportional to the speed
  just lost, above a minimum (small stumbles don't count) — real fall
  damage, just triggered by any hard stop, not only a fall from height.
  This is also what a second real bug (found via testing) turned out to
  be entangled with: `cube-behavior.tick()` had no guard against an
  oversized single-frame `dt` (unlike `punch-locomotion.tick()`, which
  already had one). In a slow/coalesced frame, gravity integrated over
  the whole oversized step at once and a falling cube's downward
  velocity ran away past 100 m/s instead of settling near zero on
  landing — which kept the cube permanently stuck in "still sliding"
  state, so its normal settle-and-resume logic (including, at the time,
  the old vertical bob) never got a clean chance to run — this was most
  of the mechanism behind "it falls to the ground, then magically resets
  back to where it was bobbing." Fixed by clamping `dt` the same way
  `punch-locomotion` already did, plus (separately) explicitly zeroing
  vertical knockback velocity the instant the floor clamp triggers so
  gravity can't keep accumulating on a component whose position can no
  longer follow it downward.
- Cubes have independent movement behavior (idle/chase/patrol/wander;
  `idle` replaced the old `bob` — grounded humanoids don't float),
  though none of it reacts to being hit beyond the knockback above.
- Gravity is tunable (menu, PUNCH tab) — lower values give a floatier,
  more super-heroic feel, which matters a lot for anything below that
  involves being airborne on purpose (juggling, jumps).
- An optional in-view stats HUD (menu, MORE tab → Show Stats) shows the
  last punch's max speed / hand distance / head distance / computed
  magnitude (plus the lock-on-capped value and distance, when the cap
  applied) / angle-to-look vs. the current cone / lock state — a
  playtesting aid for seeing what the targeting system actually did.
- A separate, always-fresh **live debug HUD** (menu, DEBUG tab) shows
  the raw signals `punch-tracker`'s state machine reads every frame —
  both hands' raw vs. head-relative speed, swing state, the live
  trigger/reset thresholds, and the turn filter — added specifically so
  a confusing in-headset moment can be read directly (or screenshotted)
  instead of guessed at blind from outside the headset. Trigger Speed,
  Reset Speed, and Turn Filter are all live-adjustable from the same
  DEBUG tab.

## Ideas for future moves (not yet implemented)

Enemies tossing airborne on a hit — the first item that used to be
here — is now built (see "Built so far" above: `cube-behavior`'s real
knockback velocity/gravity, with partial vertical launch on an
upward-angled punch). Noah's open question about whether the player
should still also self-launch on a hit that also launches the enemy
turned out to already be resolved by how the systems compose: the
player's own lunge (gated on look-alignment, `punch-locomotion.onPunch`)
and the enemy's knockback (`punch-target.applyPhysicalKnockback`) are
two independent reactions to the same punch event and already both
fire together — there was never actually a case where one needed to
suppress the other.

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
- **FOES tab**: Cube Count, Cube Health, Cube Behavior (bob/chase/patrol/wander/mixed)
- **AIM tab**: Look Cone, Lock-On Cone, Lock Range — tuning for the
  look-gated/lock-on targeting system described above
- **SPLAT tab**: Splat Amount, Splat Scatter, Knockback Force, Trail on/off
- **DEBUG tab**: Live Debug HUD toggle, Trigger Speed, Reset Speed,
  Turn Filter — punch-detection transparency/tuning, described above
- **MORE tab**: Resume, Exit VR, Show Stats

Each new move idea above should probably get its own tab as it's
built, following the same tabbed-panel pattern already in place
(`createTabbedPanel` / `buildSettingsTabs` in `games/punch-pop/index.html`).
