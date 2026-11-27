# Weight, strength and reach

Decided with Noah: no authored "minimum hands". A prefab has a realistic
`massKg`; a player or a game has a strength; the rest falls out. That also
makes the mass useful to a game as a weight limit, or "your character can
only lift X per hand", and the Toybox can demonstrate it with an arm-strength
slider.

## The model

- **Strength is what one hand can raise overhead**, in kg. Per player or per
  game, a tunable (`common/tunables.js`), not a prefab field.
- **Load** per hand = mass ÷ hands holding it (equal split for now).
- **Ratio** = load ÷ strength. At or below about 0.25 nothing changes.
- **Lag.** As the ratio grows, the drawn object (and its hand) trails the
  real controller more. There is no real weight in a controller, so lag is
  the cue. It must only ever move the *hands*, never the view, so it costs
  no comfort. The virtual-hand system already separates the drawn hand from
  the real one and draws a ghost where the real hand is
  (`common/virtual-hands.js`); this is another thing that pulls the drawn
  hand.
- **Reach.** The reachable sphere around the shoulder shrinks, and the
  ceiling comes down first. A ratio of 1 can go overhead (that is the
  definition of strength); around 2 only chest height; heavier than that,
  only carried near the torso. So a super heavy cannonball goes no higher
  than the chest even in two hands, and a cannonball one hand could lug
  can't be held over your head. Heights are relative to the head, so crouching
  works; `semantic-hand.getShoulderWorldPosition` already gives the shoulder.
- **At the limit** the drawn hand and object stop and the real controller
  carries on; the ghost shows the gap, and a small haptic buzz
  (`common/haptics.js`) says you are straining.
- **Throws** scale with the load: strength decides how fast it can be thrown.
- **Minimum hands is derived.** Mass over strength says how many hands lift
  it; nothing is authored. (A prefab's interaction points still limit how
  many can *grip* it.)

## Decide before building

- The curves: lag against ratio, ceiling and reach against ratio. Start as
  tunables with sliders and tune in the headset (`docs/actions/debug-tuning.todo.md`
  describes the approach).
- Default strength in kg, and what a game with no strength set does
  (probably nothing: weight off).
- What happens when a ratio is too high to lift at all: it won't leave the
  ground, or it slips out. And dropping from strain.
- An unset `massKg` (`prefabs.todo.md`).
- Mass when a Toybox toy is resized (cube of the scale).

## Showcase

The 3D Model Toybox watch menu gets an arm-strength slider (and the toy-size
control that already exists), so a person can feel a cannonball and a
bullet and watch the same prefab lag and refuse to rise as the slider
drops.
