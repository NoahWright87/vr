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
- **[Pistols at Dawn](games/pistols-at-dawn/index.html)** — two boxy pistols holster at your hips, a shotgun rides a bandolier across your back, and a hat sits on your head (hips/back approximated from headset yaw, the hat's spot tracks full head rotation, since there's no real body tracking). Grab any of them the same way — a shared "holsterable" component handles the whole hold/dangle/throw/holster mechanic generically, not just for guns. Grip near one to draw it, aim at a target, and pull the trigger to score — pistols fire a single shot, the shotgun sprays six pellets in a tight cone. Release the grip near a matching anchor to holster it (generously, so it doesn't drop by accident); release it elsewhere while a finger is still on the trigger and it dangles from your finger, swinging and spinning as a simple physics sim reacting to your hand motion. A hard-enough upward release is a throw instead of a drop — aimed so a straight-up toss comes back to the same hand and a toss with sideways intent lands near the other one, for juggling — and anything falling or flying is generously catchable by grip or by trigger finger. The hat rides the exact same mechanics: take it off like drawing a gun, and its spin pivot is offset to one edge of the head-hole (like a finger hooked under the brim) so it twirls like a hat trick instead of a plate.

  Every anchor (hip holsters, head, back bandolier, and a small slot hidden inside the hat's own crown) is a generic "anchor-slot," sized small/medium/large — small fits any slot, medium needs medium-or-bigger, large needs large. Nothing is hardcoded to "guns go in holsters": the hat (medium) can ride your head or the bandolier but not a holster; a pistol (small) fits everywhere, including tucked inside the hat or, if you're feeling silly, worn on top of your head like a hat itself. Each slot shows a small translucent sphere — color-coded by size — that grows more obvious as a compatible carried item gets close and gives a quick "click" bounce right as it enters snap range, since controller vibration doesn't reliably work everywhere. A slot already claimed by something hides its indicator; something actively held with its own slot (like a worn-in-hand hat) will passively catch a falling item that fits, so you can toss a gun up, whip your hat off, and catch it inside.

  Turn around and there's a saloon bar behind you, which exists mostly to find out how far the generic systems stretch. The bottles standing on it aren't special objects — they're the same "holsterable" props the guns are, sitting in the same "anchor-slot" sockets the hip holsters use, so you can stand a beer in your holster or set a pistol on the bar. Slam a capped bottle down on the counter (or the floor) and the cap pops off; tip an open one up to your mouth and you actually drink it. Shoot one and it shatters into glass; throw one hard at the ground and it shatters the same way through a completely different code path. Shattered bottles restock themselves on the shelf a few seconds later, the way knocked-down targets stand back up.

  Two things generalized outward from that. First, **stacks**: a hand holds up to four things instead of one, and an anchor-slot can have a capacity, with contents fanned out either way. So you can hold two pistols in one fist (one trigger pull fires both, with two recoils and two clouds of smoke), grab an armful of bottles and fling them all skyward on one throw for skeet, or clench five cigars in your teeth at once. Second, **vices**: drinking fills a meter that decays slowly, lit cigars add a fast tremor, and both feed one shared "unsteady hands" wobble that every held object reads — so a fifth cigar wrecks your aim about as thoroughly as a second beer. It perturbs held objects and never the camera, on purpose; a swaying gun barrel is funny, a swaying view is a motion-sickness generator.

  Cigars sit in a tray on the bar and can be lit three ways, none of which are enumerated anywhere in the code: off another lit cigar, off the barrel of a gun you just emptied (barrels track heat and stay hot for a couple of seconds), or by shooting the cigar, which does mean pointing a loaded pistol at your own face. That's a two-attribute "ignition-source"/"lightable" contract plus a proximity check, so a lantern or a stick of dynamite would join in for free. Guns and cigars both produce smoke into one shared particle pool, and firing faster than the barrel cools builds a real cloud — which you can sweep away by waving a hand through it, or clear the showy way by bringing the muzzle up in front of your face to blow across it.

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
