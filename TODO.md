# Todo

Things deliberately deferred, with enough context to pick them up cold.
Ideas that aren't committed to yet live in DESIGN.md or in conversation;
this is only for work that has been decided on and postponed.

## Desktop semantic hands

- **Carry the shared hand-intent path through every practical VR mechanic.**
  The Showcase now proves the first slice: desktop WASD/mouse input drives
  simulated gameplay-facing hands for a watch, a mounted menu, and a simple
  grab/drop box, while tracked controllers continue to drive those hands in
  XR. The larger objective is: **we eventually want all shared VR
  interactions to be usable — and therefore testable — on a normal laptop
  with mouse and keyboard whenever practical.** VR commands the hands
  physically; desktop commands the hands semantically. Next candidates
  include weapons, holsters, throwing/catching, two-handed props, mounted
  weapons, cannon loading/aiming, hand-cranked guns, and other machinery.

- **Migrate Pistols at Dawn onto the shared semantic hand/object contracts.**
  V1 deliberately did not lift its `hand-rig`/`holsterable` graph into the
  Showcase: that graph also owns stacks, holsters, dangling, catches,
  throwing, support grips, vice wobble, recoil, and physics. Extract the
  useful state transitions behind a shared interface incrementally, then
  make Pistols consume that interface rather than maintaining a second input
  path. Do not make the Showcase depend on Pistols' legacy globals.

  **The foundation is confirmed working, with no changes needed to
  `hand-rig`/`holsterable`/`firearm` themselves** (verified with a headless
  Playwright run against the real dev build, not just read from source —
  see the comment block above `#player-rig` in
  `games/pistols-at-dawn/index.html`): `oculus-touch-controls`/
  `tracked-controls` never attaches while not presenting to WebXR (no
  controller to track), so `semantic-hand`'s existing non-XR `tick()`
  freely drives `#left-hand`/`#right-hand`'s own `object3D` transform —
  the exact same entity/transform `hand-rig` reads every frame — with
  nothing fighting it. And because `hand-rig` listens for raw
  `gripdown`/`gripup`/`triggerdown`/`triggerup` on that same entity (not a
  higher-level `semantic-action`), emitting those same four events from
  desktop/mobile input, after posing the hand via `semantic-hand.
  setWorldTransform`/`setPointPose`, drives the entire hold/holster/
  dangle/throw/catch state machine unmodified. A live probe confirmed a
  full draw round-trip: posing `#right-hand` onto a holstered pistol's
  world transform and firing `gripdown` correctly called
  `holsterable.grab()` and reparented it under the hand's grip child.

  One real nuance the probe surfaced, worth handing to whoever builds the
  hotbar/switching UI: `holsterable.release()` checks the *item's* current
  world position against nearby slots (`tryHolsterElse` →
  `findNearestSlot`), and a held item sits at the hand's grip child plus a
  `heldPosition` offset — not exactly wherever the hand itself was placed.
  Releasing with the hand parked at the item's original (pre-grab) world
  position landed in `falling`, not `holstered`, because that offset put
  the item just outside the slot's catch radius. Positioning code that
  wants a synthetic release to re-holster needs to aim so the *item* lands
  within the slot's radius, accounting for that offset, not just place the
  hand back where it grabbed from.

  Remaining work is entirely about *deciding what triggers those poses/
  events* — a hotbar mapping to specific anchor slots, aiming poses for
  two-handed weapons, a throw/twirl gesture, and siege-weapon mounting —
  not about touching Pistols' own gameplay files.

- **Replace text-only XR action labels with real controller/hand glyphs.**
  A-Frame's bundled SDF font does not reliably contain color emoji such as
  `👉`, `🖐️`, or `✊`, so the first hint-zone pass uses `POKE` and `GRIP`.
  Add small vendored vector/mesh glyphs (including alternating open/closed
  hand frames where useful) without making hint zones care which headset or
  controller supplied the action.

## The shared menu system

`common/menu-model.js` (the pure model) and `common/menu-crossbar.js`
(the A-Frame renderer plus stick engagement) exist, with an in-world
demo panel in `primitives/menus/`. Deliberately not done yet:

- **Migrate the surfaces, one at a time.** Agreed order: the watch
  first (most used, smallest content, biggest win from stick
  navigation), then Pistols' teleport page (worst offender — 12
  hand-positioned entities on a `4.38`-tall plane, whose destinations
  already exist as data in `TOWN_LOCATIONS`), then the wall and
  pedestal panels, then Punch Pop's `createTabbedPanel` (tabs become
  the top level of the drill). The old markup path goes when the last
  consumer is off it, not before. `crossbar-menu` already re-emits
  `menu-item-select` in the shape `menu-item` uses, so existing
  handlers survive a page moving across.

- **Give the temple pip a stronger presence.** It exists and fills, but
  it is a thin bar at ~34° off centre, which is the edge of what a
  Quest shows. If it turns out to be missable in a headset, the fix is
  a larger or animated mark rather than moving it inboard, since
  anything closer to centre is in the way during play.

- **The one-eye test, now runnable.** The visor ships defaulting to
  BOTH eyes on purpose: per-eye rendering is a `layers.set(1|2)` call
  that only means anything once WebXR's two cameras exist, and it has
  never been run in a headset here — defaulting to it risked a menu
  that is simply invisible on first try, which is a miserable thing to
  diagnose while wearing one. So `Eyes: Both / One` is the first row of
  the visor's own menu, with `Scrim: On / Off` under it. That covers
  the three variants agreed earlier (mono + dark scrim, mono + no
  scrim, binocular + scrim) as two menu selections rather than a
  rebuild. The answer decides how dark the visor's backing can be, and
  whether `eye: inboard` becomes the default.

- **Text overflow options.** Long labels currently shrink to fit and
  then ellipsize. Agreed but not built: wrapping to a second line
  within the row's space, and a marquee that scrolls a too-long label
  back and forth — on the focused row only, since text drifting in the
  periphery is both noise and a comfort problem.

- **A multi-slot item kind, for room codes.** Four letters is four
  independent slots, where "inward" should move to the next slot rather
  than drill deeper — the arcade high-score pattern. The 26-row
  alphabet submenu in the showcase is the crude version, and exists to
  find out whether hold-to-repeat scrolling is fast enough to live
  with. Wrap-around already helps (Z is one step above A).

- **A gamepad can't drive a menu off a headset.** `gamepad-input`
  publishes `semantic-move` on the rig; `menu-stick-control` listens for
  `axismove` on hands, which is the XR tracked-controller event. So a
  desktop gamepad moves the player and the menu ignores it. Keyboard and
  mouse both work. The fix wants care: movement must not be captured, so
  a gamepad probably drives menus from the d-pad rather than the stick
  that walks you around.

- **On a phone, taps don't land where your finger is.** The showcase's
  cursor is a *gaze* cursor (`rayOrigin: entity`), so a tap anywhere on
  the canvas activates whatever the screen-centre reticle is pointing
  at — verified by tapping an empty corner and watching the aimed-at row
  fire. This is pre-existing and applies to every menu in the repo, new
  and old, not just the crossbar. The model still works because aiming
  at an off-centre row and tapping scrolls it to the middle, so a second
  tap selects it — but it is "point the phone and tap", not "touch the
  thing", which is not what anyone expects on a phone. The fix is to use
  `rayOrigin: mouse` when `input-router` reports the touch family, so a
  tap raycasts from the touch point. Small, but it changes mobile
  behaviour for every existing menu, so it wants its own pass.

- **The on-screen action buttons don't drive menus.** `touch-controls`
  publishes `semantic-action-intent` on the rig; the crossbar listens for
  controller button events on hands. So USE/INTERACT do nothing to an
  open menu on mobile. Same shape of gap as the desktop gamepad above,
  and probably the same fix.

- **Grip should stop meaning "point".** The fingertip laser enables on
  `gripdown` (`common/watch-menu.js`), which is why reaching for the
  watch in Pistols grabs your hat instead. The laser already has a
  gesture route — it settles ~180ms after the point animation — so grip
  can go back to meaning only "grab". Small change, touches every
  existing menu, so it wants its own pass.

- **Register menus as ordinary interaction candidates.**
  `common/interaction-targeting.js` already arbitrates by direct hit →
  priority → gaze → distance, and `interaction-hints.js` already
  guarantees that the outlined object and the object an action reaches
  cannot disagree. Menus don't participate: watch pointing is a
  separate path bolted to grip, which is the actual reason the two
  collide. Registering the watch, wall panels and the visor as
  candidates makes one resolution point instead of two systems, and
  extends the outline-before-commit guarantee to every contested input.
  Bigger than the menu work; worth doing on its own.

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

## Refactor leftovers

From the games/pistols-at-dawn/js/ file split (see DESIGN.md's "File
structure" section for the rationale and the remaining question of how
the split should be shaped once more code moves into a shared library):

- **Duplicate `CIGAR_PUFF_INTERVAL_MS`.** `core.js` declares it twice
  (1100, then 750 a bit further down, silently shadowing the first) —
  a pre-existing bug from before the split, left in place rather than
  fixed so the split itself changed nothing about which value actually
  runs. Worth deciding which one was meant to win and deleting the
  other; both are currently commented as pointing at each other so
  whoever looks at either one finds the other.

## Build tooling and the shared design package

- **Finish the incremental module migration when it earns its keep.** Vite
  now builds the site as a vanilla multi-page app and the files in `common/`
  are ES modules. Pistols at Dawn's older topic scripts intentionally remain
  ordered classic scripts for now; give them explicit import/export
  boundaries as they are changed, rather than making a risky mechanical
  rewrite. Explicitly validate the production build on the Quest browser
  before tightening Vite's browser target or adopting newer syntax.

- **Use `@noahwright/design` for the website framing, not inside VR.** The
  current package (`github.com/noahWright87/design`, inspected at main commit
  `a5a0194`) already publishes ESM (`dist/index.mjs`), types, and a CSS export
  (`@noahwright/design/styles.css`), so Vite can consume its published npm
  package normally. Its scope here is the conventional DOM/site layer—the
  prototype landing page, navigation and page shell, primitive editors,
  documentation, and similar UI surrounding an immersive experience. Do not
  import its components or tokens into A-Frame scenes, in-world watch menus,
  materials, or text; the VR interaction/design system remains independent.

  The package currently has React 18 peer dependencies, so decide during the
  Vite work whether the outer site shell should use its React components or
  only its exported CSS. This must not turn into a React rewrite of any game.
  Prefer the published npm version for reproducible builds. A pinned Git
  revision is possible after the design repo adds a `prepare` build or checks
  in `dist` (its current exports point at uncommitted `dist` files), while a
  local workspace/link would need the design build running as the two
  repositories are developed together.

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

## Playing over the internet, not just LAN

Done: a publicly reachable relay (`worker/`, a Cloudflare Worker +
Durable Object — see README.md's "Hosted relay (Cloudflare Workers)"
section for account setup and deploying it), STUN
(`common/multiplayer.js`'s `iceServers` points at
`stun.cloudflare.com`, free and accountless), and the two client-side
changes that fall out of having a fixed public relay: its `wss://`
address is now a build-time constant (`vite.config.js` →
`common/relay-config.js`, see README.md's "Hardcoding the relay
address"), and `tryAutoHostViaLocalRelay` (the
`ws://localhost:8787` auto-probe, which only meant something when the
relay was something you launched locally) is gone. The locally-run
relay itself (`server/signal-server.js`, the Windows exe packaging,
`build-relay-exe.yml`) has been removed entirely — the hosted relay is
the only one now.

Still deliberately deferred:

- **TURN**, for the fraction of real-world NAT setups (symmetric NAT,
  restrictive carrier/corporate NAT, some double-NAT routers) where
  even STUN can't establish a direct path. Unlike STUN, a TURN server
  actually relays the live game traffic, so it's an ongoing bandwidth
  cost, not a one-time setup — pay a TURN provider (Cloudflare has one,
  `turn.cloudflare.com`, at $0.05/GB — no longer the free/accountless
  story the rest of this relies on) or self-host `coturn` on a VPS
  with bandwidth headroom. This is the piece that most changes "zero
  cost" into "real hosting bill," and also the one place a
  misconfigured relay could be abused by a stranger to relay their own
  traffic — worth its own deliberate decision once STUN-only actually
  proves insufficient for real playtests, not added speculatively.
- **The out-of-game showcase panel's manual copy/paste path and
  free-text relay-address field** are deliberately left as-is (see
  README.md's "Multiplayer" section) — they're still useful for
  testing the connection code without a headset, but now have a
  slightly stale story (the address field has nothing to point to by
  default). Worth revisiting once it's clear whether that panel is
  still earning its keep now that the in-VR watch menu is the real
  way to connect.

## Multiplayer watch menu

The in-VR Multiplayer page (watch menu → Multiplayer) covers HOST,
JOIN, and END, with a room-code entry control and a live player list
(peerId + assigned color, `primitives/menus/index.html`). Not built
yet:

- **Kicking players.** Floated as a "maybe" — no kick action exists.
  The player list already lives in the watch page itself (not the
  room-code sidecar, which is deliberately non-interactive) precisely
  so a kick button can be added to each row later without
  restructuring anything.
- **Player names.** The roster only has peerId + color right now —
  there's no name entry or display anywhere.
