# Menus: the plan

The shared menu system, and where it is going. Read this before adding a
menu type, a surface, or a field to page data.

## File convention

The same as `docs/actions/`:

- `<topic>.spec.md` is the present: what exists, how it behaves, where it
  lives. Keep it true.
- `<topic>.todo.md` is decided-on future work, with enough context to start
  cold. When an item is built, move its substance into the spec and delete it
  from the todo.

## The shape of it

One **model**, several **surfaces**.

- `common/menu-model.js` is the model: a menu is a stack of levels, each a
  list with a focus. It decides what is focused, what is visible, what a press
  means, and (for grids) what a sideways move means, what you can afford and
  what the details pane says. No A-Frame, no DOM; `node --test` covers it.
- A **surface** draws the model and routes input into it. There are two:
  - `crossbar-menu` (`common/menu-crossbar.js`): a windowed list, focus in the
    middle. For things you scroll past: settings, a pause menu, the watch, the
    visor. See the README's *Crossbar menu* entry.
  - `grid-menu` (`common/menu-grid.js`): tiles with pictures, a details pane, a
    wallet. For things you browse: shops, armories, wardrobes, the toybox. See
    [`grid.spec.md`](grid.spec.md).
- **Page data** is the same for both. A page that asks for `layout: 'grid'` is
  a grid where a surface can draw one, and still a list on any crossbar. Every
  grid-only field (`thumbnail`, `price`, `details`, `currencies`, ...) is
  optional and ignored by a crossbar, so a shop's page can sit on the watch too.
- **Input plumbing is shared.** `menu-stick-control` (in `menu-crossbar.js`)
  decides which menu a hand's thumbstick or the keyboard is driving, for every
  surface; `projected-menu` + `projected-crossbar` put either surface on a prop,
  a wall button or a wrist. A new surface implements the same handful of
  methods (`step`, `forward`, `back`, `activate`, `setLocked`,
  `setEngagedHand`, `getWorldPosition`, and `horizontal` if sideways means
  something on it) and is listed in `MENU_SURFACES`.

## Principles

1. **Page data, not markup.** A menu is a title and a list of items. Never build
   rows or tiles by hand in HTML; if a surface needs something the data can't
   say, add a field to the model, documented where the model documents fields.
2. **One verb set.** Up/down, inward, outward, confirm. A grid adds sideways,
   and outward off its first column is still back. A thumbstick, a finger
   laser, a poke, a mouse and the keyboard all reach the same verbs.
3. **A tap is always safe.** Pointing at something that isn't focused only
   focuses it, and never moves it out from under the pointer, so the second tap
   picks what the first one aimed at.
4. **Built once.** A surface creates every entity it will ever show when it is
   built; navigation changes text, opacity, textures and positions. Creating
   entities while a menu is in use is a dropped frame on a Quest.
5. **Nothing happens by accident.** A drifting stick never counts (one shared
   dead zone, `common/stick-drift.js`), and going in, coming out and confirming
   are held until a wheel fills, longer for serious rows. See
   [`holds.spec.md`](holds.spec.md).
6. **There is always a way back.** Inside any submenu, on any surface, the
   corner `<`, the title and the breadcrumb all go up one level, whether or not
   the menu can be closed. Everything above the level you are in fades with
   distance from it: the level you are in at full, its parent at 70%, and so
   on up to the title.
7. **Prompts are for the input in use.** A keyboard prompt never shows in a
   headset, and a hint with nothing to say for the current input does not show.
8. **The menu refuses what it can.** Something you can't afford is refused by
   the model (`denied`), visibly, so games only hear about purchases that can
   happen.

## Topics

- [`grid.spec.md`](grid.spec.md) — the grid menu as it is.
- [`grid.todo.md`](grid.todo.md) — what's decided next for it.
- [`holds.spec.md`](holds.spec.md) — hold to confirm, and stick dead zones.
- [`holds.todo.md`](holds.todo.md) — what's decided next for those.
- [`scrim.spec.md`](scrim.spec.md), [`scrim.todo.md`](scrim.todo.md) — the
  comfort scrim round the edges of view: in menus, while moving, or always.
- [`touch-menus.spec.md`](touch-menus.spec.md) — menus opened by touching or
  grabbing something: auto-close when the hand leaves, and per-mode prompts.
