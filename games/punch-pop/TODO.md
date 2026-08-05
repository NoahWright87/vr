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

The punch → movement pipeline went through a **second** full redesign
(the first replaced a per-frame "is the hand extending away from the
head" heuristic with velocity-threshold swing detection; that's now
*also* gone, replaced by reach-calibrated extension-fraction
detection). Playtesting kept landing "either too hard to register or
way too twitchy" no matter how the velocity thresholds got tuned, and
Noah's framing of the actual fix was to stop asking what a proper punch
or uppercut technically *is* and start asking what a player *thinks*
they're doing: extending their fist forward (a punch) or overhead (an
uppercut), whatever the speed, cocked back first or not. Current model:

1. **Reach calibration** (`punch-locomotion.startCalibration` /
   `updateCalibration`, menu REACH tab → Calibrate Reach): ~3s sampling
   max forward hand-to-torso distance from either hand, then ~3s
   sampling max overhead distance, against an approximate torso
   reference point (`TORSO_HEAD_DROP` below head position). Stored as
   plain globals `reachForward`/`reachOverhead` (sensible defaults
   until calibrated), clamped to `REACH_MIN`/`REACH_MAX` so a degenerate
   sample (e.g. barely moving) can't produce a tiny/huge reach. Freezes
   punching and rig physics for its duration the same way the menu does
   (`this.calibrating`, checked in `onPunch` and `tick`) — the menu
   itself is closed first so the player can actually see the prompts
   and move their arms freely.
2. **Extension-fraction state machine**, two independent instances per
   hand (`punch-tracker`'s `fwd`/`up` — one for a forward punch, one for
   an uppercut): each frame computes the hand's offset from the torso
   reference point, decomposed into a forward component (dot product
   with the head's flattened forward direction) and a vertical
   component, each expressed as a fraction of the calibrated reach.
   States: `armed` (fraction below `EXT_ARM_THRESHOLD`, 40%) →
   `extending` (crossed 40%, accumulating max speed / hand travel / head
   travel same as the old swing tracker) → fires a "punch" event the
   instant *either* the fraction crosses the full-extension threshold
   (`EXT_FORWARD_FULL_THRESHOLD` 90% / `EXT_OVERHEAD_FULL_THRESHOLD`
   80% — "if they cross 90% of their reach, treat it like an abrupt
   stop, the punch is thrown") *or* the hand's speed drops back near
   zero (`stopSpeed`, still head-relative-filtered via `headBlend` —
   see below) → `holdForReset`, ignored until the fraction drops back
   below 40% to re-arm. Both hands run both axes simultaneously; a
   diagonal swing crossing both thresholds can fire both a punch and an
   uppercut from one motion — treated as (and reads as) one bigger
   compound hit, not something specifically prevented.
3. This is **structurally immune**, not just empirically patched, to
   the single biggest false-positive source found last round (turning
   your body while holding a hand out): rotating hand-offset-from-torso
   and torso-forward-direction by the same angle (a body turn with a
   static arm pose) leaves their dot product — what the extension
   fraction is built from — unchanged. A real reach changes it directly.
   No threshold-tuning can offer that guarantee the way this
   construction does by geometry alone. Verified via Playwright: a
   simulated 90° body turn holding a fixed arm-offset pose fired zero
   punches and never left the `armed` state (note for future testing:
   A-Frame's default `look-controls` on `<a-camera>` reasserts its own
   tracked rotation every tick and will silently fight a
   manually-set `head.object3D.rotation` across a multi-frame test loop
   unless explicitly disabled first — cost real debugging time to
   discover, worth remembering).
4. **No more look-cone gate.** The old one rejected a swing whose net
   displacement direction was too far from where the player was
   looking — structurally unnecessary now, since a pure cock-back/
   retraction can't cross the extension threshold to begin with (arming
   requires *starting* below it and moving up past it). Movement
   direction now leans on **look direction** as the primary intent
   signal: if a live cube is within `lockOnConeAngle` (widened to 40°)
   of your aim and within range (`baseLockRange`, widened to 2.0m, plus
   a swing-size bonus), the punch/uppercut locks onto it, capped by
   distance-to-target the same way as before (`LOCK_DISTANCE_FACTOR`/
   `LOCK_MIN_MAGNITUDE`). If your look-direction search comes up empty
   but you glanced at an enemy within the last ~2s
   (`RECENT_LOOK_MEMORY_MS`) and it's still roughly in range
   (`updateRecentLookTarget`, ticks every frame independent of
   `menuOpen`), that remembered target is used instead — "people
   reliably turn their head mid-swing, especially winding up, even
   though their eyes/intent didn't move." With no lock at all,
   direction is mostly look direction, lightly nudged
   (`PUNCH_DIR_BLEND`, 0.25) by the swing's own net displacement (which
   `punch-tracker` may report as `null` if displacement was negligible
   — falls back to pure look direction).
5. **Sticky hit-assist** (`hitAssistMode`, menu AIM tab, global not
   per-entity): `off` is pure physical proximity (`punch-game
   .checkHand`'s existing hitRadius check, unaffected); `cheat`
   (default) calls the locked target's `punch-target.hit()` directly
   the instant the punch fires, regardless of whether the fist's real
   swept path would have reached it — the direct fix for "I punch
   toward an enemy and fly right past it, missing entirely"; `turn`
   does the same guaranteed hit plus a small **instant** (not animated —
   smooth camera rotation is a worse VR-comfort offender than an
   instant snap, same reasoning as "snap turn" locomotion) rig-yaw nudge
   toward the target first (`nudgeYawToward`/`applyYawAroundPoint`,
   pivoting on the head's actual world position, not the rig's
   arbitrary translation origin), so the hit visually reads as landed.
   Both are explicitly framed as an experiment to A/B against each
   other for motion sickness vs. obviousness, per Noah's ask.
6. Impulse magnitude is unchanged: max hand speed, hand travel
   distance, and head travel distance
   (`speedFactor`/`handDistFactor`/`headDistFactor`), scaled by
   `powerMultiplier` ("Move Speed"). **New split**: ambient/incidental
   contact damage (`punch-game.checkHand`, unaffected by whether a
   deliberate punch/uppercut is in progress) now always feeds zero
   hand/head distance into that formula — pure velocity-based, per an
   explicit design note that a graze shouldn't hit as hard as a real
   committed strike. The "lunging" distance bonus only applies via a
   *deliberate* triggered punch/uppercut's own accumulated stats
   (`onPunch`, and — in `cheat`/`turn` hit-assist — direct application
   to the locked target).

Downward swings still don't get a special "smash" boost — a downward
punch is just a punch/uppercut whose computed direction happens to
point down, handled by the same unified system.

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
- **Comfort vignette + "zoom" haptic buzz** (menu, FEEL tab), both
  requested speculatively before any playtesting — untried in a headset
  as of this writing, so the defaults/ranges below are first guesses,
  not tuned ones. Vignette: a camera-child plane (`#vignette`) carrying
  a runtime-painted radial-gradient canvas texture (`buildVignetteTexture`
  — transparent center, opaque edge; canvas pixels beyond the outer
  gradient stop are opaque by default, which conveniently masks the
  plane's corners too), opacity driven every frame in
  `punch-locomotion.updateVignette` from current rig speed
  (`VIGNETTE_REFERENCE_SPEED` for full ramp) and exponentially smoothed
  (`VIGNETTE_SMOOTH_TAU`) so it doesn't flicker between frames.
  `vignetteSize` scales the *plane itself* rather than repainting the
  texture on every menu tweak — cheaper, and avoids a canvas regen on
  every `+`/`-` press. Explicitly added to `world-menu-system`'s
  existing overlay-hide list (see the menu bug-fix note above) since it
  would otherwise freeze mid-fade while the menu is open (rig physics,
  and therefore the speed driving it, pause too). True directional
  motion blur was considered and specifically not built — it needs a
  real post-processing pipeline this project doesn't have, has a real
  mobile-GPU cost, and isn't actually the established comfort mechanism
  (masking peripheral motion, not blurring it, is what vignetting is
  for). "Zoom" buzz: `punch-locomotion.updateBuzzHaptics` fires a short
  pulse to both hands roughly every `BUZZ_INTERVAL_MS` while rig speed
  is above `BUZZ_MIN_SPEED`, intensity scaled by how fast you're
  currently going (`BUZZ_REFERENCE_SPEED` for full intensity) — reuses
  the existing `pulseHaptics` helper already wired into punch-connect
  feedback, since the WebXR haptics API is discrete pulses, not a real
  sustained rumble, so "buzz" is approximated by pulsing quickly and
  repeatedly. Both default on, both fully tunable (Strength 0-200%,
  Vignette also has a Size knob) — genuinely can't be judged from
  outside a headset, and comfort tolerance is personal, so this is
  explicitly meant to be dialed in live rather than shipped at a fixed
  guess.
- **Crash + "vibration doesn't do anything" fix**, first real-headset
  playtest of the above turned up both problems, and both had a concrete
  cause: `pulseHaptics` called `actuator.pulse()` and only wrapped it in a
  synchronous try/catch — but per the Gamepad Haptic Actuator spec,
  `pulse()` returns a **Promise** that a browser can reject (e.g. for
  overlapping pulse calls on the same actuator), and a sync try/catch does
  not catch a rejected promise. With the zoom buzz firing pulses on both
  hands roughly every 90ms during any sustained fast movement, that's an
  unhandled rejection accumulating every cycle of a real play session —
  fixed by explicitly attaching `.catch(function(){})` to the returned
  promise. Separately, `updateVignette` was calling
  `el.setAttribute('material', 'opacity', ...)` and
  `el.setAttribute('visible', ...)` every single frame (70-90Hz) — real,
  avoidable overhead, since `setAttribute` runs A-Frame's schema-diff-and-
  fire-update-handlers machinery meant for discrete events, not a per-
  frame hot path. Fixed by mutating the underlying THREE.js
  `mesh.material.opacity` / `object3D.visible` directly instead, which
  every other frequently-touched per-frame value in this file already
  does. Also added a `hapticActuatorSeen` diagnostic surfaced in the live
  debug HUD as `haptics L:yes/no R:yes/no`, set the first time each hand's
  `pulseHaptics` call runs — so "is vibration unsupported on this
  hardware, or is something actually broken" has a concrete, in-headset
  answer instead of a guess. Verified via Playwright with a fake
  `hapticActuator` whose `pulse()` deliberately rejects 1/3 of calls under
  sustained high-speed movement (the exact condition that fires buzz
  continuously): zero `unhandledrejection` events reached `window` with
  the fix, versus a harness-verified 1-for-1 catch when the same rejection
  is thrown without a `.catch()`. Also re-verified the vignette's
  strength/size/off behavior is bit-identical to the pre-rewrite
  `setAttribute` version (proportional scaling at 50%/100%/200% strength,
  correct 0-1 clamp at 200%, instant zero+hide when disabled). This is a
  real, well-justified, verified fix for a real bug — but "crashes" was
  reported without a specific repro, so if it persists after this, the
  next debugging step needs more specifics (does it happen on a punch, a
  menu open, after N minutes, etc.).

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
Opens via any face button (A/B right, X/Y left) instead of grip, which
got pressed by accident too often during normal punching.

- **PUNCH tab**: Move Speed, Gravity, Max Speed, Reset Arena
- **FOES tab**: Cube Count, Cube Health, Cube Behavior (idle/chase/patrol/wander/mixed)
- **AIM tab**: Lock-On Cone, Lock Range, cycle Hit Assist (off/cheat/turn)
- **REACH tab**: Calibrate Reach, Reach Fwd, Reach Up, Arm Threshold % —
  the reach-calibrated extension detection described above
- **SPLAT tab**: Splat Amount, Splat Scatter, Knockback Force, Trail on/off
- **FEEL tab**: Vignette on/off + Strength + Size, Zoom Buzz on/off +
  Strength — the comfort vignette / haptic buzz described above
- **DEBUG tab**: Live Debug HUD toggle, Stop Spd, Turn Filter —
  punch-detection transparency/tuning, described above
- **MORE tab**: Resume, Exit VR, Show Stats

Two real bugs behind a round of "the menu doesn't work reliably"
feedback, both found by reading things rather than guessing, worth
remembering if you touch UI interaction in this file:
- A-Frame's `cursor` component only binds to real controller button
  events (`triggerdown`/`triggerup`) if you explicitly set its
  `downEvents`/`upEvents` — left at the default (empty arrays), it
  instead listens for mouse/touch events on the canvas, and a real
  trigger pull only produced a click via whatever synthetic click a
  given WebXR browser happens to fire on "select" for accessibility-
  fallback purposes. Confirmed by reading A-Frame 1.6.0's actual
  `cursor` component source (`downEvents.length || upEvents.length`
  gates which listener path gets wired up), not assumed. Both hand
  entities' `cursor` config now explicitly sets
  `downEvents: triggerdown; upEvents: triggerup`.
- The always-on debug line, punch-result label, and opt-in stats/live-
  debug HUDs are all fixed in front of the camera and were staying
  visible (and visually competing with) the menu panel while it was
  open. `world-menu-system.open()`/`close()` now explicitly hide/
  restore them (respecting whichever opt-in HUDs were actually toggled
  on, so closing the menu doesn't un-hide one the player had
  deliberately turned off).

Each new move idea above should probably get its own tab as it's
built, following the same tabbed-panel pattern already in place
(`createTabbedPanel` / `buildSettingsTabs` in `games/punch-pop/index.html`).
