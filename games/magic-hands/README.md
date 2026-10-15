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

Desktop: 1/2/3 choose synthetic hand poses, drag to look, WASD to move, Space or
scene click bends the right lightning thumb; Q bends the left. Release reloads.
Scroll or the farsight slider moves the fixed-size window toward/away from the
face. The shield slider extends/retracts arms; H switches one/two shield hands; R resets
scores. Synthetic joints run through the real feature extraction and gesture
state machine. The default view aims at the 4 m target. Targets out to 48 m
give the telescope something to inspect.

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
| Telekinesis | Palm down, point at object, pinch thumb/index to acquire; move while pinched, open to release | Different from extended outward shield and joined farsight; needs shared grabbable objects and target selection with visible lock |
| Teleportation | Point with index + middle extended, other fingers curled; pinch to confirm a visible landing marker | Two extended fingers exclude lightning; needs valid-floor raycast and explicit confirmation |
| Fireball | Cup one hand near chest to charge, then push the cupped hand forward | Bent fingers exclude shield, no pointing index; needs a motion history, minimum displacement, charge preview and projectile receiver contract |
| Ice breath | Cupped hands near mouth, sustained deliberate hold; extend hands away to stop | Require a mouth-relative zone and a distinct two-hand shape outside the farsight aperture; hand tracking cannot sense breathing, so breath would be a pose-driven effect |

These are proposed gestures, not implemented spells. Capture headset traces
for their preparation, action and ordinary incidental movements before locking
them in. Add incoming practice projectiles next so shields can block something.
