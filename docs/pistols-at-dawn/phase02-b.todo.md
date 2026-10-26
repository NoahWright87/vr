# Phase 02-B: style v0

**Runs alongside** 02-A and 02-C. **Depends on:** phase 01 (duel
events, profile).
**Design:** `style.todo.md`.

## Goal

Showing off is noticed, named and scored, and a duel's results show
style next to the score.

## Work

1. **The listener.** Subscribe to events the systems already
   announce (shots, catches, twirls, landings, lighting things,
   swallowing, shattering, explosions, `hat-tipped`, wardrobe changes)
   and turn them into tricks. The scoring core (repeats paying less,
   the combo window, variety multiplying, state multipliers) has no
   A-Frame in it and is tested with `node --test`. The tuning numbers
   live in one table.
2. **States.** Drunk and smoking (vices), on fire, two guns held, items
   in the air.
3. **A first batch of named tricks** (10–20) built from what exists.
   Toss-and-catch, twirl-then-shoot, a shot during a catch, a hat
   tip, a trick shot off a thrown bottle. Leave out slides (no slide
   move yet).
4. **Callouts.** Floating trick name and points. Head-locked text is
   fine (it's not a moving camera), but keep it off the middle of your
   view.
5. **Duel integration.** Style total per round and per match, sent in
   the results event, so 02-A's results screen and payout can use it.
   Best style per duel saved via the profile.

## Touches

A new style script/module and a callout display. **Leave alone:** duel
content (02-A) and the clothier (02-C).

## Done when

- `node --test`: repeats pay less, variety multiplies, combos end on
  time.
- Playwright: real throw + catch + shot during a duel → the expected
  tricks show up in the results. Spamming one trick scores noticeably
  less than varying.
