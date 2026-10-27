# Hand poses: what exists

- `common/hand-pose-core.js`: the pose data: normalizing, compacting,
  validating, editing, blending. Pure; tested by
  `tests/hand-pose-core.test.js`.
- `common/hand-pose.js`: turns a pose into bone rotations on the hand model.
  Needs a browser (three.js), checked with real hand models.
- `assets/prefabs/hand-poses.json`: the committed poses.

## A pose

A name, and for each of five fingers (`thumb`, `index`, `middle`, `ring`,
`pinky`) three joints (`a` the knuckle, `b`, `c` the tip), each with three
degrees of freedom:

| | Meaning | Range |
|---|---|---|
| `curl` | 0 is the hand model's own *Open* hand, 1 its own *Fist* | -0.5 .. 1.5 |
| `spread` | degrees, sideways at the joint; positive fans a finger away from the middle one, the thumb away from the palm | ±60 |
| `twist` | degrees, about the bone's length | ±90 |

Missing is open. The JSON takes the shortest form that says it:

```json
"pistol-grip": {
  "label": "Pistol grip",
  "fingers": {
    "thumb":  [0.35, 0.45, 0.3],
    "index":  [0.45, 0.35, 0.3],
    "middle": 0.9,
    "pinky":  [{ "curl": 0.9, "spread": 4 }, 1, 0.85]
  }
}
```

A number is a whole finger with no spread or twist; an array is the three
joints, each a number or `{ curl, spread, twist }`. `compactPose` always
writes it the same way (numbers rounded: curl to 0.001, degrees to 0.1),
leaving out whatever is open. `label` is optional text for menus.

One pose serves both hands. `blendPoses(a, b, t)` mixes two (for a trigger
finger that closes as it is pulled; nothing uses it yet).

## Putting it on the hand model (`createHandPoser`)

The hand model is A-Frame's `leftHandLow.glb` / `rightHandLow.glb` (15
finger bones, `T`, `F1`..`F4`, each `a b c`), which came with seven baked
clips: Open, Fist, Hold, Grip, Point, Thumb Up, Point + Thumb.

- `apply(pose)` sets all 15 finger bones. Each bone is its Open rotation,
  turned by one rotation made of `curl × (Open→Fist turn)`, `spread` about
  the axis across the bend, and `twist` about the axis along the bone (the
  three axes are perpendicular, so a pure curl has no spread or twist in it).
  It replaces whatever a baked clip left there, so don't run a clip's mixer
  on the same model at the same time.
- Spread's sign is found by trying it (+10° and seeing which way the
  fingertip went), so "positive fans outward" holds whichever way a bone's
  own axes point.
- `measureClip(name)` returns a baked clip as pose data. Measuring the
  Fist clip gives exactly `1` on every finger; measuring then applying a
  clip reproduces it. The workshop's *Start from a baked clip* uses it.
- The left model is the right's mirror with the same local bone axes:
  applying the same pose to both gives positions that are exact mirrors
  (checked on open, fist and a pose with spread and twist on every finger;
  the error was 0).
- `loadHand(THREE, side)` loads a model and its poser together.

## Committed poses

| name | what it is |
|---|---|
| `open`, `fist` | the model's own ends |
| `hold` | the baked *Hold* clip measured, with the tiny spread and twist rounded away; what holding anything looked like before poses were data |
| `point` | index out, the rest curled |
| `pistol-grip` | index lighter for a trigger, the rest wrapped, the thumb along the side |
| `wrap-over` | a second hand over a grip, a tighter wrap |
| `pinch` | thumb and index tips meet (found by searching thumb and index joint values for the smallest tip distance, then checked by eye from three sides) |
| `cradle` | a soft cup, for holding up a cannonball or a barrel |
| `palm-up` | flat, fingers nearly straight, for a 🫴 under a barrel |

## What it taught us

- Slerping the thumb from Open to Fist wraps it across the palm. A pinch
  needs the thumb *opposed* to the index, which means spread and twist as
  well as curl. That is why a joint has three numbers, not one.
- Spread and twist are different axes from curl and must be perpendicular
  to it, or a pure fist reads back with stray twist. They are.
- Not tested in a headset, and the finger shapes are drafts by eye. Noah
  should tune them in the workshop's *Hand poses* tab.
