# Autofire: what's next

The full loop exists. See `autofire.spec.md`. Bullet-heaven logic: the
player stops aiming and becomes very powerful, so the game can throw far
more enemies at them.

## To try in the headset first

- **Does the shoulder→hand line feel like "where I'm pointing"?** If
  guns go to targets you didn't mean, try a blend toward head→hand for
  hands close to the face (`motion-sense.todo.md`).
- **Is `Present` at 55% the right off-switch?** Too low and the gun
  fires while you gesture. Too high and you have to lock your elbow.
- **Is the gun turning visibly broken?** At Wide, a gun can point 80°
  off the arm. If that reads as wrong, cap the turn lower than the cone
  and let the cone only *choose*.

## Not built yet

- **Pierce and ricochet.** Pierce continues the hit along the line to
  the next target behind. Ricochet hops to the nearest other target
  within a few metres. Both are fields on the weapon, as multishot is.
  Needs the ray-vs-zones query along the shot line (`collide.rayZone`
  over candidates).

- **Weapon definitions as data.** Today every gun shares Tuning ▸ Gun.
  Make a weapon a data object
  (`{ rate, damage, multishot, pierce, spreadDeg, recoil, sound }`)
  with per-hand loadout, so a shotgun and a pistol can coexist. The
  tunables group then edits the selected weapon.

- **Slow bullets** for the Superhot look: projectiles with travel
  time (6–30 m/s) instead of hitscan, still homing to guarantee the
  hit. Then pending damage in targeting matters.

- **How the gun gets in your hand** (still undecided): always armed;
  drawn by reaching to the hip (position-only: a fast pass through a
  hip zone); or taken from a disarmed enemy (`defense.todo.md`).

- **Reload as a flourish**, off by default: bring the gun to the other
  hand, or drop it to the hip. Still position-only.

- **What to lift from Pistols** (ideas, not globals): barrel heat and
  the post-firing smoke curl (`items-guns.js` `firearm`), shell
  casings.

- **A gun pose on the virtual hand.** Arrives with `virtual-hands`.
  Until then the gun floats at the hand position and the hand marker
  shows through.
