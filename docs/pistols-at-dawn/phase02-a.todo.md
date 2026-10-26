# Phase 02-A: the training duel series

**Runs alongside** 02-B and 02-C. **Depends on:** all of phase 01.
**Design:** `dueling.todo.md`, `wardrobe.todo.md`.

## Goal

The first stretch of the journey: a short series of training duels
that teaches dueling and the different start signals, scores you, pays
you, and points you at the next one. A new player can start it with no
explanation beyond what the game shows.

## Work

1. **Dress the cardboard cowboys** in real wardrobe items (01-A).
   Shooting items off is the hit, and a cutout with nothing left falls
   down. This tests the wardrobe system on targets before any AI.
2. **The series (4–6 duels)**, each introducing one idea. Give them
   pun titles. For example:
   1. Draw! (one cutout, a "Draw!" shout)
   2. Coin toss
   3. Starter pistol with several cutouts
   4. A false-start trap
   5. Ten paces, or whichever paces approach 01-B settled on
   6. A final mixed duel
3. **The Sheriff's Office board** (`world-hub-interiors.js` already has
   a WANTED poster) becomes the duel picker: training sheets, each
   stamped once passed. Wanted posters show up later (phase 04).
4. **Payouts and progress.** The results event pays `$` via the
   profile (01-C), saves medals and best times, and unlocks the next
   duel.
5. **Tutorial text** on the board and results screen. Plain text is
   fine, polish comes later. The announcer voice is phase 04.

## Touches

Duel definitions (data), the Sheriff's Office interior, the
cardboard-cowboy target. **Leave alone:** style scoring internals
(02-B) and the clothier (02-C). Show style on the results screen only
by listening for 02-B's event, if it's there.

## Done when

- Playwright plays the first two training duels end to end through
  real input, and checks payout, medal, the next-duel unlock, and the
  stamp on the board after a reload.
- Recorded as needing a headset: is the order teachable, are the
  signals readable, are the payouts satisfying?
