# Virtual hands

Split **the hand you control** (tracked) from **the hand you see and that
hits things** (virtual), so assists can make a punch connect or a guard
meet an attack without moving the camera. Optionally show a translucent
**ghost** of the tracked hand when they differ.

## Where hands are today

Each page has two entities per hand (see `primitives/menus/index.html`
around line 103):

- `#left-hand`/`#right-hand` carry `hand-with-watch` and `semantic-hand`.
  This is the gameplay hand: the fingertip, the grip child, desktop
  posing.
- `#tracked-hand-visual-*` carry A-Frame's `hand-controls`, the rendered
  low-poly hand model, visible in XR only.

Both are driven straight from the controller pose. Hand tracking (on
the unmerged `claude/hand-tracking-demo-ivpmd4` branch) renders through
a different component entirely.

## Plan

- A `virtual-hand` component per side, a sibling of the tracked
  entities under the rig. Each frame it copies the tracked pose and
  adds an **offset** (position plus a small rotation) that the comfort
  budget grants. Offsets come from requests ("pull toward point P,
  weight w"), resolved once per frame, so melee, guard and gun requests
  don't fight.
- **Its own model.** A simple low-poly glove or fist. It doesn't reuse
  `hand-controls` or the hand-tracking mesh. That sidesteps two input
  renderers, and it lets the virtual hand take any pose.
- **Pose is output, not input.** Actions don't read hand poses, so the
  game is free to *show* one: a fist while a strike is extending, an
  open palm while guarding, a gun grip while holding a gun, relaxed
  otherwise. Blend between them over ~80 ms.
- **The ghost**: the tracked hand drawn at about 25% opacity, without
  depth write, shown only while offset > ~1 cm. A visor setting picks
  always / when offset / never. Whether it helps or hurts the feeling of
  owning the hand is an open question. The setting exists to answer it.
- **Collisions use the virtual hand.** Strike sweeps, guard volumes and
  gun muzzles all hang off it. The tracked hand is only intent input.
- **Hiding the input models.** In XR, hide `hand-controls`' mesh (keep
  its pose updates) when virtual hands are on. Desktop already draws its
  own semantic hand. Make the virtual hand replace that too, so desktop
  shows exactly what XR shows.
- **Held things** (guns) parent to the virtual hand's grip point, so a
  gun can turn toward its target as part of the hand's rotation offset.
  Within limits: a gun pointing 40° off from the wrist reads as broken,
  so the gun's own extra yaw needs its own cap and should be tested.

## Tests

The offset resolver (requests + budget → offset) is pure and can be
tested. In the browser: with no requests, the virtual and tracked hands
coincide exactly every frame (no lag). That's the regression that would
make everything feel floaty.
