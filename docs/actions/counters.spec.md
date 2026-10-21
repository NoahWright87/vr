# Counters: what exists

`common/counters.js`, called by the `combat-attacks` system
(`common/attacks.js`). Tested by `tests/counters.test.js`. What's next
is in `counters.todo.md`.

## The idea

This is Batman: Arkham's counter, in VR. You don't pick a move: you
move, and the game plays the best-looking move that fits what you did.
In VR the "button" is your body: which way the hand was going, how
fast, what the rest of you was doing. Doing nothing in particular still
gets you a block (the guard, `defense.spec.md`). Nothing scores you a
failure.

## When

For each incoming punch (not slow bullets), from when its attacker
sets `attack.soon` (brawlers 65% through the wind-up, the sparring
dummy 80%) through the first `parryWindow` (60%) of its drive. Each
frame, each hand not already doing a move, whose **real** position is
within `Reach` (50 cm) of the punch's line, is offered to every
registered counter. The best score above zero, over both hands, wins.

## A counter

```js
import { registerCounter } from '../common/counters.js';

registerCounter({
  id: 'swat', label: 'swatted aside',
  detect: function (ctx, settings) { return null /* or */ || { score: 0..1, /* anything perform needs */ }; },
  perform: function (ctx, found, settings) {
    ctx.hand.vh.perform('counter', point /* or a function */, ms, { pose: 'fist' });
    return { label, push, speed, openMs, intoFriend, stagger }; // the reaction
  },
});
```

Re-registering an `id` replaces it. `ctx`, all world space:

| field | what |
|---|---|
| `hand` | `{ side, position (virtual), real (tracked), velocity, speed, up, vh, other }`. Velocity is relative to your head, so walking doesn't swat. `up`: held up in a guard. |
| `other` | the other hand, same shape, for two-handed moves |
| `attack` | the attack record: `base`, `tip`, `aim`, `phase`, `progress`, `el` |
| `line` | `{ base, aim, length, dir (unit), flat (horizontal unit) }` |
| `grab` | the point on their arm (shoulder to fist, as it is now) nearest your hand |
| `distance` | hand to the line, m |
| `body` | `{ yawRate (deg/s), headVelocity, headHeight }`: room for spins, ducks, leans |
| `time` | scene time |

**The reaction** goes to the attacker as `onResolve('parry', r)` with
`r.move` (the id) and `r.reaction`. It's the attacker's job to act it
out:

- `push`: world `{ x, z }`, or null for "away from you";
- `speed` (m/s), `openMs` (how long it stays open, blue, for a harder
  counter-punch), `stagger` (tilt);
- `intoFriend`: bend the push onto a robot roughly that way.

The brawler does all of this. The sparring dummy treats any counter as
its old parry (stagger and open).

## The moves so far

- **Swat** (`detectSwat`): the hand sweeps sideways across the punch,
  horizontally, at least `Swat` (1.1 m/s), with at least 55% of its
  horizontal motion across the line. Your hand catches their arm and
  carries it 18 cm the way you swept, over 260 ms. They're shoved that
  way at `Shove` (3.6 m/s), into a friend if one is roughly there.
- **Meet** (`detectMeet`): the hand drives back along the punch at the
  attacker, at least `Meet` (1.6 m/s), at least 50% along it. Fist
  meets arm; they're knocked back at `Knock back` (3.2 m/s), into a
  friend behind if there is one.

Both open the attacker for `Opening` (1.5 s).

## Off a headset

Z / X sweep the right / left hand across your face, to your left /
right, through `semantic-hand.runWorldMotion`, so the counter reads it
the way it would read a headset. A click jab into a punch is a meet.
The desktop hands rest up in a guard, so they block on their own.

## Tested

The tests cover both detectors (direction, speed, vertical motion not
counting, moving with a punch not meeting it) and the registry (best
score wins, a new move slots in, re-registering replaces). In headless
Chromium:

- Resting hands guard-block, the hand snaps up to 28 cm out, and it's
  back at the controller within half a second.
- Z / X produce swats, one of them into another robot (a pile-up).
- Jabbing into the sparring dummy's punch produces meets, then
  counter-punches.
