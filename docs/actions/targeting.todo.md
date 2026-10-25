# Targeting: what's next

The resolver, scorer, profiles, claims, recent-gaze memory, overlay and
readout exist. See `targeting.spec.md`.

## Not built yet

- **Line of sight.** Targets currently see through each other and
  through walls (there are no walls yet). When environments arrive,
  give the system a list of occluders (axis-aligned boxes are enough
  for Superhot-style rooms) and do budgeted ray checks: at most N per
  frame, cached per target for ~100 ms. Keep it out of the pure scorer
  as a pre-filter on candidates.

- **The `guard` profile.** Its candidates are *attacks*, not bodies.
  That arrives with `defense`. Attacks register with the same system
  and resolve against hand positions.

- **Pending damage instead of claims.** Claims split two guns across a
  crowd. With multishot and high fire rates, overkill also happens
  within one gun. Track damage in flight per target (shots fired but
  not landed: it matters once bullets have travel time) and treat "will
  be dead" as dead.

- **Spatial pre-cull for the swarm.** Squared distance over every
  target is fine for hundreds of targets. If the swarm goes past ~1000,
  add a uniform grid in `collide.js` and query only the cells inside
  the cone's bounding box.

- **World-space score labels** in the overlay. See
  `debug-tuning.todo.md`. The HUD readout covers it until then.
