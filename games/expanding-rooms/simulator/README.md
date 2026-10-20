# Walking Simulator

Open `/games/expanding-rooms/simulator/` or **Dev Tools → Walking Simulator**
at the bottom of the home page. The existing 2D drawing/playground tool is next
to it; its URL is unchanged.

## Run and compare

Select boundaries and walker profiles, enter comma-separated world scales and
maximum movement gains, then choose the seed range. All combinations use paired
seeds. The scale changes the generated layout; gain/steering changes at a fixed
shape, scale and seed use the same layout. Advanced controls expose the same
translation, steering and turn-gain parameters as the VR activity.

**Run batch** runs in a Web Worker. Choose **1×**, **10× target**, or **As fast as
possible**; speed changes affect scheduling, never the fixed 90 Hz simulated
frame interval. The displayed throughput includes generation. Pause preserves
state; Stop keeps completed results and discards the unfinished episode.

The left view shows the physical trace, physical head/body and the virtual rooms
mapped back onto the real floor. The right view shows the current visible rooms,
virtual head/gaze, and an exit marker. Hidden-room outlines are an observer-only
option; enabling them never gives the agent more knowledge. Replay regenerates
the selected seed and settings, then provides 10 Hz snapshots and a time slider.
The trace includes initial and terminal states.

Results group by boundary, profile, scale and gain, retaining separate outcomes:

- **completed:** reached the exit marker in the farthest graph-reachable room.
- **boundary-stop:** stopped within 20 cm of the real edge; a reset would be
  required. This conservative user response is on by default.
- **boundary-exit:** crossed the physical polygon when the stop option is off.
- **wall-block:** raw walking crossed a virtual wall.
- **navigation-stall:** failed to make 15 cm progress for 15 seconds.
- **timeout:** exhausted the episode's simulated-time budget.
- **no-exit / generation-failed:** no second reachable room, or generator error.
- **simulation-error:** an unexpected runner error, kept separate from layout
  or walking failures.

Completion rates include generation failures in their denominator. The report
also records physical/virtual distance, edge clearance, unique pieces visited,
head rotation, rejected artificial motion, and generation warnings. No episode
silently re-anchors, teleports, or recovers to manufacture success. Stationary
elevators use the same close/swap/open cycle as VR.

## What the walker knows

The decision model discovers doors using a 99-degree head-view cone with wall
occlusion and a six-metre range, remembers observed doors, and prefers less-used
doors. It scans on entry, occasionally pauses, and backtracks. The body turns
during full scans; smaller glances vary head direction independently from travel.
Purposeful, cautious and curious profiles vary speeds, turning, scanning and
hesitation. These are explicit behavioral hypotheses, not measured human data.

The global graph chooses the exit for the evaluator. It does **not** give the
walker a route to that exit. Local motor planning does know the current room's
collision geometry, including part centres around corners, and uses a clearance
grid to reach an observed doorway. This optimistic local geometry knowledge is
a limitation; navigation stalls must be replayed before blaming redirection.
Profiles are not a perception or attention model.

`model.ts` imports `ExpandedWalker` from `../walking.ts`: the actual VR motion
integration, gain/steering trackers, collision validation and room transitions.
Original growth, footprint normalization, visibility and elevator logic are also
shared. The simulator supplies synthetic tracking poses, not a second physics
implementation.

Preset boundaries cover a 4.7 × 2.1 m oblong, seeded rectangles, L shapes and
notched floors. Concavities remain intact; non-default seeds vary rotation and
dimensions. Custom headset or playground boundaries are not imported yet.

## Overnight/headless

Export a report/config from the UI, then run from the repository with Node 22.6+
and dependencies installed:

```sh
node --experimental-strip-types games/expanding-rooms/simulator/run.ts --config walking-simulator.json --out overnight.jsonl --seeds 100
```

The runner uses the same model as the browser and runs as fast as possible.
It writes one JSONL line per completed episode and a final summary. It refuses
to overwrite an existing output. If interrupted, completed lines remain usable:
load the partial JSONL in the browser to compare and replay completed episodes.
An unfinished final episode is not counted. Use a new output file and adjust
the seed range for subsequent runs. No language model or paid API is involved.

Keep the machine awake. Background tabs may be throttled, so use the headless
runner for unattended batches. Browser results remain in memory until exported;
they are not automatically stored across reloads.

A six-episode development benchmark (seed 42, oblong/rectangle, scales
1/1.25/1.5, purposeful, 90-second cap) processed about 203 simulated seconds in
2.9 wall seconds on the development machine. This is a small throughput sample,
not an overnight reliability or headset performance claim.

Use exploratory seeds to select promising settings, then change the seed range
for held-out validation. Do not treat a profile's completion rate as a prediction
of human success or comfort. Headset feedback still determines comfort, tracking
quality and whether the navigation assumptions resemble actual behavior.

Reports carry a model version. Increment `VERSION` when changing simulation
behavior so old reports are not silently presented as exact current-model replays.

## Verification

`npm test` includes discovery/occlusion, deterministic replay, paired sweeps,
independent gaze/travel, real redirection, boundary failures and concave local
navigation tests. `node tests/walking-simulator.browser.cjs` exercises the
production UI, worker, batch, replay, JSON/JSONL, pause/stop, mobile layout and
home-page Dev Tools placement. Set `VR_PLAYWRIGHT_PATH` and `VR_TEST_URL` as for
the other browser runners.
