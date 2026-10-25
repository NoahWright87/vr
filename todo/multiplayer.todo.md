# Multiplayer: 2–4 friends

## Decisions

- **2–4 players.** The fire and liquid physics are heavy on a Quest, so
  that's the budget to design for.
- **Friends only, by room code.** No random matchmaking (costly, and
  brings in cheaters). The existing room-code flow (watch menu → Multiplayer,
  `primitives/multiplayer/`, `common/multiplayer.js`, the hosted relay in
  `worker/`) is the starting point.
- **Bring your own voice chat.** Expected setup: separate play spaces
  in the same house, within shouting distance, or friends over
  Discord. No in-game voice.
- **The host's deck and rules apply to the room** (`deck.todo.md`).
  Experienced players end up as the tour guide for newbies.
- **Shared unlocks.** Anything unlocked while playing together unlocks
  for **everyone present** and goes into each player's own save
  (`phase01-c`). Nobody should have to redo progress they already
  helped a friend make.
- **Cheating isn't a concern.** It's friends. The shooter decides
  whether their own shot hit.

## Who decides what

- **The holder owns a held or thrown object.** Its position and
  release come from them.
- **The shooter claims hits.** "My shot hit player B's hat." Everyone
  applies it.
- **Each player owns their own wardrobe state**, but applies hit
  claims and the room's wardrobe rule (e.g. conservation of clothes
  moves the item to the shooter).
- **The host owns round flow**: signal timing, false-start calls,
  results.
- **Fire and liquids:** the hardest part, deliberately postponed. When
  they're synced, only send the starting events ("this puddle was lit
  here", "this explosion happened here") and accept small visual
  differences between players.

## Known problems to deal with

- Positions go over the network as world coordinates, and two players'
  play spaces differ (TODO.md, "Multiplayer boxes and per-player
  rooms"). Duel spots and arenas should use a shared anchor.
- Player names don't exist yet (TODO.md, "Player names"). Phase 01-C
  adds a name to the player profile.
- Pistols at Dawn has no networking code at all yet. Phase 03-B is the
  first slice.

## Open questions

- Can players join mid-match, or wait in Boot Hill until the next
  round?

## Non-VR players (decided: yes, eventually)

Family members without a headset should be able to join from a laptop,
phone or gamepad. Input comes from the shared semantic-hands work in
`common/` (`platforms.todo.md`), so a non-VR player's ghost moves,
aims and wears clothes like anyone else's and nothing on the network
needs to know which kind of player it is. Don't build anything in
phase 03-B that assumes every peer has tracked controllers.
