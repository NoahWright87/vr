# vr

A collection of small WebXR prototypes for the Meta Quest 2 browser, built with [A-Frame](https://aframe.io) via CDN — no build step, no npm install. Each prototype is a single, self-contained HTML file.

Deployed as a static site (planned: `vr.noahwright.dev` via Netlify).

## Structure

```
/index.html              landing page linking to every prototype
/games/<name>/index.html one folder per prototype, fully self-contained
```

To add a new prototype: create `games/<name>/index.html`, and add a link to it from the root `index.html`. Nothing else needs to change — each game manages its own A-Frame version, components, and assets.

## Prototypes

- **[Cube Pop](games/cube-pop/index.html)** — point a Quest controller at a floating cube and pull the trigger to pop it. Counter tracks progress; popping all cubes shows a win state with an in-VR reset button. Also has a gaze-reticle fallback so you can validate it from a phone or desktop browser without a headset — see below.
- **[Punch Pop](games/punch-pop/index.html)** — punch-to-move locomotion POC. There are no laser pointers here; you move by physically throwing punches, and you pop cubes by hitting them with a fist that's moving fast enough. See below for how it works and how to tune it.

### Punch Pop: how it works

The core idea being tested: **punching is the locomotion**, not a separate joystick/teleport system.

- Both hands are tracked independently and identically — each has its own `punch-tracker` component instance, so there's no shared state that could cause only one hand to register. Hand pose comes from `oculus-touch-controls`, the Quest-native controls component, confirmed on real hardware to actually bind both controllers. The in-headset debug HUD shows `L:ok`/`L:--` and `R:ok`/`R:--` so a real tracking dropout is visible immediately instead of looking like a game bug.
- A swing is tracked start-to-finish as a small state machine (`punch-tracker`): once hand speed crosses a threshold, it accumulates max speed reached, total hand path length travelled, and total head path length travelled (via the head's own `punch-tracker` instance) — until speed drops back down, at which point it emits a "punch" carrying the *net displacement direction* from where the swing started to where it ended, plus those three stats.
- The speed compared against that threshold is the hand's velocity **relative to the head's own current velocity**, not raw hand velocity (a menu-adjustable "Turn Filter", 0-100%, defaults to 100%). Playtesting turned up a real bug this fixes: rig-local hand *position* (what punch-tracker measures) doesn't rotate when you physically turn your body — only punch-locomotion's own translation moves it — so turning while holding a hand out sweeps that hand through a wide arc in tracking space, which used to read as a real swing and cause phantom lunges you never threw. The head sweeps through a correlated arc during a body turn but stays roughly still during a real punch, so subtracting it out cancels most of the false positive. The swing's *magnitude* (how hard it hits/how far it lunges) still uses raw, unfiltered hand speed, so stepping/leaning into a real punch keeps its full reward — only the "is this actually a punch" trigger is turn-filtered.
- `punch-locomotion` only allows a lunge if that direction is within a look cone of where the camera is actually looking (100° by default). This is the direct fix for accidental backward punches — a fast cock-back's net direction essentially never matches where you're looking, so it's rejected before it can move you at all — and it replaced an earlier, harder-to-tune "is the hand currently moving away from the head" per-frame heuristic that kept fighting with uppercut detection specifically (an uppercut's hand ends up *near* the head at full extension, so that check often misread real uppercuts as retracting). There's no separate uppercut/smash case anymore: a punch can send you in *any* direction your swing+look combination points toward, including straight up if you're looking at something above you — juggling included. A blocked punch shows exactly why (e.g. `BLOCKED 143deg / 100deg cone`) instead of a bare "BLOCKED", so a confusing moment in-headset is self-explanatory.
- If a live cube is close enough and within a tighter cone of your aim, the punch **locks onto it** and moves you straight toward it (extra range for a bigger/faster swing) — but the lunge magnitude is capped by how far away the target actually is (distance × a fixed factor + a small baseline), not the full swing magnitude. Without this, finishing off a cube you're already standing next to applied the same force as a lunge from across the room, flinging the player past or through it — the fix for repeated close-range combos moving the player around unexpectedly. Otherwise (no lock-on) the movement direction is your punch direction blended halfway with your look direction, so punching with nothing to aim at still generally sends you where you're looking.
- Impulse magnitude combines three swing stats: max hand speed, hand travel distance, and head travel distance (rewarding leaning/stepping into a punch, not just flicking the wrist), scaled by **Move Speed** — the one knob exposed to the player, since "does punching feel strong enough overall" is the real in-headset question.
- Gravity pulls you back down (menu-adjustable, lower it for a floatier, more super-heroic feel that makes juggling/hovering between punches easier); drag is strong on the ground (a lunge resolves into a stop rather than an endless ice-skating slide — the main lever for avoiding motion sickness) and light in the air (so a jump/lunge keeps its arc).
- Enemies are simple "cube people" now, not floating balloons — a legs/torso/head stack of boxes (`punch-game.spawnCube`) on a container entity whose own position is always the character's feet/ground-contact point (y=0 at rest; no more spawning at a random floating height, and no more idle up-down "bob" — a training dummy standing still just stands still). A real skeleton/ragdoll model is a future step; this is deliberately just enough to read as a combatant. Because there are three separately-positioned hit points instead of one, a jab, a cross, and a hook all have something to actually connect with — `punch-game.checkHand` checks each body part independently against the fist's hit radius.
- Cubes have health instead of popping in one hit. Real contact (fist within ~0.35m of *any* body part while moving fast enough — gated on the same head-relative speed used for swing detection, so spinning around with a fist out doesn't register as landing hits on anything nearby) applies damage computed by the *exact same formula* used for how far a punch lunges the player (`punch-locomotion.computeMagnitude`), fed with that hand's current swing-in-progress *raw* speed/distance stats (not the head-relative value — once a hit is confirmed real, damage should still reflect true physical force) rather than waiting for the swing to finish, since contact happens mid-swing. A cube's color desaturates toward gray (applied to all three body parts) in proportion to its remaining health (`THREE.Color`'s HSL conversion, holding hue/lightness constant and scaling saturation down — no separate health bar) and it dies once fully drained. Default health was cut in half (100 → 50) after playtesting: a *sustainable* punch — this is controlled physically, nobody can throw maximal-effort haymakers indefinitely — was only taking a sliver out of a 100-health bar, which read as "I'm not damaging this thing" rather than a fight. A short per-cube hit cooldown (~220ms) stops one swing that dwells in the hit radius for more than a frame from registering as several hits. Dying respawns a replacement — it's an endless heavy-bag loop with a running counter, not a fixed batch + win screen like Cube Pop.
- **A real bug found via testing, not playtesting, worth flagging if you touch damage code:** `punch-game`'s `init()` used to cache `punch-locomotion`'s component reference once (`this.locomotion = this.rig.components['punch-locomotion']`). Component `init()` order across sibling/cousin entities isn't guaranteed by A-Frame, and this one could run before `punch-locomotion` had attached — when that race lost, `this.locomotion` stayed `undefined` for the rest of the session and every hit silently fell back to raw hand speed as damage, skipping the entire `computeMagnitude` formula (distance bonuses, the Move Speed multiplier, all of it). This was invisible from the outside — no error, no crash, just quietly weaker hits than intended — and was likely a real contributor to "it takes forever to kill one of these," independent of the health-value rebalance above. Fixed by looking the component up fresh at the point of use instead of caching it at `init()` time.
- A non-lethal hit now physically launches the cube (`cube-behavior.applyKnockback`), primarily **straight away from the player** rather than a raw reflection of whatever direction the hand happened to be instantaneously moving (which can be pretty wobbly mid-swing) — angled only a little by the actual swing direction. The swing's vertical component contributes partial credit as a launch: an upward-angled hit sends the target a little airborne, a downward one adds a little downward velocity — which, against an already-grounded target, immediately feeds into the impact-damage system below (a downward punch that connects contributes to slamming the target into the floor). Overall speed scales with hit force but is deliberately much gentler than the player's own lunge speed. It's real position integration (velocity + friction + a light gravity pulling a launch back down), running in place of that cube's normal chase/patrol/wander/idle movement while still sliding fast enough, and leaves a thin trail of paint in the cube's own color while it slides (menu-toggleable). Once a knockback settles, the cube's patrol/wander reference point re-anchors to wherever it actually ended up rather than its original spawn spot — otherwise a cube punched well away from home would slide to a stop and then calmly walk itself back, a milder echo of the same "snaps back" bug below. A cube slid into another live cube transfers some of that damage and velocity on to it too — punching one cube into a cluster of others should hurt more than one — capped to at most once per second per specific pair, so two cubes resting against each other can't loop into infinite mutual damage.
- **"Move fast and break things":** a cube's knockback velocity that gets suddenly zeroed by a hard surface — hitting the room's wall bounds, or slamming into the floor while still falling — deals impact damage proportional to how much speed was just lost (small stumbles below a minimum don't count). This is genuinely the same idea as fall damage, just triggered by any hard stop, not only landing from a jump: punch someone into a wall, or hit them hard enough into the ground, and the impact itself hurts on top of the punch that caused it. This also fixed a real, separate bug caught via testing: `cube-behavior`'s knockback physics had no guard against a single oversized frame delta (unlike `punch-locomotion`'s, which already had one) — in a slow/coalesced frame, gravity integrated over the whole oversized step in one shot and a cube's downward velocity ran away to 100+ m/s instead of settling back near zero once it landed, which is also most of what caused the original "falls to the ground, then magically resets back to where it was bobbing" complaint (the runaway velocity kept the cube permanently stuck in "still sliding" state, so its actual settle-and-resume-normal-movement logic — including the old vertical bob height — never got a clean chance to take over correctly).
- Cubes aren't static. Each one gets a `cube-behavior` — `idle` (just stand there), `chase` (slowly drifts toward you), `patrol` (walks between two fixed points), or `wander` (ambles to a new random nearby spot every couple seconds). Default is `mixed`: every spawned cube gets a random one of the four.
- Every hit leaves a splatter of paint on the floor, in the cube's own (pre-desaturation) color — a bigger, more scattered splat for a harder hit, and a scattered multi-blob burst on the killing blow. Playtesting feedback was that the splatter read as sparse and tightly clustered right under the cube, so both the baseline splat size/opacity and the scatter distance blobs can land from the hit point went up substantially, and two more menu knobs (**Splat Amount**, **Splat Scatter** — SPLAT tab) scale further on top of that if even more is wanted. It's painted onto a single shared canvas texture (`THREE.CanvasTexture`) applied to a floor-sized transparent overlay plane (`#splat-layer`), so it accumulates for the whole session rather than resetting per-cube — after fighting through enough cubes the floor genuinely turns into a rainbow paint-bucket-explosion look, which was the point. World position → canvas pixel uses an actual raycast against the overlay plane's mesh to read back its UV coordinate at the hit point (`worldToSplatPixel`), deliberately avoiding a third hand-derived orientation formula in this file after two others already turned out backwards (see the `getWorldDirection`/`lookAt` note below) — ground-truth UVs can't be backwards the way an assumed axis mapping can. "Reset Arena" (menu button or either trigger) clears the canvas along with everything else, so a fresh run starts with a clean floor.
- You're inside an actual room (30x30m, 6m walls) with a checkerboard floor/wall texture rather than an open plane — partly for presence, partly because a strong static visual frame around you is one of the standard techniques for countering motion-sickness during fast locomotion.
- Reset is bound to either controller's physical trigger button for a quick restart, and there's also a "Reset Arena" button in the menu.
- An optional in-view **stats HUD** (menu, MORE tab → Show Stats) shows the last punch's max speed / hand distance / head distance / computed magnitude (and, if the lock-on distance cap kicked in, the capped value and distance to target) / angle-to-look vs. the current cone / lock state — for understanding what the targeting system is actually doing while playtesting.
- A separate, opt-in **live debug HUD** (menu, DEBUG tab → Live Debug HUD) shows the raw handful of numbers the detection logic reads *every frame*, continuously, rather than a post-punch snapshot: both hands' raw vs. head-relative speed and current swing state (`[SWING]`/`[idle]`), the live trigger/reset speed thresholds, the turn filter percentage, head speed, and rig velocity. This is meant to make a confusing in-headset moment (an unexpected lunge, a surprising BLOCKED) legible on the spot, or at least screenshot-able, instead of guessed at from outside the headset.

**Menu:** press either controller's grip to open it — a bigger panel spawns fixed in world space, a couple feet in front of wherever you're currently standing and facing, oriented back toward you; press either grip again to close it. This replaced an earlier per-wrist "watch" panel that turned out hard to aim at and cramped once it grew past a couple of tabs. Two things happen structurally while it's open: punching and cube-popping are disabled and rig physics freeze entirely (gated on a shared `menuOpen` flag), and the *other* hand (never the one that pressed grip) gets a small laser pointer + cursor to click menu buttons with. Because only one hand can ever be an active pointer at a time, there's no way for an absent-minded trigger pull on the "wrong" hand to register a click on whatever it happened to be aimed at. The laser stops exactly at whatever it's pointing at (a `laser-beam` component rescales it to the raycaster's live hit distance every frame). The trigger's normal "quick reset" job is suspended while the menu is open. Content is organized into tabs, built with a small generic `createTabbedPanel` helper that has nothing Punch-Pop-specific in it, meant to be copy-pasted into future prototypes that need tabs (this repo has no build step or shared module system, so "reusable" means "self-contained enough to lift wholesale," not an import):

- **PUNCH** — Move Speed, Gravity, Max Speed, Reset Arena
- **FOES** — Cube Count, Cube Health, cycle Cube Behavior
- **AIM** — Look Cone, Lock-On Cone, Lock Range (tuning for the look-gated/lock-on targeting described above)
- **SPLAT** — Splat Amount, Splat Scatter, Knockback Force, Trail on/off
- **DEBUG** — Live Debug HUD toggle, Trigger Speed, Reset Speed, Turn Filter
- **MORE** — Resume, **Exit VR**, Show Stats

Longer-term design plans (the "secretly a fitness game, but you feel like a superhero" vision — more move ideas like squat-jumps, arm-circle force fields, lunge-dashes, ground-pound smashes, and how they might chain into combos) are tracked in [`games/punch-pop/TODO.md`](games/punch-pop/TODO.md) rather than here, since none of it is built yet.

Tuning knobs not yet exposed in the menu (drag, room size, cube-cube collision radius/damage, etc.) still live as schema properties or literal attribute values near the top of each relevant component/entity in `games/punch-pop/index.html`.

**A genuinely subtle bug worth knowing about if you touch this code**: `THREE.Object3D.prototype.getWorldDirection()` only means "local -Z, transformed to world space" for an actual `THREE.Camera` (or `THREE.Light`) instance — it's overridden there specifically. For a plain `Object3D`, which is what an A-Frame entity's own `.object3D` always is (including `<a-camera>`'s — the real `THREE.Camera` lives on a *child* object reachable via `.getObject3D('camera')`), the default behavior returns **+Z**, and `lookAt()` follows the same +Z-is-forward convention for plain objects too. Both the menu's spawn-facing logic and the look-direction gating hit this directly and were silently backwards until caught by testing — see `getForwardDirection()`, the shared helper that now sidesteps it everywhere by explicitly applying the world quaternion to `(0,0,-1)` rather than trusting `getWorldDirection()`.

**Open question this POC exists to answer:** does punching alone generate enough sense of motion to avoid VR motion sickness, especially during airborne arcs (uppercut-style launches, juggling between locked-on enemies)? That can only really be judged in the headset — the desktop "Simulate punch" buttons exist to sanity-check the physics/targeting code, not the comfort of the experience.

**Safety:** this moves your whole viewpoint based on real arm swings — clear at least ~2x2m of real space and be mindful of your surroundings before trying it in a headset. If you ever need to bail out and the in-VR "Exit VR" menu button isn't reachable for some reason, your headset's own system button (e.g. the Oculus/Meta button on a Quest controller) always backs out of any WebXR session regardless of what the page does.

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

3. No laser during normal play — throw real punches. A punch only lunges you if it's roughly aimed where you're looking (winding up/cocking your fist doesn't move you — only a throw aimed near your look direction does); if a cube is close and near your aim it locks on and pulls you straight to it, otherwise you move halfway between your punch direction and your look direction. Works in any direction, including up — look at something above you and punch toward it to launch yourself at it. A punch that physically connects with a cube pops it regardless of aim.
4. Pull either trigger at any time for a quick reset.
5. Press either grip to open the menu — it spawns a couple feet in front of you, facing you, and your other hand gets a laser pointer. Aim it at a button and pull that hand's trigger to click: switch tabs (PUNCH / FOES / AIM / SPLAT / DEBUG / MORE), adjust speed/gravity/cube count/behavior/aim cones/splatter/detection thresholds, Resume, or select **Exit VR** to leave the session. Press either grip again to close it.
