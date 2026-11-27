# The Prefab Workshop: what's next

- **Undo and redo.** There is none. The only way back is *Revert to
  committed* for a prefab or a pose. A gizmo drag you didn't want is gone.
  The store already owns every change (`update(mutator, what)`), so
  snapshotting the changed entry before each non-drag edit and one snapshot
  per drag is the natural shape.
- **Test it in the workshop, not only look at it.** Today you see the hand
  on the object. The next layer is a *Test hold* that puts the prefab in a
  simulated hand (desktop semantic hands exist), fires its emitters and
  drops it, so what the workshop shows is also what the game does. That
  needs the holding layer first (`holding.todo.md`).
- **Toybox integration.** The 3D Model Toybox (`games/model-viewer/`) still
  spawns plain models. Models that have a prefab should come out *usable*
  (held by their grip, pose and all, firing their emitters), and the Toybox
  is where Noah wanted to demonstrate weight (`weight.todo.md`) and the
  override menu (`wiring.todo.md`).
- **Rename a prefab id.** Not offered: duplicate and delete does it, and
  the export then shows a new prefab and a deleted one. Fine until an id
  is referenced from somewhere that needs to follow it.
- **Rotation by number is clumsy.** Euler degrees are hard to author
  with. The rings do the real work. If it still hurts: ±90° nudge buttons,
  or a "point -Z at..." helper.
- **Mirror editing.** An `either` point's left hand can be given its own
  placement (and then edited), but there is no "mirror this other side
  back" or symmetric editing. Probably enough.
- **VR editing.** Placing hands with the real controllers (grab the
  gizmo, or hold the prefab in one hand and pose the other) could be much
  faster than a mouse once the holding layer exists. Deferred on purpose:
  the loop for a first pass is desktop (see README principle 4).
- **Model thumbnails** in the left list, and grouping by pack, would help
  once more than a handful of prefabs exist.
- **Pinch zoom and two-finger pan** on touch screens.
- **Hint when a placement is inside the model.** Nothing flags a hand
  buried in a mesh or an emitter that points back into the object.
  Deliberately not a test (README principle 7); a warning colour could help.
