# Grid menu: spec

What exists. The grid menu is the surface for browsing: many things visible at
once, a picture of each, and room beside them to read about the one you're on.

- Model: `common/menu-model.js` (GRIDS, CURRENCIES AND PRICES, DETAILS
  sections). Tests: `tests/menu-grid.test.js`.
- Surface: `common/menu-grid.js` (`grid-menu`). Stick tests:
  `tests/menu-grid-input.test.js`.
- Showcase: the Frontier demo's general store in the Menus & HUD tour
  (`primitives/menus/frontier-store.js`, `#frontier-store` in its
  `index.html`).
- Real use: the 3D Model Toybox's chest (`games/model-viewer/`).

## Page data

Everything is optional. A crossbar ignores all of it except `layout`, which it
also ignores; the page is then an ordinary list.

| Where | Field | Meaning |
| --- | --- | --- |
| page or submenu | `layout: 'grid'` | Draw this level as tiles on a surface that can. A select with it shows its options as tiles. Number levels are always lists. |
| page or submenu | `columns` | This level's own column count, overriding the surface's. |
| page or submenu | `currencies` | `[{ id, label, value, icon?, format? }]`. `value` may be a function and is read live. The innermost level with currencies is the wallet shown. `format(n)` turns an amount into its own text (`$25`); without it, prices read `25 Gold`. |
| item or option | `thumbnail` | A URL, a canvas, or `{ src or canvas, rect: [u, v, w, h] }` for an atlas cell (0..1, v up). May be a function of the item. |
| item | `subtitle` | A short second line on the tile, and the details pane's subtitle if `details` has none. |
| item | `badge` | A corner tag (`Owned`, `x3`, `New`). May be a function. |
| item | `price` | A number in the first currency, or `{ gold: 30, gems: 1 }`. May be a function; `undefined` means not for sale. A price in a currency the menu doesn't list is unaffordable. |
| item | `details` | `{ title?, subtitle?, stats?, text? }`, or a function returning it, read on every draw. `stats` entries are `{ label, value?, max?, text?, delta? }`: `value` and `max` draw a bar, `text` overrides the number shown, `delta` (vs. what you have now) is shown beside it in green or red. Without `details`, the item's `info` is the text. |
| item | `actionLabel` | What confirming does, for the pane's prompt (`Buy`, `Take out a copy`). Defaults by kind (`Open`, `Select`, `Turn on`). |

## Model API (what a surface uses)

- `createMenu(page, { gridColumns, gridRows })`. `gridColumns: 0` (the default)
  means the surface can't draw grids.
- `isGrid(level?)`, `levelColumns(level?)`.
- `moveGrid(dx, dy)`: up/down a row (keeping the column; into a short last row
  lands on its last cell), left/right a column (stopping at the ends of the
  row, never wrapping), left off the first column is `back()`. On a list level
  it is the crossbar's verbs: dy steps, right is `forward()`, left is `back()`.
- `focusIndex(index, { keepScroll })`: what a pointer does. With `keepScroll`
  the grid does not scroll if that cell is already in view.
- `getGrid()`: `{ columns, rows, firstRow, rowCount, count, grid, cells }`, each
  cell a row (as `getWindow` returns) plus `row`, `column`, `thumbnail`,
  `subtitle`, `badge`, `price`, `affordable`. Scrolling keeps a row of context
  past the focus where the window has room for it.
- `getCurrencies()`, `priceOf(item)` (`[{ id, label, amount, have, haveText,
  affordable, text }]`), `canAfford(item)`.
- `getDetails()`: `{ item, title, subtitle, stats, text, price, affordable,
  actionLabel, thumbnail, from }`, falling back to `info` the way the sidecar
  does.
- Confirming an action you can't afford emits `denied` (`{ item, id, reason:
  'price', price }`) instead of `action`.

## The surface

`grid-menu` schema, in short: `page`, `columns` (4), `rows` (3), `tileWidth`
(0.3 m), `tileHeight` (0: square picture plus two lines), `gap`, `labelChars`,
`textSize` (metres per character cell for the panel's own text), `details`
(`right | left | none`), `detailsWidth`, `detailsChars`,
`detailsContentHeight` (the picture/preview slot at the top of the pane),
`detailsThumbnail`, `maxStats`, and the same `open`, `closeBehavior`,
`closable`, `memory`, `hint*`, `stickRange`, `plateOpacity`, `exitKey`,
`exitButton`, `color`, `accent`, `font`, `titleFont` as `crossbar-menu`, plus
`deny` (the refused colour).

- **Layout.** Header: title, breadcrumb (`Shop › Guns`, clickable to go back),
  `7 / 24`, the wallet and the close/back button. Tiles: picture, a one-line
  caption (the focused tile scrolls a long one), subtitle bottom-left, price
  bottom-right (red when you can't afford it), badge top-right. The focused
  tile is brighter and stands a little proud. A scroll bar runs down the grid's
  right edge when there are more rows than fit. A list level is drawn as one
  column of wide tiles in the same frame. The details pane stacks its text by
  the height each label actually comes out at, so a long name wraps instead of
  being cut.
- **Thumbnails** are raw three.js planes with their own UVs, not `a-image`, so
  every tile showing a cell of one atlas shares that atlas's one texture.
  Textures are cached per URL and per canvas for the page's lifetime.
- **The details slot** (`detailsContentEl`) is the game's: anything appended
  there hangs centred in it. While a game shows something better than the
  picture there (the toybox's live model), it calls `holdDetailsSlot(true)`.
- **Live values.** The wallet and the details pane are re-read four times a
  second while open, so a purchase or a bounty shows without the game telling
  the menu anything.
- **Input.** Registers with `menu-stick-control` itself (no separate
  registration component). Stick: vertical steps rows, horizontal steps columns
  with repeat on a grid level (the repeat stops at the first column rather than
  backing out; a fresh push does that, held), one held detent in/out on a list
  level. Keys once entered: W/S/A/D or arrows move, Enter/Space confirms,
  Q/Backspace goes back, E/Esc leaves. Buttons in XR: trigger/A/X confirm,
  B/Y/grip back, both held until the wheel fills (see `holds.spec.md`).
  Pointing: tap a tile to focus it, tap it again to pick it.
- **The way back.** Inside a submenu the corner shows `<` whether or not the
  menu is `closable`, and the title and the breadcrumb go back too. The
  breadcrumb is one label per level, faded by distance from the level you are
  in (and the title above them), with each `›` its own label.
- **Events** (bubbling, like the crossbar's): `menu-action`, `menu-commit`,
  `menu-preview`, and `menu-denied` (`{ id, item, reason, price }`). It also
  emits `crossbar-menu-close` so `projected-crossbar` puts its panel away.

## The toybox's thumbnails

`scripts/render-toy-thumbnails.mjs` renders every model in headless Chromium
into one atlas per collection (`assets/models/thumbnails/<name>.png`, 128 px
cells) plus `index.json`; `thumbnailFor(id)` in
`games/model-viewer/toy-assets.js` turns an entry into a `{ src, rect }`. It is
run by hand after models change, not by the build. All 242 models come to
about 660 KB of PNG across five textures.
