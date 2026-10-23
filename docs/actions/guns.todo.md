# Guns: what's next

Real guns exist: the pistol, SMG and shotgun; a restocking table;
grip/trigger/throw; trigger, auto or both fire modes; always-on aim
assist; and magazines. See `guns.spec.md`. The bullet-heaven idea
stays: aim assist means the player doesn't need to be precise, so the
game can throw more enemies at them.

## To try in the headset first

- **`Grip tilt` (38°).** It's derived from A-Frame's Touch ray config,
  not measured. If guns point high or low with your hand held
  naturally, tune it, then make the right value the default.
- **Assist cone.** Soft (25°) is the default. With the trigger back in
  your hands, find where it stops feeling like aiming and starts
  feeling like the gun does it.
- **`Fling` speed.** Too low and setting a gun down throws it. Too high
  and flicks drop it at your feet.
- **Does `Reach` grab work with hand tracking?** It's the position-only
  path. Grip needs a controller (or a pinch mapped to grip).

## Not built yet

- **Reload.** Off by design (empty, throw, grab another), but a
  John Wick reload flourish (bring the gun to the other hand, or slap
  the bottom) could be a position-only gesture.
- **Pierce and ricochet**, as weapon data fields: continue along the
  line to the next zone, or hop to a nearby target.
- **Two-handed shotgun.** The shotgun is held one-handed by its grip.
  A support hand on the forend should steady it (Pistols has support
  grips), and a pump on the forend could replace the 280 ms limit.
- **Slow bullets for the player's guns** (Superhot), still guaranteed
  to hit: projectiles with travel time, using `projectiles.js`'s
  guidance. Pending damage (`incoming`) already exists for them.
- **Holsters.** Guns currently come only from the table. A hip slot
  that holds one is the next step toward how a real game gets guns into
  hands.
- **Disarming enemies** (`defense.todo.md`): a parry that drops their
  gun as a `loose` gun you can take.
- **Two guns, one trigger.** With a gun in each hand on desktop, Space
  fires both. In a headset each trigger fires its own hand, which is
  right.
