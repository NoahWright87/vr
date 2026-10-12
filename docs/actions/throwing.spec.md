# Throwing: what exists

- `common/throw-solve.js`: pure ballistics, tested by
  `tests/throw-solve.test.js`.
- The throw detector in `common/intent.js`, tested by
  `tests/intent.test.js`.
- `common/throwing.js`: the `throwing-hands` and `desktop-throw-input`
  components.

There's no throwing station: you throw at whatever is around, such as
the Range's silhouettes. What's next is in `throwing.todo.md`.

## Ballistics: `common/throw-solve.js`

Lifted from Pistols at Dawn's `computeOverhandVelocity` and
`solveArcAtSpeed` (`games/pistols-at-dawn/js/core.js`), with no
globals.

- `launchAngle(rise)`: where in the swing you let go picks the arc.
  Still rising gives a 50° lob; coming down gives a flat 12°.
- `speedForAngle`, `solveAtAngle(from, to, angle, g)`: the speed that
  lands at `to` for a given angle (null if none can).
- `solveAtSpeed(from, to, speed, g)`: the flatter landing angle for a
  given speed. Out of range it uses 45° and reports `reaches: false`.
- `aimThrow(from, to, { rise, handSpeed, gravity, maxSpeed })`:
  - tries the swing's angle within a speed cap of `maxSpeed ×
    min(handSpeed / 4, 1.15)`, so a weak flick stays weak;
  - otherwise takes the flattest arc the cap allows, and honestly falls
    short if even that can't reach.
- `leadTarget(from, pos, vel, opts)`: solves, moves the target on by
  the flight time, solves again (twice), and returns the shot plus
  `.aim`.
- `positionAt(from, vel, t, g)`.

Tested: lands within 1 cm at 3–12 m above and below; falls short when
out of range; leads a target walking across at 1.2 m/s to within 5 cm.

## Detection: `createThrowDetector` / `updateThrows` (`common/intent.js`)

Position only. A hand comes up **by your head** (within 8 cm below eye
level or higher) and becomes *cocked*. It **releases** on the first
frame it's moving at least `releaseSpeed` (2.2 m/s, head-relative),
with at least `forwardShare` (55%) of that speed along the body's
facing, while still above eye level − 20 cm. After a release the hand
must drop below eye − 20 cm (a guard by the chin is enough) before it
can throw again.

The event is `{ type: 'throw', hand, phase: 'release', t, position,
velocity (rig-local, head-relative), speed, rise }`.

**These don't throw:** a jab (shoulder height, never cocked), an
uppercut (moving up, not forward), and a slow reach to the visor. And
the strike detector now refuses forward strikes above eye − 8 cm
(`punchBelowEye`), so **a throw is never also a punch**.

## `throwing-hands`

```html
<a-entity throwing-hands="rig: #rig; left: #left-virtual; right: #right-virtual"></a-entity>
```

- **Cue:** while a hand is cocked, a knife shows in its virtual hand.
- **Release:**
  1. `combat-targeting.resolve('throw')` (the gaze-heavy profile, team
     `enemy`) from the virtual hand, along hand velocity plus gaze.
  2. With a target: `leadTarget` using its aim-point velocity (now
     measured for every target by the targeting system each tick),
     the swing's rise, the hand's speed, `Max speed` and gravity ×
     `Gravity`.
  3. With no target: the hand's velocity × 1.9, with at least 1.4 m/s
     of loft (Pistols' hurl).
  4. A `whoosh` sound, a light haptic, and the `throw` readout (target,
     angle, speed, "falls short").
- **Flight:** a pooled knife (point-first, tumbling) or star (spinning
  flat) on the action clock's world time. **Homing** turns its
  horizontal heading toward the target at up to `Homing` °/s.
- **Contact:** a swept sphere (4 cm) against every live target's zones
  except bullets; the earliest wins. It calls `applyHit({ source:
  'throw', force: 0.9, damage: Damage })` and **sticks**, parented to
  the target so it rides along, for 1.2 s. Hitting the floor sticks for
  1 s with a clack, and it expires after 4 s.
- **Debug channel `intent`:** the solved arc for a second after each
  throw.

**Tuning ▸ Throw:**

| Row | Default | Meaning |
|---|---|---|
| `Throws` | on | on/off |
| `Item` | Knife | Knife or Star |
| `Max speed` | 14 m/s | speed cap |
| `Homing` | 30°/s | in-flight steering |
| `Gravity` | 60% | gravity scale |
| `Damage` | 2 | damage per hit |
| `Whip` | 2.2 m/s | release speed |

## Desktop: `desktop-throw-input`

On the rig. **T** throws with alternating hands by running a real hand
motion through `semantic-hand.runWorldMotion`: cock up by the ear
(260 ms), hold (120 ms), whip forward (120 ms), then follow through low
(220 ms). The detector, targeting, solve and flight all run for real.
Mouse-look picks the target.

## Verified in headless Chromium

- Four desktop throws at still silhouettes 6–7 m away all release, and
  all land on the torso.
- Rails at 1.2 m/s: 3 of 4 hit.
- No throw also commits a punch.
