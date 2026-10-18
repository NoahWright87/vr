# Impossible Spaces · 2D playground

Open `/games/impossible-spaces/playground/` on a phone or laptop. It is a normal
canvas application with no WebXR/A-Frame requirement. The homepage links here.
The VR boundary flow remains in Boundary Lab; this page is a portable place
to reproduce generation problems before returning to headset testing.

## Draw → confirm → generate

The metre grid starts with a nominal **3 × 3 m square** painted in the middle.
As in VR, the brush adds a small allowance around its sampled centreline.

- **Tap corners**: tap/click the corners of a larger area, then **Add area**.
  Include some existing filled floor in the polygon so the extension joins it.
  Drawing a larger outline around the starter also works. Tap corners anywhere
  on the empty grid; there is no headset rectangle or fitted-box veto.
- **Paint**: hold/drag a 30 cm brush. It uses the same additive `FloorPaint`
  implementation as VR. Close a loop to fill its interior, or brush across gaps.
- **Pan**, **+ / −**, and **Fit** move/resize the view. These change the view,
  not the physical area. The grid remains one metre per square.
- **Undo** removes a draft corner or the last committed edit (up to 20 edits).
  **Reset square** restores the starter and can itself be undone.
- **Set boundary** shows the simplified yellow polygon. **Use boundary** locks
  it; **Keep editing** returns to the raw painted area. The final polygon must
  contain every painted cell, just like the VR save preview.
- Choose **Rooms first** or **Original growth**, set target/seed and optionally
  sizes/width/inset/connections, then **Generate level**. **New seed & generate**
  changes the seed. Editing a setting alone does not rebuild the displayed level.

Both generators receive the complete normalized polygon. The bounding rectangle
is only a search envelope. There is no 2D-specific generator or alternate
containment test. Generation runs in the shared cancellable worker.

## Explore and inspect

Tap a destination on the map to walk toward it, or use WASD/arrows and the held
direction buttons. Movement uses the core collision/door-crossing runtime.
A straight route blocked by a wall stops; choose a doorway or walk around it.
The yellow dot is the player's 16 cm body footprint (with a minimum pixel size).

Walk fully into an elevator, then press the ride button. The shared VR ride
state machine closes doors, swaps the outside while closed, and reopens them
without moving the player. Rooms-first middle layers expose previous/next.

**Walk through** draws the core's clipped visible regions. **Inspect overlapping
layout** shows full pieces for a selected physical layer in rooms-first mode
(all pieces for growth). The active visible regions remain highlighted, so a
selected layer and active room can be compared. **Jump to piece (2D only)**
selects any piece and places the dot at its first part's centre. This is an
inspection aid, not VR locomotion. **Edit boundary** discards the current level
and reopens its painted floor for additive changes.

The generation limitations are deliberately unchanged: growth can stop short;
rooms-first can meet a room count using many elevator layers and does not
guarantee interesting pacing or a minimum walking distance. Failures and
shortfall warnings remain visible. See [the handoff](../HANDOFF.md).

## Save a reproduction

Committed paint, the confirmed outline and settings auto-save under
`impossible-spaces-2d-v1` in local storage. Uncommitted draft corners and the
generated level are not restored on reload. Storage failure leaves the current
page usable; Export remains available.

**Export** downloads `impossible-spaces-2d.json`: format/version, exact painted
grid, confirmed boundary, settings, current generated level and player location.
Attach it in the next session to reproduce a problem. **Load** restores the
boundary/settings; Generate recomputes the level from the shared generator,
rather than trusting an imported layout. Matching boundary/settings/seed give
the same layout. Files do not place a saved 2D floor into a new XR tracking origin.

The version-1 grid stores `cellSize`, `bounds` and integer cell keys from
`FloorPaint` (stride 8192, coordinate offset 4096). Imports validate extents,
coordinates, settings and that the confirmed boundary contains the mask before
changing current state. `model.ts` centralizes this adapter. Future changes to
grid encoding need a format-version migration rather than silently changing it.

## Check locally

`npm run build`, then serve with Vite preview. The normal `npm test` includes
`reference-tests/playground.test.ts`: additive concave extensions, failure
without mutation, exact save/load replay, both generators' full footprints,
containment, malformed imports and invalid settings.

`node tests/impossible-playground.browser.cjs` tests the served production page
at desktop and phone sizes, including touch taps, undo/reset, confirmation,
workers, walking, stationary rides, inspection, settings/seed changes,
export/load, reload persistence and brush input. Set `VR_PLAYWRIGHT_PATH` to an
installed Playwright package and optionally `VR_TEST_URL` (default
`http://127.0.0.1:8088`). `VR_SCREENSHOT_DIR` saves desktop and phone screenshots.
