# Virtual hands: what exists

`common/virtual-hands.js`. What's next is in `virtual-hands.todo.md`.

```html
<a-entity id="right-virtual" virtual-hand="side: right; rig: #rig; tracked: #right-hand"></a-entity>
```

```js
var vh = el.components['virtual-hand'];
vh.pull('melee', worldPoint, weight);          // this frame: drift there (budget)
vh.pull('guard', worldPoint, weight, 'snap');  // this frame: get there now
vh.perform('counter', pointOrFn, ms, { pose }); // a move borrows the hand for ms
vh.busy()                                      // a move has it
vh.orient(quaternion, priority);               // this frame: turn the glove (a held gun)
vh.setPose('fist', priority);                  // this frame: show this pose (highest priority wins)
vh.position, vh.previous                       // THREE.Vector3: this frame and last, for swept hits
vh.trackedPosition                             // the real hand
vh.offsetLength()                              // metres from the tracked hand
```

**The rule:** the hand you see *is* your hand: where the controller
is, turned the way it's turned. It leaves only for a moment, to do
something good (land a punch, block, a counter), and then it comes
straight back, whether you're moving or not.

## Each frame

1. It reads the tracked hand's world position.
2. **Moves** (`perform`) still running re-request a snap pull to their
   point (or function's point) and their pose (priority 5).
3. **Requests** made since the last tick (`pull`) are averaged by
   weight into a desired offset. Requests last one frame.
4. The offset moves toward the desired offset:
   - **snap** (any snap request this frame: a block or a counter): at
     Tuning ▸ Hands ▸ `Snap speed` (6 m/s), up to `Snap reach` (80 cm),
     moving or not. The character's reflexes, not yours.
   - **budget** (only budget requests, growing the gap, under
     `handMax`): by what `comfort-budget.stepHandOffset` grants for
     this frame's real hand travel and energy (a punch's fist drifting
     onto its target).
   - **otherwise** (nothing asking, or asking for less): back at
     `Return` (3 m/s), moving or not. This used to need real hand
     motion, so a hand left alone after an assist stayed off; that
     read as hands floating away.
5. **If nobody can see it** (the tracked hand is more than 65° from
   gaze and nothing is requesting), the offset snaps to zero for free.
6. The glove is placed at tracked + offset, **turned the way the
   tracked hand is** (Tuning ▸ Hands ▸ `Turn with`: Controller). On a
   headset controller it's tilted down by `Wrist tilt` (38°, the
   controller is held below its length) and rolled by `Wrist roll`
   (90°: a vertical fist, thumb up). Those two defaults are guesses
   until tried in the headset. `Arm` points it along shoulder→hand
   instead (the old behaviour, for jittery hand tracking). A held gun
   overrides it (`orient`), so the hand turns with the gun as aim
   assist swings it onto a target. Rotation is shown, never read. Off
   a headset it's scaled by the tracked `semantic-hand`'s
   `desktopScale` (the simulated hands sit close to the camera).
7. Wanted versus granted drift goes to the comfort ledger (`hand L` /
   `hand R`).

## Visuals

- **The glove:** low-poly boxes (palm, finger block, thumb, cuff).
  Poses only move the finger block: `open` (the default), `fist` and
  `gun`. **Pose is output:** the game decides what the hand shows.
  - a held gun requests `gun` (priority 1);
  - melee requests `fist` (priority 2) while a strike is in flight;
  - the guard requests `open` (priority 3);
  - a counter's move shows its own pose (priority 5).
- **The ghost** always shows the real hand's turn, even while a gun
  turns the glove.
- **The ghost:** the same glove, translucent blue and without depth
  write, at the tracked hand, sharing the pose. Tuning ▸ Hands ▸
  `Ghost`: When apart (offset over 1 cm, the default), Always, or Never.
- **Input visuals hidden:** while `Glove` is on, the tracked hand's
  `.desktop-hand-visual` (desktop model) and `.hand-marker` (XR spheres
  in the lab) are hidden every frame. With `Glove` off they come back
  (desktop model off a headset, markers in one) and the glove hides.
- **Debug channel `assist`** draws a cyan line from the tracked hand to
  the virtual hand while they're apart.

## Who uses it

- A held `gun` (`common/guns.js`) sits at its virtual hand, scaled
  like it, asks for the `gun` pose, and sends haptics to the hand's
  tracked controller. `gun-hands` sets `vh.holding` while a hand holds
  one.
- `melee-hands` pulls fists to targets (budget) and sweeps the
  virtual fist for contact.
- `combat-attacks` snaps a guarding hand onto an incoming punch, and
  counters (`common/counters.js`) borrow a hand with `perform`.
