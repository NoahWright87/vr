# Hand poses: what's next

- **Use poses in the game's hands.** `semantic-hand` (in
  `common/interaction-hints.js`) still plays a baked clip, `Hold`, for
  every held thing (`setHeld`). It should apply the occupant's pose through
  `createHandPoser`. The hand model URLs are written twice
  (`HAND_MODELS` there, `HAND_MODEL_URLS` in `common/hand-pose.js`);
  dedupe when that lands. See `holding.todo.md`.
- **A trigger finger.** `blendPoses` exists. A gun's grip pose with the
  index closing as the trigger is pulled is `blendPoses(grip, pulled,
  trigger)`. Cheap and sells a lot; needs the trigger value from the hand.
- **Hand tracking.** WebXR hand tracking reports its own joints. Whether a
  held thing then uses the player's real fingers or our pose is undecided;
  the pose is the safe default (a tracked hand's fingers wobble).
  Pinch-to-grab already exists as a position-only path.
- **Finger collision.** Nothing stops a fingertip going into the model.
  Fine for now: the placement is authored by eye.
- **Better thumbs.** Only the pinch needed a hand-searched thumb. If more
  poses want opposition, an "oppose to index/middle/ring/pinky" helper
  (solve the thumb joints to meet a fingertip, as the pinch search did)
  would save sliding by hand.
- **Poses used by name in menus.** `label` is stored for this (so a
  weapon-grip menu can offer "Pistol grip") but nothing reads it yet.
