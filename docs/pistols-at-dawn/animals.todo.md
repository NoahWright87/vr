# Animals: horses, and a farm to tend

Long-term (phase 05+). Written down now so nothing built earlier
blocks it.

## Horses

- **Riding** is locomotion the player doesn't fully control, which is
  the classic VR motion-sickness trigger (DESIGN.md: never move the
  camera on the player's behalf). Riding needs real comfort design:
  smooth, steady speeds; turning on your own head or stick rather than
  the horse's whims; a vignette option; maybe the horse's neck and
  saddle in view as a steady frame. Prototype the comfort before
  building anything on top of it.
- **Care and training as progression.** Feed, brush and exercise your
  horse, and it gets faster. That's a progression that isn't on a
  timer and isn't fighting.
- **Horse races** as an activity (`activities.todo.md`).
- **Riding around with friends** and getting into shootouts with NPCs.
  This is the hangout version of the co-op shootouts (`dueling.todo.md`).
- Horses are ghosts too, presumably. 👻🐴

## The farm

- Animals to tend: feeding, collecting eggs, whatever turns out to be
  fun to do with your hands.
- **Lassoing** animals as an activity. The lasso is a shared verb
  first (TODO.md "Weapons not built yet": it's the one thing that pulls
  objects toward you), then a farm activity.
- The farm already exists as an area (`world-farm.js`).

## What earlier work must not rule out

- The player rig must be able to sit on something that moves (the
  revolving bar already proves surfaces can carry objects, DESIGN.md).
- Multiplayer (phase 03-B) must allow for a player who's moving fast
  across the map, not just standing in a duel.
- Animals are characters with expressions, the same as ghosts
  (`aesthetic.todo.md`).
