# vr

A collection of small WebXR prototypes for the Meta Quest 2 browser, built with [A-Frame](https://aframe.io) and a deliberately small Vite multi-page build. The smaller prototypes remain mostly single-file experiments; Pistols at Dawn and the shared primitives have deliberately outgrown that convention.

Deployed as a static site (planned: `vr.noahwright.dev` via Netlify).

## Structure

```
/index.html                   React entry point (mounts src/App.jsx) — the only non-VR page
/src/App.jsx                  landing page content: linking to every prototype and primitive
/src/theme.js                 color tokens fed to @noahwright/design's theme
/games/<name>/index.html      one folder per prototype
/primitives/<name>/index.html one folder per reusable interaction showcase
/common/menus.js              shared menu rows, pages, chrome, and projection
/common/watch-menu.js         shared wrist watch and pointing interaction
/common/locomotion.js         shared locomotion component
/common/checkerboard.js       canvas-generated checkerboard surface, colour-derived
/common/color-utils.js        hex parsing/blending the checkerboard derives shades with
/common/guardian-bounds.js    WebXR play-space boundary → a rectangle you can build against
/common/desktop-controls.js   desktop intent, movement, and interaction modes
/common/interaction-hints.js  semantic hands, hint zones, mounted/grab primitives
/common/interaction-targeting.js deterministic input-agnostic target selection
/vite.config.js               Vite entries and runtime-asset copying
```

Every prototype/primitive page is still vanilla A-Frame with no build-time framework, per the project's usual approach. The one exception is the root landing page: it's a small React app using [`@noahwright/design`](https://github.com/NoahWright87/design) for shared branding across sites, since it's the one page that isn't a VR scene.

To add a new prototype: create `games/<name>/index.html`, add it to the Vite inputs in `vite.config.js`, add a card to `src/App.jsx`, and import only the shared modules it uses. `watch-menu.js` imports its menu dependency; locomotion remains independent.

## Development

```sh
npm install
npm run dev
```

`npm run build` produces the deployable site in `dist/`, and `npm run preview` serves that production build locally. Existing prototype URLs are preserved by the multi-page inputs.

A-Frame itself is vendored into `/vendor` rather than loaded from the `aframe.io` CDN — see [`vendor/README.md`](vendor/README.md) for why and how to bump versions.

See **[DESIGN.md](DESIGN.md)** for the design philosophy these prototypes are built on — shared systems over features, so that unplanned combinations happen — plus the patterns that produce it, the rules learned the hard way, and measured performance notes.

## Prototypes

- **[Cube Pop](games/cube-pop/index.html)** — point a Quest controller at a floating cube and pull the trigger to pop it. Counter tracks progress; popping all cubes shows a win state with an in-VR reset button. Also has a gaze-reticle fallback so you can validate it from a phone or desktop browser without a headset — see below.
- **[Punch Pop](games/punch-pop/index.html)** — punch-to-move locomotion POC. There are no laser pointers here; you move by physically throwing punches, and you pop cubes by hitting them with a fist that's moving fast enough. See below for how it works and how to tune it.

### Punch Pop: how it works

The core idea being tested: **punching is the locomotion**, not a separate joystick/teleport system.

- Both hands are tracked independently and identically — each has its own `punch-tracker` component instance, so there's no shared state that could cause only one hand to register. Hand pose comes from `oculus-touch-controls`, the Quest-native controls component, confirmed on real hardware to actually bind both controllers. The in-headset debug HUD shows `L:ok`/`L:--` and `R:ok`/`R:--` so a real tracking dropout is visible immediately instead of looking like a game bug.
- **Detection is reach-calibrated, not velocity-thresholded** — a full redesign after playtesting kept landing "either too hard to register or way too twitchy" however the velocity thresholds got tuned. The reframe: stop asking what a proper punch or uppercut technically *is*, and ask what a player *thinks* they're doing — extending a fist forward (a punch) or overhead (an uppercut), whatever the speed. Menu (REACH tab) → **Calibrate Reach** samples ~3 seconds of reaching forward, then ~3 seconds reaching overhead, taking the max hand-to-torso distance seen from either hand each phase (sensible adult-human defaults are used until you do). Each hand then tracks two independent extension-fraction state machines (`punch-tracker`) — one forward, one overhead — each moving through `armed` (below ~40% of that reach) → `extending` (crossed 40%, accumulating swing stats) → fires the instant either you cross ~90% forward / ~80% overhead reach (treated like an abrupt stop — the punch is thrown) *or* your hand visibly slows back down without reaching that far → `holdForReset`, ignored until your hand comes back behind the 40% mark to re-arm. Deliberately easy to explain to a player: extend enough to punch, retract enough to punch again.
- This is structurally immune to the single biggest false-positive source found last round (turning your body while holding a hand out): rotating your torso by some angle rotates the hand's offset-from-torso vector *and* the torso's own forward direction by that same angle, and the extension fraction is built from the dot product between them — which a shared rotation leaves unchanged. A real reach changes that dot product directly; a body turn with a static arm pose doesn't, full stop, no threshold-tuning required. (A lighter head-relative "Turn Filter" — DEBUG tab — still guards the *secondary* "hand has stopped" signal against turn-induced velocity noise, but it's no longer the primary defense the way it was last round.)
- There's no look-cone gate any more — the old one existed to reject a cock-back's net displacement direction, and that whole failure mode is now structurally impossible (a pure retraction never crosses the extension threshold, since arming requires *starting* below it and moving up past it). Movement direction leans on **where you're looking** as the primary intent signal instead: if a live cube is within a generous cone of your aim, the punch/uppercut **locks onto it** and moves you straight toward it — capped by how far away it actually is (distance × a factor + a small baseline), so finishing off something at point-blank range gives a felt "thump" instead of flinging you past it. If your head has since turned away (people reliably do this mid-swing, especially winding up) but you were looking at an enemy within roughly the last 2 seconds and it's still in range, that memory is used instead (`punch-locomotion.updateRecentLookTarget`) — "last enemy I looked at that's within punching distance." With no target at all, movement is mostly look direction, only lightly nudged by the swing's own net displacement.
- **Sticky hit-assist** (menu, AIM tab) decides what happens once a target *is* locked: `off` leaves it to plain physical proximity (the fist has to actually get within ~0.35m, same as ambient contact below); `cheat` guarantees the hit lands the instant the punch fires, regardless of whether the fist's real physical path would have reached it — directly answering "I punch toward an enemy and fly right past it, missing entirely"; `turn` (default) does the same guaranteed hit, plus a small **instant, one-shot** rig-yaw snap toward the target first (pivoting on the player's actual head position, not the rig's arbitrary translation origin) so the hit visually reads as landed rather than happening invisibly. The turn is deliberately instant rather than animated — smooth/animated camera rotation is a well-known worse motion-sickness offender in VR than an instant snap (the same reasoning behind "snap turn" being the comfort-preferred way to turn via locomotion in most VR games). Defaulted to `turn` after first real playtest found `cheat` alone felt wrong — a hit registering with no visible reason it landed reads as arbitrary, where `turn` at least gives the hit something to visibly land on. The menu button spells out what each mode does (`cheat (auto-hit)`, `turn (auto-hit+view)`, `off (real aim only)`) rather than just naming it, worth cycling through and A/B-ing for yourself.
- Impulse magnitude combines three swing stats: max hand speed, hand travel distance, and head travel distance (rewarding leaning/stepping into a punch, not just flicking the wrist), scaled by **Move Speed** — the one knob exposed to the player, since "does punching feel strong enough overall" is the real in-headset question. Ambient/incidental contact (any fist-near-enemy-while-moving-fast-enough touch that isn't a deliberate triggered punch/uppercut) deals plain velocity-based damage only — never the hand/head-distance "lunging" bonus a deliberate extension gets, per an explicit design note: a graze shouldn't hit as hard as a real committed strike.
- Gravity pulls you back down (menu-adjustable, lower it for a floatier, more super-heroic feel that makes juggling/hovering between punches easier); drag is strong on the ground (a lunge resolves into a stop rather than an endless ice-skating slide — the main lever for avoiding motion sickness) and light in the air (so a jump/lunge keeps its arc).
- Enemies are simple "cube people" now, not floating balloons — a legs/torso/head stack of boxes (`punch-game.spawnCube`) on a container entity whose own position is always the character's feet/ground-contact point (y=0 at rest; no more spawning at a random floating height, and no more idle up-down "bob" — a training dummy standing still just stands still). A real skeleton/ragdoll model is a future step; this is deliberately just enough to read as a combatant. Because there are three separately-positioned hit points instead of one, a jab, a cross, and a hook all have something to actually connect with — `punch-game.checkHand` checks each body part independently against the fist's hit radius.
- Cubes have health instead of popping in one hit. Real contact (fist within ~0.35m of *any* body part while moving fast enough — gated on the same head-relative speed used for swing detection, so spinning around with a fist out doesn't register as landing hits on anything nearby) applies damage computed by the *exact same formula* used for how far a punch lunges the player (`punch-locomotion.computeMagnitude`), fed with that hand's current swing-in-progress *raw* speed/distance stats (not the head-relative value — once a hit is confirmed real, damage should still reflect true physical force) rather than waiting for the swing to finish, since contact happens mid-swing. A cube's color desaturates toward gray (applied to all three body parts) in proportion to its remaining health (`THREE.Color`'s HSL conversion, holding hue/lightness constant and scaling saturation down — no separate health bar) and it dies once fully drained. Default health was cut in half (100 → 50) after playtesting: a *sustainable* punch — this is controlled physically, nobody can throw maximal-effort haymakers indefinitely — was only taking a sliver out of a 100-health bar, which read as "I'm not damaging this thing" rather than a fight. A short per-cube hit cooldown (~220ms) stops one swing that dwells in the hit radius for more than a frame from registering as several hits. Dying respawns a replacement — it's an endless heavy-bag loop with a running counter, not a fixed batch + win screen like Cube Pop.
- **A real bug found via testing, not playtesting, worth flagging if you touch damage code:** `punch-game`'s `init()` used to cache `punch-locomotion`'s component reference once (`this.locomotion = this.rig.components['punch-locomotion']`). Component `init()` order across sibling/cousin entities isn't guaranteed by A-Frame, and this one could run before `punch-locomotion` had attached — when that race lost, `this.locomotion` stayed `undefined` for the rest of the session and every hit silently fell back to raw hand speed as damage, skipping the entire `computeMagnitude` formula (distance bonuses, the Move Speed multiplier, all of it). This was invisible from the outside — no error, no crash, just quietly weaker hits than intended — and was likely a real contributor to "it takes forever to kill one of these," independent of the health-value rebalance above. Fixed by looking the component up fresh at the point of use instead of caching it at `init()` time.
- A non-lethal hit now physically launches the cube (`cube-behavior.applyKnockback`), primarily **straight away from the player** rather than a raw reflection of whatever direction the hand happened to be instantaneously moving (which can be pretty wobbly mid-swing) — angled only a little by the actual swing direction. The swing's vertical component contributes partial credit as a launch: an upward-angled hit sends the target a little airborne, a downward one adds a little downward velocity — which, against an already-grounded target, immediately feeds into the impact-damage system below (a downward punch that connects contributes to slamming the target into the floor). Overall speed scales with hit force but is deliberately much gentler than the player's own lunge speed. It's real position integration (velocity + friction + a light gravity pulling a launch back down), running in place of that cube's normal chase/patrol/wander/idle movement while still sliding fast enough, and leaves a thin trail of paint in the cube's own color while it slides (menu-toggleable). Once a knockback settles, the cube's patrol/wander reference point re-anchors to wherever it actually ended up rather than its original spawn spot — otherwise a cube punched well away from home would slide to a stop and then calmly walk itself back, a milder echo of the same "snaps back" bug below. A cube slid into another live cube transfers some of that damage and velocity on to it too — punching one cube into a cluster of others should hurt more than one — capped to at most once per second per specific pair, so two cubes resting against each other can't loop into infinite mutual damage.
- **"Move fast and break things":** a cube's knockback velocity that gets suddenly zeroed by a hard surface — hitting the room's wall bounds, or slamming into the floor while still falling — deals impact damage proportional to how much speed was just lost (small stumbles below a minimum don't count). This is genuinely the same idea as fall damage, just triggered by any hard stop, not only landing from a jump: punch someone into a wall, or hit them hard enough into the ground, and the impact itself hurts on top of the punch that caused it. This also fixed a real, separate bug caught via testing: `cube-behavior`'s knockback physics had no guard against a single oversized frame delta (unlike `punch-locomotion`'s, which already had one) — in a slow/coalesced frame, gravity integrated over the whole oversized step in one shot and a cube's downward velocity ran away to 100+ m/s instead of settling back near zero once it landed, which is also most of what caused the original "falls to the ground, then magically resets back to where it was bobbing" complaint (the runaway velocity kept the cube permanently stuck in "still sliding" state, so its actual settle-and-resume-normal-movement logic — including the old vertical bob height — never got a clean chance to take over correctly).
- Cubes aren't static. Each one gets a `cube-behavior` — `idle` (just stand there), `chase` (slowly drifts toward you), `patrol` (walks between two fixed points), or `wander` (ambles to a new random nearby spot every couple seconds). Default is `mixed`: every spawned cube gets a random one of the four.
- Every hit leaves a splatter of paint on the floor, in the cube's own (pre-desaturation) color — a bigger, more scattered splat for a harder hit, and a scattered multi-blob burst on the killing blow. Playtesting feedback was that the splatter read as sparse and tightly clustered right under the cube, so both the baseline splat size/opacity and the scatter distance blobs can land from the hit point went up substantially, and two more menu knobs (**Splat Amount**, **Splat Scatter** — SPLAT tab) scale further on top of that if even more is wanted. It's painted onto a single shared canvas texture (`THREE.CanvasTexture`) applied to a floor-sized transparent overlay plane (`#splat-layer`), so it accumulates for the whole session rather than resetting per-cube — after fighting through enough cubes the floor genuinely turns into a rainbow paint-bucket-explosion look, which was the point. World position → canvas pixel uses an actual raycast against the overlay plane's mesh to read back its UV coordinate at the hit point (`worldToSplatPixel`), deliberately avoiding a third hand-derived orientation formula in this file after two others already turned out backwards (see the `getWorldDirection`/`lookAt` note below) — ground-truth UVs can't be backwards the way an assumed axis mapping can. "Reset Arena" (menu button or either trigger) clears the canvas along with everything else, so a fresh run starts with a clean floor.
- You're inside an actual room (30x30m, 6m walls) with a checkerboard floor/wall texture rather than an open plane — partly for presence, partly because a strong static visual frame around you is one of the standard techniques for countering motion-sickness during fast locomotion.
- A **comfort vignette** (menu, FEEL tab) darkens the edges of view as rig speed picks up, fading back out at rest — the standard VR motion-sickness mitigation (masking peripheral motion rather than showing it, which is the actual comfort lever; true directional motion blur was considered and specifically not built, since blurring the periphery removes exactly the stable visual references vignetting relies on keeping hidden-but-implicitly-present). It's a camera-attached plane carrying a runtime-painted radial-gradient canvas texture (transparent center, opaque black edge) — no external asset, same pattern as the floor/wall checkerboard and the blood splatter — with opacity exponentially smoothed toward a target driven by current speed, so it doesn't flicker between frames. On by default; **Vignette** toggles it, **Vignette Strength** scales how dark it gets at full speed (0-200%), **Vignette Size** scales the plane itself rather than repainting the texture (smaller = the darkened ring reaches further into the center). Explicitly hidden while the menu is open (otherwise it can freeze mid-fade covering the panel's edges, since rig physics — and therefore the speed driving it — pause too).
- A **"zoom" haptic buzz** (menu, FEEL tab) pulses both controllers repeatedly while moving fast, on top of the existing punch-connect haptics (a stronger pulse on a hit-assisted lock-on, a lighter one on ambient contact). The WebXR gamepad haptics API is discrete pulses, not a sustained rumble, so a "buzz" is approximated by firing a short pulse roughly every 90ms while above a minimum speed, intensity scaled by how fast you're currently going. On by default; **Zoom Buzz** toggles it, **Buzz Strength** scales intensity (0-200%).
- Reset is bound to either controller's physical trigger button for a quick restart, and there's also a "Reset Arena" button in the menu.
- An optional in-view **stats HUD** (menu, MORE tab → Show Stats) shows the last punch/uppercut's axis and whether it fired via full extension or stopping, max speed / hand distance / head distance, computed magnitude (and, if the lock-on distance cap kicked in, the capped value), lock/memory/hit-assist state, and distance to target — for understanding what the targeting system is actually doing while playtesting.
- A separate, opt-in **live debug HUD** (menu, DEBUG tab → Live Debug HUD) shows the raw handful of numbers the detection logic reads *every frame*, continuously, rather than a post-punch snapshot: both hands' raw vs. head-relative speed and current forward/overhead axis state (`A`/`E`/`H` for armed/extending/holdForReset), the live stop-speed threshold, the turn filter percentage, the calibrated reach values, and the active hit-assist mode. This is meant to make a confusing in-headset moment legible on the spot, or at least screenshot-able, instead of guessed at from outside the headset.

**Menu:** press any face button (A/B on the right controller, X/Y on the left) to open it — grip used to, but got pressed by accident too often during normal punching. A bigger panel spawns fixed in world space, a couple feet in front of wherever you're currently standing and facing, oriented back toward you; press a face button again to close it. Two things happen structurally while it's open: punching and cube-popping are disabled and rig physics freeze entirely (gated on a shared `menuOpen` flag), the always-on debug line/punch label and any opt-in stats/live-debug HUDs are hidden (they'd otherwise visually clutter the panel, and were reported as possibly blocking menu buttons), and the *other* hand (never the one that pressed the face button) gets a small laser pointer + cursor to click menu buttons with. Because only one hand can ever be an active pointer at a time, there's no way for an absent-minded trigger pull on the "wrong" hand to register a click on whatever it happened to be aimed at. The laser stops exactly at whatever it's pointing at (a `laser-beam` component rescales it to the raycaster's live hit distance every frame). **A genuinely important fix, found by reading A-Frame 1.6.0's actual `cursor` component source rather than assuming**: the hand `cursor` components now explicitly bind `downEvents`/`upEvents` to the real `triggerdown`/`triggerup` controller events — left at their default (empty), `cursor` instead listens for *mouse/touch events on the canvas*, and a real trigger pull only ever produced a click via whatever synthetic click a given WebXR browser happens to fire on "select" for accessibility-fallback purposes, which is exactly the kind of thing that would register "some of the time" — the actual cause of a round of "the menu buttons don't work reliably" playtesting feedback. The small `+`/`-` adjust buttons were also enlarged, since hand tremor during a trigger pull nudging the raycast off a small target between press and release compounds the same problem. The trigger's normal "quick reset" job is suspended while the menu is open. Content is organized into tabs, built with a small generic `createTabbedPanel` helper that has nothing Punch-Pop-specific in it. That older helper is still local to Punch Pop; new cross-experience menu work should use or extend the shared modules in `common/` rather than copy-pasting it:

- **PUNCH** — Move Speed, Gravity, Max Speed, Reset Arena
- **FOES** — Cube Count, Cube Health, cycle Cube Behavior
- **AIM** — Lock-On Cone, Lock Range, cycle Hit Assist (off/cheat/turn)
- **REACH** — Calibrate Reach, Reach Fwd, Reach Up, Arm Threshold %
- **SPLAT** — Splat Amount, Splat Scatter, Knockback Force, Trail on/off
- **FEEL** — Vignette on/off + Strength + Size, Zoom Buzz on/off + Strength
- **DEBUG** — Live Debug HUD toggle, Stop Spd, Turn Filter
- **MORE** — Resume, **Exit VR**, Show Stats

Longer-term design plans (the "secretly a fitness game, but you feel like a superhero" vision — more move ideas like squat-jumps, arm-circle force fields, lunge-dashes, ground-pound smashes, and how they might chain into combos) are tracked in [`games/punch-pop/TODO.md`](games/punch-pop/TODO.md) rather than here, since none of it is built yet.

Tuning knobs not yet exposed in the menu (drag, room size, cube-cube collision radius/damage, etc.) still live as schema properties or literal attribute values near the top of each relevant component/entity in `games/punch-pop/index.html`.

**A genuinely subtle bug worth knowing about if you touch this code**: `THREE.Object3D.prototype.getWorldDirection()` only means "local -Z, transformed to world space" for an actual `THREE.Camera` (or `THREE.Light`) instance — it's overridden there specifically. For a plain `Object3D`, which is what an A-Frame entity's own `.object3D` always is (including `<a-camera>`'s — the real `THREE.Camera` lives on a *child* object reachable via `.getObject3D('camera')`), the default behavior returns **+Z**, and `lookAt()` follows the same +Z-is-forward convention for plain objects too. Both the menu's spawn-facing logic and the look-direction gating hit this directly and were silently backwards until caught by testing — see `getForwardDirection()`, the shared helper that now sidesteps it everywhere by explicitly applying the world quaternion to `(0,0,-1)` rather than trusting `getWorldDirection()`.

**Open question this POC exists to answer:** does punching alone generate enough sense of motion to avoid VR motion sickness, especially during airborne arcs (uppercut-style launches, juggling between locked-on enemies)? That can only really be judged in the headset — the desktop "Simulate punch" buttons exist to sanity-check the physics/targeting code, not the comfort of the experience.

**Safety:** this moves your whole viewpoint based on real arm swings — clear at least ~2x2m of real space and be mindful of your surroundings before trying it in a headset. If you ever need to bail out and the in-VR "Exit VR" menu button isn't reachable for some reason, your headset's own system button (e.g. the Oculus/Meta button on a Quest controller) always backs out of any WebXR session regardless of what the page does.
- **[Pistols at Dawn](games/pistols-at-dawn/index.html)** — two boxy pistols holster at your hips, a shotgun rides a bandolier across your back, and a hat sits on your head (hips/back approximated from headset yaw, the hat's spot tracks full head rotation, since there's no real body tracking). Grab any of them the same way — a shared "holsterable" component handles the whole hold/dangle/throw/holster mechanic generically, not just for guns. Grip near one to draw it, aim at a target, and pull the trigger to score — pistols fire a single shot, the shotgun sprays six pellets in a tight cone. Release the grip near a matching anchor to holster it (generously, so it doesn't drop by accident); release it elsewhere while a finger is still on the trigger and it dangles from your finger, swinging and spinning as a simple physics sim reacting to your hand motion. A hard-enough upward release is a throw instead of a drop — aimed so a straight-up toss comes back to the same hand and a toss with sideways intent lands near the other one, for juggling — and anything falling or flying is generously catchable by grip or by trigger finger. The hat rides the exact same mechanics: take it off like drawing a gun, and its spin pivot is offset to one edge of the head-hole (like a finger hooked under the brim) so it twirls like a hat trick instead of a plate.

  Every anchor (hip holsters, head, back bandolier, and a small slot hidden inside the hat's own crown) is a generic "anchor-slot," sized small/medium/large — small fits any slot, medium needs medium-or-bigger, large needs large. Nothing is hardcoded to "guns go in holsters": the hat (medium) can ride your head or the bandolier but not a holster; a pistol (small) fits everywhere, including tucked inside the hat or, if you're feeling silly, worn on top of your head like a hat itself. Each slot shows a small translucent sphere — color-coded by size — that grows more obvious as a compatible carried item gets close and gives a quick "click" bounce right as it enters snap range, since controller vibration doesn't reliably work everywhere. A slot already claimed by something hides its indicator; something actively held with its own slot (like a worn-in-hand hat) will passively catch a falling item that fits, so you can toss a gun up, whip your hat off, and catch it inside.

  Turn around and there's a saloon bar behind you, which exists mostly to find out how far the generic systems stretch. The bottles standing on it aren't special objects — they're the same "holsterable" props the guns are, sitting in the same "anchor-slot" sockets the hip holsters use, so you can stand a beer in your holster or set a pistol on the bar. Knock a bottle's **cap** against the counter edge or the floor and it pops off (the cap carries its own small collider and has to actually strike something — testing the bottle as a whole opened every beer the instant you picked one up, since the snap-into-hand blend reads as fast downward motion). Then tip it past horizontal and it pours, forever, faster the further over it goes. Shoot a bottle and it shatters into glass; throw one hard at the ground and it shatters the same way through a completely different code path. Shattered bottles restock themselves a few seconds later, the way knocked-down targets stand back up.

  The counter is also a **drum with an armoury on its back**. Shoot the brass bell hanging over the bar and the whole thing revolves — beers, cigars, lit matches, spilled drink and any fire burning on it all come along, because nothing on the bar is "on the bar" as far as the code is concerned: every prop is parented to a socket and every socket is parented to the counter, so turning one entity brings the lot. On the other side is a gun bench: pistols hanging barrel-down on pegs, long guns lying flat in cradles (which are the same sockets rolled a quarter turn — the gun keeps the one holstered pose it has everywhere, and the rack decides which way up that pose sits), a shelf underneath, and a good many empty sockets to arrange your own loadout in. The whole assembly sweeps past at chest height on the way round; there's no pivot that avoids that when you're standing at the edge of a turntable, so instead nothing on the drum reaches above chin height and the halfway point leaves you standing in the middle of the bar looking down its length.

  Three weapons beyond the pistols and the shotgun, and two of them are the same idea. **Dynamite** is a fuse with a bundle attached: the fuse is the same object a match is made of, so every existing way of lighting anything lights it, and it goes off when the fuse runs out, when it's hit hard, or when somebody shoots it out of your hand. The **bow** is drawn with two hands — the second one takes the string, and how far apart your hands are is your draw — and the **rocket launcher** is a tube you load. Both of those are a socket with a release, so both fire whatever is in the socket: arrows (three at once, fanned), or a beer bottle, or a lit stick of dynamite. Set an arrow alight before you loose it and it will set alight whatever it lands in, including a puddle of spilled beer across the room. Aiming cheats on purpose: where you're *looking* picks the point, and the arc to reach it at the speed your draw earned is solved for you.

  The **scoped rifle** has a working scope: a second camera rendering the scene into the glass at 4x. It only renders while the eyepiece is actually at your eye — the glass is dark otherwise — which started as the way to afford an extra render pass on a Quest and turned out to be the mechanic, since that's what a scope does anyway. Steady it with your off hand on the forestock, or the magnified view swims.

  The **tank and hose** is a weapon whose ammunition is a liquid type. Pull the trigger on the pack to flip its hatch open (the trigger opens the lid of whatever you're holding — the Zippo always worked that way, and now a bottle cap does too), pour something in, sling it on your back and take the nozzle off the chest clip. Water makes it a fire hose, beer makes it a way to drench a room or drink from a distance, and fire makes it a flamethrower — none of which are modes: the tank stores a liquid type and the nozzle sprays it, and everything downstream is the liquid system doing what it already did. Light the beer as you pour it in and the stream catches in mid-air, so what lands in the tank is fire; leave the hatch open near anything hot and it'll catch by itself. The hatch falls shut after a while in case you forget. The nozzle's home socket is on the chest strap on purpose: worn, the pack is behind you and the hose is at your chest, so reaching over your shoulder and reaching to your chest are two gestures that can't be confused.

  Thrown things also finally hit things. Anything moving fast enough now casts along the ground it covers each frame and emits the same event a bullet does, so you can knock a target over with a hurled bottle — with a speed floor, so setting a gun down on a bar full of beer isn't an attack.

  The armoury's racks refill themselves ten seconds after you empty them, and any gun left lying loose goes up in smoke thirty seconds later. Those two are only safe as a pair — a self-refilling rack on its own is a gun printer, and a vanishing gun on its own eventually empties the world — and together they settle the gun count at the number of refilling sockets, with nothing counting anything. The clock only runs while a gun is genuinely loose: held, twirling on a finger, or sat in any socket anywhere (a holster, the bar, your hat, your teeth) and it's yours indefinitely. **Your own holsters don't refill** — they're stocked once at the start and are pockets after that, so what's on your hip is what you put there and the armoury is where you go for more. One socket component covers both cases; a `refillMs` of zero is the entire difference between a holster and a shop. What a pistol *is* lives in a maker function that both the wall rack and your hip call.

  Drinking isn't a separate mechanic: the poured beer is real particles, and any droplet that reaches your head goes down your throat. Cigars work the same way round — having one lit in your mouth trickles nicotine in, but holding the tip *at* your lips is a proper draw, which climbs faster, burns the ash down faster, and stops the cigar smoking into the room because you're taking it in. Pull it away and you exhale the whole banked cloud at once. Ash creeps up the tip as a grey segment; flick your wrist or twirl it off your trigger finger and it breaks off, leaving the cigar shorter for good. Smoke one to the band and it's gone, and a fresh one turns up in the tray.

  Fire has three sources beyond "borrow a lit cigar". Matches live in a box on the bar and are lit by striking the **head** on something solid — reusing, unchanged, the collider-crossing test that knocks a cap off a bottle. A Zippo sits next to them: pull the trigger or flick your wrist to work the lid, thumb a face button to strike it, and it's a flame for as long as the lid stays open. A gun barrel you just emptied is the third, since barrels track heat. None of those know what a cigar is: a two-attribute `ignition-source`/`lightable` contract plus a proximity check does all four combinations, and matches and cigars share one `burnable` component that owns burning down, ashing, and being consumed.

  Two things generalized outward from all that. First, **stacks**: a hand holds up to four things instead of one, and an anchor-slot can have a capacity, with contents fanned out either way. So you can hold two pistols in one fist (one trigger pull fires both), carry an armful of bottles and fling them all skyward on one throw for skeet, or clench five cigars in your teeth at once. Grip is a hold rather than a toggle, so building up a fistful uses a quick re-grip: let go and squeeze again within 400ms and whatever you just put down comes back with you, plus whatever's nearest now. Sweep down the bar tapping the grip and you collect bottles. A separate "hurl" throw exists alongside the aimed juggling toss — move your hand across rather than up and your real velocity is used instead of the aiming, with catching briefly suppressed so the generous catch radius doesn't snatch the bottle straight back out of the air. Thrown bottles also fall at 60% gravity, purely so there's time to draw and shoot them.

  Second, **vices** — two meters doing deliberately different jobs, both shown as a percentage at the bottom of your view. Nicotine is the shakes: a fast tremor. Alcohol adds a slow sway, aim drift (your hand chases an under-damped ghost of itself and swings past where you meant to stop), a vignette and warm tint that pulse, and butterfingers — graded, so something twirling off one finger starts getting away from you at around 25% while a properly gripped object only slips past 70%. Both are applied to your **hand**, not to what it's holding, via a child "grip" entity everything hangs off; applied per-object they made the gun swim inside an unnervingly steady fist. The rule the whole design is built around is that **none of it moves the camera** — a view that drifts independently of your head is a vestibular conflict and a reliable way to make someone ill, while a gun barrel that swims is just funny. The vignette is drawn as a quad in clip space, whose vertex shader ignores the camera entirely, because a world-space quad has to match the frustum exactly and WebXR gives you two per-eye projections instead of one FOV to match.

  Fire is its own kind of object, and the thing it burns is spilled drink. Poured beer doesn't vanish where it lands: it pools on whatever it hits — the floor, the bar — and nearby drops merge into one growing disc rather than piling up hundreds of overlapping ones. A puddle that touches anything lit catches. A burning puddle feeds its own flame as it's consumed, and that flame is itself an ignition source, which is the entire implementation of "fire spreads": lay a trail of beer and it walks along it. Fire also lights cigars, burns them down about five times faster than smoking them does, and knocks over any target that stands in it, through the same `fall()` a bullet uses. It has fuel, it grows and shrinks with it, it writhes on a couple of out-of-phase sines, and it drives one shared point light that follows whichever fire is biggest — one light rather than one per fire, since each real light costs a material recompile and per-fragment work.

  A smashed bottle spills its contents where it broke. Nobody implemented a Molotov: pour a puddle, drop a match on it, and throw a beer into the flames — the bottle shatters, its spill is already touching fire, and the whole thing goes up. There's a jug of water on the bar for when that turns out to have been a mistake; water droplets are the same particles beer is, doing the opposite job, and they put out both the flame and the burning surface under it, because dousing only the fire meant the spill relit itself immediately.

  Throwing overhand aims for you. Bring your hand above your own eyeline and swing, and the game rays out from your gaze to find what you're looking at and solves for a launch velocity that lands there — the same courtesy the juggling toss extends, pointed outward instead of back at your own hand. Where in the swing you release picks the arc: let go early, while your hand is still rising, and it lobs; let go near the top and it goes flat and fast. How hard you actually threw scales the speed ceiling, and each object has its own — a shotgun can't be rifled across the range. In testing it lands within a few centimetres of the aim point at 3-5m.

  Guns produce no smoke at the moment of the shot. Instead a barrel remembers how hard it's been worked, and once you stop shooting for a beat, that much smoke curls up out of the muzzle — cheaper than puffing on every trigger pull, and it looks more like a western. Smoke, glass, sparks, beer, fires and puddles all come out of recycled pools (entities are reused from free lists at unit size and scaled, never created and destroyed), which is what keeps a sustained pour or a spreading fire from hitching the frame. You can sweep smoke away by waving a hand through it, or clear it by bringing the muzzle up in front of your face to blow across it. The glug, the cap clink, and breaking glass are synthesized with the Web Audio API rather than shipped as assets, which keeps each prototype a single self-contained file.

  On performance: A-Frame gives you geometry caching (480 meshes in the full range share 80 geometries) and frustum culling for free, but no batching, no instancing, and no material sharing — every mesh here has its own material. A-Frame builds `a-cylinder` at 36x18 segments and `a-sphere` at 36x18, about 1300 triangles each, so the original scene was carrying **276,000 triangles**. Patching the registered primitives' schema defaults once brought that to **27,000**. Destinations now live in separate `areas/*.html` fragments: teleport loads one destination's builder scripts/content behind the fade and disposes the previous entity tree, so hidden towns do not keep rendering, ticking, raycasting, or appearing in global interaction scans. In a desktop runtime smoke test, leaving the full range for the farm reduced live A-Frame entities from 439 to 127. The watch clock updates its text once per second rather than once per rendered frame, repeated visibility changes bypass A-Frame's attribute parser, and the HUD can be hidden from the watch menu. What's left in the full range is draw-call pressure: the separate ring discs on target faces are a good future texture/instancing candidate if headset measurements still show GPU pressure.

  Repeated interaction discovery is mutation-indexed: hot paths reuse live element lists for grabbables, shootables, hands, ignition sources, targets, tanks, and brace surfaces instead of repeatedly querying the entire A-Frame DOM. Proximity haptics run at 12.5 Hz while actual grip selection remains immediate. Watch → **Show Performance** enables a low-frequency in-headset readout for FPS, frame time, draw calls, triangles, geometries, and textures. Future GLBs can use `model-prop` to pair the visual model with a simple box/sphere/cylinder hit proxy; detailed model meshes then opt out of gameplay raycasts.

  Hit targets are invincible rings on a board that tips over like a steel pop-up target; a whole group resets together once every target in it is down. The gallery spans an arc in front of you: three tiers of stationary targets at increasing distance, a couple of spinning target wheels, a couple of conveyor belts sliding targets in alternating directions, and a row of whack-a-mole-style poppers that surface on a timer. Also has the gaze-reticle fallback for target scoring, though the grab/dangle/holster/throw/slot mechanic itself is VR-only.

- **[The Rainbow Hotel](games/rainbow-hotel/index.html)** — an impossible-spaces proof of concept. Walk a full loop through six colour-coded rooms — Red → Orange → Yellow → Green → Blue → Purple — that read as six floors of a building, while your real body never leaves one small play space. There is no combat, no guns, no hand tracking, and nothing to interact with: every doorway is an open archway and the only verb is walking. It exists to find out whether the one trick underneath it feels convincing, and whether it makes anyone queasy, before anything gets built on top of it. **The building is currently switched off** while its floor is being fitted to a real Guardian — see "Fitting the floor to a real Guardian" below — and one tick box puts it back up.

### The Rainbow Hotel: how it works

  The six rooms are stacked vertically at **the same floor-plan position**, all inside your Guardian rectangle. A strip along one edge of that rectangle is reserved — no room ever occupies it — and **one hallway**, built once and reused at all five junctions, slides up and down inside it.

  When you are standing in a room, the hallway is parked at that room's floor level, so both of the room's doorways line up with the hallway's own two openings. Walking the hallway from one opening to the other raises it by exactly one floor height, so the opening you walk out of is a floor above the one you walked in through. You never see the world move, because the hallway moves *with* you — your rig and the hallway are placed at the same Y every frame, from one number.

  The rise is a function of **how far along the hallway you have walked**, never of a clock. A timed rise would keep climbing while you stood still reading a wall, and would arrive at the far doorway out of step with you. Being position-driven also makes it completely reversible: turn around and it comes back down, and the doorway you came in by has re-aligned by the time you can see it again. Walking back down from Purple lands you in Red at exactly y=0.

  **The whole thing is protected by one invariant: a misaligned opening is never visible.** That is not asserted, it is computed. `hotel-layout.js` walks a grid over the hallway's floor and asks every reachable spot two questions — how far along the walk are you, and can you see either doorway from here — using segment-versus-rectangle tests against the real wall geometry. The rise is then confined to the stretch between the last place the first doorway is visible and the first place the second one is. If a given set of settings has no such stretch, the plan says so (`rise.tight`) and the settings panel explains why, rather than quietly shipping a hallway that gives the game away.

  **Two things about the hallway's shape were arrived at by measuring, not by drawing.** First, a single pier extending each doorway's jamb into the run is *not enough* — it casts only a partial shadow, so the far edge of the doorway stays visible from most of a short run, and at that point there is no safe stretch to rise over at all. What works is a *pair*: the jamb pier plus a second one standing off it from the opposite wall. A sightline has to squeeze past one on its south side and the other on its north while climbing steeply enough to reach the doorway plane, and past a certain spacing between them no line can do both (`requiredShieldGap` has the arithmetic; the brute-force scan then checks the algebra's work). A person weaves through; a straight line can't.

  Second, progress along the hallway is a **geodesic**, not a distance to a centreline. The alcove beside a doorway is one step from that doorway in walked terms and half a hallway from it in straight-line terms; projecting it onto the nearest centreline segment puts it in the middle of the walk. That is not a measurement quibble — the rise is a function of this number, so being wrong there means the hallway is half a floor up while you are still close enough to the doorway to see straight through it. Progress is Dijkstra out from the first doorway across the hallway's open floor, going around the piers the way a person has to, sampled bilinearly every frame.

  **Turn count is a dial on one hallway, not a second hallway.** `0` extra turns is the spec's baseline — one turn at each doorway threshold, one straight run. Turning it up adds piers between them, and those project deeper than the doorway pair's do, because that is what makes them bite: piers whose gaps overlap let you walk almost straight past them and change neither the walked distance nor the occlusion. Sized so consecutive gaps *don't* overlap, both numbers move — at 3.4 × 3.2m, four extra turns take the walk from 3.84m to 4.30m and the safe stretch from 0.76m to 1.22m. Ask for more than will fit and the planner backs off until the hallway is still walkable and tells you how many actually fitted.

  **Lighting is ambient plus one directional light, and that is deliberate.** Translating a surface doesn't change how a directional light falls on it, so the hallway looks identical at every height it passes through. A point light anywhere near the shaft would shade its walls differently as it rose — the single cue this whole design exists to withhold. Same for shadows, which are off. The hallway's own lighting is an emissive ceiling panel and emissive sconces, not lights. There is a test that fails if a point light, a spot light, or a shadow ever appears in the scene.

  Everything *on* the hallway is safe to dress, though, because it moves with you — so it has a dado rail, pilasters at a regular spacing, a runner, and lit sconces. That is not decoration: evenly spaced verticals passing your eye are the clearest signal of how far you have walked, and a corridor of flat grey walls gives the eye nothing to measure its own motion against. "I walked up to the next floor" needs the walking to register first.

  **The rooms are where the windows are, and the hallway has none** — no sightlines to the outside at all, by design. Each room's floor is a checkerboard in a lighter shade of its own wall colour, derived rather than authored (`common/checkerboard.js`, extracted from the copies Punch Pop and the menu showcase were each carrying). The window sill doubles as the guardrail at the Guardian edge: you meet a ledge at hip height before you ever meet the boundary, and it reads as a building rather than as a wall that is there for reasons nobody will explain. Outside is a static backdrop — neighbouring buildings whose window rows are drawn at *this* building's floor spacing, so counting rows on the block opposite is a direct read of which floor you are on; tree canopies at about first-floor eye level, so you look up into them from Red, across them from Orange and down on them from Yellow; rooftops that go from above you to below you as you climb; and a cornice at every floor level on your own facade, so looking down out of a window stacks your own ledges away beneath you.

  **Play space** comes from `navigator.xr` → `requestReferenceSpace('bounded-floor')` → `boundsGeometry`, via `common/guardian-bounds.js`. Quest can hand back an empty array or a stale small square for the first frames after a session starts, so it polls, keeps the largest plausible rectangle it has seen rather than the most recent one (those two disagree in exactly the failure case that matters), and rebuilds the building around whatever finally settles. The polygon is turned into "a rectangle you can safely build a room inside" by shrinking the bounding box about the boundary's centroid until every point on its perimeter — not just its corners — is inside, then insetting 18cm. It tries the rotation of each long edge of the boundary as well as the tracking axes, so a Guardian drawn along the walls of a room that isn't square to your tracking origin doesn't cost you most of your floor.

  **Fitting the floor to a real Guardian — and why the building is currently switched off.** Two headset sessions in a row came back with the same report: the hotel is not aligned with the boundary, not even close. So the walls come down (`showHotel`, off by default, tick box in the settings panel — the plan is still computed on every rebuild, nothing has been removed, and ticking the box puts the whole thing back up) and what you load into is an empty lot with one-metre squares and three outlines drawn on the ground: **cyan** is the polygon the headset handed over, **amber** is the rectangle fitted inside it, **green** is a floor you can redraw by hand. Any face button turns the green rectangle's four corners into draggable handles; each controller emits a laser, the handle you are pointing at swells so there is no doubt which one you would take, grip grabs it and drags it along the floor, and the trigger puts all four back where the automatic read says they should be. The hand-drawn corners are saved locally and, once touched, stop following the automatic read. Outside a headset the camera stands in for the controller, `E` edits and `T` resets, so the whole flow can be driven headlessly. This is a measurement, not just a fix: controller poses come from the same stream that moves the player through the world, so they cannot be wrong about which reference space they are in — if the hand-drawn quad and the fitted rectangle disagree, that disagreement localises the bug to the boundary read itself. The in-headset readout quotes the quad's **sides**, not its bounding box, because a play space turned 18° has a bounding box half a metre bigger than itself in both directions and quoting that reads, wrongly, as a floor too big for the room you are standing in.

  The readout doesn't make you subtract two blocks of numbers: it quotes the disagreement directly, as `vs read 0.18 m off (0.00, -0.18) / turned -7.8 deg / sides +0.22 / -0.23`, with a magenta bar drawn on the floor between the two centres. Each part accuses something different — **a pure offset** means the polygon was measured in a space whose origin has since moved, which is staleness rather than maths; **a turn** means the fitted frame or its rotation convention; **a size difference** means the fit itself, or the inset. Once a floor has been drawn by hand it also becomes the floor the building stands on (the largest rectangle fitted *inside* the drawn quad, since four corners dragged by hand are never square), because it is the only rectangle anyone has stood in the room and confirmed. A typed override still outranks it; the boundary read no longer does.

  **Two causes have been found and fixed this way so far, both of them staleness.** First, **recentring**: holding the Oculus button moves the origin of the space the scene renders in, and the boundary polygon was converted into that space once, when read, and never re-read — so from the recentre onwards the rectangle described where the room *used* to be while the player and their real walls moved out from under it. WebXR announces this (the reference space fires `reset`) and nothing was listening. Second, and worse, **the fix for it leaked**: re-polling asks for a *fresh* bounded-floor space, and the listener on the old one was never removed, so each recentre left a live listener on an orphaned space and added another. The next real recentre fired on both and spawned two more. It doubles. A headset session reported `recentred x44` off about five button presses, with the boundary re-polling continuously the whole time.

  The lesson from both is the same, so the module no longer commits and stops looking: **the settled rectangle is re-measured a couple of times a second for as long as the session lasts**, and republished only when it has actually moved more than 5cm (every publish rebuilds a building). Relying on the `reset` event alone would still assume the headset announces every way an origin can move, and the failure when it doesn't is silent and total. The readout counts both — `recentred xN` for events the headset announced, `moved xN` for re-reads that disagreed with what was published.

  **The honest trade, and the headline finding:** the hallway's depth comes straight out of the depth of every room. At 3.4 × 3.2m the rooms are 3.2 × 1.83m; at 2.4 × 2.4m they are 2.4 × 1.2m, and the gap you walk past each pier is down to 48cm. There is no way around it in a Guardian-sized footprint — the rooms and the hallway are competing for the same rectangle — and it is the number to look at first if the thing feels cramped in the headset. Standing in the middle of your play space also puts you against the hallway wall rather than in the middle of a room, for the same reason.

  **Tuning** is a panel on the flat page (button top right), saved to local storage — so on a Quest you can set it up in the browser and it is still there after you press Enter VR. Floor height, extra turns, hallway width, doorway recess, pier gap, doorway width and spread, ceiling height, and the pier safety factor, plus a play-space override for desktop runs. It shows the measured numbers live — room size, walk length, how much of that walk the rise happens over, and the occlusion margin — and warns when a setting has made the hallway sealed, the rooms a ledge, or the transition catchable. **Copy link with these settings** puts them all in the URL. There's an opt-in in-headset readout too, off by default on purpose: the question being asked is whether the *windows* tell you which floor you're on, and a caption saying "Green, floor 4" answers it for you.

  Desktop: click to look, WASD to walk, `R` to start over. Note that WASD moves the *camera inside the rig*, not the rig — which is the same thing headset tracking does when you walk in your real room, so a desktop run exercises the actual code path rather than a stand-in for it. There is no collision, so you can walk through a wall and catch the trick from the wrong side; that is a feature of the test rig, not of the experience.

## Primitives

Small, reusable interaction building blocks — a design-system for VR, in the Storybook sense. Rather than one experience per primitive, each primitive category gets ONE demo covering every style/variant, so they can be compared side by side — the equivalent of a Storybook page listing every story for a component. Reusable A-Frame components live under `common/` and are loaded directly by both the showcase and the experiences that consume them.

- **[Menus](primitives/menus/index.html)** — every menu style in one scene, on a checkerboard floor (a tiny canvas-generated texture, tiled) so there's some sense of scale and footing:
  - **Fixed panel** — a menu fixed in world space. The `menu-item` component is the reusable part: attach it to any entity with its own geometry/material and it becomes a clickable row that highlights on hover and emits a `menu-item-select` event (with `{value, label}`) on click.
  - **Multi-value options** — `menu-option` builds a three-part row from a pipe-delimited value list. The left/right arrows cycle with wraparound, while the center label (for example `Targets: 6`) opens a compact list of every choice. The open list is a modal interaction layer, so rows visually underneath it cannot receive ray or poke events. Changes bubble as `menu-option-change` with the option key, value, display label, and index; the showcase's Move speed row and Pistols at Dawn's target-type, count, speed, and distance rows use the same component. Pistols keeps exactly one live gallery and swaps it among the restored stationary, spinner, conveyor, and pop-up implementations while retaining the current settings. Galleries support up to 24 targets at 5m, 15m, 30m, or 45m: high-count spinners add counter-rotating radii, conveyors add as many as four alternating rows, and stationary/pop-up galleries spread across 120-degree arcs. Shots and the desktop reticle share a 75m range, and bullseyes use non-overlapping annular scoring zones so distant faces do not depth-flicker.
  - **Chrome, unified** — every panel's title bar (a dedicated strip along the top, title text confined to its own region, and its buttons anchored to the right) is built by one shared `buildMenuChrome()` function, not hand-placed per template — the fixed panel, the watch's views, and the wall/pedestal panels all go through it. Whether a panel shows a ❔, an ❌, and the automatic/manual toggle is parameterized there (the fixed panel shows none — "Main Menu energy" — without needing its own bespoke layout code), and because the layout is computed instead of eyeballed, the title and buttons can't collide the way independently hand-positioned coordinates could (and did).
  - **Pointing, unified** — every hand carries one laser, originating from the same fingertip hitbox used for poking (not the raw controller entity, whose forward doesn't match where the rendered hand appears to point) and following the actual finger-bone direction measured from the hand model itself (loaded the GLB, played its Point animation, took the vector between two finger bones — not a guessed axis, and not the position-only measurement used elsewhere, which turned out ~20° off and visibly crooked as a direction). The laser appears once the hand's own "point" gesture animation has settled (~180ms), or immediately while an activation button is held; it remains visible during a trigger pull even when that hand is also holding and firing a gun. Since the same raycast already has to run continuously for hover/click detection, the line only renders while it is hitting a real target, so it never draws off into empty space. Any face button or the trigger activates whatever it's hovering — a menu never special-cases which one was used. This same laser can select an open menu's rows regardless of whether that menu is normally poke- or laser-driven, so a poke-oriented menu's close button, say, is always reachable by backing up and pointing instead. Poking up close still works too, debounced (a short per-row cooldown) so the small jitter of a real close-up poke doesn't double- or triple-count as the fingertip wobbles at the hitbox boundary.
  - **Wrist watch, wall screen, pedestal button** — three different "poke a trigger, a menu pops out of it" props, all built on the same `projected-menu` component: attach it to any entity with its own geometry (a watch face, a wall-mounted screen, a physical button — `obb-collider` auto-sizes the poke hitbox from whatever geometry is there) and a `<template>` of menu content, and it becomes a trigger. Poke/laser sizes, the offset the menu appears at (chosen so the opened panel clears the trigger's own geometry rather than intersecting it), and poke-vs-laser-vs-auto mode are all schema options set per instance, so the same component drives three visually and behaviorally distinct props:
    - The **watch** — a band + face attached to A-Frame's built-in hand model (correctly oriented: band loops the wrist, face flush on the back of the hand), showing a live clock in its own title bar. It defaults to automatic opening: raise and point the watch face toward yourself and its smaller poke menu appears; lower the wrist and it closes. The halfway, face-up pose shows the larger billboard/laser layout without changing the open/closed state, so it never opens merely because your hand passed through that pose. Poking the face still explicitly opens it, and ❌ explicitly closes it. The adjacent `A`/`M` button switches automatic opening on or off; an explicit close stays closed until the auto-open pose is left. The same toggle is part of every projected menu—on fixed props, automatic mode maps naturally to enter-proximity/open and leave-proximity/close. Pointing remains real button-driven gesture detection, not hand-tracking.
    - The **wall screen** — a fixed prop a short reach to the right of spawn; poking it always opens a bigger poke-driven menu that sits just barely proud of the wall's own surface (and hides the small TAP trigger underneath it, same as the watch hiding its own face), so it reads as the button expanding to fill the whole wall rather than a panel floating in front of it (`mode: 'poke'` — no orientation to read on a world-fixed trigger).
    - The **pedestal button** — a fixed prop a short reach to the left of spawn; poking it always billboards a menu up above it for laser/cursor selection (`mode: 'laser'`).
    - All three close the same three ways: poke/point-and-activate the ❌, walk far enough away or (world-fixed triggers only) look away for a few seconds, or (watch only) just lower the wrist.
  - **Help, three ways** — every menu also has a ❔ next to its ❌, each demonstrating a different help-UI pattern reusable well beyond this demo:
    - The **watch's** is a *modal*: a second view swapped in for the whole menu, covering it by replacing it rather than drawing on top — good for "what is this whole screen" explanations, shown here across two pages with prev/next, each with its own chrome bar too (a "HELP" title and a back button that returns to the main view without closing the whole menu).
    - The **wall screen's** is a *sidecar*: a small companion panel (with its own chrome title bar) toggled beside the main one, which never has to hide or get covered — good for stats/detail on whatever's currently showing without interrupting it.
    - The **pedestal's** is a *tutorial overlay*: arrow-and-caption hints drawn on top of the still-visible menu, stepped with any face button (bottom button back, top button forward — A/X and B/Y on real Quest controllers) instead of an on-screen row — the menu underneath is intentionally made inert (`projected-menu`'s `suppressPointing`, for exactly this "covered but still visible" case) while the overlay is up, so a face button steps the tutorial instead of also activating whatever's behind it.

  - **Desktop semantic hands** — outside XR, click the scene for pointer-locked mouse look and use WASD to move. `Tab` raises the non-dominant watch while the dominant simulated hand points (`Esc` is an alias when the browser does not consume it for pointer-lock); `E` completes a real hand poke on the reachable, highlighted wall menu and locks the player into its authored mounted-interaction anchor; `F` grabs or drops the selected test box through the same semantic hand action used by an XR grip. `E` or `Esc` exits mounted interaction. The watch exposes handedness plus Always/Delayed/Never interaction hints, both persisted locally. Hint zones resolve overlapping candidates once, so the outlined/signposted object and the object an action receives cannot disagree. XR controllers still own the gameplay hand transforms while presenting.

The desktop layer intentionally expresses intent instead of emulating an
`XRInputSource`: tracked XR input and desktop input converge on the shared
gameplay-facing hand entities. The V1 box has only a small shared held/falling/
resting state machine; Pistols at Dawn's larger holster/stack/throw/catch graph
remains isolated until it can be migrated incrementally.

Coming soon: broader object manipulation, vibration/haptics, and spatial audio.

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

**Cube Pop:**

3. Point either controller at a cube; a laser line shows what you're aiming at.
4. Pull the trigger to pop it. Pop all of them to trigger the win state, then point at the green "RESET" box and pull the trigger again to play another round.

**Punch Pop:**

3. No laser during normal play — throw real punches. Extend a fist forward past ~40% of your reach (menu, REACH tab → Calibrate Reach measures it; sensible defaults apply until you do) and it starts tracking; reach far enough (~90%) or slow back down and it fires, sending you toward whatever you're looking at — locking onto a nearby enemy if there is one, even one you glanced at moments ago before turning your head to wind up. Extend overhead (past ~40% of overhead reach) the same way for an uppercut. Bring your hand back behind the threshold before it'll register another. Works in any direction, including up — look at something above you and uppercut toward it to launch yourself at it. A punch/uppercut that physically connects with a cube (or one you're locked onto, if Hit Assist isn't set to Off) damages it regardless of exact aim.
4. Pull either trigger at any time for a quick reset.
5. Press any face button (A/B on the right controller, X/Y on the left) to open the menu — it spawns a couple feet in front of you, facing you, and your other hand gets a laser pointer. Aim it at a button and pull that hand's trigger to click: switch tabs (PUNCH / FOES / AIM / REACH / SPLAT / FEEL / DEBUG / MORE), adjust speed/gravity/cube count/behavior/lock-on/hit-assist/reach calibration/splatter/comfort-vignette/haptic-buzz/detection thresholds, Resume, or select **Exit VR** to leave the session. Press a face button again to close it.
6. You should feel a controller pulse on a punch that connects, plus a light buzz in both hands while zooming, and see the edges of your view darken during fast movement — all under the FEEL tab if you want to turn any of it down (or up).

## Multiplayer

`common/multiplayer.js` (WebRTC peer connections) and `worker/`
(the signaling relay that gets two peers' connections talking to each
other — see "Hosted relay (Cloudflare Workers)" below) are what
`primitives/menus/` uses to demonstrate peer-to-peer multiplayer, and
what the in-VR watch menu's **Multiplayer** page builds on for real
play: open the watch menu, tap Multiplayer, tap HOST (get a 4-character
room code, shown beside the watch) or dial in a code with the
directional selector and tap JOIN. No address to type anywhere — the
relay's address is baked in at build time (see "Hardcoding the relay
address" below), so a room code is the only thing anyone ever enters.
Actual gameplay traffic never touches the relay — it goes directly
peer-to-peer between each joiner and the host once connected (never
joiner-to-joiner directly), the relay only ever sees the one-time
WebRTC handshake.

The menu showcase page (`primitives/menus/`) also still has a plain
HTML panel exercising the same connection code directly (manual
copy/paste, and a free-text relay-address field) — useful for testing
the handshake without a headset, not something a player would see.
Its relay-address field has nothing to point to by default now that
there's no locally-run relay to type in; paste a `wrangler dev`
address there (see "Testing locally without deploying" below) if
you're testing the Worker itself through that panel.

### Hosted relay (Cloudflare Workers)

The relay (`worker/`) is a Cloudflare Worker + Durable Object,
reachable over the open internet — see `worker/src/signal-hub.js` for
the room logic and its header comment for why one Durable Object
instance is enough for this.

**One-time account setup:**

1. Create a free Cloudflare account at
   [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)
   — no credit card required. Workers stays on the **Free** plan
   until you explicitly switch to **Workers Paid** in the dashboard;
   nothing here does that for you, and the free plan has no payment
   method attached at all, so there's no way for it to bill you by
   accident.
2. Log in from your machine: `npx wrangler login` opens a browser tab
   to authorize the CLI. This is only needed for deploying from your
   own computer (`npm run relay:hosted:deploy`) — skip it if you're
   only using the GitHub Actions workflow below.

**Deploying:**

- **From your machine**: `npm run relay:hosted:deploy` (after
  `wrangler login` above). Prints the `https://vr-signal-relay.<your
  subdomain>.workers.dev` URL — the relay's `wss://` address is the
  same host with `wss://` in place of `https://`.
- **From GitHub Actions** (no local `wrangler login` needed): the
  "Deploy signal hub" workflow (`.github/workflows/deploy-signal-hub.yml`)
  runs `npm test` then deploys, triggered manually from the Actions
  tab. It needs one repo secret:
  - **`CLOUDFLARE_API_TOKEN`** — in the Cloudflare dashboard, go to
    **My Profile → API Tokens → Create Token** and use the **"Edit
    Cloudflare Workers"** template (scopes it to Workers + Durable
    Objects only, not your whole account). Add it as a secret at
    **repo Settings → Secrets and variables → Actions → New repository
    secret**, named `CLOUDFLARE_API_TOKEN`.
  - If your Cloudflare login has access to more than one account (most
    personal accounts don't), wrangler may also need a
    `CLOUDFLARE_ACCOUNT_ID` secret to know which one to deploy into —
    only add this if a deploy fails asking for it. Find it on any
    domain's Overview page in the dashboard, in the right sidebar.

**PR previews**: every PR automatically gets its own live preview
Worker — `preview-signal-hub.yml` deploys `vr-signal-relay-pr-<number>`
(its own Durable Object namespace, isolated from production) and
comments the `wss://` address on the PR. `cleanup-signal-hub-preview.yml`
deletes it again when the PR closes, merged or not, so these don't
pile up on the account. This isn't Cloudflare's built-in "preview URL"
feature (`wrangler versions upload`) — that's explicitly unsupported
for Workers using Durable Objects, which this one does — so it's a
real second Worker instead of a lightweight preview version, on the
same free plan as production.

This deploys unconditionally, not just for PRs that touch `worker/**`
— see "Hardcoding the relay address" below for why: every Netlify
deploy-preview build bakes in a `vr-signal-relay-pr-<number>` address
regardless of what the PR actually changed, since the HOST/JOIN
buttons ship on every build. A PR whose own preview Worker doesn't
exist yet still has its build pointed at that address, so the button
lights up (the click itself works) but hosting/joining silently fails
— the WebSocket error only reaches the browser console, not the UI.

This is separate from, and unrelated to, the site's own Netlify
deploy previews (the actual `primitives/menus/` page a browser loads)
— those come from Netlify's own GitHub integration, not anything in
this repo, and only fire on a real push to a PR's branch (opening or
retargeting a PR alone doesn't trigger one — push a commit if a
preview seems to be missing). The two previews line up automatically,
though: see "Hardcoding the relay address" below for why a PR's
Netlify preview already points at that same PR's Worker preview with
nothing to paste anywhere.

**Hardcoding the relay address**: `vite.config.js` computes the
relay's `wss://` address at build time from `CONTEXT`/`REVIEW_ID` —
environment variables Netlify sets automatically on every build, not
anything configured in this repo — and injects it as a global
(`__RELAY_URL__`, read via `common/relay-config.js`'s `RELAY_URL`).
On a `deploy-preview` build, `REVIEW_ID` is the PR number, which lines
up exactly with `preview-signal-hub.yml`'s `vr-signal-relay-pr-<number>`
naming — so a PR's Netlify preview is automatically wired to that same
PR's Worker preview, no manual pasting involved. Any other build
(production, local `npm run dev`) falls back to the production
address. An explicit `VITE_RELAY_URL` env var overrides both, for
pointing a build at something else entirely (e.g. a local
`wrangler dev` instance — see below).

**Testing locally without deploying**: `npm run relay:hosted:dev` runs
the same Worker code against Cloudflare's local simulator (`workerd`)
on your machine — prints a `ws://localhost:8787`-style address, no
Cloudflare account needed for this part. Paste it into the showcase
panel's relay-address field to exercise it directly, or run
`VITE_RELAY_URL=ws://localhost:8787 npm run dev` to point a real dev
build (including the in-VR watch menu) at it.

**Cost**: the relay only ever moves a few KB of text per connection
(the one-time handshake) — nowhere near the free plan's limits
(100,000 requests/day) under any realistic amount of play. If usage
ever did grow enough to matter, the free plan simply stops accepting
requests rather than charging you; the only way this relay can ever
cost money is if you deliberately upgrade the Cloudflare account to
Workers Paid.

**Why the relay alone isn't enough**: `common/multiplayer.js` also now
points `iceServers` at a free public STUN server
(`stun.cloudflare.com`, no account needed), which is the other half of
what it takes for two peers on separate networks to find each
other — the relay lets them exchange addresses, STUN is what gives
each side a real address to exchange. TURN — needed for the fraction
of networks where even STUN can't establish a direct path, and which
comes with a real ongoing bandwidth cost since it relays actual
gameplay traffic — is deliberately not part of this yet; see
`TODO.md`.
