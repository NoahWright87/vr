# Melee: what's next

Strike intent, targeting, budgeted pull, lean-in, swept contact,
obstacles, follow-through, whiff and cheat all exist. See
`melee.spec.md`.

## What went wrong before, and the rule each failure produced

From Punch Pop. Keep these true:

| Failure | Rule (and where it lives now) |
|---|---|
| Non-punches read as punches while still, and slid the player | Assists are paid from motion energy (`comfort-budget`). Strikes need speed, energy and a direction to commit (`intent`). |
| Turning with a hand out read as a punch | Torso-relative extension (`motion-sense`), with a test for it. |
| `cheat` auto-hit felt arbitrary | Sell it: the virtual fist really arrives, the target leans in and reacts. Cheat is kept only as a comparison setting. |
| `turn` helped, but rotating the view is risky | No view yaw by default. The hand and the target do the work. |
| A component cached at `init()` was sometimes undefined | Look components up at the point of use (melee does). |

## To try in the headset first

- **Commit thresholds** (Tuning ▸ Melee ▸ Commit, Commit at, Energy).
  Too strict and real punches don't commit (no assist, honest whiffs).
  Too loose and gestures commit. The `melee` readout shows each hand's
  state live.
- **How much pull is right?** Comfort ▸ Hand gain and Hand max cap it.
  Watch the `comfort` readout's wanted/got numbers for punches that felt
  like misses.
- **Lean** at 10 cm: does a dummy stepping into the punch look like
  it's reacting, or like it's cheating?

## Not built yet

- **Hooks and hammers.** Only forward and up axes exist. A hook is a
  lateral arc. Its extension doesn't grow much along any one body axis,
  so it may need a different signal (angular speed around the torso).
  Get real recordings first (`intent.todo.md`).
- **Lunge.** Optional rig travel toward the target, paid from real head
  travel (`comfort-budget.grantMove`, which has no caller yet). Only if
  headset testing says melee feels static.
- **Combos.** Stickiness already prefers the last target. Chaining
  bonuses (damage ramp, a juggle when launching with an uppercut) are
  game design for later.
- **Knockback on a kill**, Punch Pop style: a slide, and impact damage
  on a hard stop. Needs a mobile enemy. Silhouettes and peg dummies are
  fixed.
- **Elbows and knees:** no tracking for them. Elbow strikes might be
  inferable later (a hand close to the shoulder moving fast).
