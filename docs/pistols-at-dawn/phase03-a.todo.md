# Phase 03-A: the first AI duelist

**Runs alongside** 03-B. **Depends on:** phase 02.
**Design:** `dueling.todo.md`, `cast.todo.md`.

## Goal

Duel a ghost who duels back: it waits for the signal, draws, shoots
your clothes off, and you shoot its clothes off. Two or three
characters, built only from settings, should already feel like
different people.

## Work

1. **The opponent ghost.** A body with the same wardrobe slots and hit
   zones as the player (01-A), wearing an outfit from data.
2. **The AI.** Waits for the signal (or jumps it, if that's its
   quirk), shows its tell, draws after its reaction time, aims at a
   chosen wardrobe hit zone with its accuracy, and fires **through the
   same shot path the player uses**, so its hits on you go through
   01-A's knock-off logic unchanged.
3. **Character settings:** draw speed, reaction spread, accuracy, tell,
   nerve (does it go after its own knocked-off hat?), quirk. Make 2–3
   characters from data, e.g. a slowpoke, a cheat who jumps the gun,
   a hat-only show-off.
4. **Round end.** Stripped = the round's lost. Results and payouts
   through the existing duel and profile path. Style still counts.
5. **Entry point.** A temporary pedestal or board entry is fine. The
   fight ladder is phase 04.

## Touches

A new duelist script, character data. **Leave alone:** networking
(03-B). If both need shared changes to the duel framework, agree on
them first and keep them small.

## Done when

- Playwright: start an AI duel. The AI's shot knocks off the player's
  item through the real shot path, and the player's real shot knocks
  off the AI's. A full match resolves with results.
- The cheat triggers a false start.
- Recorded as needing a headset: is it fair, is the tell readable, does
  each character feel different?
