# Impossible Spaces

A walking-only WebXR prototype from `impossible-spaces-poc.zip`, using Boundary
Lab's shared boundary reader and walking calibration. No objectives, thumbstick
movement, snap turns or VR camera teleports. Each room has a distinct color.
Open `/games/impossible-spaces/` over HTTPS (localhost works for desktop).

For phone/laptop drawing and generation, open the [2D playground](playground/).
Start the next development session with [HANDOFF.md](HANDOFF.md): the user has
confirmed boundary creation works well; room-generation quality remains open.

## Headset setup

1. Enter VR, then **Watch → Calibrate area → Start new calibration**.
   Passthrough reveals the room. Walk its usable perimeter, or point at the
   floor and hold either controller trigger to paint. Closing an outline fills
   it; controller painting can patch missing corners after walking. Both inputs
   add to the same purple area without inward averaging. The watch offers
   walking, controller painting or both, and 10/20/30 cm controller brushes.
2. **Save boundary** shows a final yellow preview. **Yes, save boundary**
   confirms it and draws a green floor ribbon. **Keep editing** returns to
   painting. Step inside the accepted area.
3. The watch opens **Generate level** after confirmation. Select **Generate
   new rooms** to use current settings with a new seed, or enter **Rooms first**
   / **Existing generation**, adjust settings and choose **Generate!**. Settings
   alone do not rebuild the level. Generate level is also first at the watch root.
4. Walk through colored rooms and doorways. Enter an elevator fully before
   poking or pointing at its button. The doors close for 0.65 s, stay shut for
   0.8 s, then open over 0.65 s. The outside changes only while fully closed.
   The cabin and tracked player pose stay in the same physical location.

Custom calibration runs in the game's own XR session. It accepts points beyond
the reported headset rectangle and supplies the entire confirmed polygon to
both generators. The fitted rectangle is never the placement footprint.
The watch's **Footprint source** offers an explicit headset-boundary comparison.
The default requires a trace, without silently falling back to a rectangle.

Passthrough is negotiated at the initial XR entry gesture. Walking calibration
requires an AR-capable session with a non-opaque environment blend mode.
It uses Boundary Lab's additive 2.5 cm floor grid and shared component, without room-data permission
or Quest Room Setup. Calibration hides virtual rooms and pauses gameplay.
Cancel restores the previous accepted trace and level. Confirm replaces the
trace and clears the previous level; generate explicitly afterward.

Confirmed points are valid only in the current bounded-floor reference space.
Transient tracking loss hides the world until tracking recovers. Recentring,
boundary reset or XR exit discards the trace and requires calibration again.
Stored points are never applied to another tracking origin automatically.
Boundary Lab also hosts this same runtime: its watch can generate levels
directly after calibration without leaving the Lab's XR session. **Return to
Lab** restores its diagnostics and retains the accepted area for another level.
Browsers must provide bounded-floor tracking. Calibration describes a connected
floor polygon, without interior holes or obstacle detection.

## Two generation styles

**Existing generation** retains the POC's seeded outward growth, room/hall
templates and physically overlapping visibility graphs. Its submenu exposes
piece target, room-size percentages, branch chance, doorway width, margin and
seed. Its piece target includes halls and cabins; short results remain possible
and are reported.

**Rooms first** is a separate generator. It plans rectangular rooms inside each
layer of the polygon, then connects them with shared doorways or routed hallways.
Hall routing tests the entire selected-width body footprint, including corners,
against the polygon. It can route turns around concave boundaries. Failed
connections are not emitted as disconnected rooms.

Its submenu exposes room count, maximum rooms per layer, room size, connection
preference (hallways, compact doorways or mixed), hall/door width, margin and seed.
Rooms per layer is an upper limit, not a requirement. Small areas may fit only
one or two rooms per layer; extra elevator layers reuse the same physical floor.
Cabins and their single doorway coincide on every layer. Middle layers offer
NEXT and PREV; the last offers RETURN. The watch also offers layer actions.
A single-layer layout removes its unused reserved cabin.

The new mode returns exactly the requested number of **connected rooms**, or
an explicit failure if an initial room and stationary elevator cannot fit at
the selected settings and current position. Halls and cabins do not count as
rooms. This does not guarantee metres walked, play duration, or a route without
backtracking. It does not expand the footprint or reduce selected clearance to
meet a target. Narrow/irregular areas can still be elevator-heavy.

Defaults: 10 cm margin, 80 cm doors/halls, eight rooms, at most three rooms per
layer and 1.2 m room size. The grid uses half the doorway width; room dimensions
round upward to whole cells. The margin does not estimate arm reach or furniture.
Native Guardian is unaffected. This is a flat-floor prototype.

## Rendering and movement

Floors, ceilings and walls are clipped by the POC's `visibleRegions`. Drawing
complete hidden neighbors would expose overlapping rooms. Colored wall faces
are inset 1 mm on each side of shared walls, with structural backing preserving
occlusion. Views are cached per active room and closed-cabin state and disposed
on regeneration. Both generators run in a cancellable worker.

Physical tracking always controls the XR camera; the player rig stays at the
tracking origin. Crossing a virtual wall hides impossible geometry and shows an
amber recovery ring. Walk back there or generate at your new position.

Desktop preview uses WASD/arrows, mouse drag and E for elevators. Its controls
simulate rectangular, L-shaped, notched and chamfered areas. Watch submenus also
work in the preview. Desktop movement is disabled on XR entry.

## Verification

`npm test` includes repository tests and the TypeScript reference tests (Node
22.6+). `npm run build` includes the entry point and generation worker.

Optional browser runners against a served production build:

- `node tests/impossible-spaces.browser.cjs`: desktop walking, legacy elevators,
  structural wall raycasts, colored-face containment and explicit headset fallback.
- `node tests/impossible-generation.browser.cjs`: real mounted watch rows and
  settings, both workers, walking calibration in the game, acceptance beyond the
  reported rectangle, confirmation, full room count, fixed rig/world transform,
  multi-destination panel buttons, tracking recovery and reset.
- `node tests/boundary-lab.browser.cjs`: shared calibration regression checks.
- `node tests/floor-paint.browser.cjs`: walking plus controller corner repair,
  both trigger sources, brush/input selectors, watch pauses and invalid rays,
  tested in Boundary Lab and Impossible Spaces.
- `node tests/boundary-generation.browser.cjs`: complete calibration-to-level
  flow through the Lab's actual watch, in one scene and tracking session.
- `node tests/impossible-playground.browser.cjs`: 2D phone/laptop drawing,
  generation, collision/ride controls, inspection and portable reproduction files.

Set `VR_PLAYWRIGHT_PATH` to an installed Playwright package and `VR_TEST_URL`
to the served origin (default `http://127.0.0.1:8088`). No Playwright dependency
is required for the normal build/tests. Reference checks physically walk to
every room and back, including turned corridors, rather than checking only a
connected graph. They cover small rectangles, narrow L shapes, notches and
rotated areas, deterministic settings, exact room counts and stationary rides.

Real Quest 2 testing remains necessary for alignment, passthrough, both-eye
doorway seams, button reach, performance and comfort. Simulated XR checks do not
replace hardware testing. Windows, distant scenery and open bridges are deferred.
