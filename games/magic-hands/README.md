# Magic Hands

An A-Frame hand tracking courtyard at `/games/magic-hands/`. Enter VR with
Quest hand tracking enabled and controllers put down. Both hands work for
lightning; a missing hand does not disable spells on the other hand.

## First spellbook

| Spell | Intent | Recognition | Result |
| --- | --- | --- | --- |
| Lightning | Index points, other three fingers curl; thumb tip goes from perpendicular to parallel with index | 160 ms finger-gun hold; 35 ms perpendicular thumb, then 20 ms parallel thumb; no thumb position requirement | Blue glow + faint aim line, assisted-target marker, 160 ms arcing bolt, 25 points per hit |
| Farsight | Fingertips touch above and hand heels touch below, forming a circle or diamond | Any non-thumb fingertip pair; generous heel/finger seams, visible opening; no spare-finger curl or thumb seam requirement; 180 ms hold | A circular second view between the hands; about 10× near the face (12 cm), 2× at arm's length (65 cm) |
| Shield | Extend open hand to at least 80% reach, palm outward | Estimated shoulder-to-palm reach and outward palm direction; 220 ms hold; retraction/inward palm dismisses immediately | 0.5 m diameter sigil per hand; nearby palms (<40 cm) merge into a 1 m shield |
| Boulder fists | Close an empty fist; punch after the stone forms | 180 ms fist hold, then at least 12 cm extension and an outward stroke; retract to rearm | Stone surrounds the fist; punches deal 60 points and launch loose stones |
| Fireball | Cup palm upward and scoop about 8 cm | A static palm does nothing; scoop takes at least 100 ms, then an opening hand and deliberate throw release it | Floating fire orb, gently arcing projectile, 50-point area impact and impulses to nearby props |
| Telekinesis | Point at a purple-highlighted rune prop, then pinch | Fresh pinch acquires a prop within a 12° aim cone and 8 m range; only one hand owns a prop | Move to lift, pull back + fist to summon/grasp, open + push to throw; release quietly to drop |

## Hand ownership and physical spells

`spell-sandbox.js` owns the stateful physical spell actions and a small swept-
sphere simulation; `sandbox-view.js` renders their poses and publishes the same
`magic-hit` / `magic-cast` contracts used by lightning. Three rune props can be
lifted, directly grabbed, pulled into a hand, punched and thrown. Two nearby
targets are positioned for boulder practice; the distant targets work with
lightning, fireballs and thrown props. Fireballs have a small aim assist and
bounded projectile count; collisions sweep the entire frame path so fast
throws do not pass through targets or solid scenery. Solid scenery uses
conservative bounding boxes for these physical spells.

A held fireball or telekinetic object reserves its hand, including while the
fingers close or open. Grabbing a nearby prop takes precedence over equipping
an empty fist. Farsight formation takes precedence over new empty-hand actions.
After a throw or boulder dismissal, the hand must settle near the body before
another spell can take over; an open follow-through cannot summon a shield.
Tracking loss releases held props with zero velocity and dismisses held fire;
session interruptions also clear flying fireballs. Reset restores props and
scores. Only deliberate throws can make props damage targets.

Motion intent is measured relative to the head, so walking with a fist or
carrying a fireball does not count as a punch/throw. Fire release uses the last
100 ms of hand motion to preserve a natural throw that slows as the hand opens.
Telekinesis remembers the highlighted prop for up to 250 ms while the pinch
bends the index, provided the hand stays nearby and the path remains clear.
The labels above each hand show forming, ready, held and recovery states.
Open a held fire hand palm-down at rest to dismiss it. For telekinesis, opening
at rest drops the object; opening during an outward push throws it. Each hand
acts independently. These thresholds still need headset tuning for real hand
occlusion, especially pinching while closing into a grasp.

Lightning needs a fresh thumb lift after every shot, a pose change, tracking
loss, or session interruption. Each hand has its own 100 ms cooldown and angle
hysteresis: raised is roughly 63–90° to the index; bent is within roughly 46°
of parallel (either direction). A brief spike does not fire. Farsight reserves
both hands even during loose formation, ahead of lightning and shield.
Resting hands close to the chest do not activate shields. WebXR has no elbow
or shoulder tracking: shoulder positions are estimated 16 cm to either side,
22 cm below the head; the default shoulder-to-palm reach is 65 cm. This is an
estimate of 80% arm extension, not a measured elbow angle.

Lightning aims along the index base-to-tip vector, smoothed over 45 ms. The
faint guide follows that actual aim; a marker identifies the current hit or
assisted target. Direct hits win. Otherwise an 8° half-angle cone prioritizes
the closest angular center, with distance breaking ties. An outer 14° cone
allows arcs only if the raw ray misses the target surface by at most 65 cm.
Hidden, occluded, behind-hand and out-of-range targets are excluded. Mark
solid world geometry with `data-magic-blocker` so it occludes target acquisition
and bolts. Assisted bolt endpoints match the actual scored surface hit.

`common/hand-gestures.js` contains input-independent vector features,
declarative one-hand gesture definitions, hysteresis/dwell gates and spell
arbitration. `hand-input.js` converts complete WebXR joint poses (world metres)
to those features and draws skeletal hands. Partial/invalid poses immediately
release that hand. Frame gaps over 180 ms discard temporal state.
The outward palm normal uses the [WebXR joint convention](https://www.w3.org/TR/webxr-hand-input-1/).
`spells.js` renders effects and publishes `magic-hit` on generic
`[magic-receiver]` targets. Receivers decide the reaction and publish scoring;
new spell types can reuse this contract. Shields currently provide a visual
spell preview; projectile blocking will need incoming projectiles.

Farsight is a 512² circular render target at the aperture, with a second camera
aimed from the head through the circle. Only this view has 65 ms pose damping;
normal head tracking is untouched. It renders at most 30 Hz while active,
hiding hands, spells and HUD during the pass, and restores renderer state in
`finally`. Zoom uses a 60° reference FOV and clamps to 2–10× based only on
head-to-window distance; opening size changes the window, not zoom. Only one lens pass
runs even though the gesture uses two hands.

## Rehearsal and verification

Desktop: 1–6 choose synthetic hand poses, drag to look, WASD to move, Space or
scene click bends the right lightning thumb; Q bends the left. Release reloads.
Scroll or the farsight slider moves the fixed-size window toward/away from the
face. The shield slider extends/retracts arms; H switches one/two shield hands; R resets
scores. Synthetic joints run through the real feature extraction and gesture
state machine. The default view aims at the 4 m target. Targets out to 48 m
give the telescope something to inspect.

For boulders, wait for stone to form, then hold Space/Q to punch and release to
retract. For fireballs, hold Space/Q to scoop, wait for fire to form, then release
to throw. For telekinesis, hold Space/Q to pinch the highlighted prop; G pulls it
into a grasp and T pushes/throws it; a simple release drops it. These controls
produce joint poses and motion, not direct spell commands.

Run `npm test` and `npm run build`. Focused tests exercise noisy holds, thumb
edges, disambiguation, missing/invalid joints, symmetric hands, and zoom limits.
Headset playtesting is still required: occluded thumb/index tips, differently
sized hands, estimated arm reach, lens alignment and high-zoom comfort need
real tracking data. Tune gesture thresholds against recorded false positives
before broadening the accepted shapes.

## Next spell design

Add one gesture family at a time and test it against every existing pose.
Prefer a clear preparation pose, visible ready feedback, a deliberate action,
and an explicit release/rearm condition. Reserve hands for two-hand gestures.

| Next spell | Candidate movement | Separation and next technical work |
| --- | --- | --- |
| Teleportation | Point with index + middle extended, other fingers curled; pinch to confirm a visible landing marker | Two extended fingers exclude lightning; needs valid-floor raycast and explicit confirmation |
| Belt items | Reach into a potion/tool's highlighted belt zone, then grab | Nearby item intent takes precedence over empty-hand spells; needs belt slots and usable items |
| Two-hand spells | Bring matching prepared spells together and wait for visible linking feedback | Needs explicit pairing and ownership; planned examples include chain lightning, merged fireballs and a boulder ground slam |
| Necromancy | Index + pinky extended; lift the hand to raise a summon | A distinct silhouette; needs coarse finger recognition, summon behavior and commanding/recall interactions |
| Ice breath | Cupped hands near mouth, sustained deliberate hold; extend hands away to stop | Require a mouth-relative zone and a distinct two-hand shape outside the farsight aperture; hand tracking cannot sense breathing, so breath would be a pose-driven effect |

The rows in this final table are proposed gestures, not implemented spells. Capture headset traces
for their preparation, action and ordinary incidental movements before locking
them in. Add incoming practice projectiles next so shields can block something.
