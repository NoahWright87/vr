# Brawlers: what exists

Rock 'Em Sock 'Em robots that surround you and take swings, for
practising a fist fight against a group: punch one, block another,
parry one into its friend. Code: `common/brawlers.js` (A-Frame shell),
`common/brawler-core.js` (pure, tested by `tests/brawler-core.test.js`).
Showcase: the Action Lab's brawl (`primitives/actions/brawl.js`) and the
line of robots at the dummies station.

## The robot (`brawler`)

- **Body.** Raw THREE boxes sharing one unit `BoxGeometry` (no per-part
  `a-entity`), on a group that pivots at the feet: pedestal, legs,
  torso, head with an eye slot. About 1.6 m tall at size 1.
- **Arms.** Two segments and a fist each, posed by two-bone IK
  (`solveTwoBone`) with the elbow bent toward a pole out and down. At
  rest the fists sit by the chin, so the arms make a V guard. Every
  kind has them, punching or not.
- **Punch.** In the `combat-attacks` contract (`defense.spec.md`):
  - *windup* (`windupMs`): the arm draws back and the fist flashes red.
    It tracks your head or chest. `attack.late` turns on halfway, so the
    magnetic guard starts pulling a moving hand onto the line.
  - *active* (`activeMs`): the aim locks. The fist drives from the
    wind-up to the aim point, the body lunges up to 0.22 m, and the arm
    may stretch up to 30% to reach. Step out of the line to dodge.
  - *recovery*: 450 ms, then back to guard. Hitting it during the windup
    interrupts the punch.
  - Outcomes: **hit** hurts you (`player-hurt`). **Block** shoves it back
    0.9 m/s. **Parry** shoves it back hard (`parryShove`), hit-stops it
    100 ms, and opens it for 1.5 s (blue body, priority 1, so the next
    punch picks it).
- **Being hit.** The body flashes white and is knocked back along the
  hit (`force × 1.3 × knock`, divided by the kind's weight). It rocks on
  a spring about its feet. At zero health it falls over backwards (the
  zones go with it, and it can't be targeted) and stands back up after
  `resetMs` (3 s) at full health. Team `enemy`, so guns and throws hit
  it too. Zones: head ×1.5, torso, legs ×0.6.
- **Kinds** (`KINDS`):

  | kind | colour | health | swings | windup / active | speed | damage | size / weight |
  |---|---|---|---|---|---|---|---|
  | boxer | red | 4 | yes | 650 / 260 ms | 1.0 | 1 | 1 / 1 |
  | quick | yellow | 2.5 | yes | 420 / 200 ms | 1.4 | 0.5 | 0.9 / 0.8 |
  | brute | purple | 8 | yes | 900 / 340 ms | 0.7 | 2 | 1.15 / 1.8 |
  | blocker ("bag") | blue | 5 | never | | 0.9 | | 1 / 1.2 |

- **On its own** (not in a ring): `rail` slides it back and forth that
  many metres along its local X at `railSpeed`. `engage` makes it swing
  every `intervalMs` while you're within that distance.

## The ring (`brawl-ring`)

At the scene root. It spawns `count` robots (`mix`: `mixed` or one kind)
3.7 m out, all round you, and they walk in. Each frame:

- **The centre follows you** (smoothed), so they surround you wherever
  you stand.
- **Turns, beat-'em-up style.** At most `attackers` are *engaged* at
  once, and one new turn is handed out every `pace` seconds. It goes to
  a puncher you can see (within 70° of your gaze, unless `flank`),
  favouring the one nearest your gaze. An engaged robot walks in to
  `engageRadius` and swings when it's within `engageRadius + 0.2`. Its
  turn ends after its attacks (quick 3, boxer 2, brute 1) or after 6 s.
- **The queue.** Behind each engaged robot, the nearest free one lines
  up at `engageRadius + 0.8`, waiting for its turn. That's who a parry
  sends it into.
- **Circling.** The rest circle at `holdRadius` (bags 0.5 m closer),
  drifting at `orbit` rad/s and pushed apart (`spreadAngles`) so they
  surround you rather than bunch up.
- **Pile-ups.** Bodies are discs on the floor (`collideDiscs`). Walking
  into each other only nudges them apart. If a knocked-back robot hits
  another faster than 1.2 m/s, 70% of its momentum passes on, and both
  take `impact × impactDamage` (source `impact`). That's enough to knock
  a quick one down.
- **Parry aim.** A parry's shove bends onto a standing robot within
  `shoveCone` (60°) of straight back and within 2.4 m, and it's hard
  enough to reach. The robot behind is usually the queued one. This is
  a world-side cheat, so the pile-up you meant actually happens.

## In the Action Lab

- **Brawl**, off by default. B on desktop, or the visor's Brawl row.
  Tuning ▸ Brawl: Robots, Kinds, At once, Pace, Circle at, Swing from,
  Flank, Knockback, Parry shove, Pile-up damage.
- **Dummies line** (right station, behind the peg dummies): a bag on a
  0.8 m rail, a quick jabber on a rail that swings, a boxer that swings
  within 1.1 m, and a brute that only takes punches.
- **Debug ▸ HUD ▸ Brawl** shows how many are up, knockdowns, pile-ups
  and who is engaged. The action log shows "parried X — shoved into
  Y", "X crashed into Y (n m/s)" and "X is down".

## Tested

`tests/brawler-core.test.js` covers the IK (lengths, V bend,
straightening), the ring spread (including across ±π) and disc
collisions (gentle separation, momentum transfer, impact). In headless
Chromium:

- The ring surrounds you, takes turns and lands hits.
- Desktop jabs knock robots down.
- The brute falls and stands back up.
- The rail bag moves.
- Each parry resolved through `combat-attacks` shoves into the queued
  robot, and pile-ups knock robots down.
