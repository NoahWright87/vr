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

## The Rainbow Hotel (impossible spaces POC)

Built to answer one question — does a small physical room convincingly
disguise itself as a multi-floor building — and deliberately stopped
there. Everything below was considered and put off on purpose, not
missed. See README.md's "The Rainbow Hotel: how it works" and DESIGN.md's
"Impossible spaces" section for how the built part works.

**The building is currently switched off** (`showHotel`, off by default,
tick box in the settings panel). It is not broken and nothing has been
removed — the plan is still computed on every rebuild, and ticking the
box puts the whole thing back up. It is off because the first two
headset sessions both came back with "the hotel is not aligned with my
boundary, not even close", and while the walls are standing they hide
the only thing worth looking at: the floor rectangle on the ground next
to the boundary it is supposed to fit inside. See "Fitting the floor to
a real Guardian" in README.md for the calibration mode that replaced it.
Two things to do once the floor is confirmed:

- **Turn the building back on by default** — flip `showHotel` in
  `resolveSettings` and drop the "currently down" wording from the
  page's overlay, the settings panel note and README.
- **The hallway is being redesigned anyway.** Feedback from the first
  session was that it is "ridiculously cramped" and not the layout that
  was asked for. Deliberately not touched since: there is no point
  tuning a corridor inside a building that is standing in the wrong
  place. The comfort-versus-concealment search in `planHotel` is what
  currently decides its width, and it will need revisiting with whatever
  the new layout turns out to be.

- **The hallway's depth comes out of every room's depth, and nothing in
  the current design avoids that.** At a 2.4m Guardian the rooms end up
  1.2m deep. The idea that would break the tie: give each doorway a
  *local* recess that pokes south into the room's plan — a doorway-wide,
  full-height slot in the shared wall — so the doorway sits deeper
  without the whole strip getting wider. Deeper recesses measured as the
  single biggest win for the occlusion margin, so this is worth real
  effort if the rooms feel cramped in a headset. The catch is that the
  slot is open at every height, so the hallway would have to carry
  blanking panels above and below its own opening to fill it as it
  passes; that's a moving-parts change, not a parameter change.
- **No collision, anywhere.** The piers and walls are virtual only, so a
  player who walks through one can stand somewhere the occlusion
  analysis never considered and catch a misaligned doorway. Deliberate:
  pushing a real body back is worse than letting them cheat. If it turns
  out to matter, the cheap fix is a comfort fade when the head is inside
  solid geometry, not a physics response.
- **`fitSafeRect` is centre-anchored.** It grows a rectangle about the
  boundary's centroid, so a U-shaped Guardian (a pillar in the middle of
  the room) yields a small rectangle rather than a large off-centre one.
  It refuses rather than guessing, which is the right failure, but
  sliding the rectangle to find a bigger fit is a fair improvement and
  the tests already document the limitation.
- **No audio.** Footsteps in the hallway would do the same job the
  pilasters do — telling you that you are walking — and reverb changing
  between a small room and a corridor is most of what sells an interior.
  Left out because the POC is about vision and vestibular comfort, and
  adding audio before knowing whether the visual trick holds would make
  it harder to tell which one was doing the work.
- **The alternate hallway layout from the spec** (doorway in the centre
  of one wall, sharp turn, run to the edge, turn, run along it, turn,
  arrive at the centre of the opposite wall) is approximated by the
  "extra turns" dial rather than built as its own shape. The dial gets
  the *effect* — more turns, longer walk, bigger safe stretch — within
  one reusable piece. A genuinely different door placement is a
  `doorSpread` of less than 1 plus a layout function; nobody has needed
  it yet.
- **Six floors is hardcoded to six colours.** `ROOMS` in
  `hotel-layout.js` is the whole list and everything else counts off it,
  so a seventh floor is one entry — but the exterior's height bands were
  chosen against a six-floor building and would want revisiting.
