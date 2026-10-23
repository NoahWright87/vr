# Tuning, readouts and debug overlays: what's next

The registry, debug draw, HUD, log and live sidecars exist. See
`debug-tuning.spec.md`. The workflow they serve: Noah plays in the
headset, changes a number in the visor, feels the difference,
screenshots the sidecar, and says what felt wrong.

## Not built yet

- **Presets and A-B comparison.** Add a per-group select row that swaps
  between two named snapshots (`A`/`B`), for flip-back-and-forth
  comparisons. This is Punch Pop's hit-assist cycle row, generalized.
  Store the snapshots alongside the group's saved values.

- **World-space labels for debug draw.** Targeting wants a score
  printed next to each candidate. SDF text is one mesh per label and
  expensive in A-Frame, so keep a small pool (~16) of `a-text`
  entities, assigned to the nearest labels each frame and hidden
  otherwise. Lines are enough until targeting needs numbers in the
  world. The HUD readout covers it for now.

- **Fold `common/obb-collider-visibility.js` into the `hitboxes`
  channel**, or retire it. It's the older precedent for showing
  colliders.

- **Motion recording controls.** Record (rolling last N seconds),
  Label, Save. See `intent.todo.md` for where recordings go and how a
  headset gets them off the device.

- **The sidecar is the only list for a long readout.** A readout longer
  than the visor's sidecar (the action log can be 12 lines) runs off
  the card. If that bites, cap sidecar lines and show the newest.
