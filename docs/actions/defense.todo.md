# Defense: what's next

The attack contract, block/parry/hit/dodge resolution, the magnetic
guard, counters, slow bullets (shot down, deflected or returned),
player-hurt feedback, the attacker dummy and shooters all exist. See
`defense.spec.md`.

## To try in the headset first

- **Telegraph length and strike speed** (Tuning ▸ Sparring ▸ Warning,
  Strike). The design bet is that a readable warning plus a forgiving
  block makes defense feel automatic. Find the shortest warning that
  still feels fair.
- **Guard reach and block radius.** How "roughly near" is near enough?
  Too generous and blocking happens without meaning to. Too tight and
  it isn't magic.
- **Parry speed and window.** Parries should feel like a choice, not an
  accident of blocking fast.

## Not built yet

- **Threats outside your view.** Attacks from behind need a peripheral
  marker (an arrow at the edge of view, in clip space like the hurt
  flash) and a `threat` haptic on that side. Never an automatic turn.
  Audio is already positional.
- **Disarm.** A parry against an armed attacker drops its gun as
  something you can take. That's the John Wick move, and it depends on
  how guns get into hands (`guns.todo.md`).
- **Swings, not just thrusts.** The attacker only thrusts in a line. A
  swing is an arc. The strike volume can stay a capsule (shoulder→tip)
  whose tip follows the arc; `resolveContact` already handles any tip
  path. The guard line would then be the arc's chord near the player.
- **Blocking with a held gun.** Guns sit on virtual hands, so a gun
  hand already blocks with the hand's radius. A gun-shaped capsule
  would be more generous and look right.
- **Dodge feedback.** Dodges are counted but not sold: a whoosh as the
  fist passes your head, and slow-mo on a close dodge, maybe.
- **Death.** `player-hurt` restores health at zero. A real game needs a
  fail state, and the lab doesn't.
