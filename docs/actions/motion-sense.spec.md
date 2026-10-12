# Motion sensing: what exists

`common/motion-sense.js`, tested by `tests/motion-sense.test.js`, shown
in the Action Lab's motion lab (`primitives/actions/`). What's next is
in `motion-sense.todo.md`.

## Core (pure, no A-Frame)

```js
import { createMotionSense, updateMotionSense, setMotionSettings,
         describeMotion, cloneSample, flatForward, DEFAULT_MOTION_SETTINGS } from '../common/motion-sense.js';

const state = createMotionSense({ /* settings overrides */ });
updateMotionSense(state, { t, head, left, right });  // once per frame
```

**Input sample**, which is also the recording format: `t` in ms, and
for each of `head`, `left` and `right` a pose
`{ position: {x,y,z}, quaternion: {x,y,z,w}, tracked }`. Positions are
in **physical (rig-local) space**. A hand with `tracked: false` or a
missing pose reads as absent.

**State** after each update:

| Field | Meaning |
|---|---|
| `energy` | 0–1 motion energy: the strongest of the hand and head drives, through a rise/fall envelope (60 ms / 700 ms). |
| `drive.hand`, `drive.head` | the instantaneous drives before the envelope. |
| `head.position/velocity/speed` | the head's track. |
| `yaw`, `facing`, `rightward` | body facing: the head's yaw, smoothed over `facingMs`, flattened to the floor. Looking straight up or down keeps the previous facing. |
| `yawRate` | the head's own turn rate, deg/s, unsmoothed. For budgets that pay for rotation with rotation. |
| `torso` | estimated torso point: `torsoDrop` below the eyes and `torsoBack` behind them. |
| `left`/`right.tracked` | whether the hand reported this frame. |
| `.position/.velocity/.speed` | the hand's track, velocity smoothed over `velocityMs`. |
| `.relativeVelocity/.relativeSpeed` | hand minus head velocity. Walking or leaning with still arms reads approximately 0. |
| `.offset` | hand minus torso point. |
| `.extension.forward/up/side/reach` | offset along facing / vertical / outward to the hand's own side / total length, each as a fraction of its `reach*` setting. Forward is turn-immune by construction. |
| `.presented` | forward extension above `presentOn` (55%), held until it drops below `presentOff` (42%). |
| `.glitches` | how many samples were rejected as tracking jumps. |
| `history` | copies of the last `historySeconds` (2 s) of samples. |

**Robustness rules:**

- A frame gap longer than `maxGapMs` (250 ms) restarts velocities and
  zeroes energy rather than spanning the gap.
- A per-frame velocity above `maxSpeed` (15 m/s) is a tracking jump:
  the new position becomes the baseline and the velocity is left alone.
- A hand returning from untracked starts with zero velocity.

**Energy drives:** hand = `(relativeSpeed − handDeadzone) /
(handFull − handDeadzone)`, using the faster hand; head = the same with
head speed and the `head*` settings. Head *rotation* isn't a drive, so
looking around earns nothing.

Measured on synthetic traces (the tests):

- standing still with ±2 mm jitter stays under 0.03;
- sweeping the head ±60° stays under 0.03;
- a 3.5 m/s jab is above 0.5 by 100 ms (crosses it at about 65 ms);
- shadowboxing holds above 60% of peak 200 ms after stopping and is
  gone after 3 s;
- a slow 0.8 s reach up toward the visor peaks at about 0.13;
- a 90° body turn with an arm held out changes forward extension by
  under 1%.

These are synthetic. Real recordings are the next step
(`intent.todo.md`).

`describeMotion(state)` returns a 4-line text summary (energy bar,
head, each hand) for HUDs, sidecars and screenshots.

## A-Frame component

`motion-sense="camera: #cam; leftHand: #l; rightHand: #r"` on the rig.
Each tick it reads the three entities' world poses, converts them into
the rig's frame (inverse of the rig's world matrix), and updates
`this.state`. `setSettings(partial)` and `describe()` are conveniences.
Hands always report `tracked: true` for now. Detecting real dropouts is
a todo.

On desktop the semantic hands are read like any other hands, so
scripted desktop motions (`semantic-punch-controls`' jab/uppercut) drive
it through the same path. Expect a short energy blip just after page
load while the desktop hands glide into place.

## The motion lab (`primitives/actions/`)

- The page is `primitives/actions/index.html`, with its logic in
  `primitives/actions/motion-lab.js`.
- A panel ahead (`play-space-station="side: front"`) shows bars for
  energy, each hand's head-relative speed (white tick = "Hand max"), and
  each hand's forward extension (green tick = "Present"), plus the
  `describeMotion` text at 10 Hz.
- The XR hand spheres turn green while presented.
- Visor rows:
  - `HUD`: the same text, head-locked, low in view.
  - `Motion ▸`: every setting as a live number row, previewing while you
    scroll, with the readout and every value (with units) in the
    sidecar. Settings persist to `localStorage`
    (`action-lab:motion-settings`). `Defaults` resets them.
- Off a headset: left click is a jab and right click an uppercut (hold
  to charge), alternating hands. Backtick opens the visor.
