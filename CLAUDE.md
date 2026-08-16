# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

A collection of small WebXR prototypes for the Meta Quest 2 browser,
built with A-Frame via CDN — no build step, no npm install. See
`README.md` for the full picture (structure, how to test each
prototype, deployment) and `DESIGN.md` for Pistols at Dawn's own
design philosophy (it's the prototype that's grown into "the place
where the ideas get tried out").

**`TODO.md` at the repo root tracks deferred, decided-on work** —
things that have been agreed on but postponed, with enough context to
pick back up cold. Check it before assuming something is unfinished
by accident rather than on purpose, and add to it (with real context,
not just a title) when you defer something rather than letting it
evaporate.

## Testing without a headset

The CDN A-Frame URL (`https://aframe.io/releases/1.6.0/aframe.min.js`)
is not reachable from a sandboxed environment. `vendor/aframe-1.6.0/`
has a local copy — for headless testing, copy the game's `index.html`
(and, for Pistols at Dawn, everything under its `js/` folder) into a
scratch directory, swap the CDN script tag for the vendored path, and
serve it with `python3 -m http.server` from that directory. Drive it
with Playwright (`chromium.launch({ executablePath:
'/opt/pw-browsers/chromium' })`) — call components' methods and drive
the real code paths (not just shortcut method calls) rather than only
checking that the page loads without errors; a shortcut can pass while
the actual code path it's standing in for is broken. See DESIGN.md's
"Testing without a headset" section for more.

## Pistols at Dawn's file layout

Pistols at Dawn's own logic outgrew a single file and now lives in
`games/pistols-at-dawn/js/` as ~14 topic files (`core.js`,
`core-equip.js`, `items-guns.js`, `world-saloon-bar.js`, and so on),
loaded as plain `<script src>` tags — no bundler, no import/export,
same implicit-global style the original single file used. Two things
worth knowing if you're moving code between these files:

- Almost every cross-file reference is safe regardless of which file
  defines it or load order, because component `init()`/`tick()`
  callbacks only run once every script on the page has finished
  loading. The one exception: a component's `schema` object is
  evaluated the moment `registerComponent()` itself runs — eagerly,
  not deferred — so a schema `default:` that reaches into another file
  needs that file to have already loaded.
- `index.html`'s `<script>` order currently groups `core.js` first,
  then the other `core-*.js` files, then every `items-*.js`, then
  every `world-*.js`.
