# Wiring: what a prefab does, and overriding it

A prefab says what an object *is*. What happens when you use it is a game's
business, but nobody should have to wire up the obvious. Decided with Noah,
modelled on the StarCraft 2 editor: *this Gun fires this Rocket and this
MuzzleFlash; the Rocket spawns this Explosion when it dies.*

## Defaults, overridable

- A prefab may carry **default wiring**: events and what they spawn. A
  rocket launcher, its rocket and the explosion are wired together by
  default. Dozens of games can have the same M16 and none of them define
  its muzzle flash, shell casings or magazine.
- **A game overrides** by changing an entry in its own data: the same M16
  firing plasma balls instead.
- **Resolution order:** the game's override, then a Toybox session override
  (below), then the prefab's default.
- The wiring names effects by prefab id, and emitters by *role*, not by
  position. Emitters already exist in the format (`role`, a place, -Z out).

## Shape (not built, not fully decided)

Data triggers, in the style of the SC2 editor: an event name and a list of
spawns.

```json
"events": {
  "fired": [
    { "emitter": "muzzle", "spawn": "fx-muzzle-flash" },
    { "emitter": "muzzle", "spawn": "bullet-556", "speed": 880 },
    { "emitter": "eject",  "spawn": "casing-556" }
  ]
}
```

and on the bullet: `"events": { "hit": [{ "spawn": "fx-spark" }], "death": [...] }`.
Behaviors stay code: `gun`, `projectile`, `throwable` (fire control in
`common/gun-core.js` is the model). A prefab names which behaviors it has
and their parameters; game code emits the events. The engine part is small
and generic: take an event, find the spawns, place each at its emitter.

## To decide

- **Where the defaults live.** In the prefab itself (Noah: "where it makes
  sense, we could have defaults"), or in a separate per-universe wiring file
  that a prefab can be looked up in. The M16 working everywhere argues for
  the prefab.
- **How a game overrides:** a per-game table keyed by prefab id (or by
  role) replacing individual spawns.
- **Spawn cost.** A 13 shots-a-second SMG spawning a flash, a casing and a
  bullet each shot needs pooling. `common/action-effects.js` already pools sparks, shards,
  muzzle flashes and tracers (`docs/actions/feedback.spec.md`); spawns should
  come from there, not from creating entities per shot.
- **Stats and `WEAPONS`.** `gun-core`'s numbers (rate, magazine, spread,
  damage) are the first real consumer of a prefab's `stats`
  (`prefabs.todo.md`).

## The Toybox as the demo

A little menu in the 3D Model Toybox for changing a prefab's attributes,
*including what it emits and how*: the override layer made visible. Pick the
M16, change its `fired` projectile to a plasma ball, fire it. A session
override only; nothing is saved, and a game ships its overrides in data.
