# Hold to confirm, and stick dead zones: spec

What exists. Two guards against a drifting or bumped thumbstick (and a
brushed button) doing things in a menu, or walking you, on its own.

## Stick dead zones

`common/stick-drift.js` is the one setting every thumbstick reader uses:
locomotion (`common/locomotion.js`: moving, turning, teleport aim) and the
menus (`menu-stick-control` in `common/menu-crossbar.js`: stepping, going in
and out). Three presets — Small, Medium (the default), Large — each giving
`move`, `turn`, `step`, `release`, `teleport` and `teleportCommit`.

- Medium walks you only past half a push (0.5) and steps a menu only at 0.8,
  re-arming under 0.4 — well clear of the 0.1–0.3 a worn stick rests at.
  Locomotion's move is all-or-nothing past the dead zone, so a small dead zone
  meant a drifting stick walked you at full speed; slow, careful movement is
  what walking physically is for.
- It is the player's, not the game's: saved in `localStorage` (`vr.stickDrift`)
  and the same in every game. Every visor has it, as `Visor ▸ Stick dead zone`
  (`common/visor-page.js`).
- Readers ask for the current values every frame (`getStickDrift()`), so a
  change applies at once. `locomotion-demo`'s `*Deadzone` schema values are -1
  (use the setting) unless a page sets its own; `setStickDriftCompensation`
  still works and now changes the shared setting (its old names `off`, `low`,
  `high` map to the new presets).
- Desktop gamepads go through `common/input-router.js`'s own dead zone, not
  this.

## Hold to confirm

A No Man's Sky style wheel. Going into a row, coming back out and confirming
start a ring filling clockwise on the panel, and only happen when it is full.
Let go early, or move the focus, and nothing happens. Moving the focus (up and
down a list, along a grid row) is never held, so scrolling is as quick as
before.

**How long** is the model's policy, `menu.holdFor(verb)` in
`common/menu-model.js`, with defaults in `MENU_DEFAULTS.holds`:

| Verb | What | Default |
| --- | --- | --- |
| `forward` / `activate` on a submenu, select or number | going in | `enter` 220 ms |
| `activate` inside a select or number level | picking a value | `pick` 220 ms |
| `back` | coming out (and committing a value level) | `back` 420 ms |
| `back` at the root | moving onto the title bar | `enter` |
| `activate` on an action or toggle | doing something | `action` 380 ms |
| `activate` on the title bar's Close | closing | `close` 600 ms |
| — | an item's `hold: 'long'` | `long` 1500 ms |

An item sets its own with `hold`: ms, a preset name, or `false` for none (a
select's `pickHold` sets its values'). A page can change the presets for all
its rows with `holds: { action: 600, ... }`. `info` rows, disabled rows and
moves that do nothing are 0. `holdIsSerious(verb)` is true from 1000 ms
(`SERIOUS_HOLD_MS`).

**Who holds** is `menu-stick-control`'s hold engine (`beginHold`, `endHold`,
`updateHolds`), one hold per owner:

- **Controller buttons** (XR): trigger/A/X start an `activate` hold and B/Y/grip
  a `back`; releasing that button cancels. When the wheel fills it acts once (a
  held button does not repeat) and gives a short haptic pulse.
- **The stick** (XR): a sideways push past `step` starts a `forward`/`back`
  hold; falling under `release`, or swinging up or down, cancels. On a grid,
  sideways moves along the row as before; only left off the first column is a
  held `back`, and only after the stick has come back to the middle.
- **Keyboard**: keys do not drift, so only serious confirmations are held
  (Enter or Space held through the wheel); everything else acts on the press.
- **Pointer**: likewise only serious rows. A mouse or laser press is held
  (mousedown starts it, mouseup or leaving the row cancels). A fingertip poke
  cannot be held, so the first poke fills the wheel halfway and a second within
  2.5 s confirms (`createPointerConfirm`).

**Where the wheel is drawn** is the surface's: `setHold(verb, fraction)` on
`crossbar-menu` rings the selected row's inner end (where its `›` is) for going
in or confirming, and the corner `<`/X button for going back; `grid-menu` rings
the focused tile's picture, and the corner button for going back. The ring is
`createHoldRing` in `menu-crossbar.js`: raw three.js, built once, filled by
draw range. The Basics demo's `Lights out (hold)` row is the showcase for a
serious hold.

Tests: `tests/menu-grid.test.js` (the policy), `tests/menu-grid-input.test.js`
(the stick and hold engine on a test clock), `tests/stick-drift.test.js`.
