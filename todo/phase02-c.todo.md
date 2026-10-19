# Phase 02-C: the clothier v0

**Runs alongside** 02-A and 02-B. **Depends on:** phase 01 (wardrobe
slots, profile).
**Design:** `economy.todo.md`, `wardrobe.todo.md`.

## Goal

Earn `$`, walk into Boots & Suits, buy something silly, wear it. The
other half of the loop.

## Work

1. **Catalog as data.** A few dozen cosmetics across the slots chosen
   in 01-A: id, slot, price, how rare it is in the rotation, and a
   simple look (shapes and colors, with art in polish). Cosmetics
   never change hit zones.
2. **Rotating display.** Only a handful on display at once, picked
   from the catalog by date (see the rotation question in
   `economy.todo.md`). Deterministic, so friends see the same stock.
3. **Buying.** In the Boots & Suits interior (`world-hub-interiors.js`,
   `boots-suits-interior`): pick an item off the display, pay with
   `profile.spend`, and it's added to what you own.
4. **Dressing.** The mirror in the shop (and a watch-menu Wardrobe
   page) changes your outfit through 01-A's deliberate outfit-change
   path. Saved to the profile. It loads on the next visit and at match
   start.
5. **Prices and payouts** tuned together with 02-A so that after the
   training series you can afford a few items.

## Touches

Boots & Suits interior, catalog data, a watch-menu Wardrobe page.
**Leave alone:** duel content (02-A) and style (02-B).

## Done when

- Playwright: earn money via the profile API → visit Boots & Suits →
  buy through the real interaction → wear it via the mirror → reload →
  still wearing it, money spent.
- Buying is refused when you can't afford it.
- The display changes when the date changes, and is the same for the
  same date.
