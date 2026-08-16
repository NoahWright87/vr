# Todo

Things deliberately deferred, with enough context to pick them up cold.
Ideas that aren't committed to yet live in DESIGN.md or in conversation;
this is only for work that has been decided on and postponed.

## Liquids

- **Dissipation rates per surface.** Right now a puddle dries at a rate
  belonging to the *liquid* (`dryRate` in `LIQUIDS`). It should also
  depend on what it's lying on: beer on a varnished bar top should sit
  there, and the same beer on dirt should soak away. The hook already
  exists — `HARD_SURFACES` entries are objects, so a `dryFactor` on the
  surface, multiplied into the liquid's own rate, is most of it. The
  awkward part is that a puddle doesn't currently remember which
  surface it landed on, only its height; `addToPool` would need to
  store the surface alongside `y`.

  Not doing it yet because surfaces are currently three rectangles and
  a floor, and the interesting version of this needs more of a world
  than that.

## Performance

- **Instanced droplets.** Every particle is its own entity with its own
  mesh and material, so the liquid budget (420) is really a draw-call
  budget in disguise. Nothing in testing has come close to it, but a
  flamethrower emptied into open sky would. `THREE.InstancedMesh` for
  the droplet pool is the fix; it's a real change because the whole
  particle system assumes an entity per particle.

## Hands holding too much

A hand holds up to `HAND_CAPACITY` (4) things at once — grip again with
a full-ish hand and you pick up another, and anything released near
your other hand while it's busy gets silently caught into it too (see
`findCatchingHand`). That's fun for an armful of bottles and bad for
everything else: it let a fist end up carrying (and firing, on one
trigger pull) several guns at once, and once a hand accumulates a few
unrelated things there's no way out of it — no gesture drops just one,
and the other hand can't reach in and pull a single item free. The
only way out was to release the whole fistful and start over.

**Shipped as a narrow, immediate fix**: a hand can now never hold more
than one firearm (`core-hand-rig.js`'s `hasWeapon()`, checked in
`onGripDown`, `reclaimStash`, and `findCatchingHand`). Scoped
specifically to things with a `firearm` component — pistol, shotgun,
sniper — since those are what actually had the "one trigger, several
guns" bug. The bow and launcher weren't touched: neither has `firearm`,
neither exhibits that bug (each fires through its own distinct
mechanism, not the generic multi-fire dispatch), and stacking rework
in general was explicitly out of scope for this pass. Worth revisiting
if a bow/launcher ever ends up feeling like it has the same "stuck
holding it" problem in practice.

That's a patch, not a fix for the underlying stacking model. Real
rework ideas, roughly in order of how directly they address "I got
stuck holding a bunch of stuff":

- **A way to shed one specific item without releasing the whole
  fist.** Today, letting go drops (or throws, or holsters) everything
  in that hand at once. Something like: point at/toward one held item
  and a face button drops just that one, reflowing the rest — mirrors
  how a slot's fan already reflows when one occupant leaves.
- **A way for the other hand to pull a single item out of a full
  hand.** Right now grabbing only finds a *loose* grabbable; there's
  no path to reach across and take one specific thing out of the other
  hand's fistful. This is probably the more valuable of the two — it's
  the direct fix for "I can't get it back out."
- **Reconsider silent, automatic catching near a busy hand.** A hand
  that's gripping something already doesn't ask before absorbing a
  second item that wanders into `THROW_CATCH_RADIUS` — that's the
  actual mechanism behind "accidentally end up holding a bunch of
  things." Maybe catching should need the hand to be more clearly
  *offered* (fingers open, not already closed around something) rather
  than just proximity + grip-held.
- **Size- or type-aware capacity instead of one flat `HAND_CAPACITY`.**
  A fistful of bottles is the intended fun case; a fistful of anything
  else mostly isn't. Something like a per-itemSize cap, or a
  capacity that only applies to a whitelist of "stackable" props,
  would generalize the one-firearm rule instead of special-casing it.

## Refactor leftovers

From the games/pistols-at-dawn/js/ file split (see DESIGN.md's "File
structure" section for the rationale and the two bigger open
questions already tracked there — whether "no build step" still holds,
and how the split should be shaped once code is meant to move into a
shared library):

- **Duplicate `CIGAR_PUFF_INTERVAL_MS`.** `core.js` declares it twice
  (1100, then 750 a bit further down, silently shadowing the first) —
  a pre-existing bug from before the split, left in place rather than
  fixed so the split itself changed nothing about which value actually
  runs. Worth deciding which one was meant to win and deleting the
  other; both are currently commented as pointing at each other so
  whoever looks at either one finds the other.

## Weapons not built yet

Ideas that have been agreed as worth doing, in rough order of
fun-per-effort:

- **Blunderbuss.** The purest form of the loaded-socket idea: a
  wide muzzle with a `capacity: 4` socket. Ram in gravel, bottle caps,
  cigars, a whole beer, and fire whatever you loaded.
- **A real pump on the shotgun.** The forend is currently decoration.
  Sliding the support hand along the barrel should eject and chamber,
  one shot per pump. Small change, and it's the same two-handed
  operation the gatling crank will need.
- **Fanning the hammer.** Hold the trigger, slap the hammer with your
  other palm. The "hand strikes a small collider fast" test already
  exists — it's how bottle caps come off and matches light.
- **Lasso.** Hard, but it adds a verb nothing else has: pull things
  toward you. Which would finally let you get at the bottles on the
  back-bar shelf.
- **Hand-cranked gatling** and **duelling catapults.** Both need a home
  outside the bar, mounted out on the range. Both are built from
  systems that now exist: two-handed operation, a loaded socket, and
  projectiles.
