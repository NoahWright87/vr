# Motion sensing: what's next

The first slice is built. `motion-sense.spec.md` describes what exists.
This file covers what comes after it.

## Why it exists

Every action reads the same handful of facts about the player: where
the head and hands are, how fast they're moving, where the torso
probably is and which way it faces, how far each hand is extended. The
most important is how vigorously the player is moving *right now*
(motion energy), because that pays for every cheat. See
`comfort-budget.todo.md`.

Punch Pop computed all of this inline in `punch-tracker` /
`punch-locomotion` (`games/punch-pop/index.html` around lines 783 and
1059). This module is the shared, tested version, and the place where
Punch Pop's lessons are kept:

- **Turn immunity by construction.** Extension is measured as hand
  offset from the torso point, dotted with the body's facing. A body
  turn with a fixed arm pose rotates both by the same angle and leaves
  it unchanged.
- **Head-relative speed.** Hand velocity minus head velocity, so
  turning or stepping with a hand out doesn't read as a fast hand.
- **Measure in physical space.** Use rig-local (tracking-space)
  coordinates, never world. Locomotion, including the
  expansive-spaces movement gain, moves the rig. A world-space velocity
  would count virtual motion as physical motion and earn a comfort
  budget the player never paid for.

## Next

- **Calibrated reach.** `reach` is a setting today (forward/up/side
  metres). Port Punch Pop's calibration: sample about 3 s of max forward
  reach, then about 3 s of overhead, clamped to sane bounds. Make it a
  visor action, persist it per device, and show it in the readout.
  Calibrate is the first thing a new player should be prompted to do.

- **Check the shoulder estimate against real aiming.** `aimRay` exists.
  Verify against recordings that the shoulder→hand ray matches where
  people think they're pointing better than the head→hand ray.
  Hypothesis, unverified: it does for an arm held out, and the head→hand
  ray is better for a hand held close to the face (sighting down it).
  The answer may be a blend by extension.

- **Body yaw that lags the head.** Facing is currently the head's yaw,
  smoothed. People look around without turning their torso. Better:
  update the torso's yaw only when the head has held more than ~35°
  off it for a while, or when both hands' average horizontal direction
  agrees with the head. Needs recordings to tune. It matters for
  "which way is forward" in strike classification.

- **Hand-tracking dropouts.** Today a dropped sample (`tracked: false`)
  or an impossible jump (speed over `maxSpeed`) is skipped for velocity
  and the hand reads as still. With hand tracking, hands vanish when
  they leave the cameras' view, which is exactly where punches and
  throws end up. Options: hold the last velocity for up to ~100 ms
  (dead-reckon) then decay, and expose `confidence` per hand so
  consumers can refuse to fire on a guessed hand. Decide once there's a
  hand-tracking recording of a full punch.

- **History queries.** The ring buffer is kept but only the latest
  derived state is exposed. Intent classifiers will want "peak speed in
  the last 300 ms", "travel distance since t", and "velocity at the
  moment extension crossed 40%". Add these as pure functions over the
  buffer when the first classifier needs them, not before.

- **Recording.** The sample format here *is* the recording format: one
  JSON object per frame with `t`, `head`, `left`, `right`. See
  `intent.todo.md` for the recorder and the replay tests. The
  hand-tracking branch (`claude/hand-tracking-demo-ivpmd4`,
  `tests/motion-recording.test.js`) already has a gesture recorder.
  Reconcile with it rather than making a second one.

- **Energy model tuning.** Energy is a weighted sum of head-relative
  hand speeds and head speed through an attack/release envelope. The
  weights are guesses. The motion lab exists to tune them. The questions
  to answer in a headset:
  - Does standing still and looking around stay under ~0.1?
  - Does reaching for the visor or watch stay under the "assist allowed"
    threshold?
  - Does a real jab cross ~0.5 within its first 100 ms?
  - Does shadowboxing keep it up between punches (the release should be
    slow enough)?
