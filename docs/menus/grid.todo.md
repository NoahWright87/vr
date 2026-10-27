# Grid menu: todo

Decided-on next steps for the grid menu. See `grid.spec.md` for what exists.

## Needs a headset pass first

- **Check sizes on a Quest 2.** Every size here (tile width, `textSize`, the
  caption length, the panel scale on the toybox chest and the store sign) was
  tuned on a flat screen at roughly the distance the panel opens at. The
  captions in particular (about 0.02 m per character before the projected
  panel's scale) are smaller than crossbar rows. If they don't read at arm's
  length, raise `textSize`/`tileWidth` rather than shortening `labelChars`; the
  details pane already carries the full name.
- **Check the stick feel.** Horizontal repeat uses the crossbar's 450 ms delay
  and 200 ms interval. A grid row is short (3–4 cells), so the repeat may be
  more irritating than useful there; consider repeat only on vertical if so.

## Next features, in rough order

- **Tabs.** A shop with categories wants them across the top, not as a level
  you go into and come back out of. Model: a page or submenu with
  `tabs: true` makes its first level of submenus a tab strip, switched by a
  pair of dedicated keys and buttons (not left off the first column, which is
  back, and not E, which enters and leaves menus). Draw the strip in the header
  where the breadcrumb is. Keep it data: the same page without tab support is
  still submenus.
- **Quantity.** Buying several of a consumable. A `quantity: { max }` on an
  action item: confirming opens a number level (it already exists) whose
  commit is the purchase, with the price line multiplying live. Needs the
  model to emit the action with the chosen count, and `canAfford` to take a
  count.
- **Compare with equipped.** `delta` on stats is the hook, but every game will
  compute it the same way. Add an optional `compare: () => statsOfEquipped` on
  the level so the model fills `delta` itself, and an "equipped" badge style.
- **Sell / trade view.** The same grid over the player's inventory, prices
  paid to you instead of by you. Probably just a page, but `denied` needs a
  second reason (`'owned'`, `'equipped'`) so a surface can say why.
- **Filter and sort.** 140 pieces of furniture is still a lot. A row of
  filter chips (collection, rigged, size) above the grid, as page data
  (`filters: [{ id, label, test(item) }]`), and a sort select. Text search is
  out in a headset; the toybox's flat screen browser already has search.
- **Per-tile 3D content.** Some catalogs want a turning model on every tile,
  not a picture. The details slot already shows how (`detailsContentEl`); a
  tile equivalent would need a pool and a strict cap on what's loaded, so it
  stays the exception. Pre-rendered atlases are the default for a reason.
- **Thumbnails on crossbar rows.** A small icon at the start of a row would
  carry over well (a watch menu of guns), and the model already resolves
  `thumbnail`. Draw it from the same texture cache.
- **Live font restyle.** `grid-menu` sets its faces at build; the crossbar can
  change them live (`setFont`) and the tour's `Menu font` row only reaches
  crossbars. Port `setTextFont`'s font-race guard if this is wanted.
- **Overlay modes.** `crossbar-menu`'s `overlay: world | screen` (draw over
  everything / paint on the screen) is not supported on grids. None of the
  current uses needs it; a head-locked inventory would.

## Not doing (decided)

- **Wrapping across rows.** Left/right stop at the row's ends on purpose: in a
  headset, the focus jumping to the far side of the panel reads as losing it.
- **Hover to preview.** Focus is the preview, and focus moves only on a
  deliberate step or tap, never on a laser merely passing over a tile.
