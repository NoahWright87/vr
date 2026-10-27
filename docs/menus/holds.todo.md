# Hold to confirm, and stick dead zones: todo

Decided-on next steps. See `holds.spec.md` for what exists.

- **Tune the times in a headset.** The defaults (220 ms in, 420 ms back,
  380 ms act, 1500 ms serious) were chosen on paper. If going in feels sluggish
  when you know where you are going, shorten `enter` before anything else;
  `back` should stay noticeably slower than `enter`. Change
  `MENU_DEFAULTS.holds`, not individual pages.
- **Tune the dead zones in a headset**, with a drifting controller and a good
  one. Medium's 0.5 move and 0.8 menu step are the guess. If Medium still drifts
  for the controller that prompted this, raise Medium rather than telling people
  to pick Large.
- **A haptic tick while the wheel fills**, not only when it completes — the
  same felt progress the ring gives your eyes, for when you are looking at the
  row rather than the ring. Keep it faint; `pulseHaptics` is already imported.
- **Touch and desktop gamepad.** Phones drive rows by tapping (immediate except
  serious rows, via the pointer path) and the gamepad goes through
  `input-router`. Neither has the drift problem in the same way, but the
  gamepad's sticks do drift: decide whether it should read `stick-drift.js`
  too.
- **Mark the serious rows across the games.** Only the visor's `Exit VR`, the
  toybox's `Put ALL toys away` and the Basics demo use `hold: 'long'` so far.
  Candidates: Pistols' reset/clear rows, multiplayer `End session`, any "reset
  settings" row.
