# Physics: needs now, needs later, and whether to use a library

**Decision for now: no physics library.** Everything in the repo is
hand-rolled kinematics, and the near-term needs don't justify a
dependency. This file records why, and the signals that should reopen
the question.

## Near-term needs (hand-rolled, pure, tested)

A small `common/collide.js` of shape queries over plain vectors:

- segment vs. sphere, segment vs. capsule, capsule vs. capsule. Swept
  fists, swept thrown objects, strike paths against hands.
- ray vs. sphere/capsule for hitscan against zones, which is cheaper and
  more controllable than three.js raycasting against meshes.
- point vs. axis-aligned box for simple environment bounds.
- a uniform grid broadphase once target counts get large (the swarm).

Plus simple integrators, all with an oversized-dt guard (Punch Pop's
`cube-behavior` ran away to 100+ m/s on a coalesced frame without one):

- ballistic flight with per-object gravity scale (exists in Pistols);
- knockback slide with friction and floor/wall stops (Punch Pop's
  `applyKnockback`, including impact damage on a hard stop);
- damped springs for dummies rocking and silhouettes ringing.

All of it goes through the action clock's dt.

## Longer-term needs, and how each might be met

| Need | Without a library | With one |
|---|---|---|
| Enemy death | Shatter into pooled shards (Superhot). Fits the look. | Ragdolls |
| Bodies thrown into walls and tables | Kinematic slide + impact damage (Punch Pop already does it) | Rigid bodies |
| Enemies not overlapping each other | Separation steering, as in boids | Character controllers |
| Props stacking, tables tipping, chairs flung | Hard. Faked per prop | This is where a library earns it |
| Enemy navigation | Steering in simple rooms. Navmesh later | Not a physics problem |

## If and when: options

- **Rapier** (`@dimforge/rapier3d-compat`, a WebAssembly build of a
  Rust engine). Fast, deterministic, good scene queries and character
  controllers. About a 1–2 MB WASM download. Probably the right choice
  if it comes to it.
- **cannon-es**. Pure JS, simple, slower with many bodies, adequate
  for a few dozen.
- **ammo.js / PhysX**: heavy. Not worth it here.
- **aframe-physics-system**: wraps cannon/ammo. Its maintenance has
  been uneven, so prefer using an engine directly from a system.

Design the near-term code so a library could slot in later: shape
queries go through `collide.js`'s API, not scattered math, so its
implementation could become Rapier queries without callers changing.

## Signals that should reopen this

- Real rigged enemy assets arrive and shatter isn't the look wanted.
- An environment with lots of loose props is planned.
- Hand-rolled enemy separation visibly fails with a crowd.
