# export-later/

**Everything in this folder is going to leave this repo.** Each
directory under `export-later/packages/` is a self-contained package
that's built here only for convenience, because a fast loop in one repo
beats publishing and relinking while the API is still changing. Once a
package is stable, or a project outside this repo wants it, it moves to
its own repo and gets published (e.g. `git subtree split`, then npm),
and this repo depends on the published version.

## The rules (for people and LLMs alike)

1. **A package imports nothing from outside its own folder.** No
   `../../common/`, no A-Frame, no game globals. If it needs something,
   it takes it as a parameter or bundles its own copy.
2. **Nothing outside a package reaches into its internals.** The rest
   of the repo uses only the package's public entry point (its
   `package.json` `exports`, normally `src/index.js`), exactly as it
   would once the package is installed from npm.
3. **A package carries its own tests, docs and demo page.** Its
   `README.md` says what it does and how to use it. Its tests run under
   the repo's `npm test` (`node --test` finds `*.test.js` anywhere).
   Its demo page lives inside it, so the demo moves with it.
4. **Game-specific content stays out.** A package ships the engine.
   Assets and data that belong to one game (e.g. Pistols at Dawn's
   recorded voice samples or character presets) live with that game
   and get passed in.

The only things outside the package that are allowed to mention it:
- a line in the root `vite.config.js` registering its demo page
- a link to that page from the site
- the code that uses it through its public entry

## Packages

- `packages/voice/`: text-driven, Animal Crossing-style character
  voices, plus a non-VR Voice Lab page for tuning them. Planned in
  `docs/pistols-at-dawn/phase01-z.todo.md`.
