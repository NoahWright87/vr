# Activities: plenty to do between fights

The fight ladder gives direction. Activities are everything else you
do in town, alone or with friends. Same rule as the town: **leave room
for lots of them and fill them in over time.** We don't build them
all; we make sure each one is easy to add.

## The wish list

Not a commitment. A list to draw from, roughly grouped.

- **Saloon:** darts (exists, `world-saloon-darts.js`), pool, a playable
  piano, drinking games, bar fights, five finger fillet, poker.
- **Shooting:** trick-shot challenges, timed target courses (the Range
  and Shooting Gallery already have target machinery), bottle-shooting
  records, a trick-shot game of H-O-R-S-E where style is the score
  (`style.todo.md`).
- **Animals:** lassoing, horse races, looking after farm animals
  (`animals.todo.md`).
- **Odd jobs:** small daily things that pay `$`.

## An activity contract

Duels are the first activity (phase 01-B). Following DESIGN.md
("generalise on the second use, not the first"), once a **second**
competitive activity arrives (a timed target course, or reworking
darts), pull the shared parts out of the duel framework into a
general activity definition:

- how you join (walk up, a board, a menu row)
- players: solo, versus, co-op, how many
- rules and modifiers (`deck.todo.md`)
- scoring and records (best scores saved in the profile, phase 01-C)
- payouts
- its own progression, if it has one (horse training, a ladder of
  harder trick-shot sets)
- whether it works in multiplayer, and who runs it (the host, as with
  duels)

Activities announce what happens (`activity-start`, `activity-score`,
`activity-end`) like everything else does, so style, payouts, records
and the announcer can listen without each activity wiring them up.

## Progression inside activities

Some activities have their own progression that isn't on a timer
(`economy.todo.md`): harder trick-shot sets, faster target courses,
your horse getting quicker as you look after it. Records are always
worth beating, alone or against friends' records in the same room.

## Notes

- Several wish-list items need a move that doesn't exist yet: lasso
  (TODO.md "Weapons not built yet"), riding (`animals.todo.md`),
  holding cards (poker), cue control (pool). Each is a shared system
  first, then the activity.
- Interactive by default (`town.todo.md`). A piano that only plays
  when an activity is running is a missed joke. Everything should work
  idly too.
