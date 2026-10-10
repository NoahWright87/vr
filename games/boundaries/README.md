# Boundary Lab

The floor shows two distinct outlines:

- **Solid cyan, with white corner dots:** every point supplied by the headset's
  WebXR `bounded-floor` polygon, transformed into the active tracking space.
- **Dashed amber:** a rectangle calculated to fit entirely inside that polygon.
  This is an approximate conservative fit, not a second boundary returned by
  the headset, and not a guarantee of the globally largest possible rectangle.

The headset and wrist displays show the reported corner count, polygon area,
and fitted rectangle dimensions and area. No boundary margin is applied to this
diagnostic rectangle. Rectangle fitting considers tracking axes and several
boundary-edge orientations; it checks whole grid cells, including boundary
segments, so a concave notch cannot be bridged by checking corners alone.
The fitted rectangle never replaces the polygon sent to game consumers.

Use `/games/boundaries/` in the headset's browser. These experiments stay in
Boundary Lab; Room Setup data never replaces the Impossible Spaces footprint.

## Does boundary geometry arrive late?

1. Enter normal VR and open the wrist watch. Cyan is the full polygon supplied
   by `bounded-floor`; amber is the Lab's fitted rectangle.
2. Watch the sampling counters for at least 30 seconds. Reads continue every
   XR frame indefinitely, including after an empty array or unchanged pose.
   The watch reports elapsed sampling time, frame count, first valid geometry,
   empty frames, changes, and maximum corner count.
3. Select **Save diagnostics** on the main watch page. The local JSON contains the
   latest boundary points, a bounded change history, and browser identification.
   A rectangle remaining after 30 seconds is an observation, not proof that a
   different runtime could never expose more details. Corner count alone does
   not determine whether a shape is rectangular.

## What does Room Setup expose?

1. Enter the Lab normally, open the watch, select **Room Setup**, then **Test
   Room Setup**. No page buttons or exits from the headset view are required.
   On devices supporting passthrough, the Lab uses an `immersive-ar` session
   with its ordinary virtual world initially visible. Room access is requested
   as optional `plane-detection` at entry; grant permission if prompted.
   The watch reveals passthrough within that same session. Devices without
   passthrough retain a VR session and show that limitation on the watch.
2. Wait at least three seconds. Saved surfaces may arrive asynchronously.
   Green outlines mean horizontal surfaces, purple vertical, pink unclassified.
   All supplied polygon corners are rendered in their plane spaces, transformed
   into the active XR reference space on every frame. A floor, ceiling, desk,
   or couch can all be horizontal; green does not mean walkable.
3. If no surfaces arrive, open **Room Setup** in the watch and select **Open
   Quest Room Setup**. The app calls `initiateRoomCapture()` at most once per
   session, only after waiting three seconds and only with no supplied planes.
   If the launcher is unavailable, use the headset's Room Setup settings and
   re-enter. A cancelled launch requires re-entering before another attempt.
4. Compare surfaces with the physical room. Test tracking interruption and
   recentering: stale outlines should disappear, and recovering poses should
   align again. Moving or changing a plane's pose must update its outline even
   when its polygon has not changed.
5. Select **Return to virtual Lab** on the Room Setup watch page to restore the
   virtual world and controls without leaving XR. The boundary timer continues.
   Stopping/restarting the test cannot bypass the one-capture-per-session limit.
6. Select **Save diagnostics** on the main watch page. It includes the last tracked surface polygons,
   optional semantic labels, and their reference-space matrices. Data is saved
   locally, not uploaded. A browser download is requested and a local copy is
   retained under `boundary-lab-report` in this site's browser storage, including
   when the browser blocks downloads in XR. The watch displays save feedback.
   Starting another XR session starts a new observation.

The virtual floor, sky, cube, and pedestal are hidden during passthrough.
Lab locomotion is temporarily removed and the rig is reset so artificial movement
cannot move hands or menus away from real-room outlines. The previous rig,
controls, and visuals are restored by **Return to virtual Lab**, and on exit.

## Custom floor drawing: next experiment

Proposed interaction: aim at the floor, hold Trigger to paint, preview the closed
polygon, Undo strokes, and optionally edit corners for straight walls or L shapes.
Reject self-intersections and verify that the entire outline and filled footprint
are contained in the reported boundary, including edges crossing concave notches.
Mark outside sections red and prevent confirmation. This would allow excluding
obstacles, but not recover safe areas that a rectangular API omitted.

Room Setup surfaces describe physical geometry. They are **not Guardian**, do not
establish walkable floor, and do not validate a custom polygon beyond the reported
boundary. Keep the headset's safety boundary enabled throughout these tests.

References:
- [Meta Browser mixed reality and Room Setup](https://developers.meta.com/vr/documentation/web/webxr-mixed-reality/)
- [WebXR Plane Detection specification](https://immersive-web.github.io/plane-detection/)

Automated checks use synthetic delayed boundaries and planes. They verify data
and rendering behavior; actual Quest permissions, passthrough, Guardian geometry,
and the native Room Setup flow still require headset testing.

Run `npm test` for geometry and simulated XR lifecycle checks, and
`npm run test:boundary:browser` against a served production build for actual
outline buffers, Room Setup controls, report downloads, and restoration on exit.
Set `VR_PLAYWRIGHT_PATH` to an installed Playwright package and `VR_TEST_URL` to
override the default `http://127.0.0.1:8088`. `VR_SCREENSHOT_PATH` optionally saves
a clearly labeled simulated L-shaped boundary check.
