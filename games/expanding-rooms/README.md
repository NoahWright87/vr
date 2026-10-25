# Expanding Rooms

Combines Impossible Spaces' **Original growth** generator with redirected walking.
Open `/games/expanding-rooms/` on Quest over HTTPS.

## Try it

1. Enter VR. The setup panel appears in front of you. Choose **Set Boundary**.
2. Walk and/or point at the floor and hold the trigger to paint your clear floor.
   Open the watch or visor: **Set Boundary** accepts it; **Cancel** keeps the old
   outline. An invalid trace stays in setup so you can keep painting.
3. Stand inside the outline and choose **Generate level**. **Customize** changes
   the room/hall target (36 by default), room sizes, shapes and advanced building
   settings. **Redraw Boundary** replaces your outline. Changes to generation
   settings wait for the next explicit generation.
4. The lobby disappears. Call a lift with its labeled button, enter the open
   bay, grab the yellow overhead handle and pull it down. A different side may
   open after the ride, pointing toward more usable real floor.
5. Watch or visor → **Exit level** returns to setup with your boundary ready.

The initial virtual footprint is 1.25× the physical width and depth. The original
trace, including concavities, remains the physical limit. The separate lobby
**Experiments** panel and watch/visor submenu edit the same settings. Short
sidecars explain each trick; advanced numbers stay tucked away.

The shared visor HUD shows a small current-room map in the top-right corner:
room name, floor shape, doors, fences and your position/facing direction. The
floating room-name sprite is removed here. Layout boxes no longer appear
automatically on first headset entry; **Visor → Adjust** still previews them.
**Visor → HUD** retains the shared show/hide, opacity and idle-fade preferences.
The full-layout desktop debug map is tucked under **Tools & help**.

## Experiments

| Setting | Behavior | When applied |
| --- | --- | --- |
| Plan the next door | Scores the approach, threshold and 45 cm into the next room; selects a likely door from travel/look direction with hysteresis | Live; on by default |
| Longer steps | Existing speed-based translation gain, initially capped at 1.2× | Live; on by default |
| Steps that fit | Smooths translation gain toward the distance to the chosen door divided by available physical runway, within the gain cap | Live; optional |
| Bend my walk / Help my turns | Rate-limited walking curvature and head-turn gain | Live; on by default |
| Fit the next wing | Up to 4% compression/expansion along the exit direction while the lift is fully shut; once per wing; cabin and threshold stay fixed | Next applicable ride |
| Build as I explore | Replaces a never-seen wing in a worker while the lift is shut; preserves the source and return connection | First applicable ride; optional |
| Paths around things | Small solid fences in roomy rectangular spaces with room to walk around | Next generated level/wing |
| Things to look at | Colored wall pictures with a slowly moving light | Next generated level/wing |
| Door switches | Wall switches open their own ordinary doors | Next generated level/wing |
| Floor pattern | Changes floor-square density without changing geometry or walking speed | Live |

Generation tries ordinary rooms and halls first; elevators are a fallback when
ordinary growth cannot attach a piece. Call buttons are fixed wall plates beside
their own door, with a visible wire to that jamb. Pressing one opens that door;
it never closes another door. Controls persist across room transitions, and
closed doors render through neighboring rooms using the same visibility clipping
as the walls. Door state changes only on explicit interaction or lift arrival.
Square cabins permit quarter-turn choices for the connected wing while preserving player position.
Visibility and doorway-width checks reject invalid adjustments. Worker failures
or an eight-second timeout retain the existing rooms. Exiting cancels the worker.

**Tools & help** retains pause-effects, accessible lift activation, boundary
outline, recovery, counters and a JSON debug report. Advanced tuning includes
next-generation world scale, gain limits, speed thresholds and steering limits.
Effects pause while menus are open, during calibration and during lifts. Real
head tracking always remains live; headset, hands and boundary remain in tracking
space. Only the virtual world receives the inverse walking transform.

Added movement that crosses a virtual wall is rejected. Invalid tracked walking
hides the world and marks the last valid position. Returning inside the physical
boundary and using **Recover here** reanchors that valid virtual position.
Tracking resets invalidate the trace; transient tracking loss retains the mapping.

## Limits and validation

This is a first experiment, not a guarantee that every route fits. Door planning
currently tests straight approaches and falls back to room overlap when blocked;
it does not plan a curved route around furniture. Natural head movement may still
provide too little correction. Fences stay fixed while visible. Resizing happens
behind closed lift doors, not as visible walls move around the player. Floor
patterns are a perceptual experiment, not a proven speed controller.

Desktop WASD is a geometry preview. Tab opens the watch; backtick opens the visor.
Both the original 2D playground and [Walking Simulator](simulator/) remain under
**Dev Tools** on the home page. The simulator shares baseline walking code but
currently does **not** model the new switches, pull handles, wing rebuilding or
new experiment settings. Its existing overnight results therefore do not validate
this new VR interaction loop.

Run `npm test` and `npm run build`. Against a served production build, run
`node tests/expanding-rooms.browser.cjs` and
`node tests/expanding-lifts.browser.cjs` and
`node tests/expanding-door-continuity.browser.cjs` and
`node tests/expanding-room-hud.browser.cjs` with `VR_PLAYWRIGHT_PATH` and
`VR_TEST_URL` configured. Tests cover mounted lobby/watch/visor controls, boundary
accept/cancel, transformed synthetic tracking, collisions, route look-ahead,
stationary lift rides, semantic grabbing, worker-generated wings and exit cleanup.
Comfort, real hand reach and spontaneous human movement still need headset trials.
