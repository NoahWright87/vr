# Throwing, generalized

Pistols at Dawn already has an intent engine for throws. It's spread
across `holsterable.release()` (`core-equip.js` ~1600) and
`computeThrowVelocity` (`core.js` ~1497), and it classifies a release as:

| Kind | How it's recognised | What it does |
|---|---|---|
| **overhand** | hand above eye level (+2 cm) and speed > 1.5 m/s | gaze ray picks the target (`findLookTarget`). Where in the swing you let go picks the launch angle: rising → 50°, falling → 12°. Solves for speed, capped by object and arm speed (`computeOverhandVelocity`). |
| **hurl** | horizontal speed > 1 m/s and ≥ 0.7× the vertical | your real velocity × 1.9, plus loft if thrown flat. Catch suppressed 500 ms (`computeHurlVelocity`). |
| **toss** | upward speed > 0.8 m/s | the arc height comes from your flick, and the horizontal part is re-solved to land in this hand or the other one, depending on sideways intent (juggling). |
| *(none)* | otherwise | holster check, then fall. |

There's also `solveArcAtSpeed` (`core.js` ~1649): a fixed-speed,
solve-for-angle ballistic used by the bow. Constants are in `core.js`
around lines 226–250 and 549–563.

## What changes when it's generalized

- **Pure module** `common/throw-solve.js` holding the classification
  and both solvers over plain vectors. Classification takes
  `motion-sense`-style hand velocity and position plus head position,
  not a `hand-rig`.
- **The target comes from `combat-targeting.resolve('throw')`**, not
  only the gaze ray. Gaze stays the dominant term in that profile, and
  the resolver adds stickiness and "recent gaze", so a target you just
  looked away from still counts.
- **Moving targets**: lead them. Solve against the target's position
  at the predicted flight time (iterate the solve twice), then allow a
  light homing correction in flight, within a tunable cap. A bullet
  heaven allows more homing than a realistic game would.
- **Two release sources.** With a held object (a grip), the release
  moment is the grip opening, as in Pistols. Empty-handed
  (position-only), the release is the whip's speed peak from `intent`,
  which spawns a thrown weapon (knife, star) from the loadout. Both
  feed the same classification and solve.
- **A thrown thing is a slow bullet** (Pistols' DESIGN.md says the
  same). On contact it emits the same `action-hit` with
  `source: 'throw'` and a sweep test against zones, like melee's.
- **Fun later**: recall to hand (axe or boomerang), ricochet between
  targets (an upgrade, same as autofire's).

## What not to bring

Stacks, juggling to the other hand, dangling, and holsters are
Pistols' prop-play features. They aren't needed for combat throwing.
Pistols keeps them, and migrates onto the shared solver much later.

## Tests

Pistols' README claims "lands within a few centimetres at 3–5 m".
Make that an actual test of the pure solver, including the
out-of-range case falling short honestly.
