# Boundary Lab

Cyan shows every point in the headset's reported `bounded-floor` polygon.
Dashed amber is the Lab's conservative fitted rectangle. These diagnostics
never replace the reported polygon sent to Impossible Spaces.

## Walking calibration

1. Enter the Lab, open either wrist watch, and choose **Calibrate boundary** →
   **Start new calibration**. Passthrough reveals the room; virtual locomotion
   is disabled. Walking calibration requires an AR-capable session.
2. Walk a few laps around the usable perimeter, leaving clearance from walls
   and furniture. Pink shows the walked area on the floor. You can walk
   from the middle to the edge first: completed laps discard the approach.
3. Open the watch to pause sampling. **Continue walking** resumes.
   **Save boundary** runs the final simplification and shows a yellow preview.
4. The watch now asks **Save this boundary?** Review the area and corner count,
   then select **Yes, save boundary**. A separate green floor ribbon appears
   immediately. **Keep walking** returns to calibration without committing;
   **Cancel calibration** restores the previously accepted boundary.

After the first completed lap, a translucent fill and one closed outline show
the usable area, rather than the ongoing stroke. Walking through the interior
after a lap does not draw a stray line across this area.

Walking is the only input method. There are no controller paint/edit controls,
room-data permissions, Quest Room Setup dependency, or inferred room surfaces.
Passthrough is negotiated at the initial XR entry gesture, with the ordinary
opaque Lab visible until calibration begins. If passthrough is unavailable,
walking calibration is blocked rather than starting in an opaque world.

## Laps and simplification

Horizontal headset positions are sampled at approximately 4 cm spacing. A return
to an earlier section after travelling around the perimeter identifies a lap;
the closest return is used so a detection radius does not cut off the starting
corner. Completed laps refine one estimate rather than appending overlapping
rings. Completed lap areas are combined with a polygon union: every outer edge
already reached is retained. An outward lap extends the area; an inward lap
cannot shrink it. There is no positional averaging, rectangle clipping, or
convex hull filling an L-shaped indentation. A partial extra lap can extend
the visited arc when the splice remains a valid connected polygon. Loop
closure allows up to 30 cm of lateral variation between laps and uses the
closest return, discarding the initial approach and completed stroke.

During walking, points within **75 cm** of the wearer retain their detail.
Distant sections simplify with approximately **3.5 cm** tolerance. The original
active-lap samples remain behind the display, so revisiting a section can restore detail
and correct the estimate. Display updates follow approximately 8 cm movement.
Saving removes the proximity protection and runs a final pass over the polygon.
Simplification protects outward extrema, including shallow peaks that a normal
distance-only simplifier would cut inward. Nearby detail stays protected while
walking. The area estimate behind the display retains the measured perimeter.
Only one active lap and one area envelope are retained, rather than a list of
past strokes. An unusually long unfinished lap has a sample
limit with explicit feedback.

The cyan headset polygon and amber fitted rectangle are diagnostics only for
manual calibration. Quest's native Guardian can be larger and more detailed
than the rectangle exposed to WebXR. Walked outlines beyond that rectangle are
accepted, with no red outside-reference segments or containment veto at save
or confirmation. Calibration uses tracked positions in the same reference
space; it does not alter native Guardian.

The resulting area must be a valid connected polygon. Crossed strokes can be
normalised into their enclosed area; disconnected areas, interior holes,
duplicate corners and degenerate areas receive watch feedback. The path
describes the perimeter walked; it does not detect obstacles inside it.
Saving requires one completed lap; an unfinished first stroke is not filled
by inventing a closing diagonal across the room.

## Saving and tracking

The final preview remains frozen until the additional confirmation. Acceptance
copies its points into a distinct green ribbon; a browser-storage failure does
not prevent displaying or locking it for the current XR session. A local record
is also saved under `boundary-lab-calibration` when storage is available.

Confirmed geometry remains fixed in bounded-floor coordinates. A transient
tracking interruption hides the saved outline, which returns with tracked
poses in the same reference space. An interruption during calibration stops
sampling and discards its unfinished estimate, keeping passthrough visible
until Cancel. Boundary changes, recentering, and leaving XR clear the active
measurement and saved display. Stored records are not automatically restored
into a new tracking origin. These remain Lab previews; Impossible Spaces uses
the headset-reported footprint.

**Save diagnostics** preserves the latest reported polygon, sampling timing and
change history, accepted manual polygon, and any pending preview. It stores a
browser copy and requests a JSON download. No measurements are uploaded.
The shared boundary reader still checks live `boundsGeometry` every XR frame,
including initially empty data and much later updates.

## Validation

`npm test` covers geometry and XR lifecycle behavior. Tests include several
noisy laps, an initial approach, corrected wall offsets, reverse walking,
L-shaped and notched outlines, partial laps, proximity protection, outward
extrema, inward laps retaining outer reaches, outlines beyond reported bounds,
interior travel without stray outline segments, and bounded memory over 25 laps.

`npm run test:boundary:browser` exercises the mounted current watch through its
actual menu rows: start, save preview, separate confirmation, keep walking,
cancel, storage failure, filled live/review/saved concave geometry, accepting a
walk outside an undersized reported rectangle, tracking recovery and resets.
Use `VR_PLAYWRIGHT_PATH` for an installed Playwright package and `VR_TEST_URL`
to override the default `http://127.0.0.1:8088`.

Quest 2 testing still needs to confirm the real walking estimate, passthrough,
and watch interaction. Automated tests simulate headset poses.
