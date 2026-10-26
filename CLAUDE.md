# CLAUDE.md

Guidance for Claude Code working in this repo.

## What this is

A collection of small WebXR prototypes for the Meta Quest 2 browser,
built with vendored A-Frame and a vanilla Vite multi-page build. See
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

**`docs/actions/` is the plan for the action primitives** (autofire,
melee, defense, throwing, targeting, comfort budget — the "feel like
John Wick" direction). It uses paired files: `<topic>.spec.md` is what
exists now, `<topic>.todo.md` is decided-on future work. Start with
`docs/actions/README.md`, which holds the principles and build order;
when you build a todo item, move its substance into the spec and delete
it from the todo. The showcase for these is `primitives/actions/`.

**`docs/prefabs/` is the plan and spec for prefabs**: usable objects
(where hands go on a gun, which way it fires, what it weighs, where things
attach) defined once as data for every game. Same paired-file convention as
`docs/actions/`; start with `docs/prefabs/README.md`. The editor is
`primitives/prefabs/` (the Prefab Workshop). Prefab and hand-pose JSON lives
in `assets/prefabs/` and is **never edited by hand**: the workshop copies out
what changed and `scripts/apply-prefab-export.mjs` writes it back. When
Noah pastes you a prefab export (JSON with `"format": "prefab-export/1"`),
save it to a scratch file and run that script, check `git diff`, and commit.

## Testing without a headset

Run `npm install`, then `npm run dev` for source development. Use
`npm run build` and `npm run preview` to test the deployable `dist/`
output. A-Frame is checked in under `vendor/aframe-1.6.0/`, so tests do
not depend on the CDN. Drive the served site
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
loaded as plain `<script src>` tags inside the Vite-built page — still no
import/export within those legacy files, and the same implicit-global style
the original single file used. Shared primitives under `common/` are ES
modules. Two things
worth knowing if you're moving code between these files:

- Destination markup lives under `games/pistols-at-dawn/areas/`. `world-town.js`
  fetches one fragment at a time and lazily injects the destination-only legacy
  scripts listed in `TOWN_LOCATIONS`; do not add those scripts back to the eager
  list in `index.html`. Persistent player/global systems stay in the page.

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
