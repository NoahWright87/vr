# Pistols at Dawn assets

Every asset the game ships, with its status. **Default is placeholder**:
anything not known to be final gets swapped when real art arrives, and
gameplay never depends on how an asset looks (`docs/pistols-at-dawn/aesthetic.todo.md`).

- **Status:** `placeholder` (to be replaced) or `final`.
- **Source / license:** recorded where known. Where the origin wasn't
  written down when the file was committed, it says so rather than
  guessing. Check a pack's license before committing paid assets: most
  allow use in a game but not redistributing the raw files.
- Code-built stand-in geometry (boxes and cylinders) is marked in source
  with `// PLACEHOLDER-ASSET: <what the real thing should be>`; search
  for that string.

## Textures

All of these are `placeholder`, source unrecorded (committed in-repo by
earlier work; treat as project-owned until proven otherwise), license
unrecorded.

| File | Used by |
|---|---|
| `textures/barn-red-siding-v1.png` | `js/world-farm.js` |
| `textures/desert-clouds-skybox-v1.png` | no direct reference found (reference/unused or built by name) |
| `textures/desert-day-skybox-v2.png` | `index.html` |
| `textures/desert-midwest-skybox-v1.png` | no direct reference found (reference/unused or built by name) |
| `textures/desert-stars-skybox-v1.png` | `index.html` |
| `textures/farm-grass-ground-v1.png` | `js/world-farm.js` |
| `textures/fire-frame-01-v1.png` | `js/core-substances.js` |
| `textures/fire-frame-02-v1.png` | `js/core-substances.js` |
| `textures/fire-frame-03-v1.png` | `js/core-substances.js` |
| `textures/fire-frame-04-v1.png` | `js/core-substances.js` |
| `textures/interior-cream-plaster-v1.png` | `js/world-hub-interiors.js` |
| `textures/label-canyon-ale-v1.png` | `js/items-bar.js` |
| `textures/label-prairie-stout-v1.png` | `js/items-bar.js` |
| `textures/label-sunset-lager-v1.png` | `js/items-bar.js` |
| `textures/moon-billboard-v1.png` | `js/world-day-night.js` |
| `textures/olive-bottle-glass-v1.png` | `js/items-bar.js` |
| `textures/signboard-walnut-v1.png` | `areas/ghost-town.html`, `js/world-hub-interiors.js` |
| `textures/stable-dirt-straw-v1.png` | `areas/ghost-town.html`, `js/world-stable.js`, `js/world-ghost-town-environment.js` |
| `textures/sun-billboard-v1.png` | `js/world-day-night.js` |
| `textures/tumbleweed-reference-v1.png` | no direct reference found (reference/unused or built by name) |
| `textures/weather-cloud-cumulus-v1.png` | no direct reference found (reference/unused or built by name) |
| `textures/weather-cloud-puff-v1.png` | no direct reference found (reference/unused or built by name) |
| `textures/weather-cloud-underside-atlas-v1.png` | `js/world-day-night.js` |
| `textures/weather-cloud-wispy-v1.png` | no direct reference found (reference/unused or built by name) |
| `textures/weathered-roof-shingles-v1.png` | `js/world-stable.js`, `js/world-farm.js` |
| `textures/weathered-white-fence-v1.png` | `js/world-farm.js` |
| `textures/western-wood-planks-v1.png` | `areas/ghost-town.html`, `js/world-saloon-interior.js`, `js/world-stable.js`, `js/world-hub-interiors.js`, `js/world-farm.js` |
| `textures/window-glass-sheen-v1.png` | `js/world-saloon-interior.js`, `js/world-hub-interiors.js` |

## Other files in `assets/`

| File | Status | Notes |
|---|---|---|
| `shirts/README.md` | n/a | Note only; the shirt texture hookup isn't wired to anything yet. No images exist. |

## Not in this folder

- Shared models (Kenney, CC0) live in the repo-root `assets/models/` and
  are documented in `assets/models/README.md`.
- Fonts (B612, Wright Sans) and `game-icons.net` HUD icons are covered in
  the root `README.md` credits.
- Pistols builds everything else (guns, town, props) from A-Frame
  primitives in code: all placeholder.
