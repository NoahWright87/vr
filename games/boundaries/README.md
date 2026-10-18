# Boundary Lab

As of 2026-10-18 the user reports that boundary creation works well in the
Quest headset. Preserve this flow while improving generation. See the
[handoff](../impossible-spaces/HANDOFF.md) and the
[phone/laptop 2D playground](../impossible-spaces/playground/).

Cyan is the headset's WebXR-reported `bounded-floor` polygon; dashed amber is
the fitted rectangle. Neither clips custom floor painting. Quest's native
Guardian is independent and can expose more detail than WebXR supplies.

## Walk and paint one floor area

1. Enter XR and choose **Watch → Calibrate boundary → Start new calibration**.
   Passthrough reveals the room and virtual locomotion stops.
   The Lab's cyan/amber reference outlines hide while editing to keep the
   painted area clear; the headset's native Guardian stays independent.
2. The default input is **Walk + paint**. Walk around the usable perimeter;
   returning to the painted stroke closes it and fills the enclosed floor.
   A starting approach from the interior becomes part of that same filled area.
3. Point either controller down at the floor. A round cursor shows the brush;
   **hold its trigger to paint, release to stop**. Trace a missing corner from
   the existing fill and back into it, or sweep the brush across a gap.
   Closed loops fill automatically. Both controllers and walking add to the
   same purple area. There is no positional averaging or inward erasing.
4. The watch offers **Input → Walking only / Controller only / Walk + paint**
   and **Paint brush width → 10 / 20 / 30 cm**. Choose Controller only when you
   want to patch from where you are standing without adding head positions.
   Opening the watch pauses all sampling. **Continue editing** closes it again.
5. **Save boundary** converts the painted area into a simplified polygon and
   displays a frozen yellow preview. **Yes, save boundary** confirms it and
   draws a separate green floor ribbon and fill. **Keep editing** returns to
   painting. **Cancel calibration** retains the previous accepted boundary.

The cursor turns yellow while painting. Aiming upward, beyond the 4 m pointer
reach, losing controller tracking, or opening the watch interrupts the stroke.
After an interruption, release and press the trigger again. Separate strokes
are never joined by an invented diagonal. Head tracking jumps above 60 cm
interrupt walking; open the watch and Continue editing to resume.

Painting can define the entire area without a walked lap. Walking can define
it without a controller stroke. You can switch or combine them at any time.
If separate patches are unconnected, paint a bridge before saving. The Lab
supports one connected floor area without interior holes; it does not scan
furniture or change the headset's native safety boundary.

## How the area is stored

`floor-paint.js` stores an additive grid with **2.5 cm cells**. Walking stamps
a 12 cm wide brush underneath the headset; controller drawing uses the selected
brush width. The visible cursor/marker indicates the brush location. A sample
paints a capsule between consecutive valid samples from the same input source.
Cell positions have up to one cell of quantization at an edge. Repeated visits,
interior travel and inward laps cannot delete previously painted cells.

An outside flood-fill identifies unpainted cells enclosed by brush strokes and
adds them to the area. This works for the initial perimeter and later corner
repairs alike. It does not guess the nearest polygon edge, extrude triangle
fans, average wall positions, or take a convex hull of the room. Concave
indentations connected to the outside remain unfilled. Disconnected patches
display separately rather than acquiring a stray joining line.

The live contour and filled mesh come from the grid. Geometry refreshes are
limited to 10 Hz while controller cursors update each frame. Memory scales
with painted area, not the number of laps. The grid envelope is limited to
one million cells (approximately 625 m² at the default resolution); excessive
extents receive feedback and leave existing paint intact.

Saving removes grid stair-steps where possible with 2.5 cm simplification
tolerance and a small outward offset. A candidate must be simple and contain
the **entire painted area**, checked by polygon difference. Acute offset
intersections are rejected to avoid spikes. If a simpler polygon would cut
paint or become invalid, the original contour is retained. Previewing again
does not repeatedly enlarge or shrink the stored grid. The yellow preview
shows the final allowance before acceptance. A minimum 0.5 m² painted area
is required; a still-open perimeter remains a painted ribbon until closed.

## XR and persistence

Passthrough is negotiated at the initial entry gesture. Calibration requires
an AR-capable session with a non-opaque environment blend mode. There are no
room-data permissions, inferred walls or Quest Room Setup dependencies.
Both controller rays and headset positions use the **same bounded-floor
reference space**, including the floor-plane intersection. The rendered area
uses the shared reader's frame transform and stays fixed to the physical room.

Save confirmation locks a copy and draws it immediately, even if browser
storage fails. A local record under `boundary-lab-calibration` is diagnostic;
it is not automatically restored into another tracking origin.

Transient tracking loss hides accepted geometry until poses return in the
same reference space. Losing tracking during editing discards the unfinished
estimate and leaves passthrough on until Cancel. Recentring, boundary reset
or leaving XR invalidates the active calibration.

**Generate level** is the first item in Boundary Lab's wrist watch. Confirming
a calibration opens that submenu directly on **Generate new rooms**. Step
inside the green area and select it to generate immediately with the current
style and a new seed. **Rooms first** and **Existing generation** beneath it
offer their own settings and **Generate!** actions.

Generated rooms run in this same Lab scene and XR session, using the confirmed
polygon and existing tracking origin. The floor, sky, cube and diagnostics hide,
and virtual locomotion stops. **Return to Lab** restores the diagnostics and
keeps the saved area ready. You can regenerate or recalibrate without leaving
VR. The standalone Impossible Spaces page has the same Generate level menu;
there is no automatic boundary transfer between independent XR sessions.

**Save diagnostics** stores/downloads a schema-4 JSON report with reported
boundary observations, accepted/pending polygons, current painted contours,
grid resolution, input mode and brush width. Nothing is uploaded.

The headset reader still checks live `boundsGeometry` every XR frame, including
initially empty bounds and late changes. Lab cyan/amber diagnostics remain
available independently of manual painting.

## Verification

`npm test` covers painted-area retention, noisy/reversed L-shaped and rectangular
perimeters, controller-only outlines, clipped-corner repair, brush sweeps,
separate input sources, discontinuities, open gaps, final polygon containment
and bounded memory/extents. Former nearest-edge expansion tests were replaced
along with that implementation.

Against a served production build:

- `node tests/boundary-lab.browser.cjs` covers the reader, mounted watch,
  walking, saved fill/ribbon, review/resume/cancel, storage failure and tracking.
- `node tests/floor-paint.browser.cjs` exercises actual watch selector commits
  and XR `selectstart`/`selectend` events for both controllers in Boundary Lab
  and Impossible Spaces: walk first, paint the missing corner, switch input,
  pause with the watch, lose a ray/pose, save and confirm the resulting polygon.
- `node tests/impossible-generation.browser.cjs` verifies that both generators
  consume the confirmed floor in the same tracking space.
- `node tests/boundary-generation.browser.cjs` starts in the actual Lab, walks
  and confirms a boundary, verifies the automatically focused generation action,
  generates/regenerates both styles without navigation or a new XR session,
  rides an elevator, and returns to Lab with the saved polygon intact.

Set `VR_PLAYWRIGHT_PATH` to an installed Playwright package; `VR_TEST_URL`
defaults to `http://127.0.0.1:8088`. The paint runner optionally saves a top-down
render to `VR_SCREENSHOT_PATH`. Build with `npm run build`.

Real Quest 2 testing is still required for passthrough, alignment, trigger
events, brush feel, watch reach and frame performance. Browser simulations
verify application behavior, not headset hardware behavior.
