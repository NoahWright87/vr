# Magic Hands

An A-Frame hand tracking courtyard at `/games/magic-hands/`. Enter VR with
Quest hand tracking enabled and controllers put down. Both hands work for
lightning; a missing hand does not disable spells on the other hand.

## First spellbook

| Spell | Intent | Recognition | Result |
| --- | --- | --- | --- |
| Lightning | Index points, other three fingers curl; thumb up, then down | 160 ms finger-gun hold; 100 ms raised thumb; thumb-to-index-knuckle distance crosses a lower threshold | Blue fingertip glow, 160 ms beam, 25 points per hit |
| Farsight | Index tips meet above, thumb tips meet below; spare fingers curl | Two matching seams, 2.5–28 cm opening, in front of eyes, plane facing viewer; 240 ms hold | A round second camera view between the hands; 2–16× zoom, smaller opening = greater zoom |
| Shield | All four fingers extend, palm up or forward | Palm direction and open fingers; 220 ms hold | 0.5 m diameter sigil per hand; nearby palms (<40 cm) merge into a 1 m shield |

Lightning needs a fresh thumb lift after every shot, a pose change, tracking
loss, or session interruption. A 300 ms cooldown bounds repeated edges. Farsight
reserves both hands immediately while it settles, ahead of one-hand spells.
Open spare fingers deliberately exclude farsight; curled spare fingers exclude
shield. Resting hands behind/beside the viewer do not activate spells.

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
`finally`. Zoom uses a 60° reference FOV and clamps to 16×. Only one lens pass
runs even though the gesture uses two hands.

## Rehearsal and verification

Desktop: 1/2/3 choose synthetic hand poses, drag to look, WASD to move, Space or
scene click lowers the lightning thumb, release reloads it. Scroll or the
slider changes farsight aperture; H switches one/two shield hands; R resets
scores. Synthetic joints run through the real feature extraction and gesture
state machine. The default view aims at the 4 m target. Targets out to 48 m
give the telescope something to inspect.

Run `npm test` and `npm run build`. Focused tests exercise noisy holds, thumb
edges, disambiguation, missing/invalid joints, symmetric hands, and zoom limits.
Headset playtesting is still required: occluded thumb/index tips, differently
sized hands, palm-up orientations, lens alignment and high-zoom comfort need
real tracking data. Tune gesture thresholds against recorded false positives
before broadening the accepted shapes.

## Next spell design

Add one gesture family at a time and test it against every existing pose.
Prefer a clear preparation pose, visible ready feedback, a deliberate action,
and an explicit release/rearm condition. Reserve hands for two-hand gestures.

| Next spell | Candidate movement | Separation and next technical work |
| --- | --- | --- |
| Telekinesis | Palm down, point at object, pinch thumb/index to acquire; move while pinched, open to release | Different from open upward/forward shield and joined farsight; needs shared grabbable objects and target selection with visible lock |
| Teleportation | Point with index + middle extended, other fingers curled; pinch to confirm a visible landing marker | Two extended fingers exclude lightning; needs valid-floor raycast and explicit confirmation |
| Fireball | Cup one hand near chest to charge, then push the cupped hand forward | Bent fingers exclude shield, no pointing index; needs a motion history, minimum displacement, charge preview and projectile receiver contract |
| Ice breath | Cupped hands near mouth, sustained deliberate hold; extend hands away to stop | Require a mouth-relative zone and a distinct two-hand shape outside the farsight aperture; hand tracking cannot sense breathing, so breath would be a pose-driven effect |

These are proposed gestures, not implemented spells. Capture headset traces
for their preparation, action and ordinary incidental movements before locking
them in. Add incoming practice projectiles next so shields can block something.
