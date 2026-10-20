# Targets and dummies: what exists

`common/dummies.js`. What's next is in `dummies.todo.md`.

## `steel-silhouette`

A human-sized steel cut-out (legs, torso, neck, head disc) on a short
post, facing its local +Z.

- **Zones:**

  | Zone | Shape | Damage |
  |---|---|---|
  | `head` | sphere | ×3 |
  | `torso` | capsule (the aim zone) | ×1 |
  | `legs` | capsule | ×0.5 |

  They are recomputed each frame so they tilt with the body.
- **On `action-hit`:**
  - sparks at the point and a positional `clang`;
  - a 70 ms white flash;
  - hit-stop for non-gun sources;
  - a rock backwards on a damped spring, scaled by `force` (a head hit
    has more lever than a leg hit).
- **Death:** `tip` falls flat on its back. `shatter` bursts into 40
  pooled shards carrying the hit's direction, with a `shatter` sound.
  Either way it stands back up after `resetMs` (shattered ones pop back
  in).
- **Movers:**
  - `rail`: slides along its own right, ±`railRange`, at `speed`;
  - `popup`: up for `upMs`, down for `downMs`, and not targetable while
    down;
  - `peek`: hidden behind cover for `downMs`, then slides `peekDistance`
    out to its `peekSide` and leans that way over 250 ms, holds for
    `upMs`, and ducks back. It's targetable only while mostly out;
  - `walker`: turns to face the camera and walks at `speed` to within
    `stopDistance`, returning to its spawn point on revival.
- **Cheap to have many:** every silhouette shares one merged body
  geometry (legs, torso and neck) and one head disc, so each is 3
  meshes (post, body, head) with its own two materials (for the hit
  flash and the shooter's glowing head). Zones are only recomputed
  when the body actually moved.
- All of it runs on the action clock's world time.

## `target-spawner`

```html
<a-entity target-spawner="count: 5; distance: 6; arc: 70; depth: 0; mover: none; death: tip; health: 3; speed: 0.8"></a-entity>
```

Lays the silhouettes out in an arc across its local −Z, each turned to
face the spawner's origin. Odd ones are pushed back by `depth`. Any
attribute change rebuilds them. Ids are `<spawner-id>-<n>`.

In the Action Lab the spawner is driven by Tuning ▸ Range: `Targets`,
`Distance`, `Arc`, `Stagger`, `Move`, `Speed`, `Death` and `Health`.

## `target-gallery`

```html
<a-entity target-gallery="crowd: 1; walkers: 0; death: tip; health: 3; shootMs: 0; speed: 0.8"></a-entity>
```

A whole shooting gallery across its local −Z, rebuilt on any change:

| Group | Count at crowd 1 | Where |
|---|---|---|
| near, still | 3 | 3.5 m |
| pop-ups | 4 | 6 m, 90° arc |
| sliders on rails | 3 | 8–9 m, different speeds |
| peekers | 2 per cover wall, 2 walls | ~10 m; each wall is a 0.9 × 2 m slab with one peeker each side |
| far, still | 5 | 15–20 m, staggered |
| walkers | optional | 12 m |

That's 19 targets at crowd 1, and roughly double at crowd 2. `crowd: 0`
builds nothing. In the Action Lab: Tuning ▸ Range ▸ `Layout` (Gallery,
the default, or Arc for the old single row), `Crowd` and `Walkers`.

## Cost

Each silhouette is 3 meshes with shared geometry, so a gallery at
crowd 2 (about 40) is about 120 draw calls. A real swarm still wants
instancing (`dummies.todo.md`).

## `peg-dummy` and `attacker-dummy`

See `melee.spec.md` (peg dummy) and `defense.spec.md` (attacker dummy
and the silhouette's `shootMs`).

## Brawler robots

Boxy robots with IK arms that walk, punch, fall over and get back up are in `common/brawlers.js`; see `brawlers.spec.md`. A line of them stands behind the peg dummies.
