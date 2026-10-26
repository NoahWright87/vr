# Expanding Rooms

Combines Impossible Spaces' **Original growth** approach with redirected walking.
Open `/games/expanding-rooms/` on Quest over HTTPS.

## Try it

1. Enter VR and choose **Set Boundary** on the panel in front of you.
2. Walk and/or hold the trigger while pointing at the floor to paint your clear
   area. Watch or visor → **Set Boundary** accepts it; **Cancel** keeps the old
   outline. An invalid trace stays editable.
3. Stand inside the outline and choose **Generate level**. **Customize** changes
   the room/hall target (36 by default), sizes, shapes and building settings.
   **Redraw Boundary** replaces the outline. Generation changes wait for Generate.
4. Walk through the connecting rooms and halls. **There are no elevators.**
5. Watch or visor → **Exit level** returns to setup with the boundary ready.

The virtual footprint starts at 1.25× the physical width/depth. The physical trace
is never enlarged. Hall/door width defaults to the original 0.8 m; advanced
building settings retain 1.0 and 1.2 m choices.

The shared top-right visor map shows only the current room: name, floor, doors,
fences and your position/facing. Layout boxes appear only under **Visor → Adjust**.
**Visor → HUD** retains shared show/hide, opacity and idle-fade preferences. The
full-layout desktop map is under **Tools & help**.

## Room placement and hallways

Walking-only growth commits a connecting hallway and its destination room as a
pair. Before accepting a non-final room, it checks space for a following hall.
Two-corner return corridors hide the next room from the last, allowing hidden
floor to overlap and be reused. Every committed hall connects two rooms; failed
candidates leave no empty corridor behind. Visibility regions must remain
pairwise disjoint, and the original outline/door widths still constrain geometry.

The generator builds to a configurable piece target, with a bounded candidate
search. This is the ordinary room/hall continuation path, without a teleport or
closed-lift escape hatch. Runtime streaming of unbounded new chunks is not part
of this pass. A short valid result is reported; if even one room/hall connection
cannot fit, setup reports that instead of dropping you into a lone starting room.
The original Impossible Spaces activity retains its separate elevator experiments.

## Experiments and recovery

The lobby Experiments panel and watch/visor submenu share the same values and
short explanations. Live options include doorway planning, longer steps, adaptive
step gain, walking curvature, head-turn gain and floor pattern density. Optional
fences, animated wall pictures and ordinary door switches apply on generation.
The lift-based resize/rebuild experiments are removed from this activity's menus.

Door planning can route through a room's connected convex parts and around hall
corners. It scores the path, doorway and 45 cm of floor beyond it. If no valid
approach is found, it supplies no route correction. Disabling this experiment
retains the original room-overlap redirection mode for comparison.

Effects pause while menus are open, during calibration and tracking recovery.
Tracked head/hand movement stays live. Added movement that crosses a virtual wall
is rejected. Invalid tracked walking hides the world; return inside your real
boundary and use **Recover here** to reanchor the last valid virtual position.
Tracking resets invalidate the outline; transient tracking loss retains mapping.

## Performance and validation

**Tools & help → Walking stats** includes smoothed frame time/FPS, worst frame,
walking CPU time, draw calls and triangles, alongside movement and boundary
counters. Clear counters resets the timing peaks. Exported JSON includes timings.
Headset numbers are the useful measure of headset performance.

Door planning now sweeps paths against cached collision geometry instead of
simulating many physics frames, and no longer performs a second room-overlap
rotation search. Plans run at most once per 120 ms; overlap diagnostics update
once per second. Pausing effects skips geometry planning while keeping tracking
samples current. Elevator handles/buttons are never instantiated in this flow.

One fixed 720-sample desktop comparison (same 38-piece baseline level and input)
measured walking update p95 of 4.54 ms before and 0.56 ms after, with maxima of
28.68 and 5.99 ms. This is a CPU comparison, not a Quest frame-rate guarantee.

Run `npm test` and `npm run build`. Against a served production build, run:

- `node tests/expanding-rooms.browser.cjs`
- `node tests/expanding-walking.browser.cjs`
- `node tests/expanding-door-continuity.browser.cjs`
- `node tests/expanding-room-hud.browser.cjs`

Set `VR_PLAYWRIGHT_PATH` and `VR_TEST_URL` as needed. Core tests traverse a generated
room/hall layout in both directions using real collision code and verify hidden
floor overlap, visibility separation and the absence of portals. Browser checks
cover mounted menus, synthetic XR tracking, recovery, elevator-free generation,
pause behavior, persistent ordinary door controls and the shared HUD.

Desktop WASD is a geometry preview. Tab opens the watch; backtick opens the visor.
The original playground and [Walking Simulator](simulator/) remain in **Dev Tools**.
The simulator still uses its baseline generator/settings, so its existing reports
are not validation of this new walking-only generation or human comfort.
