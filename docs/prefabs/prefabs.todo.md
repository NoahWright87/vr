# Prefabs: what's next

- **Attachment mounts.** Sockets exist (`attachments[]` with `accepts`);
  the other half does not. An attachment prefab (a scope, a silencer)
  needs its own `mount`: a `{ type, pos, rot }` saying how it sits in a
  socket of that type. Then attaching is aligning mount to socket. Today's
  scope and silencer offsets in `demo-shooter.js` are exactly the
  hand-tuned numbers this replaces. Also magazines (`accepts` a
  `magazine` type) and bayonets.
- **The bolt, and other moving parts.** A bolt-action rifle has a bolt a
  game may want you to cycle by hand. That is an interaction point
  (a `pinch` pose on the bolt handle) whose hand also *moves a part*.
  Decide how a part's travel is described (axis and range, as a
  `slide`-like constraint) before building it. The interaction point
  itself already works for placing the hand.
- **Mass scales with size.** The Toybox resizes toys. When a prefab is
  resized, mass should scale with volume (cube of the scale ratio) by
  default. Decide where the scale lives (an instance's scale vs `fit.scale`).
- **Mass default.** `massKg` absent means unset. Pick what a game does with
  an unset mass (a guess from the bounding box and a density?) before the
  weight system reads it (`weight.todo.md`).
- **More prefabs.** Only four exist. The rest of the Blaster Kit (18
  blasters, grenades, clips, scopes, silencers, bullets, targets), then the
  originals (pistol, rifle, axe, sword...), then whatever else is *used*.
  Furniture can stay plain props until something needs a door handle.
  Realistic masses where they exist (an M16 is about 3.2 kg).
- **Emitters on more roles.** Only `muzzle` is used so far. The format
  takes any role. The first real ones to add: `eject` (shell casings) on
  the guns, `exhaust` and `smoke` on vehicles when those exist.
- **`stats` into `gun-core`.** `WEAPONS` in `common/gun-core.js`
  (magazine, rate, damage, spread) is exactly the kind of stat a shared
  universe should define once. Decide whether it moves into the prefab's
  `stats` (and how a game overrides it) when guns are migrated.
- **Hand-tracking and per-hand pose.** An occupant has one pose per
  authored hand. If hand tracking needs a different hold from a controller
  (it has no trigger finger to curl), that is a second pose per occupant.
  Not needed until someone tries it.
- **A `catalog` of prefab ids for games.** `getPrefab(id)` works; a way
  to list what a game can ask for (by `role` or `kind`, e.g. "any prefab
  with a muzzle emitter") may be needed once there are dozens.
