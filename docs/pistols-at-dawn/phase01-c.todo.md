# Phase 01-C: player profile and save

**Runs alongside** 01-A and 01-B. **Depends on:** nothing.
**Design:** `economy.todo.md`, `multiplayer.todo.md`.

## Goal

The game remembers who you are: name, money, what you own, what
you're wearing, what you've unlocked and how you did. Every later
phase writes to this.

## Work

1. **Profile module.** An ES module (shared code is moving to modules,
   see TODO.md "Finish the incremental module migration") that exposes
   a global for the plain scripts. Holds:
   - `name`
   - `money`
   - `owned` (cosmetic ids)
   - `outfit` (slot → item id)
   - `unlocks` (a set of card/duel ids)
   - `records` (duel id → best medal, time, style)
2. **API with events.** `earn(amount, reason)`, `spend(amount, reason)`
   (refuses if you can't afford it), `unlock(id)`, `has(id)`,
   `setOutfit(...)`. Each emits a change event so the UI can show
   "+$25 bounty" and phase 02 can react.
3. **Saving.** `localStorage`, behind a versioned key with a migration
   step, every read and write wrapped in try/catch, and the game still
   works if storage is empty or blocked. Quest browser storage is per
   device and can be cleared, so add **export/import as text** (a
   backup code) from the start. It's cheap now and saves a lot of
   pain later.
4. **Name entry.** A watch-menu way to set your name. TODO.md already
   describes the 26-letter picker and the planned multi-slot kind
   ("A multi-slot item kind, for room codes"). Use whatever exists,
   and don't block on the nicer control.
5. **Shared-unlock hook.** `unlock(id, { source })`, so phase 03-B /
   04 can apply a room-wide unlock to everyone present without changing
   this API.

## Touches

A new profile module, `js/menu-pages.js` for the name row, and the
page's script/module list. **Leave alone:** wardrobe (01-A) and duel
(01-B) code. They'll call this API in phase 02.

## Done when

- `node --test` covers the profile logic: earn/spend/refuse, unlocks,
  migrating from an older version, the export/import round trip.
- Playwright: set a name through the real watch-menu path, reload the
  page, the name survives. Also: storage blocked → the game still
  loads.
