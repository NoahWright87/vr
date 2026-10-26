# Dueling

Duels are the core activity: the tutorial, the single-player journey
and the main PvP mode are all duels. Order of work, as agreed:
**training duels against pop-up targets first, AI duelists only once
those work.**

## The duel framework

A duel is data plus a small set of states each round goes through:

```
setup → waiting for the signal → live → resolved → results
```

A duel definition says:
- its title (the pun)
- how it starts (start signal)
- what you're up against (targets, an AI duelist, or players)
- the rules (rounds, wardrobe rule, false-start penalty, Boot Hill on
  or off)
- how it's scored, and what it pays

Adding a duel should mean adding data, not code. Everything announces
what happened (`duel-signal`, `duel-false-start`, `duel-round-end`,
...) so style, payouts and the announcer can listen in without the
duel code knowing about them.

## Start signals

Not every duel is "walk ten paces and turn." Signals plug in, and the
training series should teach several of them:

- **Ten paces**: the announcer counts and you turn on ten (see the
  open question about paces below).
- **Flag drop.**
- **Starter pistol**: someone fires a shot into the air.
- **The clock strikes noon**: the day/night cycle (`world-day-night.js`)
  already tracks time of day, but there's no clock tower yet.
- **A coin toss**: draw when it lands. Landing is already announced
  (`landed`), so this costs almost nothing.
- **"Draw!"**: shouted after a random delay.

## False starts

You start with your gun holstered and your hands off it. Drawing (the
holster already announces when a gun is grabbed out of it) or firing
before the signal is a false start. The penalty is set per duel:
forfeit the round, a style penalty, or nothing at all (for silly
modes). One AI character later **always** jumps the gun.

## Training duels (phase 01-B framework, phase 02-A content)

- Pop-up man-shaped **cardboard cowboy cutouts**. Build on the existing
  target components in `world-targets.js` (`pop-target`,
  `popper-target`, `target-group`, `scoring-ring`) where they fit.
- Once the wardrobe exists, the cutouts **wear costume items** and you
  shoot them off. That tests the wardrobe system before there's any
  AI.
- **Results:** reaction time (signal to first hit), accuracy, hits and
  misses, a medal (bronze/silver/gold sheriff's star), plus style
  (`style.todo.md`) once that exists.
- **Diegetic entry point:** the WANTED poster board already in the
  Sheriff's Office (`world-hub-interiors.js`) becomes the duel
  picker: training sheets first, then wanted posters. When you beat a
  poster it gets stamped.

## The fight ladder

The single-player direction: a ladder of fights against AI duelists
that **gets harder and harder** and **isn't on a timer**. You can
climb as fast as you're good enough (unlike shop stock, which rotates
by date, `economy.todo.md`). The WANTED board in the Sheriff's Office
shows it. Each poster is a fight: a character (`cast.todo.md`), a
combination of cards and modifiers (`deck.todo.md`), and a pun title.
Beat it and it's stamped, you're paid, and its cards may unlock for
your deck. The ladder is data, so new rungs and whole new ladders can
be added indefinitely (`town.todo.md` "Extension points").

## Weapons in a duel

A duel definition names its weapon(s). If it does, it hands them out
at setup and **takes over from your carried gear**, setting your own
guns aside and returning them afterwards (`deck.todo.md` "Weapons in a
fight"). A duel that doesn't name a weapon uses whatever you carry.

## AI duelists (phase 03-A onward)

The fixed ritual of a duel means the AI doesn't need cover or flanking
logic. A duelist is a ghost in a costume with a few settings:

- draw speed and reaction-time spread
- accuracy (and how much nerves or drinking spoil it)
- a **tell**: a visible twitch before drawing
- **nerve**: does it retreat to grab its hat back?
- a **quirk**, which is really the character (see `cast.todo.md`):
  - jumps the gun
  - shoots your hat on purpose every time
  - too drunk to aim
  - insists on loading a cannon by hand

It aims at your wardrobe hit zones and fires through the same shot
path the player uses, so its hits behave exactly like yours. Steps up
from there: duels, then gang duels (2v2, three outlaws on Main
Street), then co-op shootouts (phase 05+).

## Boot Hill (knocked-out players)

The casual default, which can be turned off for sudden death: once
you're stripped you go to **Boot Hill**, a spectator perch where you
can't just walk up to people. You get a **really lame, slow-firing
gun** (a cork pop-gun?). Shoot gear off someone and it flies to you,
and you're back in. That only works when gear flies to the shooter
(conservation of clothes). Under the other wardrobe rules, decide
whether Boot Hill hits send the item to you anyway.

## What phase 01-B built

The framework runs. Where things live:

- `games/pistols-at-dawn/js/duel-model.js`: pure round/match logic,
  signal plans, modifier stack, weapon-takeover orchestration, board
  text. No A-Frame; `tests/duel-model.test.js` runs under `node --test`.
- `games/pistols-at-dawn/js/duel.js` (persistent module): the catalog of
  duels as data (`DUEL_CATALOG`), the `duel-director` system, the gear
  swap and the modifiers (`time-of-day`, `fog`).
- `js/world-targets.js` (loads with the Range): `cardboard-cowboy`,
  `duel-lane` (cutouts, board, signal props), `duel-coin`.
- `tests/duel-range.browser.cjs`: Playwright through real input.

Facts worth keeping:

- **The model never reads a clock**; every call takes `now`. Signals are
  plans of timed steps (`signalPlan`), and a step either fires the signal
  or (`waitForEvent`) leaves it to the world, which is how the coin toss
  waits for `landed`.
- **There is no holster grab event.** The holster is 01-A's, and it
  announces nothing when a gun leaves it. The director polls every
  firearm's `holsterable.state` (`held`/`dangling` means drawn) only
  while a duel is running. If 01-A adds a real event, swap the poll for
  it.
- **Guns announce nothing when they fire either** (only the thing they
  hit gets a `shot`). `duel.js` wraps `firearm.fire` once to emit
  `gun-fired`; the one-line fix belongs in `items-guns.js` (TODO.md).
- **Hits meet through an adapter, not a fork.** The cardboard cowboy is a
  `steel-silhouette` (hit zones, rock-and-fall) with `shot` turned into
  `combat-target.applyHit` by nearest zone, and `action-hit` re-announced
  as `cutout-hit`. A knife or fist reaching the same `action-hit` is
  counted too.
- **Weapon takeover** sets guns aside by moving them into a hidden,
  closed `anchor-slot` (`#duel-stash`) with `vacateSlot`/`occupySlot`,
  and puts them back the same way. A gun that was in a hand goes back to
  the holster it was built for. A full holster does NOT stop a pistol
  falling through to the waist anchor, which swaps the belt off: a test
  that holstered into the wrong hip found this. 01-A's locked slots
  should make it impossible.

### Ten paces: what worked

Only the **plain count** was built (`signal: { kind: 'ten-paces',
stepMs }`): the board counts 1 to 10, ticks on each, and says TURN!.
Findings, headless only (nobody has stood in a headset for it yet):

- It asks for no space and moves nobody, so it can never break the
  comfort rule and works in every play space. That is why it is the
  one to ship first.
- It is the only option that fits the Range, where you already face the
  targets. "Turn" is pure flavour there; it only means something once a
  duel starts you facing away, which needs the facing check (below).
- Ten paces is about 7.6 m. Most play spaces can't walk that, so the
  **thumbstick-walk** option needs a visible ground marker and has to
  stay optional. It also has to decide what counts as "turned" and
  what happens if you stop early. Not built: it's a separate comfort
  conversation (the game never walks you), and the cardboard cowboys
  don't walk away to give it a reason.
- **AI walks off while you stand still** is a phase 03-A thing: there is
  no opponent that walks yet.
- Open for the headset: is text on the board enough to count by, or does
  it need the announcer's voice (cast.todo.md) before it feels like a
  ritual? The tick is a placeholder beep. Counting at 650 ms a pace
  takes about seven seconds; check that waiting that long, hands off the
  gun, isn't tedious. If it is, shorten `stepMs` or count in twos.

Next for paces: a "face away, turn on TURN" duel (check head yaw against
the lane), and the announcer counting aloud.

## Open questions

- **Ten paces in a living room.** You can't actually walk ten paces in
  most play spaces, and the game must never move you itself (comfort
  rule). Options:
  - both players walk with the thumbstick while the count runs, and a
    ground marker shows where "ten" is
  - only the AI walks off while you stand still facing away
  - paces is just a count that ends in "turn!"

  Try them in phase 01-B. **Tried, see "What phase 01-B learned" below:
  the plain count is built and is the default; the other two are not.**
- How many rounds by default: best of 3? (01-B's sample duel is best of
  3, a signal demo is a single round; both are just `rules.rounds`.)
- When the AI shoots, do you see the bullet or just your hat leaving?
