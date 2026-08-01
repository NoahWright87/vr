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

- Both hands are tracked independently and identically — each has its own `punch-tracker` component instance, so there's no shared state that could cause only one hand to register. Hand pose comes from `generic-tracked-controller-controls` (matches by handedness only) rather than a device-specific component like `oculus-touch-controls`, which matches by the controller's exact device-ID string and can silently fail to bind on one hand if that string doesn't match what's expected. The in-headset debug HUD shows `L:ok`/`L:--` and `R:ok`/`R:--` so a real tracking dropout is visible immediately instead of looking like a game bug.
- Each hand tracks its own real-world velocity every frame (position delta relative to the player rig, not world space — see the `punch-tracker` component comment for why that distinction matters, it's what keeps the rig's own motion from feeding back into itself).
- A swing past a speed threshold fires a "punch" impulse that pushes the player rig (`punch-locomotion` component) in the punch's direction. Harder/faster swings push farther. A punch angled mostly upward (dot product with world-up) is treated as an **uppercut** and gets an extra vertical boost, launching you airborne. A downward swing while already airborne overrides the shallow arm angle with a hard **crash straight down**.
- Gravity pulls you back down; drag is strong on the ground (a lunge resolves into a stop rather than an endless ice-skating slide — this is the main lever for avoiding motion sickness) and light in the air (so a jump/lunge keeps its arc).
- Head motion in the same direction as the punch adds a small bonus to the impulse — "leaning into it" or stepping forward moves you farther, per the original idea of using your whole body.
- Cubes pop from real proximity + force (fist within ~0.35m of a cube while moving fast enough), not a raycast click. Popping one immediately spawns a replacement — it's an endless heavy-bag loop with a running counter, not a fixed batch + win screen like Cube Pop.
- Cubes aren't static anymore. Each one gets a `cube-behavior` — `bob` (float in place, the original feel), `chase` (slowly drifts toward you), `patrol` (walks between two fixed points), or `wander` (ambles to a new random nearby spot every couple seconds). Default is `mixed`: every spawned cube gets a random one of the four.
- You're inside an actual room (30x30m, 6m walls) with a checkerboard floor/wall texture rather than an open plane — partly for presence, partly because a strong static visual frame around you is one of the standard techniques for countering motion-sickness during fast locomotion.
- Reset is bound to either controller's physical trigger button for a quick restart, and there's also a "Reset Arena" button in the pause menu.

**Pause menu:** squeeze either controller's grip button (or the "Menu" button in the desktop overlay) to open it. It's aimed with the same reticle used for the desktop/phone fallback, switched into gaze-and-dwell mode (look at a button for ~800ms to select it) so no controller trigger is needed — that keeps the trigger free for its normal quick-reset job even while the menu is open. From the menu you can adjust **Move Speed** (a single multiplier over the whole punch-to-move impulse, since "does punching feel strong enough" is the real question, not any one internal constant), **Cube Count**, cycle **Cube Behavior**, **Reset Arena**, **Resume**, or — the direct fix for getting stuck in VR — **Exit VR**.

Tuning knobs (trigger speed, force-to-move scale, gravity, drag, uppercut/smash thresholds, room size, etc.) all live as schema properties on the `punch-tracker`, `punch-locomotion`, and `punch-game` components at the top of each one in `games/punch-pop/index.html` — adjust the `punch-locomotion="..."` / `punch-game="..."` attributes on `#rig` / `#cube-manager`, the defaults in the schema, or the in-headset pause menu, to change feel without touching the logic.

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

3. There's no laser — throw real punches. A fast punch that connects with a cube pops it; a fast punch anywhere lunges you in that direction, an uppercut launches you up, and a downward swing while airborne crashes you down.
4. Pull either trigger at any time for a quick reset.
5. Squeeze either grip to open the pause menu — adjust speed/cube count/behavior, or select **Exit VR** to leave the session.
