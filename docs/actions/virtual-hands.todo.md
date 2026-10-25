# Virtual hands: what's next

The split between tracked and virtual hands, budgeted drift, the
ghost, poses and hiding input visuals all exist. See
`virtual-hands.spec.md`.

## To try in the headset first

- **Does the ghost help or hurt?** Toggle Tuning ▸ Hands ▸ Ghost
  between When apart, Always and Never mid-fight. If seeing the real
  hand makes a pulled punch feel fake, Never might be right, and the
  budget then keeps the mismatch small enough not to notice.
- **Is the glove's orientation (along the arm) acceptable?** It ignores
  the wrist, so a hand held palm-up still shows palm-down. A real
  wrist-roll term from the controller's orientation, applied only when
  it's trustworthy (controllers, not hand tracking), may be wanted for
  blocking.

## Not built yet

- **Smooth pose blending.** Poses switch instantly. An ~80 ms blend of
  the finger block would read better.
- **A proper glove model.** Boxes are a placeholder until there are
  assets. Any model works, as long as it keeps the convention: −Z along
  the arm, +Y up, palm down.
- **Hand-tracking input.** The tracked hand is whatever entity is
  passed. On the hand-tracking branch, point `tracked` at the wrist
  joint entity, and hide that branch's skinned mesh the same way
  `.hand-marker` is hidden.
- **Guns turning through the hand's rotation offset.** The gun turns
  itself (autofire's `turnSpeed`) rather than through a virtual-hand
  rotation offset. That's fine until a held gun also needs to be pulled
  somewhere, for example blocking with it.
