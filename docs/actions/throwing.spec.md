# Throwing: what exists

- `common/throw-solve.js`: pure ballistics, tested by
  `tests/throw-solve.test.js`.
- The throw detector in `common/intent.js`, tested by
  `tests/intent.test.js`.
- `common/projectiles.js`: the `thrown-projectiles` system, which flies
  every thrown thing (knives and guns).
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

### Guided flight: the hit is basically guaranteed

`planGuided(from, targetPos, targetVel, opts)` solves and leads as
above and records the flight time `T`.
`guidedPosition(plan, t, targetNow)` is the plain arc **plus the
difference between where the target is now and where the plain arc
ends, eased in by smoothstep(t / T)**.

- At t = 0 the correction is zero, so the release leaves your hand
  along the arc your swing chose.
- At t = T it's complete, so the projectile is exactly on the target,
  wherever it moved, and even if the plain arc would have fallen short.

Tested: lands exactly on a target that moved a metre mid-flight; starts
at the hand and stays within 3 cm of the plain arc for the first 5% of
the flight; arrives even when out of range for the throw speed.

## Flight: `thrown-projectiles` (`common/projectiles.js`)

`launch({ el, from, target, velocity, gravity, opts, radius, damage,
force, after: 'stick'|'bounce', spin: 'point'|'flat'|'tumble', source,
onHit, onLand, onDone })`.

- **With a target**, the flight is guided. The aim point eases toward
  the target's live aim point every frame.
  - If the target dies or ducks out of reach (a pop-up going down, a
    peeker back behind cover) mid-flight, it **retargets** to the
    nearest live enemy within 4 m of where it was heading and bends
    onto it.
  - Its damage counts toward the target's `incoming` while it flies,
    so doomed targets aren't picked again.
- **Without a target**, it's plain ballistics.
- **Contact:** a swept sphere against every live target's zones except
  bullets; the earliest wins and gets `applyHit`. Then:
  - `stick` stays in it (parented, so it rides along) for 1.2 s;
  - `bounce` is knocked back, falls and lands.
- **The floor:** it lands (a clack if it hadn't hit anything). Past
  1.25 T with no contact, the guidance lets go and it's ballistic.
- **World time** throughout, so bullet time slows it.
- **Debug channel `intent`:** every guided flight's path.

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
  1. `combat-targeting.resolve('throw')` (the gaze-heavy profile, 40°,
     25 m, team `enemy`) from the virtual hand, along hand velocity plus
     gaze.
  2. With a target and `Guided` on (the default): a guided flight. The
     swing's rise picks the arc, at full throw speed, whatever the arm
     speed.
  3. With no target (or Guided off): the hand's velocity × 1.9, with at
     least 1.4 m/s of loft (Pistols' hurl).
  4. A `whoosh` sound, a light haptic, and the `throw` readout (target,
     angle, flight time).
- **Flight:** pooled knives (point-first) or stars (spinning flat) via
  `thrown-projectiles`. They `stick` with `force: 0.9, damage: Damage`.
- **Holding a gun?** That hand's whip throws the gun instead
  (`common/guns.js`), and no knife.

**Tuning ▸ Throw:**

| Row | Default | Meaning |
|---|---|---|
| `Throws` | on | on/off |
| `Item` | Knife | Knife or Star |
| `Max speed` | 14 m/s | speed cap |
| `Guided` | on | bend the flight onto the target |
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

- 12 desktop knife throws into the gallery (pop-ups, sliders, peekers,
  near and far) produced **12 guided launches and 12 hits**.
- Before retargeting and doomed-target skipping it was 6 of 8: the
  misses were targets killed or ducking mid-flight.
- No throw also commits a punch, and the wind-up isn't an uppercut
  (`upMinForward`).
