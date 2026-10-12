# Intent: classifying what the hands mean

Pure functions over the `motion-sense` buffer that turn motion into
action events. They're position-only: no buttons, no poses.

## Event shape

Every classifier emits phases, so targeting and the virtual hand can
act *before* contact:

```
arm → commit → (contact window) → recover
{ type: 'strike', hand: 'right', phase: 'commit', axis, speed, travel, headTravel, t }
```

`commit` is the important one: as early as the motion is unambiguous,
because assists need lead time. Pulling a virtual fist 6 cm needs
about 100 ms of fast motion to hide in (`comfort-budget.todo.md`).

## Classifiers

- **Strike**: generalize Punch Pop's extension-fraction state machine
  (`punch-tracker`, `games/punch-pop/index.html` ~783; the README's
  "Punch Pop: how it works" has the full reasoning). Arm below 40% of
  reach, extend, then commit on speed above threshold *and* motion
  energy above threshold. Fire at 90% extension or on stopping. Reset
  below 40%. Generalize the two fixed axes (forward, up) to forward,
  up, lateral (hook) and down (hammer). Keep the guarantee that a body
  turn can't fire it.
- **Guard**: a hand held up between the head and the front, roughly
  still or moving toward a threat. It's mainly a hint for
  `defense`. Blocking itself is proximity, not intent.
- **Present**: already in `motion-sense` as `presented`. Promote it
  here if it grows conditions.
- **Throw (empty-handed)**: a whip, where speed peaks then decelerates
  sharply near full extension. The release moment is the speed peak.
  It spawns a thrown weapon from the loadout. See `throwing.todo.md`.

## Recordings are the tests

"Getting things to feel right" failed in Punch Pop partly because every
tuning iteration happened in a headset. Fix that loop:

1. **Record** in the headset from the visor (`debug-tuning.todo.md`):
   a rolling buffer of the last ~10 s of `motion-sense` samples, saved
   with a label.
2. **Get it off the device.** In dev (`npm run dev` over `adb reverse`)
   a tiny Vite middleware accepts `POST /__recordings` and writes
   `tests/fixtures/motion/<label>-<n>.json`. Off dev, fall back to
   copy-to-clipboard or `console.log`.
3. **Replay in tests**: feed a recording through `motion-sense` and the
   classifiers in `node --test` and assert the events, including **zero
   events** for negatives.

The negatives matter more than the positives. Keep labelled
recordings of: standing still, looking around, turning in place,
walking, reaching for the visor, raising the watch, and scratching your
nose. Punch Pop's worst bug was false positives at rest, and nothing
caught it except playing.

The hand-tracking branch already has a gesture recorder
(`claude/hand-tracking-demo-ivpmd4`: "Add a gesture recorder for
designing canonical gestures against real data",
`tests/motion-recording.test.js`). Reconcile with it, since the sample
format here is meant to be the recording format.

## Desktop

`common/semantic-punch.js` animates a desktop jab or uppercut through
`semantic-hand.runWorldMotion`. Those scripted motions must *also* trip
the real classifiers, the same way desktop grab emits real `gripdown`
events. That way the desktop path tests the real code, not a shortcut.
