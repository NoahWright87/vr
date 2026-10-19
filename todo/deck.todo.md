# The deck: [weapon] at [time] in/on [place]

The name *is* the shtick. Every challenge is a combination of cards,
phrased with wordplay, alliteration or rhyme:

- Serious: "Pistols at Dawn Downtown", "Rifles at High Noon in the
  Desert", "Knives at Night in the Bar"
- Ridiculous: "Cannons at Midnight on the Moon", "Ninja Stars on
  Christmas Morning", "Flamethrowers at Rush Hour on the Bridge",
  "Muskets on Parade Floats at the Thanksgiving Parade"

## The four decks

- **Weapons**: a normal batch (pistols, rifles, knives, bows) and a
  zany batch (cannons, muskets, ninja stars, flamethrowers). Much of
  this exists already (`items-*.js`). The rest is in TODO.md "Weapons
  not built yet".
- **Times**: dawn, high noon, dusk, midnight, Christmas morning, rush
  hour... Time of day is mostly already a dial (`world-day-night.js`).
- **Places**: Main Street, the saloon, the desert, the bridge, the
  moon.
- **Modifiers**: low gravity, snow, fog, everyone's drunk, moving
  platforms.

## Cheap places

A lot of places should be **an existing map plus modifiers**, not a
new map:

- The moon = the desert + low gravity + black sky.
- Christmas morning = town + snow + lights.
- Rush hour = a road with moving traffic to dodge.

Each new map costs work and frame rate on a Quest, and a modifier is
mostly data.

## How decks connect to the journey

- **Single player is how you collect cards.** Beat a wanted-poster
  character and their signature weapon, place or modifier goes into
  your deck.
- **The host's deck sets what the room can use** (`multiplayer.todo.md`).
- **Roll the Duel**: a slot machine for PvP. Pull the lever, get
  "Flamethrowers at Rush Hour on the Bridge." Re-rolling is half the
  fun.
- The ridiculous stuff should never be stuck behind a grind for a
  visiting newbie. The host's deck covers that.

## Rules of thumb

- **Pain to use, never boring to wait.** Slappers Only worked because
  everyone was equally bad *and* rounds were short. Zany weapons need
  short rounds, quick resets, and the AI stuck with the same weapon.
- **Moving platforms (parade floats) are a comfort risk.** Being moved
  by something you don't control can cause motion sickness. Keep them
  slow and steady, no sharp turns, give players a railing or frame to
  look at, and add a comfort option. Moving surfaces already carry
  objects (the revolving bar, DESIGN.md), so most of the system
  exists.
- **Titles are generated from cards, then improved by hand.** A
  generator that likes alliteration gives you combinations. Story
  duels get handwritten titles.

## Not before phase 05

Roll the Duel, the zany batches and most modifiers. Phases 01–04 only
need the *shape*: a duel definition names its weapon, time and place.
