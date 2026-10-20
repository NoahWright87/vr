# Expanding Rooms

First playable combination of Impossible Spaces' **Original growth** generator
and Expansive Spaces' walking gain, walking steering and head-turn gain.
Open `/games/expanding-rooms/` on Quest over HTTPS.

1. Enter VR. Open either the watch (raise your wrist) or visor (hold an empty
   hand beside your temple). Choose **Calibrate area → Start new calibration**.
2. Walk and/or controller-paint your usable physical floor in passthrough.
   Save, review the yellow outline, then confirm. This is the existing shared
   boundary flow, in the same XR session.
3. Stand inside the saved boundary. **Generate level → Generate new rooms**.
   The initial virtual footprint is 1.25× the width and depth (1.5625× area).
   Generation preserves the polygon's concavities. The physical trace is never
   enlarged or substituted with a headset rectangle.
4. Walk through colored rooms. Enter an elevator fully, then press its button
   or use **Recovery → Ride elevator**. Close the menu to let the ride advance.

Both menu surfaces share controls and values:

- **Generate level:** scale from 1–2×, Original growth settings, new seed or
  regenerate the selected seed. Scale and generator changes wait for explicit
  generation; movement settings take effect live.
- **Walking effects:** pause effects, movement gain, steering and turn gain,
  with their speed thresholds, limits and overlap response. Steering and turn
  gain initially enabled; movement gain ramps to 1.2× at 2 m/s. Below 0.6 m/s,
  walking gain is 1× and walking steering is inactive. Slow head turns stay 1×.
- **Recovery:** re-anchor here, regenerate here, show/hide the real boundary,
  and ride elevator. To re-anchor, first return to a clear spot inside the
  physical boundary. This explicitly maps that physical spot to the last valid
  virtual position, preserving the active room and current yaw mapping.
- **Debug:** physical/virtual metres, current gains, steering rate, floor overlap,
  boundary excursions, wall blocks, rejected artificial movement and recoveries.
  Download a local JSON report containing the exact level, seed and settings.

Effects pause while either menu is open, during calibration, and during elevator
rides; real tracked movement remains live. Added motion that would cross a wall
is rejected. If raw walking crosses a virtual wall, the world hides and an amber
ring marks the last valid position; menus remain usable. Physical boundary exits
also hide the world and ask you to return. Recentring or exiting XR invalidates
the trace; transient tracking loss resets motion samples without resetting the
world mapping. The rig, hands and physical outline remain in tracking space;
only the virtual world receives the inverse locomotion transform.

Desktop WASD is a **geometry preview**, not a fake headset locomotion test. Tab
opens the watch; backtick opens the visor. The original 2D playground remains
available separately. The [Walking Simulator](simulator/) uses `walking.ts`
for accelerated seeded batches, independent gaze/travel, reports and replay.
Both 2D tools are in the home page's **Dev Tools** section.

This prototype does not guarantee that steering can make every generated route
fit every physical boundary. Room-floor overlap is a heuristic, not a route
planner. A high overlap score does not prove the next doorway is reachable.
Short generation results remain possible and are reported. The purpose is to
find those failures in headset, with adjustable settings and repeatable reports.
Arm-swing, slide, jump and binocular experiments remain in Expansive Spaces.

Run `npm test` and `npm run build`. With Playwright available, run
`node tests/expanding-rooms.browser.cjs` against a served production build,
setting `VR_PLAYWRIGHT_PATH` and `VR_TEST_URL` as in Impossible Spaces. These
checks exercise shared menus, generation, synthetic XR frames, transformed-world
alignment, recovery and calibration; they do not establish headset comfort.
