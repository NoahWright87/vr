# Phase 01-A: wardrobe slots

**Status: built.** What exists now, and where each decision is recorded,
is in the "Built" section at the bottom; the Work list below is kept for
its intent. Only the headset items remain open.

**Runs alongside** 01-B and 01-C. **Depends on:** nothing.
**Design:** `wardrobe.todo.md`.

## Goal

Your costume becomes your health bar, and reaching for your gun never
grabs your belt again. At the end of this phase a gun can shoot a worn
item off the player, the item flies loose, and putting it back on
restores that "life". There are no opponents yet: test by shooting
your own hat with a second gun, or by firing from a fixed test
emitter.

## Work

1. **Locked wardrobe slots.** Add a general option to `anchor-slot`
   (e.g. `locked: true`) so the item sitting in that slot can't be
   grabbed out of it during play. Apply it to the head, waist and
   chest slots in `games/pistols-at-dawn/index.html`. Slots *on* worn
   items (the belt's `belt-hip-N` holsters, the vest's packs) stay
   unlocked. Changing outfits goes through a deliberate path (a
   function the clothier and the watch menu will call later), not
   grabbing. Fixes "reached for my gun, grabbed my belt."
2. **Hat tip.** Gripping a locked hat's brim lifts it with your hand.
   Letting go always puts it back on your head, wherever your hand is.
   Emit `hat-tipped`. Ideally this is a general "can be lifted but
   always returns" behavior that a locked item opts into, not hat
   code.
3. **Hit zones.** Each wardrobe slot gets one hit zone, the same size
   for every slot type no matter what item is worn, carrying the
   `.shootable` class. The ghost body is never shootable.
4. **Knock-off.** A `shot` on a worn item's hit zone: the item leaves
   the slot as a loose physical object carrying the shot's direction
   (reuse the throw/explosion velocity path), the slot empties, and an
   event goes out (e.g. `wardrobe-changed` with the slot, the item,
   the shooter if known, and how many slots are still filled). Zero
   left → `ghost-stripped`. Loose costume items must not perish
   during a match.
5. **Putting it back.** Returning an item to an *empty* slot of the
   right type is allowed. Only implement "retrieve own" now. The other
   rules (conservation of clothes etc.) come in phase 03-B and phase
   04, so keep the decision in one rule function they can replace.
6. **The belt's holsters.** When a belt is knocked off, its holstered
   items fall loose near the wearer (the default in
   `wardrobe.todo.md`).
7. **Rental costume.** The default outfit fills every slot. Outfit =
   data (slot → item id). Until 01-C lands, a constant is fine.
8. **Pick the slot list.** Start with hat, vest, belt, boots. Boots
   need an estimated anchor like `body-anchor` already uses for hips.
   Write down what you chose and why in `wardrobe.todo.md`.

## Touches

`js/core-equip.js` (anchor-slot, holsterable, belt),
`js/world-player-body.js`, `index.html`'s body-anchor markup. **Leave
alone:** duel code (01-B) and profile code (01-C). Coordinate with them
only through events.

## Done when

- Playwright, through real code paths: pose a hand on a holstered
  pistol and fire `gripdown` → the pistol comes out and the belt stays
  worn. Grip on the belt itself → nothing comes off. Grip the hat brim,
  move, release → the hat goes back on your head.
- Fire a real gun (trigger event) at a worn hat → the hat is loose, the
  slot is empty, the event fired with the right count. Put it back →
  count restored.
- Knocking off the belt drops its pistols loose. Knocking off
  everything fires `ghost-stripped`.
- A random soak test (DESIGN.md) still runs clean.
- Recorded as needing a headset: hit-zone size and placement, how the
  hat tip feels, whether boot zones are reachable.

## Built

Everything in "Work" is in. Decisions (slot list and why, the rule
function, events, belt behaviour) are recorded in `wardrobe.todo.md`.

- `anchor-slot` gained `locked`; `liftable` is the general "lift but
  always return" behaviour (hat tip is `liftable` on the hat).
  `holsterable.isLocked / returnHome`, and a `slot-occupied` event on the
  slot. `hand-rig.findGrabbableObject` skips locked items (one line).
- Wardrobe lives in `js/world-player-body.js` (WARDROBE section):
  `wardrobe-slot`, `wearable`, `wardrobeCanWear`, `knockOffWardrobe`,
  `wearItem` / `takeOffItem`, `RENTAL_OUTFIT` / `currentOutfit()`,
  `WARDROBE_ITEMS`, boots (`boxy-boots`, placeholder).
- `body-anchor` has a `feet` side; `#boots-anchor` is new in markup.
  The head hat moved out of `areas/range.html` into the outfit.
- `shot` events now carry `source` (the firing gun or projectile).
- Test: `tests/pistols-wardrobe.browser.cjs` (needs `npm run preview`).

### Still needs a headset

- Hit-zone size (`WARDROBE_ZONE_RADIUS`, 0.15m) and placement for all
  four slots; open the page with `?zones` to see them.
- How the hat tip feels: is the hat's 0.35m grab radius too generous,
  does lifting it ever steal a grab from a pistol held near the face.
- Whether the boots zone is reachable and fun, or just awkward to aim at.
- Whether shooting a belt off and dropping its guns at your feet reads
  well.
- Estimated feet position vs. a real stance (crouching, leaning).
