# Platforms: VR first, but everyone can play

## Decisions

- **Most VR projects in this repo should eventually work with mouse
  and keyboard, phone, and gamepad too.** Not the top priority, but two
  real wins:
  - **Faster testing.** Once the VR-specific parts are settled, content
    can be checked without a headset.
  - **The whole family can play together** with only two headsets.
- **Not Quest-specific.** Only Quest hardware is available to test on,
  but nothing should assume it. Use WebXR's generic input profiles and
  don't hard-code Quest controller layouts.
- **This belongs in shared code (`common/`), not in Pistols at Dawn.**
  The work is already underway: TODO.md "Desktop semantic hands"
  describes desktop input posing the same hands VR uses, and confirms
  Pistols' hand-rig works unmodified under it. Pistols *uses* that,
  and Pistols' own todos only cover what's specific to it (e.g. a
  desktop way to draw from a holster or twirl).

## What this means for Pistols' plan

- **Multiplayer (phase 03-B and after)** should allow players who
  aren't in VR. Their ghost moves and aims like anyone else's, driven
  by the shared hands. That answers the open question in
  `multiplayer.todo.md`: yes, eventually.
- **Activities and duels** should avoid relying on things only VR can
  do, or provide a non-VR version.
- **Comfort options** (smooth vs. teleport movement, snap vs. smooth
  turning, a vignette, seated play, left-handed) are shared settings
  too. Horses, wagons and floats depend on them (`animals.todo.md`,
  `deck.todo.md`).

## Non-VR tools

Separate from playing on desktop: small web pages for tuning things
without a headset. The Voice Lab (`phase01-z.todo.md`) is the first,
and the Ghost Lab (`phase02-d.todo.md`) the second. They're reached
from a Utilities section on the site (`process.todo.md`).
