# Phase 02-D: expressive ghosts, and the Ghost Lab

**Runs alongside** 02-A, 02-B and 02-C. **Depends on:** phase 01-A
(wardrobe slots, so ghosts can wear outfits).
**Design:** `aesthetic.todo.md`, `wardrobe.todo.md`.

## Goal

A cute Pac-Man-style ghost with a face that reacts to what happens to
it, used for the player (seen in the mirror), AI duelists (03-A) and
remote players (03-B). Plus a non-VR **Ghost Lab** page for
previewing ghosts, outfits and expressions in a normal browser.

## Work

1. **The ghost character.** A reusable component: dome, wavy skirt
   (a gentle idle wobble is fine), eyes, mouth, wearing wardrobe items
   in the same slots as 01-A. Start from `boxy-ghost`
   (`js/world-player-body.js`). Placeholder geometry, marked
   (`aesthetic.todo.md`).
2. **Expressions as data.** A small set to start: neutral, shocked,
   smug, nervous, woozy, furious, laughing. Each is a pose of eyes
   (shape, pupils, brows) and mouth, blended over a short time.
3. **Driven by events.** A map from game events to expressions:
   - a wardrobe item knocked off → shocked
   - a trick landed → smug
   - drunk → woozy
   - waiting for the signal → nervous
   - stripped → furious

   Data, not code, so new events can be mapped later.
4. **The player's own face** is visible in `#mirror` and to others. It
   shouldn't block your own view: the player ghost is already built so
   nothing sits in front of the camera (`GHOST_FRONT_Z`).
5. **The Ghost Lab page.** A non-VR page with a ghost in a simple
   scene and orbit camera, plus:
   - buttons for each expression
   - pickers for each wardrobe slot (from 02-C's catalog data; since
     02-C runs at the same time, start with the rental costume and
     whatever items exist, and pick up the catalog when it lands)
   - a "fire event" dropdown to check the event mapping

   Linked from the Utilities section (phase 00-b). It doubles as the
   outfit previewer the clothier needs.

## Touches

The ghost component (replacing or wrapping `boxy-ghost`), the
expression data, the Ghost Lab page (registered in `vite.config.js`).
**Leave alone:** duel content, style, clothier logic. Read the catalog
as data and listen for events.

## Done when

- Playwright on the Ghost Lab: choosing an expression changes the face,
  choosing an outfit puts the item in the right slot, firing a mapped
  event plays its expression.
- In the game, knocking off the player's hat (real shot path) makes the
  mirror ghost look shocked.
- Recorded as needing a headset: whether faces read at duel distance,
  and whether the mirror view is fun.
