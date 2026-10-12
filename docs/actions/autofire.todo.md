# Autofire guns

Full autofire. No trigger and no precise aim: hold a hand out roughly
toward the enemies and the gun in it kills them. Bullet-heaven logic: the
player stops aiming and becomes very powerful, so the game can throw far
more enemies at them.

## The loop

1. **Sense**: the gun hand is *presented*: extended beyond ~45% of
   forward reach with hysteresis (`motion-sense` already computes
   `presented`). A retracted hand is "at rest" and doesn't fire, which
   gives the player an off-switch with no button. Speed doesn't matter.
   You can fire while moving the hand fast.
2. **Resolve**: `combat-targeting.resolve('gun', { origin: shoulder,
   direction: shoulder→hand })`. Configurable "Aim need": `none` (any
   target in range, 360°), `soft` (wide cone, default), `cone` (narrow,
   still generous).
3. **Fire**: at the weapon's rate while a target exists. The shot is
   guaranteed: hitscan from the muzzle to the target's aim point, with
   spread applied only to the *visual* tracer, never the result. A miss
   only happens on purpose (no line of sight, out of range).
4. **Sell**: the gun turns toward the target through the virtual
   hand's rotation offset, capped (see `virtual-hands.todo.md`).
   Muzzle flash, tracer, impact sparks, a recoil kick on the virtual
   hand (never the camera), one haptic pulse, and a synthesized shot
   sound.

## Weapons are data

```js
{ id: 'pistol', rate: 4, damage: 1, range: 25, cone: 35, pierce: 0,
  multishot: 1, spreadDeg: 2, recoil: 0.6, haptic: [0.4, 30], sound: 'pistol' }
```

The bullet-heaven upgrades are fields, not code: rate, multishot (fan),
pierce (continue through to the next target on the line), ricochet (hop
to the nearest other target), crit (headshot chance). Pistols' shotgun
(`pellets`, `coneDeg`) becomes multishot plus spread.

## How the gun gets in your hand

For the POC, weapons are a **loadout**: the visor picks what each hand
holds and it appears there. No grabbing, no holsters.
Long term, decide between:

- always armed (pure bullet heaven);
- draw by reaching to the hip, position-only (dwell or a fast pass
  through a hip zone), like Pistols' holsters but with no grip;
- disarming enemies (see `defense.todo.md`).

## What to lift from Pistols (ideas, not globals)

All in `games/pistols-at-dawn/js/items-guns.js` unless noted:

- `fire()` (~line 1005) and `castShot` (`core.js` ~698): the shot
  contract and the `shot` event shape. Use the new `action-hit` event,
  compatible with it.
- `spawnTracer` (~85) and the muzzle effects: move to a shared pooled
  effects module (`feedback.todo.md`). Pistols' smoke/debris/spark
  spawners (`core.js` ~943–1000) are the pooling pattern.
- The recoil spring (`applyRecoilImpulse`, `RECOIL_*` constants):
  applied to the virtual hand.
- Barrel heat and the post-firing smoke curl: a nice touch, and cheap.
  Keep it.
- Not bracing, ADS or scope. Those are precision mechanics, the
  opposite of this design.

## Hands

Gun grip pose on the virtual hand. Two guns means two independent
loops, with targeting's `claimed` term splitting the targets between
them. Reloading is off by default (bullet heaven). A John-Wick-flourish
reload (bring the gun to the other hand, or drop it to your hip) is a
later option, and must still be position-only.

## Done when

On the Range station: hold both hands out at a row of silhouettes and
they go down in a satisfying sequence without you aiming. Lower your
hands and it stops. The visor tunes rate, cone, aim need and gun-turn
cap, and the readout shows the current target and score per hand.
