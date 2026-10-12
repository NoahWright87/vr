# Feedback: what's next

The clock, effect pools, haptic patterns and synthesized sounds exist.
See `feedback.spec.md`.

## Not built yet

- **What triggers bullet time** in play: several attacks at once, a
  parry, a meter? That's a game-design question. The clock has a
  manual `Slow-mo` row to feel it out.

- **The player being hit**: a red edge flash drawn in clip space, using
  the technique Pistols' vices vignette uses because WebXR has two
  per-eye projections (`games/pistols-at-dawn/js/items-vices.js`), plus
  `haptic(hand, 'hurt')` on both hands. Never shake or push the camera.
  It comes with `defense`.

- **Hit-stop on gun hits** is deliberately off (silhouettes skip it for
  `source: 'gun'`). At 4+ shots a second it read as stutter in
  principle. Try it in the headset before deciding.

- **Decals** (bullet marks on silhouettes) would need a small pooled
  quad set per target, or a canvas texture like Punch Pop's splatter.
  Not needed until targets stop being plain steel.

- **Shell casings**: a fourth instanced field. Cheap, and very
  John Wick.

- **Particles only know the floor.** Shards fall through tables. When
  environments exist, add a list of axis-aligned boxes to `stepField`'s
  options.
