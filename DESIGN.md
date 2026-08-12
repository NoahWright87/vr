# Design notes

Working notes for the prototypes in this repo, and specifically for
Pistols at Dawn, which has grown into the place where the ideas get
tried out.

## The core bet

**Build shared systems, not features.** Every mechanic should be a
general capability that some objects happen to have, never a special
case wired to one prop. The payoff is combinations nobody implemented
and nobody predicted — which is where all the joy in this thing has
come from so far.

The test of whether a system is right: can you describe a fun thing it
does that isn't written down anywhere in the code?

Things that were never implemented, and work:

- Wearing a pistol on your head, because a head is a slot and a pistol
  is small enough to fit in one.
- Hiding a gun inside your hat, then catching a *second* thrown gun in
  the hat while you're holding it.
- Clenching a pistol in your teeth, because a mouth is also just a slot.
- Lighting a cigar off the barrel of a gun you just emptied, because
  barrels track heat and heat is an ignition source.
- Standing a beer in your hip holster.
- Making a Molotov: pour a puddle, light it, throw a bottle into it.
  Bottles spill when they break, spills burn, fire spreads along spills.
  Nothing in the code knows what a Molotov is.

When something *doesn't* combine and obviously should, that's the bug —
not a missing feature. "Twirling a cigar should shake the ash off" was
exactly that: shaking already worked, twirling already worked, and they
didn't meet.

## The patterns that produce it

**Split what a thing IS from what it DOES.** A prop is a stack of small
components: geometry (`boxy-gun`, `boxy-bottle`), the generic hold/
throw/holster state machine (`holsterable`), and one thin behaviour
companion (`firearm`, `pourable`, `cigar`). Adding a prop is picking
components, not writing a class.

**Contracts, not lists.** Nothing anywhere holds a list of "guns that
can be holstered" or "ways to light a cigar". Instead:

- `anchor-slot` + `itemSize` — anything small enough fits anywhere that
  will take it.
- `ignition-source` + `lightable` — two attributes and a proximity
  check. Every combination of (cigar, match, lighter, hot barrel, fire)
  works because none of them enumerate the others.
- `.shootable` + a `shot` event — guns raycast a class and emit; each
  target decides what a hit means. Rings tip over, bottles shatter,
  cigars catch light.

If you find yourself writing `if (thing === 'bottle')`, stop.

**Announce, don't act.** Components emit what happened and let others
decide: `holsterable` emits `landed`, and it's `breakable` that turns a
hard landing into broken glass. `breakable` emits `shattered`, and it's
`pourable` that spills the contents. Neither knows about the other.

**Generalise on the second use, not the first.** `burnable` only
appeared when matches needed the cigar's burn-down. `pourable` only
appeared when the water jug needed the bottle's pouring. Guessing
earlier would have got the shape wrong.

## Rules learned the hard way

**Never move the camera.** A view that drifts, rolls or sways
independently of the player's head is a vestibular conflict and a
reliable way to make someone genuinely ill. Drunkenness perturbs the
player's *hands* and paints a head-locked overlay; it does not touch
the camera, and it never will.

**Perturb the hand, not the held object.** Applying the shakes
per-object made the gun swim inside an unnervingly steady fist.
Everything held hangs off a child "grip" entity, so hand and contents
move together.

**Screen-space effects belong in clip space.** A quad placed in the
world in front of the camera has to match the frustum exactly, and
WebXR gives you two per-eye projections instead of one FOV to match. A
vertex shader that writes `gl_Position` directly can't be got wrong.

**A thrown exception kills the entire render loop.** A-Frame runs every
component's tick from one loop. One stale method name froze the whole
scene. Every component registered in `pistols-at-dawn` now has its tick
wrapped: the first failure is logged loudly and that one component is
switched off, and the world keeps running. In a codebase built on
unplanned combinations, degrading beats freezing.

**Never mutate a collection while iterating it.** Particles spawn other
particles from inside the particle loop — a droplet landing makes a
splash. Removal is deferred: mark dead, sweep once at the end of the
frame.

**Aim assist is a feature, not a cheat.** Real hand velocity is too
noisy for anyone to land a juggling catch or hit a target with a thrown
bottle. Throws keep the *intent* of your motion (how hard, which
direction, where in the swing you released) and replace the rest with a
solved trajectory.

## Performance notes

Measured, not guessed. On a scene of ~490 meshes:

- A-Frame gives you geometry caching (490 meshes shared 80 geometries)
  and frustum culling. It gives you no batching, no instancing, and no
  material sharing.
- The real cost was primitive tessellation: `a-cylinder` and `a-sphere`
  default to 36×18 segments, ~1300 triangles each. A scene made of
  bottle necks was carrying **276,000 triangles**. Patching the
  registered primitives' schema defaults once, before the scene
  initializes, took it to **27,000** and touched no creation sites.
- Everything transient is pooled — particles, fires, puddles — reused
  from free lists at unit size and scaled, never created and destroyed.
  Entity creation is the expensive operation in A-Frame.
- Next win if it's ever needed: ~210 of the meshes are five separate
  ring discs on each of 37 target faces. Baking a bullseye into one
  texture would collapse those to 37.

## Testing without a headset

Most of this can be verified headlessly. `playwright` + a local
`aframe` from npm (the CDN is not always reachable) drives the real
scene: call components' `tick()` directly, place hands and objects by
hand, and assert on the resulting state. Every mechanic listed in the
commit history was checked this way before being claimed.

The things that genuinely can't be checked that way, and need eyes in a
headset: whether a pose *feels* right, field-of-view-dependent effects,
and anything tuned by feel (wobble amplitudes, flick thresholds, reach
distances). Those are called out in comments where they occur.

A randomized soak test — thousands of frames of pouring, igniting,
shooting, smashing and dousing at random — is what found the crash that
weeks of ordinary play only hit occasionally. Worth re-running after any
change to the shared systems.
