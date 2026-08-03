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
- `punch-locomotion` only allows a lunge if that direction is within a look cone of where the camera is actually looking. This is the direct fix for accidental backward punches — a fast cock-back's net direction essentially never matches where you're looking, so it's rejected before it can move you at all — and it replaced an earlier, harder-to-tune "is the hand currently moving away from the head" per-frame heuristic that kept fighting with uppercut detection specifically (an uppercut's hand ends up *near* the head at full extension, so that check often misread real uppercuts as retracting). There's no separate uppercut/smash case anymore: a punch can send you in *any* direction your swing+look combination points toward, including straight up if you're looking at something above you — juggling included.
- If a live cube is close enough and within a tighter cone of your aim, the punch **locks onto it** and moves you straight toward it (extra range for a bigger/faster swing). Otherwise the movement direction is your punch direction blended halfway with your look direction, so punching with nothing to aim at still generally sends you where you're looking.
- Impulse magnitude combines three swing stats: max hand speed, hand travel distance, and head travel distance (rewarding leaning/stepping into a punch, not just flicking the wrist), scaled by **Move Speed** — the one knob exposed to the player, since "does punching feel strong enough overall" is the real in-headset question.
- Gravity pulls you back down (menu-adjustable, lower it for a floatier, more super-heroic feel that makes juggling/hovering between punches easier); drag is strong on the ground (a lunge resolves into a stop rather than an endless ice-skating slide — the main lever for avoiding motion sickness) and light in the air (so a jump/lunge keeps its arc).
- Cubes pop from real proximity + force (fist within ~0.35m of a cube while moving fast enough), not a raycast click, and are unaffected by the look-cone gating above — that only gates whether *you* lunge, not whether a punch that physically connects still pops something. Popping one immediately spawns a replacement — it's an endless heavy-bag loop with a running counter, not a fixed batch + win screen like Cube Pop.
- Cubes aren't static. Each one gets a `cube-behavior` — `bob` (float in place), `chase` (slowly drifts toward you), `patrol` (walks between two fixed points), or `wander` (ambles to a new random nearby spot every couple seconds). Default is `mixed`: every spawned cube gets a random one of the four.
- You're inside an actual room (30x30m, 6m walls) with a checkerboard floor/wall texture rather than an open plane — partly for presence, partly because a strong static visual frame around you is one of the standard techniques for countering motion-sickness during fast locomotion.
- Reset is bound to either controller's physical trigger button for a quick restart, and there's also a "Reset Arena" button in the menu.
- An optional in-view **stats HUD** (menu, MORE tab → Show Stats) shows the last punch's max speed / hand distance / head distance / computed magnitude / angle-to-look / lock state — for understanding what the targeting system is actually doing while playtesting, not meant to stay on for normal play.

**Menu:** press either controller's grip to open it — a bigger panel spawns fixed in world space, a couple feet in front of wherever you're currently standing and facing, oriented back toward you; press either grip again to close it. This replaced an earlier per-wrist "watch" panel that turned out hard to aim at and cramped once it grew past a couple of tabs. Two things happen structurally while it's open: punching and cube-popping are disabled and rig physics freeze entirely (gated on a shared `menuOpen` flag), and the *other* hand (never the one that pressed grip) gets a small laser pointer + cursor to click menu buttons with. Because only one hand can ever be an active pointer at a time, there's no way for an absent-minded trigger pull on the "wrong" hand to register a click on whatever it happened to be aimed at. The laser stops exactly at whatever it's pointing at (a `laser-beam` component rescales it to the raycaster's live hit distance every frame). The trigger's normal "quick reset" job is suspended while the menu is open. Content is organized into tabs, built with a small generic `createTabbedPanel` helper that has nothing Punch-Pop-specific in it, meant to be copy-pasted into future prototypes that need tabs (this repo has no build step or shared module system, so "reusable" means "self-contained enough to lift wholesale," not an import):

- **PUNCH** — Move Speed, Gravity, Max Speed, Reset Arena
- **FOES** — Cube Count, cycle Cube Behavior
- **AIM** — Look Cone, Lock-On Cone, Lock Range (tuning for the look-gated/lock-on targeting described above)
- **MORE** — Resume, **Exit VR**, Show Stats

Longer-term design plans (the "secretly a fitness game, but you feel like a superhero" vision — more move ideas like squat-jumps, arm-circle force fields, lunge-dashes, ground-pound smashes, and how they might chain into combos) are tracked in [`games/punch-pop/TODO.md`](games/punch-pop/TODO.md) rather than here, since none of it is built yet.

Tuning knobs not yet exposed in the menu (trigger speed, drag, room size, etc.) still live as schema properties or literal attribute values near the top of each relevant component/entity in `games/punch-pop/index.html`.

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
5. Press either grip to open the menu — it spawns a couple feet in front of you, facing you, and your other hand gets a laser pointer. Aim it at a button and pull that hand's trigger to click: switch tabs (PUNCH / FOES / AIM / MORE), adjust speed/gravity/cube count/behavior/aim cones, Resume, or select **Exit VR** to leave the session. Press either grip again to close it.
