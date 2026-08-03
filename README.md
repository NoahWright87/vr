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

- Both hands are tracked independently and identically — each has its own `punch-tracker` component instance, so there's no shared state that could cause only one hand to register. Hand pose comes from `oculus-touch-controls`, the Quest-native controls component, confirmed on real hardware to actually bind both controllers (an earlier revision briefly swapped this for `generic-tracked-controller-controls` on the theory that device-ID matching was flaky — wrong diagnosis, a low battery was the real cause of that report, and the swap broke both hands outright since that component never bound on this hardware at all). The in-headset debug HUD shows `L:ok`/`L:--` and `R:ok`/`R:--` so a real tracking dropout is visible immediately instead of looking like a game bug.
- Each hand tracks its own real-world velocity every frame (position delta relative to the player rig, not world space — see the `punch-tracker` component comment for why that distinction matters, it's what keeps the rig's own motion from feeding back into itself).
- A swing past a speed threshold fires a "punch" impulse that pushes the player rig (`punch-locomotion` component) in the punch's direction, but only while the hand is actually extending *away* from the body (a per-frame check: does the hand's velocity have a positive component along the direction from head to hand?). Without that check, quickly cocking your fist back to wind up a big swing reads as a full-speed punch in the backward direction and launches you before you've thrown anything — this is what fixed that.
- Harder/faster swings push farther. A punch is only classified as an **uppercut** (extra vertical boost, launches you airborne) if it's both angled steeply upward *and* started down near the waist — the hand's rolling recent-minimum height, which forgets old lows over about half a second, is compared against a height threshold. That second condition is what stops an ordinary jab thrown at a high target (which starts around shoulder height, not down at the waist) from being misread as an uppercut just because it happens to point upward. A downward swing while already airborne overrides the shallow arm angle with a hard **crash straight down**.
- Gravity pulls you back down; drag is strong on the ground (a lunge resolves into a stop rather than an endless ice-skating slide — this is the main lever for avoiding motion sickness) and light in the air (so a jump/lunge keeps its arc).
- Head motion in the same direction as the punch adds a small bonus to the impulse — "leaning into it" or stepping forward moves you farther, per the original idea of using your whole body.
- Cubes pop from real proximity + force (fist within ~0.35m of a cube while moving fast enough), not a raycast click. Popping one immediately spawns a replacement — it's an endless heavy-bag loop with a running counter, not a fixed batch + win screen like Cube Pop.
- Cubes aren't static anymore. Each one gets a `cube-behavior` — `bob` (float in place, the original feel), `chase` (slowly drifts toward you), `patrol` (walks between two fixed points), or `wander` (ambles to a new random nearby spot every couple seconds). Default is `mixed`: every spawned cube gets a random one of the four.
- You're inside an actual room (30x30m, 6m walls) with a checkerboard floor/wall texture rather than an open plane — partly for presence, partly because a strong static visual frame around you is one of the standard techniques for countering motion-sickness during fast locomotion.
- Reset is bound to either controller's physical trigger button for a quick restart, and there's also a "Reset Arena" button in the watch menu.

**Watch menu:** hold down a controller's grip button and a small settings panel appears above that wrist, like checking a smartwatch — release the grip and it closes. This replaced an earlier face-filling "pause menu" design that players found disorienting and hard to aim at. Two things happen structurally while a watch is open: punching and cube-popping are disabled and rig physics freeze entirely (gated on a shared `menuOpen` flag), and the *other* hand (never the one showing the watch) gets a small laser pointer + cursor to click menu buttons with — same raycaster+cursor pattern `laser-controls` itself uses, just aimed at menu buttons and normally switched off. Because only one hand can ever be an active pointer at a time, there's no way for an absent-minded trigger pull on the "wrong" hand to register a click on whatever it happened to be aimed at — a real bug in the previous both-hands-active design. The laser also now stops exactly at whatever it's pointing at (a `laser-beam` component rescales it to the raycaster's live hit distance every frame) instead of a fixed length that visibly poked through the far side of the panel it had just clicked. The trigger's normal "quick reset" job is also suspended while a watch is open, so clicking a menu button doesn't also reset the arena. Content is organized into tabs — **PUNCH** (Move Speed, Reset Arena), **FOES** (Cube Count, cycle Cube Behavior), **MORE** (Resume, **Exit VR**, **Debug Axes** — see below) — built with a small generic `createTabbedPanel` helper that has nothing Punch-Pop-specific in it, meant to be copy-pasted into future prototypes that need tabs (this repo has no build step or shared module system, so "reusable" means "self-contained enough to lift wholesale," not an import). Both wrists' panels stay in sync — opening one now explicitly refreshes its displayed values first, since they're two independent bits of DOM sharing one underlying settings state and a value changed on one wrist doesn't repaint the other's (still-hidden) text on its own. On desktop/phone there's no grip button, so the overlay's "Menu" button toggles the left watch instead, aimed with the same gaze reticle used for popping cubes without a headset.

**Debug Axes:** a toggle in the watch menu's MORE tab that draws three labelled, colored bars out of each fist along its local X (red), Y (green), Z (blue) axes — the standard RGB=XYZ convention. The watch panel's position and tilt on the wrist were tuned blind, with no headset to check them against, and the first attempt read as edge-on ("like a blade") from a natural wrist-check pose. This tool exists to fix that properly: hold your hand in the pose you'd actually check a watch in, read off which colored/labelled axis points toward your eyes, and that pins down exactly which local axis the panel's rotation needs to be built around, instead of guessing again.

Tuning knobs (trigger speed, force-to-move scale, gravity, drag, uppercut/smash thresholds, room size, watch position/tilt, etc.) all live as schema properties or literal attribute values near the top of each relevant component/entity in `games/punch-pop/index.html` — change feel without touching the logic.

**Open question this POC exists to answer:** does punching alone generate enough sense of motion to avoid VR motion sickness, especially during the airborne uppercut/smash arcs? That can only really be judged in the headset — the desktop "Simulate punch/uppercut/smash" buttons exist to sanity-check the physics code, not the comfort of the experience.

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

3. No laser during normal play — throw real punches. A fast punch that connects with a cube pops it; a fast punch anywhere lunges you in that direction, a punch that starts low and swings steeply upward launches you as an uppercut, and a downward swing while airborne crashes you down. Winding up (cocking your fist back before a big swing) doesn't move you — only the actual outward throw does.
4. Pull either trigger at any time for a quick reset.
5. Hold down a grip button to check that wrist's watch menu — punching disables and your other hand gets a laser pointer. Aim it at a button and pull that hand's trigger to click: switch tabs (PUNCH / FOES / MORE), adjust speed/cube count/behavior, Resume, or select **Exit VR** to leave the session. Release the grip to close it. If the panel is hard to see/aim at from a natural "check my watch" hand pose, turn on **Debug Axes** (MORE tab) and report back which colored axis (red=X, green=Y, blue=Z) points toward your eyes in that pose — that's enough information to fix the panel's orientation exactly rather than guessing again.
