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
  - `walker`: turns to face the camera and walks at `speed` to within
    `stopDistance`, returning to its spawn point on revival.
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

## Cost

Each silhouette is 5 meshes, so 24 of them is about 120 draw calls.
That's fine for the range, but the swarm needs instancing
(`dummies.todo.md`).
