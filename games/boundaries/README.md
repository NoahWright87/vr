# Boundary Lab

Enter VR with a room-scale boundary. The floor shows two distinct outlines:

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

## Headset checks

1. Compare cyan with a rectangular Guardian. Cyan and amber should coincide;
   the amber dashes leave portions of cyan visible.
2. Repeat with a narrow oblong shape, including one angled relative to the
   tracking axes. The fitted rectangle should follow its long direction.
3. Draw an L-shaped boundary around an excluded corner. Check that cyan follows
   the inside bend. Amber should remain in one usable portion of the L.
4. If cyan remains rectangular despite drawing an L, the browser is supplying
   a rectangle. The lab cannot recover corners absent from the reported data.
5. Redraw or recenter the boundary and check that both outlines stay aligned.
   Missing geometry or tracking hides the outlines until valid data returns.

This tests reported floor geometry, not furniture recognition. The current
polygon model does not describe interior obstacle holes. The headset's own
safety boundary remains authoritative.

## Automated checks

`npm test` includes Boundary Lab geometry and simulated XR-frame checks for
concave, oblong, rotated, invalid, changed, and temporarily unavailable bounds.
These checks establish geometry handling, not what a particular headset reports.

`npm run test:boundary:browser` checks actual outline buffers, dashed rendering,
and reference-space updates in the built application. It also verifies the
Impossible Spaces defaults and a 2 mm separation between a pair of wall faces.
Use an existing Playwright package via `VR_PLAYWRIGHT_PATH`, and override the
served build URL with `VR_TEST_URL` (default `http://127.0.0.1:8088`). An optional
`VR_SCREENSHOT_PATH` saves a clearly labeled simulated L-shaped renderer check.
