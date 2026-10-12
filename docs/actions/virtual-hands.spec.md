# Virtual hands: what exists

`common/virtual-hands.js`. What's next is in `virtual-hands.todo.md`.

```html
<a-entity id="right-virtual" virtual-hand="side: right; rig: #rig; tracked: #right-hand"></a-entity>
```

```js
var vh = el.components['virtual-hand'];
vh.pull('melee', worldPoint, weight); // this frame: I'd like the hand there
vh.setPose('fist', priority);         // this frame: show this pose (highest priority wins)
vh.position, vh.previous              // THREE.Vector3: this frame and last, for swept hits
vh.offsetLength()                     // metres from the tracked hand
```

## Each frame

1. It reads the tracked hand's world position.
2. **Requests** made since the last tick (`pull`) are averaged by
   weight into a desired offset. Requests last one frame.
3. The offset moves toward the desired offset by what
   `comfort-budget.stepHandOffset` grants for this frame's real hand
   travel (`motion-sense` speed × dt) and energy. With no requests it
   returns toward zero by the same rule.
4. **If nobody can see it** (the tracked hand is more than 65° from
   gaze and nothing is requesting), the offset snaps to zero for free.
5. The glove is placed at tracked + offset, pointing along the
   shoulder→hand line. It never uses wrist rotation, like the guns.
   Off a headset it's scaled by the tracked `semantic-hand`'s
   `desktopScale` (the simulated hands sit close to the camera).
6. Wanted versus granted drift goes to the comfort ledger (`hand L` /
   `hand R`).

## Visuals

- **The glove:** low-poly boxes (palm, finger block, thumb, cuff).
  Poses only move the finger block: `open` (the default), `fist` and
  `gun`. **Pose is output:** the game decides what the hand shows.
  - autofire requests `gun` (priority 1) while a gun is held;
  - melee requests `fist` (priority 2) while a strike is in flight.
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

- `autofire-gun` sits on a virtual hand (`hand: #right-virtual`) and
  sends haptics to the virtual hand's tracked controller.
- `melee-hands` pulls fists to targets and sweeps the virtual fist for
  contact.
