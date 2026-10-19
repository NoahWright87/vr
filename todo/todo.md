# Pistols at Dawn: the game plan

This folder is the plan for turning Pistols at Dawn from a sandbox of
systems into a complete game, with a journey you can follow and a
place to goof off with friends. It came out of a long design
conversation; the decisions below were made in that conversation, so
treat them as settled unless playtesting says otherwise.

How this folder relates to the rest of the repo:

- **`DESIGN.md`** (repo root): how the systems work and why. The
  "build systems, not features" bet applies to everything here.
- **`TODO.md`** (repo root): smaller deferred items across the whole
  repo. Still in use. It may move into this folder one day as topic
  files (`menus.todo.md`, `liquids.todo.md`, ...).
- **`todo/*.todo.md`**: this plan. `todo.md` (this file) is the big
  picture. Each `<topic>.todo.md` holds the design decisions for one
  area. Each `phaseNN[-x].todo.md` is one chunk of work, in order.

## The premise

**You're a ghost, and Ghost Town is a ghost tourist trap.** Everybody
there is dressing up and playing cowboy, and it's all a bit
ridiculous. That one premise explains a lot that was already true:
floating hands, teleporting between buildings, being able to drink
fire. It also gives us the rules:

- **Ghosts can't be hurt, so there's no gore at all.** Bullets pass
  straight through a ghost.
- **What you *can* lose is your cowboy costume.** Your hat, belt,
  boots, gloves and so on are your health bar. Every worn item is a
  hit, and a ghost with nothing left on has lost. See
  `wardrobe.todo.md`.
- **Everyone else is in on the act.** Training targets are cardboard
  cowboy cutouts at the "Wild West Experience." The challengers are
  ghost actors and fellow tourists. The wanted posters are the
  attraction's "Duel a Legend" program. You start in a rental
  costume.

## The name is the joke, and the content engine

Every challenge is "[weapon] at [time] in/on [place]", phrased for fun
with alliteration, rhymes and puns. Some are serious ("Pistols at Dawn
Downtown", "Knives at Night in the Bar") and some are ridiculous
("Cannons at Midnight on the Moon"). That's three decks of cards plus
modifiers, and every mission, PvP match and unlock is a combination of
them. See `deck.todo.md`.

## Two ways to play, one world

- **The journey (single player):** training duels against pop-up
  cardboard cowboys, then AI duelists from the wanted posters, each
  with a quirk. Beating them earns money and unlocks their weapon,
  place or modifier for your deck. You need direction to stick with a
  game, so the journey always has a next poster.
- **Hanging out (2–4 friends):** goof around town, duel each other,
  roll a random ridiculous duel, or team up against AI later on. Each
  player has their own play space, within shouting distance or over
  Discord. No matchmaking, no strangers, no in-game voice chat.

## Pillars

1. **Systems, not features** (DESIGN.md). Wardrobe hits, style
   scoring and duel signals are all built on events the systems
   already announce.
2. **Party-game balance.** Doing badly should make you harder to hit
   (stolen clothes, see `wardrobe.todo.md`), not lock you out. Casual
   rules by default. Hardcore is an option.
3. **Credit for anything.** The style system rewards variety and
   showing off. Losing while being way cooler is a real outcome. See
   `style.todo.md`.
4. **Pain to use, never boring to wait.** Awkward weapons (muskets,
   hand-loaded cannons) are welcome. Dead air isn't.
5. **Money flows constantly.** Easy to earn, fun to spend, lots of
   cosmetics, few on display at a time. See `economy.todo.md`.
6. **Comfort is non-negotiable.** The game never moves the camera
   (DESIGN.md "Rules learned the hard way"). Anything that moves the
   player (parade floats, paces) has to respect that.
7. **Gameplay first, polish last.** Art, audio and voiceover come from
   asset bundles and recordings near the end. Until then, simple
   shapes and text are fine.

## Decisions so far

| Area | Decision |
|---|---|
| Health | Worn costume items. All hit zones the same size, so cosmetics never affect gameplay. |
| Changing clothes | Only on purpose: at the clothier, or in the watch menu. Never by accident mid-fight. Tipping your hat is allowed and always snaps back. |
| Default PvP rule | **Conservation of clothes**: shooting an item off someone sends it to your matching empty slot if you have one. See `wardrobe.todo.md` for the other rule options. |
| Explosions | Hurt you through shrapnel and fire projectiles only, never a blast radius, so explosives aren't strictly better than everything else. |
| Fire on clothes | A burning item pops off after a couple of seconds unless you pat it out or douse it. |
| Knocked out | Casual default: you go to Boot Hill with a lame slow gun, and get back in by shooting gear off someone (Bomberman style). Can be turned off for sudden death. |
| Players | 2–4. Room codes only. Bring your own voice chat. |
| Unlocks | The host's unlocks apply to the room. Anything unlocked while playing together unlocks for everyone present. |
| Money | Shown as `$`. Plenty of it. Rotating shop. Expensive silly items and town upgrades give you something to save toward. |
| Voices | Animal Crossing-style gibberish generated from text with per-character presets, plus recorded lines for key moments. See `cast.todo.md`. |

## Topic files

- `wardrobe.todo.md`: clothes as health, slots, rules, fire and shrapnel.
- `dueling.todo.md`: duel rounds, start signals, false starts, training targets, AI duelists, Boot Hill.
- `style.todo.md`: trick and style scoring.
- `economy.todo.md`: money, the clothier, catalog, money sinks, town upgrades.
- `multiplayer.todo.md`: 2–4 friends, who owns what, what syncs.
- `deck.todo.md`: weapons × times × places × modifiers, naming, Roll the Duel.
- `cast.todo.md`: characters, procedural characters, the voice engine.

## Phases

Files named `phaseNN-a`, `phaseNN-b`, ... can be worked on **at the
same time** by separate sessions. Each one lists what it may touch and
what it must leave alone. A phase starts once the phase before it is
merged. Phases 01–03 are detailed. Phase 04 onward is deliberately
sketchy and should be rewritten once the earlier phases have been
played.

| Phase | Tracks (parallel) | Outcome |
|---|---|---|
| 01 | A: wardrobe slots · B: duel framework · C: player profile & save | The foundations, each testable alone |
| 02 | A: training duel series · B: style v0 · C: clothier v0 | A complete single-player loop: train, earn, dress up |
| 03 | A: first AI duelist · B: two-player network duel | Real opponents, both AI and human |
| 04 | Sketch | Wanted-poster campaign, wardrobe rule options, Boot Hill, shrapnel and burning clothes, 3–4 players, voice engine |
| 05+ | Sketch | The deck and Roll the Duel, zany places, moving platforms, co-op shootouts, town upgrades, polish |

Every phase follows the repo's testing rule (CLAUDE.md): drive the
real code paths with Playwright, not shortcut method calls, and record
anything that needs a headset to judge.
