# Brawlers: what's next

See `brawlers.spec.md` for what exists.

## To try in the headset first

- **Is the spacing right?** `engageRadius` 0.85 m puts a robot's torso
  surface about 0.6 m from your eyes. That's close enough to punch
  without stepping, and close enough to feel crowded. Tune it, and
  `holdRadius`, under Tuning ▸ Brawl.
- **Two at once.** Two engaged robots can wind up together. That's the
  "block one, punch the other" drill, but it may be too much at first:
  set At once to 1.
- **Parry feel.** A parry needs a hand moving *into* the punch faster
  than Tuning ▸ Defense ▸ Parry, early in the strike. Desktop jabs
  rarely manage it, so check it on the headset. If parries are too rare
  in a crowd, widen the Parry window rather than slowing the robots.
- **Does the queue read?** The queued robot stands right behind the
  engaged one. If it looks like a conga line, offset it to one side
  (still inside `shoveCone`).

## Not built yet

- **Blockers that block.** Bags only stand there. A real guard would
  raise the arms when you wind up, so a punch to the head is blocked
  (sparks, no damage) and you have to go to the body or wait for an
  opening. That would be a new obstacle zone on the forearms, the way
  peg dummies' pegs are.
- **Hooks and uppercuts from them.** Every robot punch is a straight
  thrust. Swings (`kind: 'swing'` in the attack contract) need the
  defense resolver to handle an arc.
- **Grabs, throws and shoves** of a robot by the player: push one into
  another directly, not only by parrying.
- **Walls.** Knocked robots slide forever on an open floor. They should
  stop at (and crash into) the play-space edge and props.
- **Performance.** Each robot is about 16 meshes, with two materials of
  its own (the colour flashes). Fine for 12 robots. For a crowd, share
  materials per kind and flash with an instanced colour, or merge the
  body as the steel silhouettes do.
- **Slow-mo while surrounded.** The action clock already slows robots
  (they use `clock.dt(el)`). A "two swings at once" trigger for bullet
  time is the obvious hook.
