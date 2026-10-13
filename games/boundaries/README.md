# Boundary Lab

Cyan shows every point in the headset's reported `bounded-floor` polygon.
Dashed amber is the Lab's conservative fitted rectangle. These diagnostics
never replace the reported polygon sent to Impossible Spaces.

## Walking calibration

1. Enter the Lab, open either wrist watch, and choose **Calibrate boundary** →
   **Start new calibration**. Passthrough reveals the room; virtual locomotion
   is disabled. Walking calibration requires an AR-capable session.
2. Walk once around the usable perimeter, leaving clearance from walls
   and furniture. Pink shows the walked area on the floor. You can walk
   from the middle to the edge first: the first completed lap discards the approach.
   A small ground ring shows your tracked position.
3. Once the area appears, walk directly into any missed corners or edges.
   Each outward position grows the purple area immediately. Another full lap
   is unnecessary. Returning inside or moving away never shrinks it.
4. Open the watch to pause sampling. **Continue walking** resumes.
   **Save boundary** runs the final simplification and shows a yellow preview.
5. The watch now asks **Save this boundary?** Review the area and corner count,
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
corner. The first completed lap establishes the connected concave polygon.
After that, every outward tracked position extends its nearest existing edge
with a local filled patch, combined by polygon union. Extending the full edge
recovers a cut-off corner rather than leaving a thin finger reaching it.
Adjacent exposed sides of a convex corner expand together; concave turns stop
this extension so an L-shaped furniture indentation remains intact.
A 2 mm pad keeps collinear reaches from becoming zero-width lines. There is
no requirement to finish another lap, be within 30 cm of the old outline, or
match a particular arc. Even outward movements below the usual 4 cm sample
spacing grow the area. Interior travel retains the area without extra strokes.
There is no positional averaging, rectangle clipping, or global convex hull
filling an L-shaped indentation. Initial loop closure allows 30 cm of route
variation and uses the closest return, discarding the approach.

Regular display refreshes protect detail within **75 cm** of the wearer.
An outward update first straightens the supporting area without this proximity
restriction, while still requiring full containment, so noisy nearby vertices
do not turn a corner reach into a thin finger.
Distant sections straighten with approximately **3.5 cm** tolerance. Each
replacement edge is shifted outward to its furthest supporting sample, and
adjacent supporting lines intersect to recover corners. The result must be
simple and contain the entire previous polygon, checked with polygon
difference; otherwise the previous shape is retained. Acute corner extensions
above three tolerances also retain the original. Concave indentations remain.
Display updates follow approximately 8 cm interior movement; outward expansion
redraws immediately.
Saving removes the proximity protection and runs a final pass over the polygon.
The visible polygon is the stored polygon, including accepted straightening.
Moving back to a section never restores a less simplified, smaller outline.
Both final saving and live straightening must contain the previous filled
area. Straightening can add a small outward allowance to produce long straight
edges; the yellow preview shows this final approximation before acceptance.
Only the initial stroke is recorded. After it closes, only the area envelope
and one current position remain. An unusually long unfinished lap has a sample
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
interior travel without stray outline segments, immediate outward updates,
missed-corner recovery, whole-polygon containment between previews, straight
wall recovery and bounded memory over 25 repeated visits.

`npm run test:boundary:browser` exercises the mounted current watch through its
actual menu rows: start, save preview, separate confirmation, keep walking,
cancel, storage failure, filled live/review/saved concave geometry, accepting a
walk outside an undersized reported rectangle, immediate growth more than
30 cm beyond the old outline, retained geometry after walking away and saving,
the tracked-position ring, tracking recovery and resets.
Use `VR_PLAYWRIGHT_PATH` for an installed Playwright package and `VR_TEST_URL`
to override the default `http://127.0.0.1:8088`.

Quest 2 testing still needs to confirm the real walking estimate, passthrough,
and watch interaction. Automated tests simulate headset poses.
