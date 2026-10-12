# Targets and dummies

Stand-ins for enemies until there are real assets. The long-term look
is Superhot-like: a limited number of low-poly figures and simple
environments. So these should already be low-poly bodies with zones,
not abstract cubes.

Built so far: `combat-target` (see `targeting.spec.md`) and the
steel silhouette, with rail/pop-up/walker movers, tip and shatter
deaths, and a spawner (see `dummies.spec.md`). Everything below that is
not marked built is still to do.

## Contract: `combat-target` (built)

Anything that can be targeted, shot, struck or thrown at. It registers
with the targeting system (`targeting.todo.md`) and declares:

- **zones**: named spheres or capsules in local space (`head`, `torso`,
  `armL`, ...) with a damage multiplier and a targeting priority.
  Zones, not meshes, are what gets hit, so the visuals can be swapped
  without touching hit logic.
- `team`, `alive`, `threat` (0–1, how dangerous right now: an attack in
  progress is high).
- an **aim point** per verb: guns aim at the torso by default, head for
  "precision" upgrades; strikes aim at the head or torso by height.

Hits arrive as one event, `action-hit`, whatever caused them:
`{ zone, point, direction, force, damage, source: 'gun'|'strike'|'throw'|..., by }`.
It's the same idea as Pistols' `shot` event (`items-guns.js`
`fire()`: `{point, direction, damage}`, non-bubbling, sent to the hit
entity) with `zone`, `force` and `source` added. Keep the field names
compatible so Pistols' targets could later listen to both.

## The dummies, in build order

1. **Steel silhouette** (built). A flat cut-out with head and torso zones. Hit:
   rings and rocks back on a spring. Head shot or enough damage: tips
   over and resets after a delay. This is the autofire range's target.
   Variants: on a rail (slides back and forth), pop-up (rises on a
   timer), walker (advances toward you at a fixed speed and stops at
   1.5 m).
2. **Peg dummy (mook jong).** A trunk with three pegs (two high, one
   mid) and a leg. Zones on the trunk at head and torso height. The
   pegs are obstacles, not targets. It's for melee: does a punch slip
   between the pegs and land on the trunk? It reacts by rocking on a
   spring proportional to `force`.
3. **Attacker dummy.** The peg dummy with a motorised arm that swings
   at you on a telegraphed schedule. It's the source of attacks for
   `defense.todo.md`. See the attack contract there.
4. **Shooter silhouette.** A silhouette that fires slow, visible
   projectiles (Superhot bullets, ~6–10 m/s) at your head or torso.
   They can be dodged, deflected, or shot out of the air.
5. **Swarm walker.** The cheapest possible body (one instanced mesh per
   type, one capsule zone) that walks straight at you. It's the
   bullet-heaven stress test: how many can be on screen with autofire
   running before the Quest 2 drops frames? Record the answer in the
   spec.

## Reactions sell the hit

Per `README.md` principle 4, the target does a lot of the selling:

- **Lean-in**: during a committed strike that's targeting it, the
  dummy may rotate or step up to ~10 cm toward the incoming fist, so
  contact happens. This is the cheapest assist there is, with no comfort
  cost. Make it a tunable.
- **Flinch**: react on contact, not a frame later.
- **Knockback**: simple kinematic slide and tilt with friction, as in
  Punch Pop's `cube-behavior.applyKnockback`. That's a decent
  reference, including its oversized-dt guard and the "impact on a hard
  stop deals damage" idea.
- **Death**: shatter into pooled low-poly shards, Superhot style
  (built for silhouettes).
  It fits the eventual look, it's cheap with a pool, and it avoids
  ragdolls entirely (see `physics.todo.md`).

## Spawning and resetting

A small spawner that a station configures: which dummy, how many, the
pattern (arc, line, random ring), and respawn on death. The visor has
Station ▸ Reset and counts.

## Performance

The swarm walker must not be built from per-part `a-entity` boxes the
way the silhouette is (5 meshes each). Use one `InstancedMesh` per body
type, with each walker a slot, as `action-effects` does for particles.
`combat-target` zones stay per walker; they're just data.
