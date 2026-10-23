# Guns: what exists

- `common/gun-core.js`: what each weapon is, and fire control. Pure,
  tested by `tests/gun-core.test.js`.
- `common/autofire-core.js`: turning toward a target within a cap.
  Pure, tested by `tests/autofire.test.js`.
- `common/guns.js`: the `gun`, `gun-hands` and `gun-rack` components.

They're shown at the Action Lab's range: a table of guns between you
and the target gallery. What's next is in `guns.todo.md`.

## Weapons (`WEAPONS` in `gun-core.js`)

| | Mag | Fires | Rate | Damage | Notes |
|---|---|---|---|---|---|
| **Pistol** | 12 | semi: every pull, ≥ 35 ms apart | 6/s autofire | 1 | |
| **SMG** | 30 | full: on the pull, then 13/s while held | 13/s | 0.6 | 1.5° spread |
| **Shotgun** | 6 | semi, pump-limited to ≥ 280 ms | 1.6/s autofire | 0.7 × 6 pellets | 6° spread, a `boom`, big recoil |

Thrown, a gun does 3 damage (shotgun 4).

**Fire control** (`createFireControl`, `pressTrigger`, `releaseTrigger`,
`heldShots`):

- Every shot spends a round; empty clicks dry.
- Pulls faster than the minimum interval are dropped, not queued.
- A frame never fires more than 4 shots, even after a hitch.
- `pelletDirections` spreads a shotgun's pellets: the first one goes
  straight.

## `gun`

One entity per gun. Its model is boxes, with −Z the barrel and the
grip at the origin. An **ammo bar** along its right side is green, then
amber below a third, red when empty. It has a state:

- **`rack`**: lying on its side in a table slot.
- **`held`**: each frame it sits at its virtual hand (drawn at the
  hand's scale, so smaller off a headset), and the hand shows a gun
  grip.
  - **Base aim** (Tuning ▸ Gun ▸ `Aim from`):
    - *Hand* (the default) is the controller's direction. In a headset
      the barrel is pitched `Grip tilt` (38°) below the grip axis,
      because WebXR's grip space points along the handle and A-Frame's
      own Touch laser points about 40° below it. Desktop hands point
      straight.
    - *Arm* is the shoulder→hand line, which is better for hand
      tracking.
  - **Assist** (always on unless set to Off): targeting's `gun` profile
    from the hand, along the base aim, inside the `Assist` cone (Tight
    12°, Soft 25°, Wide 45°), enemies only. The gun turns onto the pick
    at 1500°/s, never more than the cone + 5° off the base aim.
  - **Firing** (Tuning ▸ Gun ▸ `Fire`):
    - *Trigger* (the default): a pull fires at once. With a pick, the
      barrel snaps onto it and the first pellet is a **guaranteed hit**.
      Without one, the shot hits whatever zone its line meets, or
      misses with a tracer.
    - *Auto*: holding the gun presented with the barrel on a target
      fires at the weapon's rate, and the trigger is ignored.
    - *Both*: either one.

    The SMG fires while its trigger is held.
  - **Each shot:**
    - a flash, a tracer per pellet, and a `shot` or `boom` sound;
    - a `shot` haptic, stronger for the shotgun;
    - recoil kick on the gun only.

    A kill logs a line.
- **`flying`**: thrown or dropped, flown by `thrown-projectiles` (see
  `throwing.spec.md`). A thrown gun is **guided onto its target**,
  tumbles, bounces off what it hits (`throwDamage`, force 1.5), and
  falls.
- **`loose`**: on the floor after landing. It can be picked up (so can
  a gun still in flight). After `Loose life` (20 s) it shrinks away and
  is removed. That's Pistols' rule: a self-restocking rack is only safe
  because loose guns perish.

## `gun-hands`

```html
<a-entity gun-hands="rig: #rig; left: #left-virtual; right: #right-virtual; camera: #cam"></a-entity>
```

- **Grab** (Tuning ▸ Gun ▸ `Grab`):
  - *Grip* (the default): `gripdown` on the tracked hand takes the
    nearest grabbable gun within 20 cm of the virtual hand.
  - *Reach*: an empty hand lingering within 14 cm for 250 ms takes it.
    That's position-only, for hand tracking.
- **Trigger**: `triggerdown`/`triggerup` on the tracked hand go to its
  gun.
- **Let go** (`gripup`):
  - **Slow:** dropped with the hand's velocity.
  - **At least `Fling` (1.8 m/s):** **thrown**. The target comes from
    the `throw` profile along hand velocity plus gaze, and the flight is
    guided. With no target, the gun flies on the hand's velocity × 1.6
    plus loft.
- **The overhand whip** (the throw detector from `common/intent.js`)
  throws whatever gun the hand holds, so a position-only throw works
  too. The knife thrower stands aside for that hand (`vh.holding` /
  `vh.releasedGunAt`).
- **Readout `gun`:** per hand, the weapon, ammo, current target, shots
  and kills.
- **Desktop:** `G` / `H` reach the right / left simulated hand to the
  nearest gun within 1.1 m and squeeze (a real `gripdown`), or let go if
  holding. `Space` pulls the triggers of every hand holding a gun (a
  real `triggerdown`/`triggerup`). `T` is the whip.

## `gun-rack`

```html
<a-entity gun-rack="slots: pistol, pistol, smg, smg, shotgun; spacing: 0.2; respawnMs: 3000"></a-entity>
```

A table with one slot per entry, guns lying barrel-away. A slot whose
gun left `rack` restocks `respawnMs` later, popping in.

## Tuning ▸ Gun

| Row | Meaning |
|---|---|
| `Fire` | Trigger / Auto / Both |
| `Assist` | Off / Tight / Soft / Wide |
| `Aim from` | Hand / Arm |
| `Grip tilt` | barrel pitch below the grip axis, headset only |
| `Ammo` | Magazine / Infinite |
| `Grab` | Grip / Reach |
| `Fling` | release speed that counts as a throw |
| `Damage` | damage scale |
| `Recoil` | recoil scale |
| `Tracers` | on/off |
| `Loose life` | how long a loose gun lasts |

## Verified in headless Chromium

- Grabbing from the table with `G`.
- **14 pulls 45 ms apart fire 14 shots** (the old autofire was 4/s).
- Throwing the empty gun with `T`: guided into a gallery target, which
  goes down.
- The slot restocks; grabbing again works.
- The shotgun fires once per pull. With `Fire: Auto` and hands held out
  (`Q`), it emptied itself at targets (4 kills).
