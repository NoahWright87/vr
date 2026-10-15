# Defense: what exists

- `common/attacks.js`: the `combat-attacks` system, slow bullets, and
  the pure `resolveContact` / `guardPoint`, tested by
  `tests/attacks.test.js`.
- `common/player-hurt.js`: what being hit does.
- `attacker-dummy` and the silhouette's `shootMs` in
  `common/dummies.js`.

They're shown at the Action Lab's Sparring station (behind you) and at
the Range (Tuning ▸ Range ▸ Shoot). What's next is in
`defense.todo.md`.

## The attack contract

An attacker registers an attack and moves it each frame:

```js
var attack = sceneEl.systems['combat-attacks'].begin({
  el, kind: 'thrust', phase: 'telegraph', base, tip, radius: 0.05, damage: 1,
});
attack.aim = point;        // where it's going (for the magnetic guard)
attack.late = true;        // late in the telegraph: the guard may start pulling
attack.phase = 'active';   // only active attacks resolve
attack.progress = 0..1;    // through the active window (parries need it early)
attack.onResolve = function (outcome, detail) { ... };
system.dodged(attack);     // the attacker says the active window ended untouched
system.end(attack);
```

`base`, `tip` and `aim` can be live `THREE.Vector3`s the attacker
updates in place. The strike volume is the capsule base→tip.

## Resolution, every frame, for each active attack

`resolveContact(attack, hands, body, settings)`, in order:

1. **block**: a virtual hand within `blockRadius` (10 cm) plus the
   attack's radius of the strike volume (the closest hand wins).
2. **parry**: that hand is also moving at least `parrySpeed`
   (1.6 m/s), **back along the attack toward the attacker** (cosine
   over 0.3), in the first `parryWindow` (60%) of the active window.
3. **hit**: the tip within the player's head sphere (camera, 13 cm) or
   torso capsule (the motion-sense torso point down 45 cm, 17 cm
   radius).
4. **dodge**: the attacker reports its window ended with none of these.

**On resolution:**

- **block / parry:**
  - a `block` or `parry` sound at the contact point;
  - the matching haptic on that hand's real controller;
  - sparks (blue for a parry);
  - a log line naming the hand and its speed.
- **hit:** `player-hurt.hurt(damage, point)`.

Every outcome goes to the `defense` readout.

## The magnetic guard

While an attack is late in its telegraph or active, any virtual hand
within `guardReach` (35 cm) of its line (`guardBase || base` → `aim`)
is pulled onto the nearest point of it, with weight 4 so it beats
melee's pull (1). The pull is granted by the comfort budget, so **a
still hand isn't pulled**: you have to move toward the attack. The hand
also shows an open palm (pose priority 3).

## Slow bullets

`system.fireBullet(from, to, ownerEl, speed?)`:

- A pooled small red sphere (never created per shot after warm-up)
  moving at Tuning ▸ Defense ▸ Bullets (7 m/s) on **world time**, so
  bullet time slows it.
- It's an **attack** each frame (the strike volume is last position →
  position; the guard line is the next half second of its path).
- It's also a **`combat-target`** (team `enemy`, priority 1, threat 1,
  one `core` zone), so **autofire shoots it down**: sparks, and
  "shot a bullet down" in the log.
- **block** knocks it aside, grey and harmless, and it falls.
  **parry** sends it back at its owner at 1.6× speed, blue; on
  reaching the owner it `applyHit`s with `source: 'deflect'`, damage 3.
  Either way it stops being a target.
- It expires after 5 s or below the floor.

## Player hurt: `common/player-hurt.js`

`sceneEl.systems['player-hurt'].hurt(damage, fromPoint)`:

- **A red edge flash drawn in clip space.** Its vertex shader ignores
  the camera, so both eyes match in a headset (Pistols' vignette
  technique). It fades over 450 ms.
- `hurt` haptics on both real hands (from the page's `motion-sense`),
  a thump, and a log line.
- **Never a camera shake or push.**
- Health counts down. At zero it logs "went down" and restores health,
  since there's no death yet.
- Tuning ▸ Player: `Health` and `Flash` strength. Readout `player`:
  health and hits taken.

## `attacker-dummy`

A trunk and head (zones `head`, `torso`) with one world-space arm. It
turns to face you, and only attacks while your head is within `engage`
(1.3 m, horizontal). The cycle, every `intervalMs` (2.6 s ± 25%):

1. **telegraph** (`telegraphMs`, 700 ms): the fist draws back behind
   the shoulder, flashing red. A faint red line shows the path, which
   tracks you. It aims at your head or torso (`aimAt`: mixed, head or
   torso).
2. **active** (`activeMs`, 280 ms): the line locks (step out of it to
   dodge) and the fist drives out to `reach` (1.0 m), eased out.
3. **recovery** (`recoveryMs`, 450 ms).

Being hit during the telegraph interrupts it. A **parry** staggers it,
gives it a 120 ms hit-stop, and **opens** it for `openMs` (1.2 s):
`combat-target.openUntil` is set, the arm glows blue, its priority
rises, and **melee hits on an open target are counters at 1.5× force**
("COUNTER" in the log). It never dies, and it's team `dummy`, so guns
leave it alone.

Tuning ▸ Sparring (lab): `Attacks` (on/off), `Every`, `Warning`,
`Strike`, `Reach`, `Aims at`. Tuning ▸ Defense: `Block`, `Parry`,
`Parry win`, `Guard`, `Bullets`.

## Shooters

`steel-silhouette`'s `shootMs` (and `target-spawner`'s): while standing
and alive, its head glows red for 500 ms, then a slow bullet leaves its
chest toward your head (±5 cm), with a `shot` sound. Tuning ▸ Range ▸
`Shoot`: Never, Slow (4.5 s) or Fast (2 s).

## Verified in headless Chromium

- Standing still in front of the sparrer gets you hit.
- Desktop jabs timed to its strike produce blocks and parries
  (`PARRIED sparrer (right hand, 3.2 m/s)`).
- Fast shooters hit you 7 times in 9 s with guns down. With guns up,
  the guns shoot bullets down and keep killing targets.

## Also attacking

The brawler robots (`brawlers.spec.md`) throw their punches through the same `combat-attacks` contract, so block, parry, the magnetic guard and dodging all work on them. A parried robot is also shoved back, into the robot queued behind it.
