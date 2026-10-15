# Targeting and collision: what exists

What's next is in `targeting.todo.md` and `physics.todo.md`.

## Collision queries: `common/collide.js`

Pure functions over `{x,y,z}`, tested by `tests/collide.test.js`:

- `closestOnSegment(p, a, b)` and `closestSegmentSegment(p1, q1, p2, q2)`
  (Ericson 5.1.9).
- `raySphere`, `rayCapsule` and `rayZone`: distance to the first hit or
  −1, and 0 if the ray starts inside.
- `sweptSphereCapsule(p0, p1, radius, a, b, r)` and `sweptSphereZone`:
  a sphere moving from p0 to p1 against a capsule. Returns
  `{ t, point }` at first touch, or null. This is the fist test: a fist
  covering 30 cm in one frame still hits a 4 cm arm.
- A zone is `{ type: 'sphere', a, r }` or `{ type: 'capsule', a, b, r }`.
  `zoneCenter(zone)` gives its centre, and `zoneSurfaceToward(zone,
  from)` the point on its surface facing `from`, where sparks go.

## Targets: `combat-target` (in `common/combat-targeting.js`)

```js
el.setAttribute('combat-target', { health: 3, aimZone: 'torso', team: 'enemy', priority: 0 });
el.components['combat-target'].setZones([
  { name: 'head', type: 'sphere', a: {x,y,z}, r: 0.14, damage: 3 },
  { name: 'torso', type: 'capsule', a: {...}, b: {...}, r: 0.22 },
]);
```

- Zones are in the entity's local space. `worldZones()` transforms them
  at most once per frame. `zone(name)`, `aimZone()` and `aimPoint()`
  (the aim zone's centre) are the accessors.
- **One hit contract:** `applyHit({ zone, point, direction, force,
  damage, source, by })` scales damage by the zone, subtracts health,
  sets `killed`, and emits a non-bubbling **`action-hit`** with that
  detail on the entity. Whatever owns the target decides what a hit
  looks like. The fields follow Pistols' `shot` (`point`, `direction`,
  `damage`) plus `zone`, `force`, `source` and `by`.
- `alive` (health > 0) and `available` (the owner's say-so, e.g. a
  pop-up that's down). A target is a candidate only while alive,
  available and visible. `revive()` restores health.
- `threat` (0–1), `priority` (0–1) and `lookedAt` feed scoring.
  `incoming` and `velocity` are described under the resolver below.

## Resolver: the `combat-targeting` system

```js
var pick = sceneEl.systems['combat-targeting'].resolve('gun', {
  origin, direction, by: 'right', current: lastTargetEl, coneDeg: 35, // coneDeg/range optional overrides
});
// { el, target, zone, zoneName, aimPoint, score, terms, distance, name, candidates } or null
targeting.claim(pick.el, 'right'); // lasts 250 ms unless renewed
```

- **Pure scorer** `scoreCandidates(candidates, query, profile)` is
  tested, including a 500-target benchmark at well under 1 ms per
  resolve. It pre-culls by squared range and a dot-product cone test
  before any square root. The terms are:
  - **aim**: closeness to the aim line, across the cone;
  - **distance**;
  - **gaze**: angle from where the head looks;
  - **recent**: looked at within the last 2 s (Tuning ▸ Targeting ▸
    Memory, the system updates it each tick);
  - **sticky**: the querying hand's current target;
  - **threat** and **priority**;
  - **claimed**: a penalty if another hand has claimed it.

  Every pick carries its terms.
- **Profiles** (`DEFAULT_PROFILES`) are `gun` (30 m, cone set by the
  gun's Assist), `strike` (1.6 m, 60°) and `throw` (25 m, 40°,
  gaze-heavy). Tuning ▸ Targeting: `Gun range`, `Hit range`,
  `Hit cone`, `Throw cone`, `Throw range`, `Gaze` and `Sticky` (as % of
  the profile weights), and `Memory`.
- **Doomed targets are skipped.** `combat-target.incoming` is the damage
  already flying at it (thrown knives and guns add theirs on launch and
  take it back on landing). A target whose `incoming` covers its health
  isn't a candidate, so the next throw goes to someone else.
- **Target velocity.** Each tick the system measures every live
  target's aim-point velocity (`target.velocity`), which throws use to
  lead. A jump over 20 m/s is treated as a respawn, not a speed.
- No line of sight yet. Targets don't occlude each other.
- **Readout** `targeting`: the last pick per verb and hand, with its
  score and terms.
- **Debug draw:** `targeting` draws each query's cone, a line to every
  candidate, and the winner highlighted. `hitboxes` draws every
  target's zones (red alive, grey dead).
