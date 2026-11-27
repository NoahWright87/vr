# Holding: making a hand hold a prefab

The prefab data says where each hand goes (`occupantFor`,
`prefab.holdPlacement`). Nothing yet makes a hand *hold* one. This is the
layer that does, and the one that finally fixes the screenshot that started
all this.

## Move the shooter demo onto prefabs first

`primitives/menus/demo-shooter.js` has a hand-tuned `GUNS` table (`rotY`,
`pos`, `muzzle`) and `index.html` has `heldPosition` and a model rotation per
prop. Replace them with `prefab="id: smg-d"` and the prefab's emitter and
occupant. **The bug in the screenshot is in that table:** `rifle` and `smg`
have `rotY: 180`, but `blaster-a` and `blaster-d` already face -Z (checked
from the models' geometry: barrel at -Z, magazine toward it, stock at +Z), so
the barrel ended up pointing at the player while the muzzle point and the
bullets, at -Z, went the other way. `pistol` (`rotY: 0`) was already right.
The scope and silencer offsets there are guessed the same way and become
attachment mounts (`prefabs.todo.md`).

Drive the real code paths when checking (see `CLAUDE.md`): grab the gun
with the semantic hand, fire, and check the tracer leaves from the emitter
anchor, not just that the page loads.

## Placing the object from the hand

A hand holding an occupant has a pose and a placement. The object goes where
`hand model frame · inverse(occupant)` puts it, where the hand model frame is
the drawn virtual hand (`common/virtual-hands.js`), not the raw controller:
the model sits at a fixed offset from the controller, so the object
is `controller · modelOffset · inverse(occupant)`. Apply the occupant's pose
through `createHandPoser` (`hand-poses.todo.md`). `simple-grabbable` today
parents the object under the hand's `gripEl` with a `heldPosition`; the
prefab path replaces that, behind the same `simple-grabbed` / `simple-released`
events, so props that aren't prefabs keep working.

Which occupant a hand takes: the first free one on the point it grabbed
(the grab picks the *interaction point* by distance, as it picks a
`hint-zone` today). Occupants are by arrival, not side (`prefabs.spec.md`).

## Steering: `drives`

Decided with Noah:

- **Pistols: locked together.** Two hands on one grip: the second hand
  doesn't steer (`drives: false`) and is drawn at its occupant placement,
  rigid with the object.
- **Rifles: the position is driven by both hands.** Every occupant with
  `drives: true` steers. Place the object at the trigger (first) hand and
  take its aim from the line between the two real hands (the object's
  vector between the two points vs the vector between the hands); roll
  can't come from two points, so it comes from the first hand's
  orientation.
- **The hands should be drawn very close to the real controllers**, so the
  object bends to the hands, not the hands to the object. The real hand
  spacing won't match the authored spacing. First pass: the support hand is
  drawn pinned to its point, the existing virtual-hand ghost shows where the
  real hand is, and past a tolerance the support hand lets go.
- **`slide` (optional, later).** Let a point carry a range along an axis
  (a hand on a handguard) so the drawn hand follows the real one along it
  and only the sideways error remains. Noah called this an edge case; it is
  cheap to add to the format and not needed at first.

## Desktop

Everything here has to work from desktop semantic hands too (`TODO.md` ▸
Desktop semantic hands): the semantic hand is placed at the occupant by the
same path, and "steering" there is just the one hand.

## Pistols at Dawn

Still on its own `hand-rig` / `holsterable`. Migrate incrementally as
`TODO.md` ▸ Desktop semantic hands describes; this layer is what it would
migrate *to*. Don't make the shared code depend on Pistols' globals.

## Heavy things

Not authored here. A cannonball takes two hands because it is heavy
(`weight.todo.md`), not because a field says so; its points just say where
the hands go.
