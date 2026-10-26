# Phase 03-B: two-player network duel

**Runs alongside** 03-A. **Depends on:** phase 02.
**Design:** `multiplayer.todo.md`, `wardrobe.todo.md`.

## Goal

Two friends, each in their own play space, join a room by code and
duel. Each sees the other's ghost and outfit, shots knock clothes off,
and **conservation of clothes** works. This is the thinnest slice that
proves the network design before more content piles up on top of it.

## Work

1. **Joining a room in Pistols.** Bring the existing watch-menu
   Multiplayer page (host / join / room code / end, built on
   `common/multiplayer.js` and the `worker/` relay) into Pistols'
   watch. Show player names from the profile (01-C).
2. **Remote ghost.** Head, hands and worn outfit of the other player,
   plus the gun they're holding. A simple look is fine.
3. **Who decides what** (`multiplayer.todo.md`): the holder owns held
   items, the shooter claims hits ("hit player B's hat"), each player
   applies claims to their own wardrobe, the host runs the round and
   the signal timing.
4. **Conservation of clothes**, the default rule. A knocked-off item
   flies to the shooter's matching empty slot if there is one,
   otherwise it drops loose. It replaces 01-A's single rule function.
5. **A shared anchor.** Duel positions relative to a shared arena
   anchor, not raw world coordinates, so different play spaces work
   (TODO.md "Multiplayer boxes and per-player rooms").
6. **Leave out for now, and write down what you left out:** syncing
   fire, liquids and explosions. Either disable those props in network
   duels or let them be local-only, and say which.
7. **Shared unlocks.** Whatever finishing a network duel unlocks goes
   to both players (`unlock(id, { source })` from 01-C).

## Touches

A new Pistols networking module, a watch-menu page, the remote-ghost
visuals, and the wardrobe rule function. **Leave alone:** AI duelist
internals (03-A).

## Done when

- Playwright with **two browser contexts** joined through the real
  relay or a local stand-in: A shoots B's hat → it leaves B and lands
  on A's empty head slot (if A's is empty), on both screens. A full
  round resolves with the same result on both.
- Disconnecting mid-duel doesn't freeze either side.
- Recorded as needing headsets: latency feel, whether remote hit zones
  feel fair.
