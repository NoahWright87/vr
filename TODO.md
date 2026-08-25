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

## Multiplayer relay executable

`npm run package:relay:win` (see README's "Multiplayer connection
relay" section) produces a working but bare-bones
`dist-exe/vr-signal-relay.exe` via `@yao-pkg/pkg`. Deliberately
shipped without these so a non-technical person can at least *try*
it, with the rough edges named rather than silently accepted:

- **Code signing.** The exe is unsigned, so Windows SmartScreen shows
  an "unrecognized app" warning on first run. Needs a paid Windows
  code-signing certificate (and, if a Mac build ever happens, an
  Apple Developer account for notarization) — this is a cost/process
  commitment, not an engineering task, so it's gated on deciding this
  is worth recurring money rather than a coding session.
- **System tray icon instead of a bare console window.** Right now
  running the exe just opens a terminal-style window printing
  addresses and staying there. A tray icon showing "N players
  connected" (or just "relay running") would read as a real app
  instead of a dev tool — probably an Electron or Tauri wrapper
  around the same `server/signal-server.js` logic, which is a bigger
  lift than the relay itself was.
- **Friendlier address discovery.** `server/signal-server.js` prints
  every non-internal IPv4 address it finds and makes the human pick
  the right one — fine for one Wi-Fi adapter, confusing on a machine
  with a VPN or multiple network interfaces. Could auto-select the
  most likely one (e.g. prefer `192.168.*`/`10.*` private ranges) or
  show a QR code of the address, though the QR code idea only helps
  peers with a normal screen to scan from — it doesn't solve the
  headset-to-headset case discussed for the WebRTC handshake itself.
- **Mac/Linux builds.** `pkg`'s `--targets` supports other platforms
  (e.g. `node22-macos-arm64`, `node22-linux-x64`) — not built only
  because the ask so far has been a Windows laptop specifically. Same
  command, different target string, whenever it's needed.

## Playing over the internet, not just LAN

Everything built so far (`common/multiplayer.js`, the signaling
relay) is deliberately LAN-only, and not just because the relay
happens to run on a home laptop — `common/multiplayer.js` sets
`iceServers: []`, so peers only ever gather local host ICE candidates
and can't find each other across two different networks at all.
Decided against doing this now: it trades "no server, no hosting
costs" (the explicit starting premise of this whole feature) for real
recurring infrastructure, so it should be a deliberate choice, not
something added piecemeal. If it's ever wanted, it's three layers,
and they only pay off bundled together — doing just one leaves
multiplayer exactly as LAN-only as today:

- **A publicly reachable relay.** Deploy `server/signal-server.js`
  somewhere with a real domain and TLS (`wss://`, not `ws://` — a
  page served over `https://` can't open a plain `ws://` connection).
  Cheapest is a small always-on host (a few dollars a month, or a
  free tier on something like Render/Railway/Fly.io). No code changes
  to the relay itself, since it already listens on all interfaces.
- **STUN**, added to `iceServers` in `common/multiplayer.js`, so each
  peer can learn its own public IP:port as seen from outside its home
  router (that's the one thing missing today that keeps this
  LAN-only at the WebRTC layer, independent of the relay). Free
  public STUN servers exist, or self-host `coturn`. On its own, with
  no public relay, this changes nothing — the relay is what lets two
  peers find each other to exchange addresses in the first place.
- **TURN**, for the fraction of real-world NAT setups (symmetric NAT,
  restrictive carrier/corporate NAT, some double-NAT routers) where
  even STUN can't establish a direct path. Unlike STUN, a TURN server
  actually relays the live game traffic, so it's an ongoing bandwidth
  cost, not a one-time setup — pay a TURN provider or self-host
  `coturn` on a VPS with bandwidth headroom. This is the piece that
  most changes "zero cost" into "real hosting bill."

Two client-side changes fall out of this once a public relay actually
exists, neither of which is done yet:

- **The "Local relay" address field goes away.** With a fixed public
  relay, its `wss://` address becomes a hardcoded constant in the
  client instead of something typed into `#mp-relay-url` — a room
  code becomes the only thing anyone ever enters. Today's manual
  copy/paste path can probably retire at the same time, since it only
  exists as a no-relay fallback.
- **Auto-host (`primitives/menus/index.html`'s `tryAutoHostViaLocalRelay`)
  stops making sense and should be removed, not left in place
  alongside the new address.** It exists specifically to answer "is a
  relay running on THIS machine" by probing `ws://localhost:8787` —
  a question that only means something when the relay is something
  someone launches locally. A permanent public relay has no
  "machine it's running on" from the player's side, so that whole
  detection path becomes dead code once this lands, not an
  enhancement to build on.
