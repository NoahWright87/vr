# Pistols at Dawn: the game plan

This folder is the plan for turning Pistols at Dawn from a sandbox of
systems into a complete game: a place full of things to do, a ladder
of fights that gives you direction, and somewhere to goof off with
friends. It came out of a long design conversation. The decisions
below were made there, so treat them as settled unless playtesting
says otherwise.

How this folder relates to the rest of the repo:

- **`DESIGN.md`** (repo root): how the systems work and why. The
  "build systems, not features" bet applies to everything here.
- **`TODO.md`** (repo root): smaller deferred items across the whole
  repo, all prototypes. Still in use.
- **`docs/pistols-at-dawn/*.todo.md`** (this folder): this plan, and
  only for Pistols at Dawn. `todo.md` (this file) is the big
  picture. Each `<topic>.todo.md` holds the design decisions for one
  area. Each `phaseNN[-x].todo.md` is one chunk of work, in order.
- **`export-later/`**: code built here that's headed for its own repo
  (`export-later/README.md`).
- **`docs/actions/`**: the shared action primitives plan (melee,
  throwing, targeting, defense, dummies, comfort budget), built in
  `common/` and shown in `primitives/actions/`. Pistols should *use*
  those primitives where they fit rather than building its own. Check
  there before building any combat-feel system.

## The premise

**A western Pierhead Arcade, for ghosts.** You're a ghost, it's a ghost
town, and there's stuff to do. No story and no explanation; it's not a
serious game. You load in at the edge of town and go have fun.

Being ghosts gives us the rules:

- **Ghosts can't be hurt, so there's no gore at all.** Bullets pass
  straight through a ghost.
- **What you *can* lose is your cowboy costume.** Your hat, belt,
  boots, gloves and so on are your health bar. Every worn item is a
  hit, and a ghost with nothing left on has lost. See
  `wardrobe.todo.md`.
- Flavor, not lore: training targets are cardboard cowboy cutouts, and
  you start in a "rental" costume.

## The name is the joke, and the content engine

Every challenge is "[weapon] at [time] in/on [place]", plus modifiers,
phrased with alliteration, rhymes and puns. Some are serious ("Pistols
at Dawn Downtown", "Knives at Night in the Bar") and some are
ridiculous ("Cannons at Midnight on the Moon, twirl to reload"). Cards
mix and match, so every fight, PvP match and unlock is a combination.
See `deck.todo.md`.

## Ways to play, one world

- **Direction (single player).** Training duels against cardboard
  cowboys, then a **fight ladder** of AI duelists that gets harder and
  harder. It isn't on a timer: you can climb it as fast as you're good
  enough. You need direction to stick with a game, so there's always a
  next fight.
- **Collecting.** Shops rotate their stock by the real date, Animal
  Crossing style. What you buy goes into your wardrobe for good, so your
  collection grows over time. See `economy.todo.md`.
- **Activities.** Saloon games, trick shots, target challenges, horse
  care and racing, lassoing, poker, five finger fillet. Some have their
  own progression. See `activities.todo.md` and `animals.todo.md`.
- **Hanging out (2–4 players).** Goof around town, duel each other,
  roll a ridiculous duel, ride around and get into shootouts with NPCs.
  Separate play spaces within shouting distance, or over Discord. No
  matchmaking, no strangers, no in-game voice chat. Family members
  without a headset should be able to join from a laptop or phone
  eventually (`platforms.todo.md`).

## Pillars

1. **Systems, not features** (DESIGN.md). Wardrobe hits, style scoring,
   duel signals and expressions are all built on events the systems
   already announce.
2. **A living project with no dead ends.** It'll keep growing like a
   live-service game. Every kind of content (buildings, places,
   activities, fights, modifiers, cosmetics, characters) is added as
   data plus at most one new builder. See `town.todo.md` "Extension
   points".
3. **Interactive by default.** If something in the world could be
   interactive, make it interactive.
4. **Party-game balance.** Doing badly should make you harder to hit
   (stolen clothes), not lock you out. Casual rules by default, hardcore
   as an option.
5. **Credit for anything.** The style system rewards variety and
   showing off. Losing while being way cooler is a real outcome. See
   `style.todo.md`.
6. **Pain to use, never boring to wait.** Awkward weapons and zany
   rules are welcome. Dead air isn't.
7. **Money flows constantly.** Easy to earn, fun to spend.
8. **Comfort is non-negotiable.** The game never moves the camera on
   the player's behalf (DESIGN.md "Rules learned the hard way").
   Horses, wagons, floats and paces have to respect that.
9. **Cute and friendly, despite the extreme violence.** Pac-Man-style
   ghosts with simple, very expressive faces (*Move or Die* is the
   reference). See `aesthetic.todo.md`.
10. **Gameplay first, assets later.** Anything we use now is marked as a
    placeholder and gets swapped later. Gameplay never depends on how
    an asset looks.
11. **Make headset time count.** Every PR carries a playtest checklist,
    and anything tunable without a headset gets a non-VR tool page
    (`process.todo.md`).

## Decisions so far

| Area | Decision |
|---|---|
| Story | None. A place to have fun. |
| Start | You load in at the edge of Ghost Town. |
| Health | Worn costume items. All hit zones the same size, so cosmetics never affect gameplay. |
| Changing clothes | Only on purpose: at the clothier, or in the watch menu. Never by accident mid-fight. Tipping your hat is allowed and always snaps back. |
| Default PvP rule | **Conservation of clothes**: shooting an item off someone sends it to your matching empty slot if you have one. See `wardrobe.todo.md` for the other rule options. |
| Explosions | Hurt you through shrapnel and fire projectiles only, never a blast radius. |
| Fire on clothes | A burning item pops off after a couple of seconds unless you pat it out or douse it. |
| Knocked out | Casual default: Boot Hill with a lame slow gun, and back in by shooting gear off someone (Bomberman style). Can be turned off. |
| Progression | A fight ladder that isn't on a timer, shops whose stock rotates by date, and per-activity progression (e.g. horse care). |
| Weapons | You customize the guns you carry around. A duel can supply its own weapons, which take over from yours for the duel (catapults today, so your gold shotgun waits). |
| Players | 2–4. Room codes only. Bring your own voice chat. Non-VR players eventually. |
| Unlocks | The host's unlocks apply to the room. Anything unlocked while playing together unlocks for everyone present. |
| Money | Shown as `$`. Plenty of it. Big-ticket silly items and town upgrades give you something to save toward. |
| Buildings | Saloon full of activities, Sheriff's Office (wanted posters, ladder), clothier, stable, farm. Other buildings can just be shootout locations. A wagon reaches places off the strip. |
| Look | Cute Pac-Man ghosts with expressive faces. All current assets are placeholders, tracked in a manifest. |
| Platforms | VR first. Mouse/keyboard, phone and gamepad eventually, via shared code. Nothing Quest-specific. |
| Distribution | A silly game on the site. No store plans. |
| Voices | Animal Crossing-style gibberish generated from text with per-character presets, plus recorded lines for key moments. A standalone package with a non-VR Voice Lab (`phase01-z`). |

## Topic files

- `town.todo.md`: the strip, building purposes, the wagon, **extension points**.
- `activities.todo.md`: things to do, and the shared activity contract.
- `animals.todo.md`: horses (riding, care, racing) and the farm.
- `wardrobe.todo.md`: clothes as health, slots, rules, fire and shrapnel.
- `dueling.todo.md`: duel rounds, start signals, false starts, training, the fight ladder, AI duelists, Boot Hill.
- `deck.todo.md`: weapons × times × places × modifiers, naming, Roll the Duel.
- `style.todo.md`: trick and style scoring.
- `economy.todo.md`: money, rotating shops, the collection, gun customization.
- `multiplayer.todo.md`: 2–4 players, who owns what, what syncs.
- `cast.todo.md`: characters, procedural characters, the voice engine.
- `aesthetic.todo.md`: look and feel, expressions, placeholder assets, licensing.
- `platforms.todo.md`: VR and non-VR play, comfort, non-VR tools.
- `process.todo.md`: PR playtest checklists, the Utilities section.

## Phases

Files named `phaseNN-a`, `phaseNN-b`, ... can be worked on **at the
same time** by separate sessions. A **`-z`** track is standalone:
nothing depends on it, it depends on nothing, and it can start any
time, whatever phase the rest of the work is in. Each file lists what
it may touch and what it must leave alone. A phase starts once the
phase before it is merged. Phases 00–03 are detailed. Phase 04 onward
is deliberately sketchy and should be rewritten once the earlier
phases have been played.

| Phase | Tracks (parallel) | Outcome |
|---|---|---|
| 00 | a: PR template · b: Utilities section · c: placeholder-asset manifest | Housekeeping that makes everything after it easier |
| 01 | A: wardrobe slots · B: duel framework · C: player profile & save | The foundations, each testable alone |
| 01-Z | Standalone: voice engine + Voice Lab page | Character voices you can tune in a normal browser |
| 02 | A: training duel series · B: style v0 · C: clothier v0 · D: expressive ghosts + Ghost Lab | A complete single-player loop: train, earn, dress up, with faces |
| 03 | A: first AI duelist · B: two-player network duel | Real opponents, both AI and human |
| 04 | Sketch | The fight ladder, modifiers, activity framework, wardrobe rule options, Boot Hill, shrapnel and burning clothes, 3–4 players, voices in the game |
| 05+ | Sketch | Roll the Duel, the wagon and off-strip places, horses and the farm, more activities, co-op shootouts, non-VR players, swapping in real assets |

Every phase follows the repo's testing rule (CLAUDE.md): drive the
real code paths with Playwright, not shortcut method calls. Every PR
lists what needs a headset as a playtest checklist (phase 00-a).
