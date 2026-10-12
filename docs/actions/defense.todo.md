# Defense: block, parry, counter

Put your hands roughly near an attack and it's handled.

## The attack contract

Nothing attacks the player yet. Attackers (`dummies.todo.md`'s
attacker dummy and shooter silhouette) create **attacks**: records
registered with targeting under the `guard` profile.

```
{ id, by, phase: 'telegraph'|'windup'|'active'|'recovery',
  path: { from, to } or projectile { position, velocity },
  radius, aimAt: 'head'|'torso', t0, durations }
```

- **Telegraph** (~400–800 ms, tunable): readable warning. The limb
  glows and a faint line traces the strike path. It's also an audio
  cue, positioned in space. Attacks from outside your view get a
  peripheral marker and a haptic pulse on that side, never an
  automatic turn.
- **Active**: the only phase that can hurt you or be defended against.
- Outcome when it resolves: `hit | blocked | parried | dodged | deflected`.

## Resolution, during the active phase

- **Block**: any virtual hand (or a held gun) within `blockRadius` of
  the strike path. The virtual hand is pulled onto the contact point
  within the budget (a magnetic guard). The attack stops and the
  attacker gets a small push. `blockRadius` grows if the hand is moving
  toward the attack, which rewards reaching for it.
- **Parry**: a block made with the hand moving fast *into* the attack,
  early in the active window. The attacker is staggered and **opened**
  for a counter window (~1 s). Parry is a stronger block decided only
  by motion, so it still needs no button.
- **Counter**: during the opened window, strikes against that attacker
  get maximum targeting priority and bonus force. Later: a disarm drops
  the attacker's gun as something you can take.
- **Dodge**: the head leaves the attack's path. That's free, since
  physical movement is the game.
- **Deflect** (projectiles): a virtual hand or gun touches a slow
  bullet and it's knocked away, or with an upgrade, sent back at its
  shooter. Shooting a bullet down goes through autofire, with incoming
  projectiles as high-threat targets.

## Getting hit

Hits land on head or torso volumes estimated from `motion-sense`. The
feedback: a red edge flash in clip space (as Pistols' vices vignette
does, `items-vices.js`), a haptic on both hands, a sound. **No camera
shake, no knockback of the view.** Health is a simple counter for now.

## Station

Sparring: one attacker dummy, then two. The visor tunes telegraph
length, active window, block radius, parry speed, and pull-in budget.
The readout shows the last outcome and why ("blocked: right hand 14 cm
from path, moving toward it at 1.8 m/s").
