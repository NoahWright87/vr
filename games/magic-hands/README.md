# Magic Hands

A hand tracking spell courtyard at `/games/magic-hands/`. Enable Quest hand
tracking, put the controllers down and enter VR. Each hand can act independently;
farsight and portal creation use both hands.

## Spellbook

| Spell | Movement | Result |
| --- | --- | --- |
| Lightning | Point the index, loosely curl the other fingers and hold the thumb folded roughly parallel | Weaker 8-point bolts every 150 ms; raise the thumb to stop. A faint aim line averages the whole-hand and index axes. Aim assistance and near-miss arcs remain. |
| Farsight | Join fingertips above and hand heels below to form a circle/diamond | Face distance controls about 10× close to the face through 2× at arm's length. Exact thumb contact and spare-finger curl are unnecessary. |
| Shield | Extend an open hand to roughly 80% reach, palm outward | A 0.5 m shield per hand; two nearby extended hands make a 1 m shield. Retracting dismisses it. |
| Boulder fists | Close an empty fist, then punch | Stone forms after 180 ms. A deliberate extending punch deals 60 points or launches a loose prop; retract to rearm. A nearby physical grab can take precedence over an existing boulder. |
| Fireball | Briefly hold a cupped palm upward or scoop a little; throw or thrust forward | A floating orb releases on a natural throw or a cupped forward thrust, with gaze influencing its aim. Exact finger opening is unnecessary. Impact deals 50-point area damage. Gather again immediately, without a reset or recovery pose. |
| Telekinesis | Point at a highlighted rune prop and pinch; yank back and open like a glove to catch | Pinch/move lifts and guides. A quick pull summons the prop into an open catching hand. Push forward to throw. Nearby props can be grabbed with a fist, closing hand or pinch. |
| Portal | Open hands near the chest, backs together/palms outward; push forward and apart | A gaze/hand aim guide previews the destination. The short push-and-spread opens a rectangular doorway. Grab a side to hold it open, then pull to travel, or step through. |

## Tracking and hand ownership

`common/hand-persistence.js` retains the last observed hand for 1.5 seconds when
it leaves the camera view. Missing observations are explicitly marked as
remembered. Held fire, boulders, telekinetic props and an existing portal grip
persist through that interval. No new spell, punch or throw executes while a
hand is unseen; lightning pauses. The remembered hand mesh is hidden, while
held spell feedback says the spell is still held. Reacquisition resets motion
history so a position jump cannot become a punch or throw. A held fireball can
release when an open throwing hand reappears; a returning cupped hand keeps it.
Expired tracking releases props into hover and clears the hand. Session/visibility
interruptions clear input memory and active held spells.

Held spells and objects reserve their hand. Portal preparation reserves both
hands before shield/lightning and empty-hand actions, but cannot steal held fire
or an owned prop. Portal side grabs precede new prop grabs. Farsight formation
precedes other empty-hand physical actions. Fireball release clears its action
immediately; a short shield suppression interval prevents the follow-through
from forming a shield, while allowing another fireball. Other recovery states
expire automatically rather than requiring a particular reset pose.

Lightning uses a 50/50 normalized average of wrist-to-knuckles and index-base-to-tip
directions, with 70 ms aim damping. The longer hand baseline reduces sensitivity
to finger-tip orientation. The curled-finger score tolerates an uncertain spare
finger. A short point hold and thumb-angle hysteresis gate automatic firing;
each hand has its own cadence. Direct hits win; otherwise an 8° half-angle cone
prefers the target nearest aim center. An outer 14° cone allows bounded near-miss
arcs. Solid scenery occludes acquisition and scoring.

Fire can gather from a 240 ms cupped palm-up hold or a short upward scoop. A
forward stroke of roughly 8 cm can release it while still cupped. Throw direction
combines relative hand motion with head gaze (65% gaze). Motion is measured
relative to the head so walking does not throw. Palm-down opening at rest dismisses
held fire and immediately permits gathering another.

For telekinesis, a fresh pinch acquires a highlighted prop within 8 m. Selection
is remembered briefly while the index bends into the pinch. Pulling back about
7 cm with an inward stroke, or about 14 cm more slowly, starts the summon without
requiring a fist. Opening during the pull does not drop it: the prop arrives in
a catching glove. Keep the glove open to hold, push to throw, close then open
to release, or turn the open glove palm-down at rest. Gentle releases hover in
place. Thrown props have swept collision and an unconditional floor clamp; once
settled they rise to a reachable hover. One prop cannot belong to both hands.

Shield reach still estimates shoulders and a default 65 cm arm because WebXR
does not track elbows. Farsight uses the existing circular secondary view and
face-distance zoom. Shields currently display the effect; incoming projectile
blocking remains future work.

## Portal doors

Bring the hands close at chest height with their backs toward each other and
palms facing outward. Slightly forward-angled palms also work. The preparation
is near the body, distinguishing it from extended shields. Two pointing fingers
are no longer a portal gesture.

Look toward clear ground or a colored portal wall. Head gaze contributes 78%
of the aim, with 22% from the palms' forward bisector when available; the aim
is damped over 160 ms. Level gaze selects distant ground rather than sky. A
brief 180 ms preparation makes the guide clear. There is no stillness test:
ordinary aim jitter does not restart it. Push the hands forward about 8 cm
while spreading them by about 14 cm in total. The destination locks as that
movement begins. Brief tracking gaps pause preparation for up to 650 ms.

The opening is rectangular, roughly 0.9–1.15 m wide and 1.8–2.3 m high. The exit
faces the location you cast from, so you emerge looking back toward your old
location. Landings require a clear standing footprint and are rechecked when
traveling. Both portals stay upright on the courtyard's flat floor.

Close a fist or pinch around either vertical side of either doorway. A side grab
restores a shrinking door and holds the pair open. Pulling roughly 24 cm brings
the nearby doorway over the head, with a 2:1 pull gain. Both hands may hold sides.
Unheld portals begin shrinking after 1.4 seconds without interaction and close
over the following roughly 1.6 seconds. A crossing refreshes the interaction
timer; walking back through is possible while the opening is large enough.
Completed casts replace the pair. Reset/session changes close it.

`portal-gesture.js` owns pure gesture, aperture lifetime and rectangular crossing
rules. `portals.js` owns placement, rendering, grips and travel. Each visible
front captures an eye-specific view with the portal transform, that eye's
projection, and an oblique exit clipping plane. Portals visible within that
capture show animated static on their fronts, preventing recursive rendering.
Every back is a solid tinted color. Farsight sees static portal fronts too.
Offscreen targets are 640² per eye/portal and are disposed when closing. Render
target, viewport/scissor, XR state, shadow updates and hidden objects are restored
in `finally`. Player-rig travel transforms XR joints, remembered hands and owned
props consistently; loose world props and projectiles remain where they are.

## Desktop rehearsal and verification

Buttons/keys 1–7 choose joint poses. Drag to look, WASD to move, Space/click uses
the right hand and Q the left. Lightning: hold to fire. Boulders: hold to punch,
release to retract. Fire: hold to scoop, release to throw; repeat without R.
Telekinesis: hold to pinch, G yanks and opens a catching glove, T pushes to throw.
Portal: Space moves both palms forward and apart; after opening, G grasps a side
and pulls. Farsight uses the face-distance slider/scroll; shield uses the reach
slider and H to switch one/two hands. R resets scores, props and active portals.

`npm test` covers persistence and reacquisition, repeated fireball creation,
cupped thrusts and gaze, automatic lightning, yank/open catches, direct grabs,
floor integrity, portal jitter tolerance, opening disambiguation, side grasps,
shrinking and rectangle crossings. `npm run build` creates the deployable site.
Browser regression drives actual keyboard-to-joints-to-actions paths at fixed
16 ms frames, including tracking-loss injection, repeated throws, automatic
fire, glove catches, side holding/reopening, pull travel and return travel.
Separate checks exercise asymmetric eye cameras/ArrayCamera, nested static,
solid backs and renderer restoration. Headset comfort, tracking tolerances and
performance still require real playtesting.

## Next spell design

| Spell family | Candidate interaction |
| --- | --- |
| Belt items | Highlighted body-relative potion/tool slots with physical grabs |
| Two-hand spells | Matching prepared spells link visibly before merging: chain lightning, bigger fireballs, ground slam |
| Necromancy | Index + pinky silhouette, then a deliberate lift to summon |
| Ice breath | A distinct sustained mouth-relative two-hand pose; hand tracking cannot sense breathing |

Add one family at a time and test it against normal incidental movement and the
existing spells. Add incoming practice projectiles so shields can block something.
