# The comfort budget: what exists

`common/comfort-budget.js`, tested by `tests/comfort-budget.test.js`.
Why it exists and what's left are in `comfort-budget.todo.md`.

**The rule:** assists are a gain on real motion this frame. A system
only *requests* an assist, and the budget grants what the player's
physical motion has paid for. Stillness earns nothing.

## Pure core

- `stepHandOffset(offset, desired, handTravel, energy, settings)` →
  `{ offset, wanted, granted }`. It moves a virtual hand's offset toward
  `desired`:
  - **growing** the gap is allowed `master × handGain × handTravel ×
    energyFactor(energy, handEnergy)`;
  - **closing** it is allowed `master × recenterGain × handTravel`,
    with no energy needed;
  - the offset is clamped to `handMax`.

  So a still hand never drifts, and a slow reach (motion but low
  energy) never drifts away.
- `grantYaw(requestedDeg, headYawDeltaDeg, settings)` is capped at
  `master × yawGain × |head yaw this frame|`. `yawGain` defaults to 0,
  so the view is never turned.
- `grantMove(requestedM, headTravelM, settings)` is capped at
  `master × moveGain × head travel`. It defaults to 0 and has no caller
  yet.
- `energyFactor(energy, floor)` is 0 at or below the floor, rising to
  1 at full energy.

## Settings: Tuning ▸ Comfort

| Row | Default | Meaning |
|---|---|---|
| `Assist` | 100% | master scale; 0% turns everything off |
| `Hand gain` | 60% | drift per cm of real hand travel |
| `Hand floor` | 20% | motion energy needed to drift away |
| `Hand max` | 15 cm | the most a virtual hand may ever be off |
| `Return` | 80% | recentring per cm of real travel |
| `View yaw` | 0% | view turn per degree of head turn |

## Ledger and readout

`recordAssist(channel, wanted, granted)` keeps a rolling one-second
total per channel. The `comfort` HUD readout shows, for example,
`hand R: wanted 9.0cm got 3.1cm /s`: the single most useful line when
a punch felt like it missed.

## Callers

`virtual-hand` (hand drift and return) is the only caller so far.
