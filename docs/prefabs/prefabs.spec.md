# Prefabs: what exists

- `common/prefab-core.js`: the format, validation, transform maths,
  occupant lookup (with mirroring), the library diff/export, and a JSON
  formatter. Pure; tested by `tests/prefab-core.test.js`.
- `common/prefab-data.js`: loads the committed data.
- `common/prefab.js`: the `prefab` component.
- `common/model-catalog.js`: every model (Kenney's 228 plus the
  originals) as one list, and loading any of them as a three.js object.
  It was `games/model-viewer/toy-assets.js`; the Toybox now imports it
  from here.
- `assets/prefabs/`: the data (below).
- `scripts/apply-prefab-export.mjs`: writes a workshop export into it.
- `tests/prefab-data.test.js`: every committed prefab is valid.

## The format

One entry per prefab, keyed by id (lowercase letters, digits, dashes).
Everything is in the **prefab frame**: metres, +Y up, -Z forward, origin
at the best pivot (a gun's main grip). Rotations are degrees, three.js
Euler `XYZ`.

```json
"smg-d": {
  "name": "SMG",
  "model": "kenney-blaster-kit-blaster-d",
  "fit": { "pos": [0, 0.034, -0.084], "rot": [0, 0, 0], "scale": 0.65 },
  "massKg": 2.4,
  "interactions": [{
    "id": "grip", "hands": "either",
    "occupants": [{ "pose": "pistol-grip", "pos": [0.03, -0.02, -0.023], "rot": [-41, 0, -90] }]
  }],
  "emitters": [{ "id": "muzzle", "role": "muzzle", "pos": [0, 0.07, -0.385], "rot": [0, 0, 0] }],
  "attachments": [{ "id": "rail", "accepts": ["optic"], "pos": [0, 0.155, -0.06], "rot": [0, 0, 0] }],
  "stats": {}
}
```

| Field | Meaning |
|---|---|
| `model` | an id from the model catalogs (`kenney-...` or an original's id) |
| `fit` | takes the model file into the prefab frame; `scale` is uniform |
| `massKg` | optional; absent means unset, not zero |
| `interactions[]` | a place where hands go; `hands` is `left`, `right` or `either` |
| `…occupants[]` | one entry per hand that can use the point at once, in order of arrival |
| `…occupants[].pose` | a name in `hand-poses.json` |
| `…occupants[].pos/rot` | where the **hand model's own frame** goes (see below) |
| `…occupants[].drives` | whether this hand's movement steers the object; true for the first occupant, false after, unless set |
| `…occupants[].left` | an `either` point's own left-hand `{ pos, rot, pose? }`, in place of the mirror |
| `emitters[]` | where things come out; `role` is a free string (`muzzle`, `eject`, `exhaust`...) and -Z is out |
| `attachments[]` | sockets; `accepts` is a list of types |
| `stats` | anything; never interpreted |

**An occupant is the hand model's frame in the prefab frame.** The hand
.glb's own axes: fingers along -Z, palm toward -Y, back of hand +Y, the
origin near the knuckles (the palm bone is 9.5 cm behind it). The right
hand's thumb is toward -X; the left hand model is its exact mirror.
An `either` point is written for the right hand. The left is the same
placement mirrored across X = 0 (`mirrorTransform`: negate x, and for the
rotation negate the quaternion's y and z), unless that occupant has its own
`left`. A `left` or `right` point is placed for that hand as written.

Occupants are in order of arrival, not by side. A pistol grip with two
occupants means: the first hand takes occupant 0 on its own side, the second
hand takes occupant 1 on *its* side (the mirror of what is authored when the
second is the left). Both are authored for the right hand.

`occupantFor(interaction, side, index)` returns `{ pose, pos, rot, drives,
mirrored }` for a side and place, or `null` if that hand can't use it.

Numbers are rounded when written (positions to 0.1 mm, rotations to
0.01°), and the JSON always has the same key order and omits defaults
(`compactPrefab`), so a diff shows what someone changed and nothing else.

## Data files

- `assets/prefabs/hand-poses.json`: `{ name: pose }`. See `hand-poses.spec.md`.
- `assets/prefabs/<pack>.prefabs.json`: `{ id: prefab }`, one file per
  model pack (`blaster-kit`, `furniture-kit`, ..., `originals` for the hand
  made models). `common/prefab-data.js` finds them by name with
  `import.meta.glob`. A new pack needs no code change.

Committed so far (all drafts for Noah to tune in the workshop):

| id | model | notes |
|---|---|---|
| `smg-d`, `rifle-a` | Blaster Kit d, a | pistol grip + a palm-up foregrip, muzzle emitter, SMG also a rail and a muzzle socket |
| `pistol-h` | Blaster Kit h | two occupants on the grip (grip, then wrap-over), muzzle emitter |
| `grenade-a` | Blaster Kit grenade-a | a held-in-the-fist point |

Scales are chosen so a real-size hand fits the grip (0.65 for the rifle and
SMG, 0.8 for the pistol, 0.65 for the grenade). The shooter demo used 0.4,
which left a grip about 5 cm tall.

**The Blaster Kit models all face -Z already** (barrel at -Z, stock at +Z),
so their `fit.rot` is `[0, 0, 0]`. They are also slanted: the SMG's grip is
about 41° off vertical, the rifle's 33°, the pistol's 49°, so those hand
placements are tilted about X to match.

## The `prefab` component

```html
<a-entity prefab="id: smg-d"></a-entity>
```

- Loads the model (`loadToy`), applies `fit`, and makes child entities
  `.prefab-anchor` with `data-anchor-kind` (`emitter` or `attachment`),
  `data-anchor-id`, `data-role` / `data-accepts`, at each anchor's place.
- `prefab.def`: the normalized prefab. `prefab.anchor('emitter', 'muzzle')`
  returns its entity. `prefab.holdPlacement('grip', 'left', 0)` returns
  `{ pose, position, quaternion, drives }` (THREE objects, in the prefab's
  frame).
- Emits `prefab-ready` when the model is loaded.
- `prefab.setDefinition(def)` swaps the data under a live entity and loads
  a new model only if the model id changed. The workshop edits this way.
- Nothing here makes a hand hold anything. See `holding.todo.md`.

## Library and export

A **library** is `{ poses, prefabs }`. `diffLibraries(baseline, current)`
returns the export:

```json
{ "format": "prefab-export/1", "prefabs": { "smg-d": { ...whole prefab } }, "poses": { "pinch": null } }
```

A changed or new entry is written whole; a deleted one is `null`.
`applyExport(library, export)` applies it; `parseExport(text)` reads pasted
text or says why it can't.

`node scripts/apply-prefab-export.mjs export.json [--dry-run]` validates
the whole result (every prefab, every pose, every model id and pose name
used) and writes nothing unless all of it is valid. It puts each prefab in
its model's pack file, moves a prefab between files if its model's pack
changed, creates pack files as needed, sorts keys, and rewrites only files
that differ. Tested by `tests/apply-prefab-export.test.js`.

## Tests

- `tests/prefab-core.test.js`: transforms against three.js conventions,
  mirroring, compaction, validation, occupant lookup, export round trips.
- `tests/prefab-data.test.js`: the committed files are valid, in the right
  pack file, and exactly what the apply script writes; the shooter prefabs'
  muzzles are forward of their grips; the workshop is built and linked.
- `tests/apply-prefab-export.test.js`: the paste-back loop.
