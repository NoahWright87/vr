# Look and feel: cute, friendly, extremely violent

## Direction

- **Cute and friendly**, despite all the shooting, fire and dynamite.
  The violence is cartoon violence against clothes. Nobody bleeds;
  hats fly.
- **Pac-Man-style ghosts.** A rounded dome top, a wavy skirt, big
  simple eyes. The player body (`boxy-ghost` in
  `js/world-player-body.js`) is the starting point.
- **Low detail, lots of expression.** *Move or Die* is the reference:
  very simple characters that feel alive because their faces and
  bodies react all the time. A ghost should look:
  - shocked when its hat flies off
  - smug when it lands a trick
  - woozy when drunk
  - nervous in a standoff
  - furious when stripped

  Expressions are driven by events the game already announces, so they
  come almost for free.
- **Animals** (`animals.todo.md`) follow the same rule: simple shapes,
  expressive faces.

## Temporary assets

Look doesn't matter much right now, and everything will be swapped
for better assets later. What matters is that the swap is easy and
nobody forgets what's temporary:

- **Every asset is marked placeholder or final.** One manifest per
  game, e.g. `games/pistols-at-dawn/assets/ASSETS.md` (or a JSON file
  if a tool needs to read it), listing each texture, model and sound
  with its status, source and license.
- **Code that builds placeholder visuals in code** (boxes and cylinders
  standing in for a real model) gets a searchable marker comment, e.g.
  `// PLACEHOLDER-ASSET: <what the real thing should be>`.
- **Gameplay never depends on what an asset looks like.** Hit zones,
  grab spans and colliders belong to the gameplay shape, not the mesh
  (`model-prop` already works this way, DESIGN.md "File structure"),
  so a better-looking model can't break anything.
- **Asset licensing.** Most bought asset packs (e.g. Humble Bundles)
  allow using assets in a game but not redistributing the raw files.
  If this repo is public, raw paid assets committed to it may break
  that. Check each pack's license before committing it, and record it
  in the manifest. Kenney (CC0) assets are already fine
  (`assets/models/LICENSE.txt`).

## Sound

Same rules as visuals: placeholder now, marked as placeholder, swapped
later. One design note worth keeping for later: the duel standoff
deserves a big spaghetti-western music moment.
