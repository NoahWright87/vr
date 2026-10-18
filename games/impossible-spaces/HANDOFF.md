# Impossible Spaces handoff — 2026-10-18

## Where the user left this

The user reports **boundary creation now works great in the headset**. Room
generation still leaves something to be desired. This PR is being wrapped up
as a base for another session; generator quality is unfinished work, not a
hardware-validated success claim. Preserve the working boundary path while
investigating layouts. No new generator redesign was attempted in the final
2D-playground change.

Primary headset: **Quest 2**, with portable WebXR behavior desired. An earlier
reported space was **4.7 × 2.1 m**; the user also tests oblong/concave footprints
around real furniture. Do not assume a large rectangular room.

## Product constraints and decisions

- VR movement is **real-world walking only**. No thumbstick movement or camera
  teleportation. Each room has a distinct debug color so seams are visible.
- Elevators stay at the same physical location: enter, press a button, close
  doors, replace the outside while fully closed, reopen. Middle rooms-first
  layers offer NEXT/PREV and the last offers RETURN. This is adjacent-layer
  selection, not arbitrary numbered destinations.
- No objectives yet. Current goal is proving impossible geometry in usable
  physical spaces; windows, clouds/ocean/space scenery and open catwalks are
  deferred. Scenery windows should be simpler than sightlines onto real
  overlapping rooms; open bridges need visibility/occlusion work.
- Default margin **10 cm**, doors/halls **80 cm**. These are user-selected POC
  defaults, not furniture/arm-clearance estimates. Movement-gain settings and
  other redirected-walking techniques have not been implemented.
- Setup and generation must live in **the same VR experience**. The user was
  understandably frustrated when sent to Boundary Lab and then told to use a
  separate generator page. The Lab now hosts the actual generation/runtime
  directly, and its watch opens generation immediately after confirmation.

## The boundary path that works

1. Boundary Lab `/games/boundaries/` → Watch → Calibrate boundary.
2. Start reveals passthrough; walk a perimeter and/or point either controller
   at the floor and hold its trigger to paint. Both use one additive 2.5 cm
   `FloorPaint` grid. Closed outlines flood-fill. The watch pauses both inputs.
3. Save freezes a simplified yellow polygon. Yes, save boundary confirms it
   and draws the green ribbon. The watch moves to **Generate level → Generate
   new rooms**. Both generator settings submenus are in that same menu.
4. Generate hides Lab props and disables its artificial locomotion. **Return
   to Lab** restores diagnostics and retains the accepted area in this session.

The cyan WebXR `boundsGeometry` and amber fitted rectangle often coincide on
this Quest browser even when native Guardian is irregular. The shared reader
already samples every XR frame, including initially empty/late geometry.
Waiting longer did not supply the needed detailed outline. Room Setup/plane
inference was tried and abandoned. Do not reintroduce that dependency.

The painted polygon is independent of the reported rectangle. Samples beyond
that rectangle are accepted. Earlier attempts to average paths or extend the
nearest polygon edge produced inward creep, spikes and thin loops in headset
screenshots. **That code is removed**. The bitmap only gains cells; contour
simplification happens at save, with whole-area containment. Do not restore
nearest-edge fans or a global convex hull that fills furniture indentations.

Controller rays and head positions use the **same bounded-floor reference
space**. Render roots apply its frame matrix; generated coordinates additionally
use the selected polygon's normalization origin. Keep the XR player rig at the
tracking origin during play. Native Guardian is independent and unchanged.
Transient tracking loss can recover in the same space; resets/recentering/XR
exit invalidate the trace. Stored polygons are diagnostic, never automatically
applied to a different XR origin. One connected polygon is supported; internal
holes and disconnected patches are not. Paint a bridge to connect patches.

## Generator status: what is and is not guaranteed

**Original growth** (`core/generator.ts`) retains the imported POC templates,
seeded branching, visibility constraints and physical overlap. Its piece
target includes rooms/halls/cabins and can fall short. Warnings are intentional.

**Rooms first** (`core/rooms-first.ts`) is a separate option. It plans rectangular
rooms on each physical layer, then connects them by shared doors or full-width
grid routes. Grid step is half the doorway width, minimum room is three cells
across, and room-size settings round upward to cells. Thus 1.2 m doors imply
at least 1.8 m rooms. Routing can turn around concave footprint edges, but rooms
remain axis-aligned; rotated/narrow areas can pack poorly. Unconnectable plans
are omitted and additional stationary elevator layers supply the room count.

Neither generator target nor the rooms-per-layer setting has an application-set
upper limit (2D and VR watch); inputs must be valid whole numbers. Per-layer
packing is limited by the physical footprint.

It returns the exact requested number of **connected rooms**, provided a
starting room/cabin module fits, or fails explicitly. This does **not** guarantee
metres walked, play time, a long simple path, room variety or no backtracking.
Small areas may contain one/two rooms per layer, producing the elevator-heavy
experience the user dislikes. Increasing the count alone does not solve this.
Do not describe the room-count check as a guaranteed level-length/pacing result.

Next-session priorities: inspect exported 2D layouts; define route/pacing metrics;
improve use of small concave spaces and room/corridor variety; reduce obligatory
returns to elevators; keep the old generator available for comparison. New room
themes and movement gain are separate follow-ups.

## Start the next session in 2D

Open `/games/impossible-spaces/playground/`. It begins with a filled square on
a metre grid. Paint a loop/patch by tapping or dragging; closed loops fill
automatically. Painting is the only drawing tool. Confirm the boundary, then
generate with either engine. Explore with tap-to-walk, WASD/arrows or held direction buttons;
inspect full overlapping layouts and jump to individual pieces for debugging.
The shared stationary ride cycle is available in cabins.

Export a JSON reproduction with painted cells, confirmed polygon, settings,
seed, generated level and current player state. Load/reload restores the floor
and settings; regenerate to reproduce. This page deliberately uses the same
floor mask, worker, full-polygon containment, generators, visibility and
collision logic as VR. It does not introduce another generation algorithm.
See [playground instructions](playground/README.md).

## Code map

| Area | Files |
| --- | --- |
| Shared XR polygon/frame reader | `common/headset-boundary.js` |
| Additive paint and polygon validation | `games/boundaries/floor-paint.js`, `floor-drawing.js` |
| Passthrough, input, confirmation, watch calibration | `games/boundaries/floor-setup.js` |
| Lab hosting the actual game without leaving XR | `games/boundaries/level-preview.ts` |
| Shared generation menu / worker | `generation-menu.js`, `generate-worker.ts` |
| VR app state / clipped Three.js rendering | `main.ts`, `render.ts` |
| Full footprint containment / both generators | `core/footprint.ts`, `generator.ts`, `rooms-first.ts` |
| Movement, clipped views / manual stationary rides | `core/runtime.ts`, `vr-runtime.ts` |
| Non-XR canvas UI / persistence and parameter adapter | `playground/main.ts`, `model.ts` |

Except the first four rows, paths above are relative to `games/impossible-spaces/`.
`runtime.updateElevators` is the older automatic/teleport reference behavior;
**VR and the new 2D playground use `vr-runtime.beginRide/advanceRide` instead**.

## Verification and limits

Run `npm test` and `npm run build`. TypeScript reference tests require Node
22.6+ type stripping. Optional production browser tests use Playwright selected
by `VR_PLAYWRIGHT_PATH`; `VR_TEST_URL` defaults to `http://127.0.0.1:8088`:

- `tests/boundary-lab.browser.cjs`, `tests/floor-paint.browser.cjs`: calibration,
  both controllers, save/review/cancel, storage failure and tracking states.
- `tests/boundary-generation.browser.cjs`: actual Lab watch from calibration to
  generation, regeneration, elevator ride and return, in one scene/session.
- `tests/impossible-generation.browser.cjs`, `tests/impossible-spaces.browser.cjs`:
  standalone menu/worker flow, fixed XR rig, wall raycasts, clipping and spacing.
- `tests/impossible-playground.browser.cjs`: phone touch + laptop canvas flow,
  complete polygon delivery, generation, walking, rides, export/load and reload.

Reference tests walk to every generated piece and back with body clearance,
and check deterministic seeds, exact room counts, footprint containment and
disjoint visible regions. These prove geometry invariants, not engaging layouts
or hardware comfort/performance. Shared walls use 1 mm colored face insets per
side with structural backing; avoid reintroducing z-fighting when changing rooms.
