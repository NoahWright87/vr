# Autofire: what exists

`common/autofire.js` (component), with its pure parts in
`common/autofire-core.js` (tested by `tests/autofire.test.js`), shown
at the Action Lab's Range station. What's next is in
`autofire.todo.md`.

```html
<a-entity autofire-gun="side: right; rig: #rig; hand: #right-hand"></a-entity>
```

The entity *is* the gun: a boxy pistol whose local −Z is the barrel. It
is **not** a child of the hand. Each frame it moves to the hand's
position and points along the shoulder→hand line from `motion-sense`,
so wrist rotation never matters and controllers, hand tracking and
desktop hands all aim it the same way.

## The loop, per frame per gun

1. **Sense**: the hand is `presented` (forward extension above
   `Present`, held until below `Lower`). This is the on/off switch: a
   lowered hand never fires.
2. **Resolve**: `combat-targeting.resolve('gun', ...)` from the
   shoulder along the arm, with the current target as `current`
   (sticky), the hand as `by`, and the cone from Gun ▸ Aim: Wide 70°,
   Soft 35°, Tight 15°.
3. **Turn**: the gun turns toward the target's aim point at
   `turnSpeed`, never more than the cone + 10° off the arm.
4. **Fire**: only once the barrel is within 4° of the target, at
   `rate` shots/s on **player time** (full rate in slow motion). The
   target is claimed every frame it's held, so the other gun prefers
   another.
5. **Guaranteed hits**: each shot calls the target's `applyHit` with
   `source: 'gun'`, `force: 0.6`, at the aim zone's surface facing the
   muzzle, or the head with `Headshot` probability. Spread only jitters
   the tracer. **Multishot** adds hits on the next-best candidates (the
   same target if there are none).
6. **Sell**: a muzzle flash, a tracer, a `shot` sound at the muzzle, a
   `shot` haptic on that hand, and a recoil kick (pitch and pull-back
   on a spring) on the gun only, never the camera. On a kill: a `kill`
   haptic and a log line.

## Tuning ▸ Gun

| Row | Meaning |
|---|---|
| `Hands` | Both, Right, Left or None |
| `Aim` | Wide, Soft or Tight cone |
| `Rate` | shots per second |
| `Damage` | per hit |
| `Multi` | multishot |
| `Headshot` | crit chance |
| `Turn` | turn speed, °/s |
| `Recoil` | kick strength |
| `Tracers` | on/off |

Readout `gun`: per hand, up or down, the current target and score, and
shots and kills. Debug channel `assist`: the arm's line (grey) against
the gun's actual direction (green).

## Desktop

In the Action Lab, `Q` (or the visor's `Guns up (Q)` row) moves both
simulated hands between held-out (forward 0.55 m) and at your sides,
through `desktop-hand-presence`. The hands travel at `semantic-hand`'s
speed, so `motion-sense`, presenting, targeting and firing all run the
real path. Mouse-look aims.

**Verified in headless Chromium:**

- raising the hands with Q presents both;
- five silhouettes die within about 3 s;
- lowering stops fire;
- walkers and shatter work;
- 0.25 slow-mo slows walkers fourfold.
