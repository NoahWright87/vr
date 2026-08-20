# Todo

Things deliberately deferred, with enough context to pick them up cold.
Ideas that aren't committed to yet live in DESIGN.md or in conversation;
this is only for work that has been decided on and postponed.

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

## Hands holding too much

A hand holds up to `HAND_CAPACITY` (4) things at once — grip again with
a full-ish hand and you pick up another, and anything released near
your other hand while it's busy gets silently caught into it too (see
`findCatchingHand`). That's fun for an armful of bottles and bad for
everything else: it let a fist end up carrying (and firing, on one
trigger pull) several guns at once, and once a hand accumulates a few
unrelated things there's no way out of it — no gesture drops just one,
and the other hand can't reach in and pull a single item free. The
only way out was to release the whole fistful and start over.

**Shipped as a narrow, immediate fix**: a hand can now never hold more
than one firearm (`core-hand-rig.js`'s `hasWeapon()`, checked in
`onGripDown`, `reclaimStash`, and `findCatchingHand`). Scoped
specifically to things with a `firearm` component — pistol, shotgun,
sniper — since those are what actually had the "one trigger, several
guns" bug. The bow and launcher weren't touched: neither has `firearm`,
neither exhibits that bug (each fires through its own distinct
mechanism, not the generic multi-fire dispatch), and stacking rework
in general was explicitly out of scope for this pass. Worth revisiting
if a bow/launcher ever ends up feeling like it has the same "stuck
holding it" problem in practice.

That's a patch, not a fix for the underlying stacking model. Real
rework ideas, roughly in order of how directly they address "I got
stuck holding a bunch of stuff":

- **A way to shed one specific item without releasing the whole
  fist.** Today, letting go drops (or throws, or holsters) everything
  in that hand at once. Something like: point at/toward one held item
  and a face button drops just that one, reflowing the rest — mirrors
  how a slot's fan already reflows when one occupant leaves.
- **A way for the other hand to pull a single item out of a full
  hand.** Right now grabbing only finds a *loose* grabbable; there's
  no path to reach across and take one specific thing out of the other
  hand's fistful. This is probably the more valuable of the two — it's
  the direct fix for "I can't get it back out."
- **Reconsider silent, automatic catching near a busy hand.** A hand
  that's gripping something already doesn't ask before absorbing a
  second item that wanders into `THROW_CATCH_RADIUS` — that's the
  actual mechanism behind "accidentally end up holding a bunch of
  things." Maybe catching should need the hand to be more clearly
  *offered* (fingers open, not already closed around something) rather
  than just proximity + grip-held.
- **Size- or type-aware capacity instead of one flat `HAND_CAPACITY`.**
  A fistful of bottles is the intended fun case; a fistful of anything
  else mostly isn't. Something like a per-itemSize cap, or a
  capacity that only applies to a whitelist of "stackable" props,
  would generalize the one-firearm rule instead of special-casing it.

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
