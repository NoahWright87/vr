# The Prefab Workshop: what exists

`primitives/prefabs/` (served at `/primitives/prefabs/`, linked from the
home page under Building blocks). A desktop page for editing prefabs and
hand poses, seeing them, and copying out what changed. Built for a mouse
and keyboard; touch uses the same pointer events but is untested and has
no pinch-zoom.

- `index.html`, `workshop.css`: the page.
- `workshop.js`: wires it together (`window.workshop` is the app).
- `store.js`: the library being edited, what differs from the commit, and
  keeping that in the browser. DOM-free; `tests/prefab-workshop-store.test.js`.
- `view.js`: the 3D viewport, hands, markers, camera and gizmo.
- `inspector.js`: the Prefab, Hand poses and Export panels.
- `selection.js`, `ui.js`: what is selected; DOM helpers.
- `tests/prefab-workshop.browser.cjs`: drives the real page (see Tests).

## Layout

- **Left:** every prefab (marked `new` or `● changed`), then every model
  that doesn't have one, with a search box. Click a model to start a prefab
  from it.
- **Middle:** the viewport. Red/green/blue lines are X/Y/Z at the origin;
  the grey arrow on the floor is forward (-Z); the grid is 10 cm. The
  model, a translucent hand for every occupant of the selected interaction
  point (and its mirror for `either` points), orange cones with dashed lines
  for emitters (the dashes show where they point), cyan boxes for sockets.
- **Right:** tabs for Prefab, Hand poses and Export.
- URL: `?prefab=<id>` or `?model=<catalog id>` opens straight to one.

## The viewport

- **Orbit** by dragging empty space; **pan** with right-drag or Shift-drag;
  **zoom** with the wheel. `3/4`, `Front`, `Side`, `Top`, `Back` set the
  angle; `Frame` fits the model; `Focus` zooms to the selected placement.
- **The gizmo** appears on whatever is selected (the model fit, a hand
  position, an emitter or a socket): arrows move along an axis, rings turn
  about one, the grey ball slides freely in the view plane. **Shift** snaps
  (5 mm, 15°). `Gizmo: world | local` picks whether its axes follow the
  prefab or the selected thing.
- `See-through` draws the model faint, to see a hand inside it. `All hands`
  shows the hands of every interaction point, not just the selected one.

## The Prefab tab

Sections that open and close (and remember): identity (name, mass in kg,
revert, duplicate, delete); **Model fit** (position, rotation, scale, the
model's size in metres, *Centre*, *Sit on floor*, *Turn 90°*, *Flip 180°*,
*longest side = N m*); **Where hands go** (each interaction point's id and
`hands`; each occupant's pose, *steers*, position and rotation, an optional
*its own left hand*, and *+ another hand at this point*); **Emitters**;
**Attachment sockets**; **Stats** (a JSON box). Numbers update live while
the gizmo drags and the other way round.

## The Hand poses tab

Pick a pose; *Rename*, *Duplicate as*, *New blank*, *Delete* (refused while
a prefab uses it), *Revert*, a text label, and *Start from a baked clip*.
Five finger rows: a slider moves a whole finger's curl (shifting its joints
together, keeping their differences); the arrow opens its three joints,
each with curl, spread and twist. The pose shows on **free hands** (a pair
in the viewport) or on **the selected hand position** on the prefab, live.
It says which prefabs use the pose.

## Keeping edits, and getting them out

- Every edit is compared with the committed data, not logged: undoing an
  edit by hand stops it being a change. What differs is saved to
  `localStorage` (`prefab-workshop-edits-v1`) a moment after each edit and
  on page hide, so a reload or a closed tab loses nothing. If the browser
  blocks storage, the header says so.
- **Copy changed JSON** (header, and the Export tab) copies exactly what
  differs, in the export format (`prefabs.spec.md`): each changed or new
  prefab or pose whole, `null` for a deleted one. If the browser refuses the
  clipboard, it opens the Export tab where the text can be selected.
  *Download .json* does the same to a file.
- **Apply a copied export** on the Export tab applies a pasted export on top
  of what is there (to restore on another machine).
- **Discard all** goes back to the commit.
- To commit: paste the copied JSON to Claude, or save it and run
  `node scripts/apply-prefab-export.mjs file.json`.

## Tests

- `tests/prefab-workshop-store.test.js`: changes against the baseline,
  saving and reloading, broken or missing storage, import and discard.
- `tests/prefab-workshop.browser.cjs`, run against `npm run dev` or
  `npm run preview` (`VR_TEST_URL`, `VR_CHROMIUM`): the real page and real
  mouse events: opens a committed prefab; an edit counts as a change; a
  translate drag moves one axis only and the field follows; a rotate drag
  turns; orbiting edits nothing; *Copy changed JSON* puts exactly the
  changed prefab on the clipboard; a reload keeps edits; a new pose edited
  with its sliders is a change and drives the hand; *Discard all*; and
  creating a prefab from a model. Passes on both servers.
