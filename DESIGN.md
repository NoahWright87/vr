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
- Drinking fire. Fire is a liquid, liquid that reaches your mouth gets
  swallowed, so of course you can. It costs you nothing but dignity.
- Setting the bar alight and then revolving it, which delivers a
  burning armoury. Fire is a pool, pools ride surfaces that move, and
  the bar is a surface that moves.
- Hanging a beer bottle on a gun peg, or laying your hat in a rifle
  cradle. A rack is a socket; a socket doesn't ask what you're putting
  in it.
- Shooting a stick of dynamite out of the air, or out of somebody's
  hand. It's `.shootable` and it explodes when hit; nothing had to
  agree that this was allowed.
- Blowing a rack of bottles across the room, catching one in mid-air,
  and drinking it. A blast hands loose objects a velocity, which is
  the same thing your arm does, so everything downstream of a throw
  applies.
- Loosing a beer bottle, or a lit stick of dynamite, from the bow. The
  nock is an anchor slot and slots have never asked what you're
  putting in them.
- Shooting a flaming arrow into a puddle of spilled beer on the far
  side of the room and setting the floor alight. An arrow is
  lightable, a lit one publishes heat, and pools catch from heat.

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

## The liquid system

The largest shared system, and the clearest example of the bet paying
off. Everything that flows exists in exactly two states:

- **Droplet** — in the air. A sphere with a velocity, falling under its
  own type's gravity, given a sideways nudge at birth so a poured
  stream reads as a spray rather than a wire.
- **Pool** — resting on a surface. A flat disc. Drops landing near one
  join it and it grows, which is both what liquid does and what keeps a
  five-second pour to one object instead of four hundred.

A liquid *type* is nothing but data: colour, weight, spread, lifetime,
and what it does when it hits you or hits something hot. Adding
gasoline or whiskey is a data blob, and it inherits pouring, pooling,
merging, drinking, dousing and burning for free.

**Fire is a liquid.** That is the whole design:

- a fire droplet is a flame in the air, and it falls, lazily;
- a fire pool is burning ground, and its radius *is* its fuel;
- a burning pool throws droplets back into the air, more often and
  higher the bigger it is;
- those droplets land somewhere slightly else and start burning there.

That last step is the entire implementation of fire spreading. There is
no spread function. Fire crawls along a spill because its flames
physically land further along it, it jumps small gaps because a flame
can travel about a metre, and the wind that already pushes smoke will
blow it downwind for free. Alcohol meeting fire doesn't "catch" in any
special sense either — the pool changes type and its volume becomes
fuel.

The one rule this needs to stay honest: **a jump must cost the source
more fuel than its landing returns**, or fire feeds itself off its own
sparks and burns forever. Spread must come from flames reaching *new*
fuel, never from fire creating fuel.

A steady flame also sits on each burning pool, underneath the jumping.
Without it the effect reads as popcorn; with it, the jumps are tongues
coming off something solid. Setting the jump rate to zero leaves a
perfectly good conventional fire, which is how the idea was de-risked
before it was tried.

## Projectiles: a thrown thing is a slow bullet

A bullet was an instant raycast; a thrown bottle was a falling object
that only noticed the floor. So you could not knock a target over by
throwing something at it, which is the "obviously should combine and
doesn't" smell the whole design is supposed to catch.

The fix isn't a collision system. Anything in flight fast enough casts
along the short distance it covered this frame, and if it crosses
something `.shootable` it emits the very same `shot` event a pistol
emits. Targets fall, bottles shatter, cigars light — all through code
that already existed and none of which learned a new word. What the
impact means to the *thing that hit* is announced separately as
`impact`, and left to whatever companion cares.

Two details keep it honest. A **speed floor**, because setting a gun
down on a bar covered in bottles is not an attack, and without one
every gentle release near the shelf would smash something. And backing
the ray up to where the object started the frame, so a fast throw
can't tunnel between two positions.

The scan of the scene is now shared: the first caster in a frame pays
for it and everyone else reuses the list. That was already true within
one shotgun blast; it needed to become true across casters once
dynamite could put twenty objects in the air at once.

## Explosions, and dynamite as an assembly of other people's parts

`detonate()` is a plain function, not a component, because a stick of
dynamite and (next) a rocket both want the same thing to happen at a
point in space and neither wants to own it. It spills burning fuel,
knocks over targets through the same `fall()` a bullet uses, shatters
glass through the same `shatter()`, and hands every loose object a
velocity — which is to say it *throws* them, through the ordinary
throw path, so a blasted bottle is still catchable in mid-air and
still shootable out of it.

The stick itself is the clearest case yet of assembling rather than
writing. Its fuse is `buildBurnStick` — literally the object a match
is made of — so it ashes as it burns, can have its light flicked off,
and is lit by every existing fire source without any of them being
told dynamite exists. `holsterable` is the throw. `lightable` is the
match. The only new component is `explosive`, which listens for the
three ways anything here ends — a fuse running out, a hard impact, and
being shot — and calls `detonate`. That is the whole weapon.

## The bow: two hands, and neither of them presses anything

Almost none of the bow is bow code. The second hand on the string is
the *support grip* the shotgun's forend already introduced — the only
new idea is `supportBehind`, one boolean meaning "the second hand is
behind this rather than out along it", which makes a drawn bow aim
down the line between your hands the same way a braced shotgun does,
read backwards. The draw is then simply how far apart your hands are,
and loosing is letting go, which holsterable already announces.

What flies is whatever is in the nock, and the nock is an ordinary
anchor slot with room for three. Nothing says it takes arrows, so it
doesn't: three arrows leave as a fanned volley, a beer bottle leaves
as a beer bottle and smashes into whatever it reaches (because a
thrown thing is already a slow bullet), and a lit stick of dynamite
leaves as somebody else's problem.

The aim cheats on purpose, and the cheat is the mirror of the overhand
throw's. That one fixes the ANGLE your swing picked and solves for
speed; the bow fixes the SPEED your draw earned and solves for the
angle, then leans most of the way from where the bow is pointing
toward that answer. Judging an arrow's arc by eye in VR is not fun;
watching one drop onto a target across the room very much is.

Two bugs worth remembering, both found by the harness rather than by
reading:

- **A bow catches its own arrow.** The nock is a slot on a held
  object, and a held object with a slot on it is supposed to catch
  things — that's "use your hat to catch your gun". The arrow was
  being snatched back on the frame it left. The fix was the existing
  hurl flag, which already means "this is emphatically leaving".
- **Lerping two equal-length vectors gives a shorter one.** Blending
  the bow's aim toward the solved arc quietly robbed a full draw of a
  third of its power. Blend the directions, then put the speed back.

## Loading, as a shared idea

Three weapons now, and the interesting thing is that the third one
cost almost nothing. A bow is a socket on a string; a launcher is a
socket in a tube. Both hand whatever is in that socket a velocity and
let the projectile system take it from there.

That's the whole design, and it produces the jokes for free, because
an `anchor-slot` has never asked what you're putting in it: you can
nock a beer bottle, ram a lit stick of dynamite down the launcher, or
put a rocket in your hat. Nothing had to permit any of that, and
nothing would have to be touched to add a blunderbuss.

The rocket is the clearest measure of how much was already built. It
is: an `explosive` that's armed, so contact is enough; plus a motor
that pushes along its own velocity and cancels most of gravity while
it burns, which is the one behaviour that makes it read as a rocket
rather than a thrown brick. Flight, impact, scoring, fire, the blast
throwing the furniture around — all of that is machinery that existed
for thrown bottles and a stick of dynamite.

## The scope is real, and that's why it's usually off

The rifle's scope is a second camera with an 11-degree field of view
rendering the scene to a 256px texture that is then the glass in the
eyepiece. Which is to say it costs a whole extra pass over a scene of
about 160 draw calls, per frame, and that is not a bill worth paying
for a rifle hanging on a wall.

So it only renders when the eyepiece is within 22cm of your head. The
optimisation turned out to be the mechanic: the glass is dark until
you bring the rifle up and put your eye behind it, which is what a
scope does anyway. Cheapest kind of win — the thing that makes it
affordable is the thing that makes it feel right.

Three hazards, all the same hazard, all from rendering inside somebody
else's frame: put the renderer's target back, switch WebXR off for the
duration (or three.js renders the off-screen pass in stereo into the
headset's own framebuffer), and hide the lens before rendering or it
films its own last frame — an infinite corridor, which is a lovely bug
and quite useless as a sight.

`scope` is its own component rather than part of the rifle, because
looking through a tube has nothing to do with firing one. It's "a disc
on this object showing what a narrow camera down its -Z can see",
which would work just as well as a spyglass or a mirror behind the
bar.

## The revolving bar

The clearest bill of health the "shared systems" bet has had. The
counter is a drum with the saloon on one face and an armoury on the
other; shoot the bell hanging over it and the whole thing turns over.

The interesting part is how little of it is the turn. Nothing on the
bar is "on the bar" in any sense the code knows about — every beer,
cigar, match and lighter is parented to an anchor slot, and every slot
is parented to the counter. Rotating one entity brings the lot, and
there is no take-the-bottles-with-it code because there was never a
list of bottles to take. The armoury is likewise not a new kind of
thing: it's the same `addBox`/`addSlot` calls the bar already used,
authored in the same coordinates, on a child entity turned 180°.

Only two things needed saying out loud, and both because they are the
things in the scene that *aren't* parented to anything:

- **Spilt liquid.** A pool is a world-space disc, so a spun bar would
  leave your beer hanging in the air where the counter used to be.
  Pools resting on a moving surface now ride it round.
- **The counter as a hard surface.** A hard surface is an axis-aligned
  rectangle, which stops being true the moment it turns. Surfaces can
  now name the object they're mounted on and keep their rectangle in
  *that* frame, so the counter goes on being a counter mid-spin — you
  can still crack a bottle cap on it while it's moving.

The geometry has one honest compromise in it. The axis has to be the
counter's own centre or the faces don't swap places, and that axis is
0.92m from where you stand while the bar is 3.4m wide, so the ends
sweep straight through you. There is no pivot that avoids that: you
are standing at the edge of a turntable. Rather than fight it, nothing
on the drum reaches above chin height, so the sweep passes *under*
your view rather than blacking it out — at the halfway point you're
standing in the middle of the bar looking down its length, which is
better than the effect anyone was aiming for. The tall back wall and
the high shelves are scenery and don't move.

## Stock and perishing

Two components that are only safe as a pair, and which say something
about how to add supply to a world like this.

`stocked` goes on a *slot* and means "this socket knows what belongs in
it": one gets built there at scene load. Give it a `refillMs` and it
keeps doing it, however many times the socket goes bare. It never
learns what became of the last one, which is what separates it from
`breakable`'s respawn — that one is an object coming back from the
dead, this one is a shop restocking a shelf. `perishable` goes on the
*item*: a clock that only runs while the thing is loose on the floor or
in the air, and stops dead the moment anything holds it — a fist, a
fingertip it's twirling on, or any socket anywhere in the scene.

That one number, `refillMs`, is the whole difference between a holster
and a shop, and it took a wrong turn to notice. Making the hip holsters
refill was defended at the time as "no special cases" — but it's a
gunslinger standing next to a vending machine, and it robs the armoury
of the only job it has. A holster is stocked once and is thereafter a
pocket: what's in it is what you put there. An armoury peg refills,
because an armoury is where guns come from. Same component, one
number, and the *uniform* rule turned out to be the wrong rule.

Either component alone is still a bug. A refilling rack on its own is a
gun printer: strip the wall, drop the lot, come back in ten seconds. A
perishing item with nothing that replaces it eventually leaves an empty
world. Together, the number of guns settles at the number of refilling
sockets — which no code enforces, counts, or even knows. A soak test
that strips everything eight times over lands there on its own.

The knock-on: what a pistol IS had to move out of markup and into a
maker function so a rack could build one, and once it had, three props
in markup became one prop and three sockets.

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
frame. The same rule caught the second case for free: A-Frame runs
every component's tick from one list, so an entity removing *itself*
from the scene mid-tick (a perished gun) mutates the list being walked.
Same fix — mark it, sweep it once.

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
- Writing a primitive's *dimension* rebuilds its geometry. Every
  anchor slot pulses its indicator sphere by writing `radius` each
  frame, which was free with five slots and is not free with the
  armoury's rack of empty ones — an occupied slot early-outs, an empty
  one never does, so a wall of bare sockets is a wall of spheres being
  rebuilt to the size they already were. Writing only on an actual
  change is a two-line guard.
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
