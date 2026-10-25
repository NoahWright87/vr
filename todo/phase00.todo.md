# Phase 00: housekeeping

Small, quick and useful to everything after it. Do these first; each
is an afternoon at most. They don't depend on each other.
**Design:** `process.todo.md`, `aesthetic.todo.md`.

## 00-a: pull request template with a playtest checklist

- Add `.github/pull_request_template.md` for the whole repo. Sections:
  - **What changed** (short)
  - **Tested without a headset**: what ran and passed (Playwright,
    `node --test`, build)
  - **Headset playtest checklist**: concrete `- [ ]` steps with what
    "good" looks like, taken from the phase file's "needs a headset"
    notes
  - **Not tested / known gaps**
  - **Placeholder assets added**, if any
- Mention it in `CLAUDE.md` so sessions fill the checklist in properly
  rather than skipping it.

## 00-b: a Utilities section on the site

- A place on the landing page (`src/App.jsx`) for non-VR helper tools:
  a Utilities section, or a gear icon on the Pistols at Dawn card
  leading to a small utilities page. Pick whichever reads better.
- Until the Voice Lab (01-Z) or Ghost Lab (02-D) exists, it can link
  the existing menus showcase or say "coming soon." Those tracks add
  their own links here.

## 00-c: marking placeholder assets

- Create `games/pistols-at-dawn/assets/ASSETS.md` listing the existing
  textures (`assets/textures/*.png`) and anything else Pistols loads,
  each marked placeholder or final, with source and license where
  known. Default to placeholder when unsure.
- Add the `// PLACEHOLDER-ASSET:` comment convention
  (`aesthetic.todo.md`) to `CLAUDE.md`. Don't retro-tag every box in
  the codebase. Tag new placeholder geometry from here on, and tag old
  geometry when it's touched anyway.

## Done when

- A test PR shows the template.
- The site builds, and the Utilities entry is reachable from the
  landing page on desktop and phone widths.
- `ASSETS.md` covers every file currently in
  `games/pistols-at-dawn/assets/`.
