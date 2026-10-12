# Melee: punches always connect

## What went wrong before, and the rule each failure produced

From Punch Pop (`games/punch-pop/TODO.md` and its README section have
the long history):

| Failure | Rule |
|---|---|
| Non-punches read as punches while still, and slid the player | Assists are paid from motion energy (`comfort-budget`). Negative recordings in tests (`intent`). |
| Turning with a hand out read as a punch | Torso-relative extension geometry (`motion-sense`). |
| `cheat` auto-hit felt arbitrary | Sell it: the virtual fist actually arrives (`virtual-hands`) and the target reacts (`dummies`). |
| `turn` helped, but rotating the view is risky | View yaw only within the budget, default 0. Prefer moving the hand and the enemy. |
| A component cached at `init()` was sometimes undefined (init order race) | Look components up at the point of use. |

## The loop

1. **Sense**: a strike `commit` from `intent`.
2. **Resolve**: `combat-targeting.resolve('strike', ...)` from the
   torso, in the strike's direction, gaze-weighted. Prefer the current
   target (combos).
3. **Bring them together**, cheapest first:
   - the target leans in up to ~10 cm (free);
   - the virtual fist is pulled toward the zone's surface, within the
     budget;
   - (optional, default off) a lunge, with rig translation paid from
     real head travel.
4. **Contact**: a *swept* test of the virtual fist (a segment from last
   frame's position to this frame's, as a capsule with the fist's
   radius) against the target's zone capsules. At 72 Hz a 6 m/s fist
   moves 8 cm per frame and would tunnel through a point test.
5. **Damage and force**: Punch Pop's `computeMagnitude` (max hand
   speed, hand travel and head travel, so stepping in rewards you). A
   graze (contact with no committed strike) is speed-only, as in Punch
   Pop.
6. **Sell**: hit-stop on the *target* (not the player), haptic, thump,
   flinch, knockback.

If the budget can't close the gap, the punch **whiffs honestly**. A
`cheat` setting can still force the hit, for comparison.

## Station

The peg dummy (`dummies.todo.md`), then three in an arc to test
switching targets between punches.

## Not possible

Kicks and knees: there's no foot tracking. Elbows: maybe, as a strike
whose hand is close to the shoulder with the elbow estimated. Later.
