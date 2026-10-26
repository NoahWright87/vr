# Style: Tony Hawk for gunslingers

You get credit for *anything*. Just pointing and shooting barely
scores. Twirling, tossing and catching, sliding into cover, landing
trick shots, all while smoking and eight whiskeys deep: that scores
the most. Some modes ignore style, some use it to pick the winner, and
it's always shown.

## Why it suits this codebase

The systems already announce everything: `shot`, `landed`, catches,
twirls, lighting things, swallowing, `shattered`, explosions. A style
tracker is just a **listener**. It scores what it hears, including
combinations nobody wrote a trick for. That's the "build systems, not
features" bet (DESIGN.md) pointed at scoring.

## Scoring rules

- **Repeats pay less.** Each kind of trick pays less every time you
  repeat it, and recovers over time. Spamming one move gets you
  nowhere.
- **Variety multiplies.** Different kinds of trick inside one combo
  window multiply each other. The combo ends after a short quiet
  spell, or when you get hit.
- **States multiply everything.** Drunk (the existing vice system
  already tracks how drunk you are), smoking, on fire, two guns at
  once, mid-catch, airborne items in play.
- **Danger pays.** Near-misses, retrieving your hat under fire,
  winning with a single item left.
- **Rude flourishes pay.** Tipping your hat to an opponent
  (`wardrobe.todo.md`), shooting their hat while it's in the air.

## Presentation

- **Callouts with names.** "HAT TRICK!", "HIGH-NOON HOT TODDY!" Naming
  the tricks is cheap, fun content, and it's where the alliteration
  goes.
- **Two podiums at the end** (borrowed from Jackbox's points vs.
  likes): **Winner** and **Coolest**. You can lose and still be the
  one who was way cooler. 😎🤠
- In single player, style sits next to the duel score, and the payout
  takes it into account (`economy.todo.md`), so style is worth
  something even when you lose.

## Notes

- Some tricks need moves that don't exist yet. Twirling, tossing and
  catching are all built. **Sliding into cover isn't**: movement is
  thumbstick-only right now. Hold off on promising slide tricks until
  that move exists.
- Keep the scoring logic free of A-Frame so it can be tested with
  `node --test`, the way `common/menu-model.js` is.
- Tuning (decay rate, combo window, multipliers) is a matter of feel.
  Keep it in one data table.
