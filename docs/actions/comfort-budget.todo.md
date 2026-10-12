# The comfort budget

The rule: **the faster you're physically moving, the more the game may
do without you noticing.** Stillness earns nothing.

**Built:** the hand-drift and return channels, view yaw (off by
default, no caller), the travel grant (no caller), the visor settings
and the ledger readout. See `comfort-budget.spec.md`. The design notes
below still explain why. What's left is at the bottom.

## The lesson it's built on

Punch Pop's lunge (`punch-locomotion.onPunch`) moved the rig whenever a
punch was detected. When detection was right, mid-punch, the slide felt
fine. When detection was wrong, it fired while the player stood
relatively still, and being moved while still is exactly what makes
people sick. Tuning thresholds never fixed it, because the problem was
structural: *permission* to move the player came from the classifier's
confidence rather than from the player's actual motion.

The fix is to separate them. A classifier may *request* an assist. The
budget decides how much of it is allowed this frame, based only on real
motion. A false positive while standing still then gets approximately
nothing, however confident the classifier was.

## Mechanism: gains, not offsets

Express every cheat as a **gain on real motion this frame**, never as a
displacement applied on its own:

- **Virtual hand drift**: the virtual hand may move toward its assist
  target by at most `k_hand × |real hand displacement this frame|`
  (plus a tiny floor). A still hand can't drift. A fast punch can be
  pulled several centimetres.
- **Re-centring** (virtual hand returning to the tracked hand) follows
  the same rule. It only catches up while the hand is moving, so you
  never watch your hand slide back. Exception: when the hand is outside
  the view frustum, snap it back freely, since nobody sees it.
- **View yaw**: at most `k_yaw × |real head yaw change this frame|`. The
  redirected-walking literature (Steinicke et al., 2010) puts
  unnoticeable rotation gains at roughly 0.67–1.24× of real head
  rotation. That's a sensible prior for the cap, though not
  verified for a combat context. Zero head rotation means zero view
  yaw, which already rules out Punch Pop's "turn" mode snapping while
  you're still.
- **Lunge / rig translation**: at most `k_move × real head travel`
  over the strike window. Movement is "solved" elsewhere, but an
  action-triggered displacement is an action's consequence and pays
  here. It goes through the locomotion API, never by writing the rig's
  position directly.

The `k_*` values are the tunables. Motion energy from `motion-sense`
scales them all through one master curve (`assist = curve(energy)`), so
there's one global "how much cheating" knob plus per-channel caps.

## Pure core

`comfort-budget` takes the motion-sense state plus this frame's
requested assists (`{ channel, hand?, desired: vector or angle }`) and
returns the granted portion of each, with the reason it was limited.
That's plain functions and plain numbers, tested with:

- a still trace: every grant is approximately 0 whatever is requested;
- a recorded jab: hand drift is granted and grows with speed;
- a head turn: yaw is granted within the gain cap, and hand drift is
  not, because the hand is still relative to the head.

## Visible and tunable

- Visor ▸ Comfort: master curve, each `k_*`, and per-channel on/off.
- Readout: energy, and per channel requested vs. granted this second
  (a running sum). "Assist wanted 9 cm, got 3 cm" is the most useful
  single line when a punch felt like it missed.
- Debug channel `assist`: draw the gap between tracked and virtual hand.

## Open questions, to answer in the headset

- Does a visible virtual/tracked mismatch break the feeling of owning
  the hand, even within the budget? This is the ghost-hand experiment
  in `virtual-hands.todo.md`.
- Is view yaw needed at all once the virtual hand can reach? Noah's
  instinct is "rotate the view very little". Start with `k_yaw = 0`
  and let the hand do the work.

## Still to do

- **Wire view yaw and lunge to callers**, if headset testing says
  they're wanted at all. Melee's assist is hand drift plus the target
  leaning in, and the yaw channel exists with gain 0 so it can be tried
  from the visor without new code once something requests it.
- **Use head-relative hand travel for drift?** Drift is currently
  earned by the hand's rig-local travel, so walking with your hands
  still earns drift (the hands do move through the room). If that
  turns out to be noticeable, earn it from head-relative travel
  instead.
- **Out-of-view recentring is binary** (offset snaps to zero when the
  real hand is more than 65° from gaze and nothing is requesting). A
  hand at the edge of view could visibly pop. Fade it in over ~100 ms
  if that's ever seen.
