# The town: a strip that keeps growing

The game is a place, not a story. You load in at the edge of Ghost
Town and there's stuff to do. Think of it as a **living project**,
like a live-service game: it keeps getting new buildings, activities,
fights and places for years. So the main job of the town's structure
is to **never paint us into a corner**.

## Decisions

- **You start at the edge of Ghost Town.** No intro, no tutorial
  stagecoach. Good enough for now. Revisit only if new players keep
  getting lost.
- **The strip grows by adding buildings.** Each building is one
  manifest entry in `TOWN_LOCATIONS` (`js/world-town.js`), one
  fragment in `areas/` and its builder script(s). That's already how
  it works (DESIGN.md "File structure"), so adding a building costs
  nothing structurally. Keep it that way.
- **A wagon takes you to places off the strip**: the desert, the
  canyon, the train, the moon. It's the same idea as the teleport
  menu, wrapped in something you can see and ride. It gives unlimited
  room for shootout locations without making the strip itself long.
  How it moves you has to follow the comfort rules (`platforms.todo.md`):
  fade out and back in, or a slow steady ride with a frame to look at.
- **Interactive by default.** If something in the world could be
  interactive, it should be. Pianos play, doors swing, spittoons ring
  when shot, chairs can be picked up. Scenery that just sits there is
  a missed joke.

## What the buildings are for

| Place | Purpose |
|---|---|
| **Saloon** | The main hangout. Packed with activities: darts (exists), pool, a playable piano, drinking, bar fights, five finger fillet, poker. See `activities.todo.md`. |
| **Sheriff's Office** | Wanted posters and the fight ladder (`dueling.todo.md`). |
| **Boots & Suits** | The clothier: rotating stock, buying, changing your outfit (`economy.todo.md`). |
| **Stable** | Horses: care, training, racing, riding around with friends (`animals.todo.md`). |
| **Farm** | Animals to look after, and lassoing (`animals.todo.md`). |
| **Range, Shooting Gallery** | Target challenges and trick shots (`activities.todo.md`). |
| **Bank, and other shells** | **Shootout locations are a fine job for a building.** The Bank, General Store, Pharmacy and Post Office can be arenas first and get a shop or activity later if one turns up. No building has to justify itself beyond "a good place for a gunfight." |

The General Store will probably end up as another date-rotating shop
(gun customizations, see `economy.todo.md`), and the Post Office as
friends/invites (its board already says so), but neither is decided.

## Extension points (how the game grows without dead ends)

Every kind of content should be addable as **data plus, at most, one
new builder**, with no rewiring of what already exists:

- **A building:** `TOWN_LOCATIONS` entry + area fragment + builder.
- **An off-strip place:** a wagon destination (same manifest idea) +
  area fragment + builder, or an existing area + modifiers
  (`deck.todo.md`).
- **An activity:** an activity definition (`activities.todo.md`).
- **A fight, duel, card or modifier:** data (`dueling.todo.md`,
  `deck.todo.md`).
- **A cosmetic or gun customization:** a catalog entry
  (`economy.todo.md`).
- **A character:** data (`cast.todo.md`).

When a new system arrives, the review question is: *what's its data
file, and can someone add the 50th one without touching the code that
runs the first?* If the answer is no, that's the dead end we're
trying to avoid.
