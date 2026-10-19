# Todo

Things deliberately deferred, with enough context to pick them up cold.
Ideas that aren't committed to yet live in DESIGN.md or in conversation;
this is only for work that has been decided on and postponed.

## 3D Model Toybox

- **Explore two-hand skeletal posing after the rigid-toy workflow is tested.**
  The first hand should hold the complete toy; a second hand could manipulate
  an individual limb/bone. The Toybox currently loads complete GLBs (preserving
  any rigs) and uses shared simple-grabbable for one rigid object per hand.
  Imported rigs are not necessarily IK rigs or even consistently named. A later
  pass needs bone picking, per-rig joint limits and a clean handoff between
  whole-object and bone grabs, without assuming every character has a skeleton.
  The current static original person/skeleton cannot support this without a rig.

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
(the A-Frame renderer, stick engagement, and `projected-crossbar`, which
puts a crossbar panel inside any `projected-menu` trigger) are the only
menu system now. Every menu in every game is on them — the showcase, the
watches in Pistols and Boundary Lab, Pistols' carriage stall, and a visor
in every game (Punch Pop's settings live in its visor; the others carry
the shared `Visor ▸` settings and `Exit VR` from `common/visor-page.js`).
Nothing of the old menus is left: `common/menus.js` is just
`projected-menu`, the trigger (poke, raised wrist, mounted mode, walking
away) that the watch and every crossbar prop open through, and what a
row does is handled by its id on `menu-action` / `menu-commit`.
Deliberately not done yet:

- **Games' own visor rows.** Pistols and Boundary Lab's visors hold only
  the shared rows for now, and Cube Pop's only `Reset cubes`. Whatever a
  game wants reachable mid-play without lifting the wrist belongs there.

- **A crossbar page editor, if it is missed.** The showcase used to have
  a `?edit=1` menu editor (title, item labels, positions, JSON out) for
  its old fixed panel. It went with that panel. A crossbar page is
  already data, so the replacement would edit page JSON — labels, kinds,
  options, number ranges — and live-reload the panel, rather than
  positions, which the crossbar lays out itself.

- **Multiplayer boxes and per-player rooms.** The showcase now fits its
  stations to each player's own boundary, but box spawns, releases and
  held-box positions still go over the network as world coordinates. Two
  players whose rooms differ see the host's box land where the host's
  platform is, which may not be on theirs (or may be outside their room).
  The fix is to send box positions relative to the box platform
  (`#station-boxes`'s local space) and convert on receipt; remote aims
  and heads have the same issue and would want a shared anchor instead.

- **Wrapping long labels to a second line.** A label longer than its
  row is now cut with `...` and, on the focused row only, scrolls end to
  end and back (`marqueeText` in `common/menu-model.js`). Wrapping onto a
  second line within the row's space was the other option discussed and
  is not built.

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

- **The on-screen action buttons can enter a menu but not step it.**
  INTERACT now appears next to a crossbar panel and enters/leaves it —
  `menu-stick-control` answers the same `semantic-action-intent`
  `touch-controls` publishes, and `input-router`'s `INTERACT_ZONES` lists
  the `menu` zone alongside `mounted`. What is still missing is moving
  the focus: there is no on-screen equivalent of W/S, so once entered you
  drive the list by tapping rows, which works whether or not you entered
  (and which the entered footer now says instead of naming keys). Worth
  adding a small up/down pair to the action grid while a menu is entered,
  which would also give the desktop gamepad above somewhere to point.

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

- **Visor rows could face your eye vertically too.** The visor's
  layout spreads five rows down most of an eye's field (`Height`,
  default 64°), but the panel is still flat: it is pitched to face you
  at its centre, so the top and bottom rows are seen ~32° off-axis and
  from ~18% further away, and render at roughly 70% the size of the
  selected row. The fix is to put the rows on an arc of radius `d`
  around the eye — row at angle φ goes to `y = d·sin φ`,
  `z = d·(1 − cos φ)`, `rotation.x = φ` — in `crossbar-menu`'s
  `render()` when a panel opts in, with the title, breadcrumb line,
  footer and progress arc following the same arc. Deferred because the
  outer rows are faded on purpose and the change touches every
  vertical placement in `layout()`; worth doing if the outer rows read
  as too small in a headset.

## The visor HUD

The visor has a HUD now (`common/visor-hud.js`, `common/visor-frame.js`,
`common/aim-targeting.js`; see DESIGN.md's *The visor HUD*), shown off in
the menus showcase. Decided on and deferred:

- **Rebuild Pistols at Dawn's HUD on it.** This is the next step, and
  the reason the HUD exists: Pistols' HUD is words in the middle of the
  screen (`#player-hud`'s `#hud-text` score line and `#vice-text`, plus
  `#performance-text`), toggled by the watch's `HUD` row through
  `PLAYER_HUD_VISIBLE` (`core.js`, `world-menu.js`). The plan: score and
  shots to a top corner (the Frontier style's bounty is the model), the
  vice meter (`items-vices.js`) to the bottom bar as an icon meter, each
  hand's gun to its own bottom corner with revolver pips (`drawAmmo`
  already does six-shooters), the place name from `TOWN_LOCATIONS` to the
  top bar on arrival, and the watch's `HUD` row to `Visor ▸ HUD`. Aiming:
  `findLookTarget` (`core.js`), used by the overhand throw, the bow and
  thrown knives, should become `aim-targeting`'s gaze lock — mark targets
  and bottles with `aim-target`, `request()` brackets while a throwable is
  held or the bow is drawn, and replace each caller's own target pick
  with `getLock()` / `assistThrow`. The desktop `#reticle-cursor`
  (`reticle-fallback`) stays as the click raycaster but could draw in the
  HUD's reticle slot. `performance-text` belongs in the debug submenu.

- **Adjust the visor by grabbing it.** The row-based adjustment works but
  is indirect. What we want instead: an `Adjust Visor…` row that puts a
  small model of the visor rectangle in the room in front of you, at
  arm's length — world-locked, not head-locked, because something locked
  to your head moves away when you reach for it. Handles on its sides set
  width, top/bottom set height, and a third set of handles (corner pegs,
  probably) sets bend. The real grey slot boxes in your view follow live
  as you drag (they are `visor-hud`'s Adjust preview, `setPreview({ frame:
  true })`), so you are adjusting the thing you see, not a number.
  Grabbing uses the same `semantic-hand` grab as everything else; off a
  headset the existing rows stay the way to do it.

- **A real first-run calibration.** Today the first headset session with
  nothing saved flashes the slots and a hint pointing at `Visor ▸ Adjust`
  for twelve seconds (`maybeFirstRun`), then saves the defaults so it does
  not nag. The idea floated was a game opening on the adjustment, like a
  brightness screen; that wants the grab-to-adjust model above, since
  asking a new player to find a menu at their temple first is backwards.

- **Pick the default menu face.** Every crossbar menu can now be set in
  any face (`crossbar-menu`'s `font` and `titleFont`: `roboto`, `b612`,
  `b612-regular`, `wright`, `sourcecodepro`, or an MSDF atlas URL; live,
  via `setFont`), and the showcase has a B612 panel and a Wright Sans
  panel either side of the static one to compare them. The default is
  still A-Frame's Roboto everywhere; deciding whether B612 (with Wright
  Sans titles?) becomes the default for the watch, the visor and every
  game's panels is the remaining call, best made in the headset. The
  atlases bake printable ASCII plus `°·×–—…’‘“”•←→↑↓‹›▸`; Wright Sans has
  no `‹ ›`, so a menu's chevrons fall back to B612 under it. Anything
  else needs a re-bake (see `vendor/fonts/README.md`).

- **Hints from interaction-hints in the reticle slot.** The HUD has a
  hint line above and below the reticle (`hud.setHint`), and the showcase
  props use it. `interaction-hints` still shows its own in-world cards in
  XR and a 2D corner pill on desktop. Feeding its resolved candidate
  (`desktopCandidate`, and the XR equivalent) into `setHint` would make
  the reticle the one place prompts appear; deciding whether the
  in-world cards then go is the open question.

- **Gun aim cones in the games.** `aim-targeting.addSource(id, { object3D:
  barrel, color })` gives any gun GTA-style auto-aim with its own bracket
  colour; the showcase blaster does exactly this. No game gun uses it
  yet — Pistols' guns aim with real sights, which is the point of them —
  so it waits for a game that wants assisted aim (dual-wielding, say, a
  shotgun bracketed red and a pistol blue). A target with several aim
  points (a head in red, armour in grey) would be child entities, each
  with its own `aim-target` (`offset`, `color`) — `aim-target` is one per
  entity — which should work today but has not been tried.

- **The HUD has no screen-space mode.** The visor menu's `Draw: Screen`
  row paints it onto the display; the HUD is always in stereo at the
  frame's distance. Screen mode was worse for the menu (eye strain at
  zero disparity), so this is probably right, but it was not tried.

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

## Rendering quality tiers

- **Add a high-graphics weather-shadow option.** The Quest-friendly default
  renders one soft ground decal for only the six largest active cloud groups.
  A future high tier can raise that cap or use per-cloud alpha-tested shadow
  casters so roofs and walls receive more detailed moving shadows. Keep the
  current batched path as the low/default tier: it is deliberately one draw
  call and avoids multiplying the real-time shadow-map workload.

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
