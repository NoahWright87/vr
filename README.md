# vr

A collection of small WebXR prototypes for the Meta Quest 2 browser, built with [A-Frame](https://aframe.io) via CDN — no build step, no npm install. Each prototype is a single, self-contained HTML file.

Deployed as a static site (planned: `vr.noahwright.dev` via Netlify).

## Structure

```
/index.html              landing page linking to every prototype
/games/<name>/index.html one folder per prototype, fully self-contained
```

To add a new prototype: create `games/<name>/index.html`, and add a link to it from the root `index.html`. Nothing else needs to change — each game manages its own A-Frame version, components, and assets.

See **[DESIGN.md](DESIGN.md)** for the design philosophy these prototypes are built on — shared systems over features, so that unplanned combinations happen — plus the patterns that produce it, the rules learned the hard way, and measured performance notes.

## Prototypes

- **[Cube Pop](games/cube-pop/index.html)** — point a Quest controller at a floating cube and pull the trigger to pop it. Counter tracks progress; popping all cubes shows a win state with an in-VR reset button. Also has a gaze-reticle fallback so you can validate it from a phone or desktop browser without a headset — see below.
- **[Pistols at Dawn](games/pistols-at-dawn/index.html)** — two boxy pistols holster at your hips, a shotgun rides a bandolier across your back, and a hat sits on your head (hips/back approximated from headset yaw, the hat's spot tracks full head rotation, since there's no real body tracking). Grab any of them the same way — a shared "holsterable" component handles the whole hold/dangle/throw/holster mechanic generically, not just for guns. Grip near one to draw it, aim at a target, and pull the trigger to score — pistols fire a single shot, the shotgun sprays six pellets in a tight cone. Release the grip near a matching anchor to holster it (generously, so it doesn't drop by accident); release it elsewhere while a finger is still on the trigger and it dangles from your finger, swinging and spinning as a simple physics sim reacting to your hand motion. A hard-enough upward release is a throw instead of a drop — aimed so a straight-up toss comes back to the same hand and a toss with sideways intent lands near the other one, for juggling — and anything falling or flying is generously catchable by grip or by trigger finger. The hat rides the exact same mechanics: take it off like drawing a gun, and its spin pivot is offset to one edge of the head-hole (like a finger hooked under the brim) so it twirls like a hat trick instead of a plate.

  Every anchor (hip holsters, head, back bandolier, and a small slot hidden inside the hat's own crown) is a generic "anchor-slot," sized small/medium/large — small fits any slot, medium needs medium-or-bigger, large needs large. Nothing is hardcoded to "guns go in holsters": the hat (medium) can ride your head or the bandolier but not a holster; a pistol (small) fits everywhere, including tucked inside the hat or, if you're feeling silly, worn on top of your head like a hat itself. Each slot shows a small translucent sphere — color-coded by size — that grows more obvious as a compatible carried item gets close and gives a quick "click" bounce right as it enters snap range, since controller vibration doesn't reliably work everywhere. A slot already claimed by something hides its indicator; something actively held with its own slot (like a worn-in-hand hat) will passively catch a falling item that fits, so you can toss a gun up, whip your hat off, and catch it inside.

  Turn around and there's a saloon bar behind you, which exists mostly to find out how far the generic systems stretch. The bottles standing on it aren't special objects — they're the same "holsterable" props the guns are, sitting in the same "anchor-slot" sockets the hip holsters use, so you can stand a beer in your holster or set a pistol on the bar. Knock a bottle's **cap** against the counter edge or the floor and it pops off (the cap carries its own small collider and has to actually strike something — testing the bottle as a whole opened every beer the instant you picked one up, since the snap-into-hand blend reads as fast downward motion). Then tip it past horizontal and it pours, forever, faster the further over it goes. Shoot a bottle and it shatters into glass; throw one hard at the ground and it shatters the same way through a completely different code path. Shattered bottles restock themselves a few seconds later, the way knocked-down targets stand back up.

  Drinking isn't a separate mechanic: the poured beer is real particles, and any droplet that reaches your head goes down your throat. Cigars work the same way round — having one lit in your mouth trickles nicotine in, but holding the tip *at* your lips is a proper draw, which climbs faster, burns the ash down faster, and stops the cigar smoking into the room because you're taking it in. Pull it away and you exhale the whole banked cloud at once. Ash creeps up the tip as a grey segment; flick your wrist or twirl it off your trigger finger and it breaks off, leaving the cigar shorter for good. Smoke one to the band and it's gone, and a fresh one turns up in the tray.

  Fire has three sources beyond "borrow a lit cigar". Matches live in a box on the bar and are lit by striking the **head** on something solid — reusing, unchanged, the collider-crossing test that knocks a cap off a bottle. A Zippo sits next to them: pull the trigger or flick your wrist to work the lid, thumb a face button to strike it, and it's a flame for as long as the lid stays open. A gun barrel you just emptied is the third, since barrels track heat. None of those know what a cigar is: a two-attribute `ignition-source`/`lightable` contract plus a proximity check does all four combinations, and matches and cigars share one `burnable` component that owns burning down, ashing, and being consumed.

  Two things generalized outward from all that. First, **stacks**: a hand holds up to four things instead of one, and an anchor-slot can have a capacity, with contents fanned out either way. So you can hold two pistols in one fist (one trigger pull fires both), carry an armful of bottles and fling them all skyward on one throw for skeet, or clench five cigars in your teeth at once. Grip is a hold rather than a toggle, so building up a fistful uses a quick re-grip: let go and squeeze again within 400ms and whatever you just put down comes back with you, plus whatever's nearest now. Sweep down the bar tapping the grip and you collect bottles. A separate "hurl" throw exists alongside the aimed juggling toss — move your hand across rather than up and your real velocity is used instead of the aiming, with catching briefly suppressed so the generous catch radius doesn't snatch the bottle straight back out of the air. Thrown bottles also fall at 60% gravity, purely so there's time to draw and shoot them.

  Second, **vices** — two meters doing deliberately different jobs, both shown as a percentage at the bottom of your view. Nicotine is the shakes: a fast tremor. Alcohol adds a slow sway, aim drift (your hand chases an under-damped ghost of itself and swings past where you meant to stop), a vignette and warm tint that pulse, and butterfingers — graded, so something twirling off one finger starts getting away from you at around 25% while a properly gripped object only slips past 70%. Both are applied to your **hand**, not to what it's holding, via a child "grip" entity everything hangs off; applied per-object they made the gun swim inside an unnervingly steady fist. The rule the whole design is built around is that **none of it moves the camera** — a view that drifts independently of your head is a vestibular conflict and a reliable way to make someone ill, while a gun barrel that swims is just funny. The vignette is drawn as a quad in clip space, whose vertex shader ignores the camera entirely, because a world-space quad has to match the frustum exactly and WebXR gives you two per-eye projections instead of one FOV to match.

  Fire is its own kind of object, and the thing it burns is spilled drink. Poured beer doesn't vanish where it lands: it pools on whatever it hits — the floor, the bar — and nearby drops merge into one growing disc rather than piling up hundreds of overlapping ones. A puddle that touches anything lit catches. A burning puddle feeds its own flame as it's consumed, and that flame is itself an ignition source, which is the entire implementation of "fire spreads": lay a trail of beer and it walks along it. Fire also lights cigars, burns them down about five times faster than smoking them does, and knocks over any target that stands in it, through the same `fall()` a bullet uses. It has fuel, it grows and shrinks with it, it writhes on a couple of out-of-phase sines, and it drives one shared point light that follows whichever fire is biggest — one light rather than one per fire, since each real light costs a material recompile and per-fragment work.

  A smashed bottle spills its contents where it broke. Nobody implemented a Molotov: pour a puddle, drop a match on it, and throw a beer into the flames — the bottle shatters, its spill is already touching fire, and the whole thing goes up. There's a jug of water on the bar for when that turns out to have been a mistake; water droplets are the same particles beer is, doing the opposite job, and they put out both the flame and the burning surface under it, because dousing only the fire meant the spill relit itself immediately.

  Throwing overhand aims for you. Bring your hand above your own eyeline and swing, and the game rays out from your gaze to find what you're looking at and solves for a launch velocity that lands there — the same courtesy the juggling toss extends, pointed outward instead of back at your own hand. Where in the swing you release picks the arc: let go early, while your hand is still rising, and it lobs; let go near the top and it goes flat and fast. How hard you actually threw scales the speed ceiling, and each object has its own — a shotgun can't be rifled across the range. In testing it lands within a few centimetres of the aim point at 3-5m.

  Guns produce no smoke at the moment of the shot. Instead a barrel remembers how hard it's been worked, and once you stop shooting for a beat, that much smoke curls up out of the muzzle — cheaper than puffing on every trigger pull, and it looks more like a western. Smoke, glass, sparks, beer, fires and puddles all come out of recycled pools (entities are reused from free lists at unit size and scaled, never created and destroyed), which is what keeps a sustained pour or a spreading fire from hitching the frame. You can sweep smoke away by waving a hand through it, or clear it by bringing the muzzle up in front of your face to blow across it. The glug, the cap clink, and breaking glass are synthesized with the Web Audio API rather than shipped as assets, which keeps each prototype a single self-contained file.

  On performance: A-Frame gives you geometry caching (480 meshes in this scene share 80 geometries) and frustum culling for free, but no batching, no instancing, and no material sharing — every mesh here has its own material. The measured problem was neither of those. A-Frame builds `a-cylinder` at 36x18 segments and `a-sphere` at 36x18, about 1300 triangles each, so a scene made of bottle necks and cigars was carrying **276,000 triangles**. Patching the registered primitives' schema defaults once, before the scene initializes, brought that to **27,000** without touching a single creation site. What's left is ~160 draw calls, which is the next thing worth attacking if it ever matters: about 210 of the 480 meshes are the five separate ring discs on each of 37 target faces, and baking a bullseye into one texture would collapse those to 37.

  Hit targets are invincible rings on a board that tips over like a steel pop-up target; a whole group resets together once every target in it is down. The gallery spans an arc in front of you: three tiers of stationary targets at increasing distance, a couple of spinning target wheels, a couple of conveyor belts sliding targets in alternating directions, and a row of whack-a-mole-style poppers that surface on a timer. Also has the gaze-reticle fallback for target scoring, though the grab/dangle/holster/throw/slot mechanic itself is VR-only.

## Running locally

Any static file server works. From the repo root:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080` in a desktop browser to sanity-check the page.

## Testing without a headset (phone or desktop)

Cube Pop has a small reticle (ring) fixed to the center of the camera view, in addition to the VR controller lasers. It works with no headset at all:

- **Phone**: open the deployed Netlify/GitHub Pages URL in your phone's browser. Look around by tilting the phone (it uses the gyroscope); when the reticle sits on a cube, tap anywhere on the screen to pop it.
- **Desktop**: click-and-drag on the page to look around, then click a cube to pop it.

This is meant for quick sanity checks (did my change break spawning/popping/win/reset?) — it's not a replacement for testing the real controller-trigger interaction on the Quest 2 itself.

## Testing on a Quest 2

WebXR only activates in a "secure context" — `https://` origins, or `http://localhost`. A page served from your computer's plain LAN IP (e.g. `http://192.168.1.23:8080`) will **not** show the "Enter VR" button on the headset, even though the 3D scene loads fine. Pick one of these to get a real secure-context URL onto the Quest:

**Option A — USB + adb reverse (no internet needed, fastest for iteration)**
1. Enable Developer Mode on the Quest (via the Meta Quest phone app) and plug it into your computer via USB.
2. Confirm the headset is visible: `adb devices` (install `adb` / Android platform-tools if you don't have it).
3. Forward the port: `adb reverse tcp:8080 tcp:8080`
4. On the Quest, open the browser and go to `http://localhost:8080` — `localhost` counts as secure, so WebXR works over the forwarded USB connection.
5. Put on the headset, navigate to `games/cube-pop/`, and you should see an "Enter VR" button.

**Option B — tunnel (works over Wi-Fi, no USB/adb setup)**
1. Run your local server as above.
2. Run a tunnel, e.g. `ngrok http 8080`.
3. Open the `https://...ngrok...` URL it gives you directly in the Quest Browser.

**Option C — push to a real https host**
Once this repo is on Netlify (or GitHub Pages in the meantime), just open the deployed `https://` URL in the Quest Browser — no local networking tricks needed. This is the simplest option once the site is live, and the same URL works for every prototype in the collection going forward.

### In the headset

1. Open the URL for a prototype (e.g. `.../games/cube-pop/`).
2. Tap the "Enter VR" button that A-Frame renders automatically.
3. Point either controller at a cube; a laser line shows what you're aiming at.
4. Pull the trigger to pop it. Pop all of them to trigger the win state, then point at the green "RESET" box and pull the trigger again to play another round.
