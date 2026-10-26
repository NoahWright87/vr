# Phase 01-B: duel framework

**Runs alongside** 01-A and 01-C. **Depends on:** nothing.
**Design:** `dueling.todo.md`.

## Goal

A duel defined as data runs from setup to results against pop-up
cardboard targets at the Range. This is the engine every later duel
(training, AI, PvP) runs on.

## Work

1. **Round flow.** `setup → waiting for signal → live → resolved →
   results`, plus matches (best of N). Announce each change as an
   event (`duel-signal`, `duel-false-start`, `duel-round-end`,
   `duel-results`, ...) so style, payouts and an announcer can listen
   in later. Keep the state logic free of A-Frame and test it with
   `node --test`, the way `common/menu-model.js` is.
2. **Duel definitions as data.** Title, start signal, opponents
   (targets for now), rules (rounds, false-start penalty), scoring.
   Weapon, time and place fields exist even if only one value is used
   now (`deck.todo.md`).
   - **Modifiers:** a list of small apply/remove pieces of data,
     stackable. Implement one or two cheap ones (time of day via
     `world-day-night.js`, fog) just to prove the shape. The real
     collection comes in phase 04.
   - **Weapon takeover:** if a duel names its weapon, hand it out at
     setup, set the player's carried guns aside, and give them back at
     the end, including after an aborted duel. Leave the belt and
     holsters themselves alone (01-A's territory). Set aside what's in
     them through the normal slot calls.
3. **Start signals that plug in.** Build at least: a "Draw!" shout
   after a random delay (text plus a sound placeholder), a starter
   pistol, a flag drop, and a coin toss that triggers on its `landed`
   event. Try ten paces (see the paces question in
   `dueling.todo.md`) and write down what worked.
4. **False starts.** The duel needs guns holstered at setup. A
   holster grab or a shot before the signal is a false start, and the
   duel's rules decide the penalty.
5. **Cardboard cowboys.** A man-shaped pop-up target that appears on
   the signal. Start from `common/dummies.js`'s `steel-silhouette`,
   which already has hit zones and a `popup` mode
   (`docs/actions/dummies.spec.md`), restyled as cardboard, rather than
   building a new one. Its hits arrive as `action-hit`, while Pistols'
   guns emit `shot`, so working out how the two meet is part of this
   item (an adapter, not a fork). Fall back to `world-targets.js` only
   if the dummy doesn't fit.
   For now each one has painted hit areas. Phase 02-A dresses them in
   real wardrobe items from 01-A.
6. **Results.** Reaction time (signal to first hit), accuracy, hits,
   misses, medal tier. Show it on an in-world board at the Range.
   Emit a results event with all of it. Paying out is 01-C's and 02's
   job.
7. **One sample duel** at the Range you can start from the watch menu
   or a pedestal.

## Touches

A new duel script (persistent, not area-scoped: it belongs in the
page's eager script list, see CLAUDE.md), `js/world-targets.js` for the
cutout, `areas/range.html`, and one watch-menu row. **Leave alone:**
anchor-slot/holsterable internals (01-A). Listen for the holster's
existing grab events rather than editing it.

## Done when

- `node --test` covers the round flow, including false starts and
  best-of-N.
- Playwright plays the sample duel through real input: holster check →
  signal fires → pose a hand, draw with `gripdown`, aim, `triggerdown`
  → cutout hit → results event with a sensible reaction time.
- Drawing before the signal triggers a false start.
- Each built start signal has a test.
