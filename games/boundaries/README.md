# Boundary Lab

The floor shows two diagnostic outlines:

- **Solid cyan, with white dots:** the full polygon reported by WebXR
  `bounded-floor`, transformed into the current tracking space.
- **Dashed amber:** an approximate rectangle fitted entirely inside that
  polygon. It is calculated by the Lab, not returned by the headset.

The watch shows corner count, polygon area, and fitted rectangle dimensions.
The fit checks complete cells and boundary segments so concave notches are
excluded. It never replaces the reported polygon used by Impossible Spaces.

## Calibrate by walking

1. Enter the Lab and open either wrist watch. Choose **Calibrate by walking**,
   then press **Calibrate by walking** on that page.
2. The watch closes and passthrough reveals the real room. Walk slowly around
   the outline of the usable floor, keeping clear of furniture and walls.
   Pink follows the headset's horizontal location, projected onto the floor;
   headset height and controller orientation do not affect the outline.
3. Walk back near your starting point. Open the watch; recording pauses while
   the watch is open and reopens directly on the calibration controls.
   **Confirm boundary** closes the loop, checks it, and locks
   a valid outline in green for this Lab session, restoring the virtual Lab.
4. **Cancel** discards the calibration and restores your previous Lab outline.
   **Continue walking** resumes tracing. **Undo last section** undoes the latest
   uninterrupted walking section or closing/edit action. **Edit with controller**
   opens the drawing page where you can drag corners, then return to calibration
   to Confirm (or use **Save in Lab**).

The path describes the perimeter you walked; it does not scan obstacles or
prove that everything enclosed is clear. Trace inward around obstacles and
leave room for your body. A table cutout can be an indentation in an L/U-shaped
outline; disconnected outlines and interior holes are not supported.

There is no Quest Room Setup, plane-detection permission, native room launcher,
or surface inference. On passthrough-capable devices, the initial entry gesture
starts an AR-capable session with the ordinary opaque Lab visible. Calibration
reveals passthrough in that same session. Walking calibration is blocked when
passthrough is unavailable, including an opaque session. Ordinary VR entry and
controller drawing remain available on other devices.

## Draw with a controller

1. Enter VR, open either wrist watch, and choose **Floor boundary**.
2. Select **Start drawing**. The watch closes. Release the selecting trigger,
   aim the controller at the floor, then hold Trigger to trace a pink outline.
   You can also tap Trigger at individual corners, or release between strokes.
   The cursor shows the floor intersection; point downward to see it.
   On an AR-capable session this also reveals passthrough for drawing/editing;
   otherwise the virtual checkerboard remains visible.
3. Open the watch and choose **Finish / close outline** to connect the last
   point to the first. The watch reports invalid or crossed outlines.
4. Choose **Edit corners** to close the watch and hold Trigger within 12 cm
   of a pink corner to drag it. Release to drop it. **Undo** restores the last
   stroke, edit, finish, or clear action. **Clear** starts a new outline.
5. Choose **Save in Lab** to accept a valid closed polygon. Green means saved.
   **Stop drawing** pauses and keeps the preview. Editing a saved polygon
   requires accepting it again.

Draw only inside cyan. Sections crossing outside turn red and block saving.
The test checks entire edges, including a closing edge across a concave notch,
and rejects self-intersections, duplicate corners, doubled-back edges, and
degenerate areas. An L-shaped outline can exclude an obstacle from a rectangle.
It cannot recover any safe floor omitted by the headset's reported rectangle.
Keep Guardian enabled; the drawing is your description of the floor, not an
independent obstacle detector.

While calibrating, drawing and reviewing, artificial locomotion is disabled, the rig is
aligned with the tracking origin, and the cube/pedestal are hidden. Saving or
stopping restores the previous controls, backdrop and props. Trigger presses used on a
watch never draw points; drawing resumes only after release. Rays come from
the XR controller's target-ray pose in bounded-floor coordinates, without
assuming a Quest-specific controller model orientation.

Saved outlines are **Lab previews for the current XR session only**. They do
not change the Impossible Spaces footprint. Tracking loss, boundary changes,
recentring, and leaving VR discard them so old points cannot be treated as
current room measurements. Tracking interruptions stop measurement while
keeping passthrough visible; Cancel/Stop restores the virtual Lab. Diagnostics
can retain a snapshot for inspection.

## Check delayed boundary data

The shared boundary reader reads live `boundsGeometry` every XR frame,
including after an initial empty array or an unchanged pose. Watch the counters
for at least 30 seconds: elapsed time, frames, first geometry, empty frames,
changes, and maximum corner count. A rectangle that stays a rectangle is the
shape that browser session supplied; the Lab does not manufacture more corners.

**Save diagnostics** on the main watch page stores a local JSON copy under
`boundary-lab-report` and requests a download. It includes the latest reported
points, bounded change history, browser identification, and manual drawing
snapshot. No data is uploaded. Watch feedback explains when only browser
storage is available. A new XR session starts a new observation and drawing.

## Validation

Run `npm test` for geometry and simulated XR lifecycle checks. Run
`npm run test:boundary:browser` against a production build for rendered
concave/rotated boundaries, real watch selections, simulated controller strokes,
corner edits, outside rejection, walking calibration, passthrough eligibility,
Confirm/Cancel, watch pauses, interruption/reset handling, restoration, and
report downloads. Set `VR_PLAYWRIGHT_PATH` to an installed Playwright package
and `VR_TEST_URL` to override `http://127.0.0.1:8088`.

These checks simulate XR inputs. Quest 2 testing still needs to confirm aiming,
trigger interaction, watch usability, passthrough, walking alignment, and the actual
reported Guardian shape.

Passthrough API reference: [Meta Browser mixed reality](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/).
