# Feedback: what exists

What's next is in `feedback.todo.md`.

## Action clock: `common/action-clock.js`

A scene system that every action component takes its dt from.

```js
var clock = sceneEl.systems['action-clock'];
clock.dt(el)            // world ms this frame for el (0 while el is hit-stopped)
clock.playerDt()        // real ms: the player's hands, guns, virtual hands
clock.hitStop(el, ms)   // freeze one entity (default: Tuning > Time > Hit stop, 60 ms)
clock.setTimeScale(s, rampMs)  // eased ramp (default Ramp 250 ms)
```

- The system ticks before components, so each frame's values are
  ready. A single frame never integrates more than 50 ms.
- **The player is never slowed.** Guns fire at their real rate in slow
  motion.
- Tuning ▸ Time: `Slow-mo` (Off / 50% / 25% / 10%, for trying bullet
  time by hand), `Hit stop` and `Ramp`.
- Pure core (`createClock`, `advanceClock`, `setTimeScale`, `hitStop`,
  `scaledDt`) is tested by `tests/action-clock.test.js`.
- **Users so far:**
  - `steel-silhouette`: motion, spring, and hit-stop on non-gun hits;
  - `action-effects`: all particles and tracers run on world time;
  - `thrown-projectiles` and bullets: world time;
  - held guns: player time.

## Effects: `common/action-effects.js`

A scene system with fixed-size pools. No entity, mesh or material is
created per event.

| Call | What | Pool |
|---|---|---|
| `fx.sparks(point, normal, { count, color, speed, size })` | hot specks off a surface, with gravity, drag and bounce, shrinking | `InstancedMesh`, 400 slots, additive |
| `fx.shatter(center, { count, color, radius, spread, velocity, burst, size, life })` | tumbling tetrahedra that bounce, settle and shrink away: the Superhot death | `InstancedMesh`, 600 slots, flat-shaded Lambert |
| `fx.flash(point, direction, { size, color, life })` | muzzle flash, about 50 ms | `InstancedMesh`, 32 slots, additive |
| `fx.tracer(from, to, { color, life })` | a line that fades from the muzzle end first | one `LineSegments`, 96 slots, additive |

- **Four draw calls whatever's happening.** A full pool drops new
  particles rather than stealing live ones. A full tracer buffer drops
  the oldest. `fx.stats()` gives live counts.
- Particles settle on y = 0 (the floor). They don't collide with
  anything else.
- The pure integration (`createField`, `emitParticle`, `stepField`,
  tracers) is tested by `tests/action-effects.test.js`.

## Haptics and sound: `common/action-feedback.js`

- `haptic(handEl, name, strength)` plays a named pattern through
  `common/haptics.js`. The patterns are `shot`, `hit-light`,
  `hit-heavy`, `block`, `parry`, `kill`, `threat` and `hurt`, each a
  list of `[intensity, ms]` pulses, where intensity 0 is a gap. Never
  required: hand tracking has none.
- `sound(name, position?)` plays a Web Audio synthesized sound: `shot`,
  `boom` (shotgun), `click` (dry fire), `thump`, `clang`, `shatter`,
  `block`, `parry` and `whoosh`. There are
  no assets. A position goes through an equal-power `PannerNode`, and a
  scene system keeps the listener on the camera. The voice cap is 24,
  and the audio context starts on the first pointer, key or touch, or
  on entering VR.
- Tuning ▸ Feedback: `Volume`, `Haptics` (strength scale) and `Sound`
  (on/off).
- `scheduleHaptic` is pure and tested.
