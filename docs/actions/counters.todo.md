# Counters: what's next

Two moves exist (`counters.spec.md`). The user's direction is that this
grows into **lots** of moves, chosen by how you move. It's a sneaky
fitness game that rewards silliness. Keep the registry open, and keep
each move self-contained: detect, perform, reaction.

## Moves the user has asked for

None of these are built. Each needs what's listed after it.

- **Grab and shove** (one hand swept sideways): built as Swat.
- **Spin throw**: a sideways sweep *with the body turning*. Grab the
  arm, and as you turn, they're thrown around you and away. Reads
  `body.yawRate`. Needs a thrown-in-an-arc reaction on the brawler.
- **Pull down and knee**: the hand comes *down* onto the punch. Grab,
  pull them down, and your knee comes up into their chin. Needs player
  legs (below) and a pulled-down reaction.
- **Spartan kick**: lean back as it comes. They're launched away. Reads
  head velocity backward. Needs legs.
- **Knee, then kick**: down, then lean back. A sequence: one move
  leading into another.
- **Parry then dislocate**: one hand parries, and the *other* hand
  strikes the shoulder. Two-handed: reads `ctx.other`.
- **Two-handed grab and throw**: both hands converge on the punch.
- **Heads together**: grab two attackers (two punches at once, one per
  hand) and bring the hands together. Needs a move that resolves two
  attacks at once.
- **Leg sweep**: squat (head drops fast). Their legs go out from under
  them.
- **Jump kick to the face**: jump (head rises fast).
- **Roundhouse**: any big spin.

The last three aren't counters to a punch. They're attacks you start
(`melee.todo.md`), but they should come from the same move registry
and the same kind of motion reading.

## What's needed for that

- **Defining moves well.** Deferred by the user: "eventually we'll need
  a good way to define these moves and how to detect them". For now a
  move is code: `detect` and `perform`. When there are 6–10 of them,
  look for what repeats. Likely candidates:
  - **motion features**: hand direction relative to the punch, body
    turn, lean, drop, rise, both hands converging;
  - **a little timeline** for perform: reach, hold, carry, release, as
    data;
  - **reactions as named animations** on the attacker (pushed,
    thrown-arc, pulled-down, launched, crumple).

  Recording real headset motion for each move would give test fixtures
  (see `intent.todo.md`).
- **Player legs.** A knee or kick drawn from roughly your hip, for the
  duration of the move. Nothing draws a body for the player now.
- **Body motion in `motion-sense`.** It has `yawRate` and head
  velocity. Add *lean* (head moving relative to the estimated hips),
  *drop* and *rise* (squat, jump), filtered so looking around doesn't
  count.
- **Brawler reactions** beyond being shoved: grabbed (follows your hand
  for the move), thrown in an arc, pulled down, launched.
- **Slow-mo on a counter.** The action clock exists; a short
  time-scale dip as a counter lands would sell it. Arkham does this.
- **Moves that start from your attacks**, not their punches. The same
  registry, with a different trigger.

## To try in the headset first

- Does Swat fire when you mean it, and not when you're just guarding?
  The `defense` readout counts swats and meets. Tune Counters ▸ Swat
  and Reach.
- Is the counter window right? It's the end of the wind-up and the
  start of the drive. Too early reads as precognition; too late and
  the guard has already taken the hand.
