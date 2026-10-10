# Impossible Spaces

A walking-only WebXR exploration prototype built from the supplied
`impossible-spaces-poc.zip`. No objectives, thumbstick movement, snap turns, or
VR camera teleports. Open `/games/impossible-spaces/` using the repository's Vite
server or production build. WebXR requires HTTPS (or localhost for desktop).

## In a headset

1. Draw a room-scale boundary, stand well inside it, and enter VR.
2. The game reads the same `bounded-floor` polygon and frame transform as Boundary
   Lab via `common/headset-boundary.js`. The cyan outline is the reported boundary.
3. Walk through the colored rooms and doorways. The initial room is generated
   around the actual headset pose. The rig stays at the XR origin.
4. Enter an elevator fully and poke **RIDE**, or point and trigger. The panels
   close for 0.65 s, remain closed for 0.8 s, then reopen over 0.65 s. Only after
   full closure does the outside room graph change. Both cabins have identical
   floor geometry, door orientation, and color; your pose does not change.
5. Use the wrist watch to regenerate around your current position, change the
   inward margin (0.10 / 0.25 / 0.40 m) or doorway width (0.8 / 1.0 / 1.2 m), and
   toggle the boundary outline. The current values and seed appear in the watch.

Browsers without bounded-floor data cannot generate a VR level. Tracking loss
pauses play. Boundary resets discard the old level and rebuild using fresh data.
If you physically cross a virtual wall, the game hides the impossible geometry
and marks your last valid floor position with an amber ring. Walk back there, or
regenerate from your current position. The camera is never clamped or slid.

The boundary is a footprint, not an obstacle scan. The headset's own safety
boundary remains authoritative. The default inset is 10 cm and the default doorway width is 80 cm. The inset
is adjustable; it does not estimate arm reach or detect furniture.

## Desktop preview

WASD / arrows move, dragging the scene looks around, and E presses the elevator
button. Preview settings offer rectangles, L shapes, notches, and chamfered
boundaries. The top-down diagnostic map includes faint hidden rooms to show
physical reuse; the 3D renderer draws only declared visible regions. Desktop
movement is disabled as soon as VR starts.

## Implementation and limits

- `core/` retains the POC's templates, seeded growth, visibility math, and reference
  runtime. `footprint.ts` adds whole-edge containment and clearance for concave
  polygons. A bounding box is used only as a candidate-search envelope.
- `stationaryElevators` changes generation so linked cabins coincide physically.
  Each destination room grows into the same bounded footprint in a separate
  visibility graph. `vr-runtime.ts` adds the manual door cycle and tracked walking.
- Floors, ceilings, and wall segments are clipped by `visibleRegions`;
  drawing complete neighboring rooms would reveal hidden overlaps. Render groups
  use colored faces inset by 1 mm into each owner, with joined corners and a
  uniform backing at the original wall line to preserve occlusion. Colored
  faces are clipped again after insetting. Render groups are cached per active room and closed-cabin state and disposed on regeneration.
- Generation runs in a cancellable worker. Settings and seeds reproduce a level
  for the same boundary and starting pose. Short levels retain the POC warning.
- Very small/narrow spaces can contain only a short level or no valid layout.
  The generator never shrinks below the selected doorway width or expands the
  physical boundary to satisfy the requested piece count. A 1 m doorway implies
  a minimum 1.5 m room width, plus the chosen inward margin. This is a flat-floor
  prototype; angled floors and obstacles inside the boundary are unsupported.
- Controller button/ray interaction uses the shared wrist menu code. A gaze dwell
  fallback works when no controller has connected. Native articulated-hand
  tracking/pinch controls are not implemented.

## Verification

`npm test` runs existing repository tests plus the imported reference tests and
new VR tests. Node 22.6+ is required for the TypeScript tests' type stripping.
`npm run build` includes the new entry point and generation worker.

An optional `npm run test:impossible:browser` runs the browser integration checks
against a served production build. It uses an installed Playwright package;
`VR_PLAYWRIGHT_PATH` can select an existing runtime package, `VR_TEST_URL` overrides
the default `http://127.0.0.1:8088`, and `VR_SCREENSHOT_PATH` optionally saves the
preview. Playwright is not required by the normal build or `npm test`.

Automated checks cover deterministic generation, comfort widths, containment of
whole pieces in irregular polygons, independent sightline tracing, clipped
rendering, walking to every room and back, manual elevator closure and pose
preservation, unavailable/tracking/reset boundary states, and reference runtime
behavior. Browser smoke checks exercise real desktop key input and rendered
button events, 3D structural wall raycasts, colored-face containment and spacing, and simulated boundary events with a fixed XR rig.

Still requires headset playtesting: exact guardian alignment, both-eye seams at
doorways, button reach, boundary redraw/recentering on hardware, real controller
events, and Quest 2 performance/comfort. The desktop preview is not a hardware
validation claim.
