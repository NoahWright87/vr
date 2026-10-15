# Melee: what exists

`common/intent.js` (strike classification, pure, tested by
`tests/intent.test.js`) and `common/melee.js` (the `melee-hands`
component), shown at the Action Lab's Dummies station. What's next is
in `melee.todo.md`.

```html
<a-entity melee-hands="rig: #rig; left: #left-virtual; right: #right-virtual"></a-entity>
```

## Strikes: `common/intent.js`

`createStrikeDetector(settings)` and `updateStrikes(detector,
motionState)` → events. Each hand runs one state machine per axis
(forward and up), generalized from Punch Pop's `punch-tracker`:

1. **armed**: extension below `armAt` (40%).
2. **extending**: crossed `armAt`. Peak speed, start position and
   head position are recorded.
3. **committed**, emitted as `commit`: past `commitAt` (55%) with
   head-relative speed ≥ `commitSpeed` (1.5 m/s), motion energy ≥
   `commitEnergy` (0.3), and **motion mostly along this axis** (so an
   uppercut from a low guard, already well out in front, isn't read as
   a jab). Only one axis per hand can be committed.
4. **land**: a committed strike reaching full extension (`fullForward`
   90%, `fullUp` 80%), or slowing below `stopSpeed` (0.6 m/s).
   Then **hold** until the hand comes back below `armAt`.
5. A slow reach that never commits goes to **hold** silently, at full
   extension or after `maxReachMs` (700 ms). **This is the guard
   against Punch Pop's false positives.**
6. **cancel**: a committed hand pulled back below `armAt` before
   landing.

Events are `{ type: 'strike', hand, axis, phase, t, speed (peak),
travel (from where it armed), headTravel, direction (rig-local unit) }`.
`committedAxis(detector, side)` reports a strike in flight.
`strikeForce(e)` = speed/4 + travel×0.8 + headTravel×2, clamped to
0.3–2.5, so stepping in hits harder.

**Tested with synthetic traces:**

- a fast jab commits, then lands;
- a slow reach, standing at guard, and a 120° body turn with an arm out
  throw nothing;
- an uppercut commits on the up axis only;
- retracting early cancels;
- two jabs make two strikes.

## The loop: `melee-hands`, per hand

1. **Commit → resolve.** `combat-targeting.resolve('strike')` from the
   shoulder. For forward strikes it searches along the arm bent toward
   the motion (`aim + 0.6 × motion`); for uppercuts, along the body's
   facing tipped up 0.15. It prefers this hand's last target. The
   target gets **`action-incoming`** `{ by, point, lean, ms }`, and
   peg dummies lean up to `Lean` toward the fist (free: nothing about
   you moves).
2. **In flight**, the virtual hand shows a fist and is pulled toward
   the target zone's surface, 3 cm past it so the sweep crosses it.
   The pull is limited by the comfort budget.
3. **Contact**, every frame: a swept sphere (5 cm) along the virtual
   fist's motion is tested against every zone of every live target
   within 2.5 m (x/z box pre-cull). The **earliest touch wins**, so a
   peg in the way blocks the punch. Contact is checked before a strike
   is retired, and there's a 250 ms per-hand, per-target cooldown.
   Without a committed strike, contact still counts as a **graze** if
   the hand is moving at least `Graze` speed; a graze is speed-only
   force (Punch Pop's rule).
4. **Follow-through.** `land` doesn't end the strike: contact still
   counts for 160 ms afterwards, because full extension (90%) comes
   before the fist reaches something a little further out. After that
   it's a **whiff**, logged with the target it was meant for, unless
   Assist is **Cheat**, which applies the hit anyway.
5. **Hit.** `applyHit({ zone, point, direction (hand velocity), force,
   damage: force × Damage, source: 'strike', by })`.
   - A **blocked** hit (an obstacle zone) gets a `block` haptic.
   - Anything else gets `hit-heavy` (force > 0.9) or `hit-light`, and
     **hit-stop on the target only**.
   - The target owns its sound and wobble.
   - The log line includes the assist distance.

## Tuning ▸ Melee

| Row | Default | Meaning |
|---|---|---|
| `Assist` | Pull | Off / Pull / Cheat |
| `Lean` | 10 cm | how far a target leans in |
| `Damage` | | damage scale |
| `Graze` | 2 m/s | speed for a graze to hit |
| `Commit` | 1.5 m/s | speed to commit |
| `Commit at` | 55% | extension to commit |
| `Energy` | 30% | motion energy needed to commit |

Readout `melee`: per hand, the axis in flight, the target, and the
last outcome ("forward torso 1.20 (assist 2.0cm)", "whiff (dummy-2 out
of reach)", "blocked by peg-left").

## Dummies station

- **`peg-dummy`** (`common/dummies.js`): a trunk with `head` (×1.5)
  and `torso` zones, plus optional pegs (left, right and middle) as
  **obstacle zones**. A peg hit does no damage and is `blocked`: a
  clack and wood chips.
- On a hit it thumps, throws dust, and rocks on a 2-axis spring
  away from the punch. It counts hits and shows the last force, and
  never dies.
- It's team `dummy`, so guns never target it.
- The lab has two peg dummies either side of a peg-less one in the
  middle.

## Verified in headless Chromium

Real desktop jabs (left click), standing 0.75 m from the middle dummy,
land 4 of 4 with about 2 cm of pull. A desktop uppercut from 0.4 m lands
on the head with 11–14 cm of pull. From 1.25 m, Pull honestly whiffs
and Cheat lands. Straight desktop jabs at a pegged dummy hit the pegs,
since they aren't down the centre line.

**Desktop quirk:** the resting desktop hand pose sits at 45% forward
extension, above `armAt`. The forward axis re-arms only during a jab's
wind-up (which pulls the hand back), which is always how desktop jabs
start. A real guard is around 32%.
