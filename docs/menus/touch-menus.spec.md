# Menus you touch or grab open: spec

What exists. A `projected-menu` trigger (`common/menus.js`) opened by a hand —
a poke on its collider, or `grab-to-open` in the Menus tour — remembers which
hand opened it.

## Auto or manual

- `autoClose: true` (auto): the menu closes once that hand has been further than
  `autoCloseDistance` (0.35 m) from the trigger for `autoCloseDelay` (350 ms).
  Coming back inside resets the clock, so a wobble while you read does not shut
  it. For a quick look: a loot box, swapping a gun at an armory, checking an
  inventory. You drive it with that hand's stick while it is there, or with the
  other hand.
- `autoClose: false` (manual, the default): open until it is closed, walked away
  from (`closeDistance`) or looked away from (`lookAwayDelay`), as before. For
  browsing: a shop, the toybox.
- Only in a headset. Off a headset there is no real hand to take away; the
  walk-away and look-away rules still apply.
- Opened without a hand (the watch's `Open toybox`, a script calling `open()`),
  a menu never auto-closes.
- The player can override every menu at once: `Visor ▸ Touch menus` — *Each
  menu decides* (the default), *Stay open*, *Close when let go* — saved in this
  browser for every game (`common/menu-preferences.js`).
- `setAutoClose(bool)` changes a menu's own default live; it emits
  `projected-menu-auto-closed` (`{ handEl }`) when it closes itself.
- The decision is pure (`chooseAutoClose`, `resolveAutoClose` in
  `common/projected-menu-mode.js`) and tested in
  `tests/projected-menu-mode.test.js`.

In the Menus tour, Shooter's gun case and Fantasy's chest are auto; the lamp,
toolbox, wanted board and general store are manual. The toybox chest is manual.

## Prompts are per mode

A `hint-zone`'s `modes` (`all`, `desktop`, `xr`) says which play it is for. Both
menu surfaces' walk-up prompts (`E Menu`, then `E Exit menu`) are `desktop`: in
a headset you reach for a menu instead, so there they are neither highlighted
nor carded. Separately, any hint card with no key and no label for the input in
use no longer shows at all — that empty tile was the "[E] Exit menu" prompt
showing up blank in XR.
