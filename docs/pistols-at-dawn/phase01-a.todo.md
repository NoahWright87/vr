# Phase 01-A: wardrobe slots

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
