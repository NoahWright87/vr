# 3D Model Toybox

Open **3D Model Toybox** on the home page, or `/games/model-viewer/`.
Poke the chest's latch to open the shared projected menu in VR. Its top-level
creator choices are **Kenney** (with his official logo and website link) and
**Originals**. Choose a collection, pick a model to see its live 3D sidecar
preview, then confirm the focused row to take out a copy. Repeat to set out
multiple toys. The chest, watches and visor all use the current shared crossbar
menu system; scrolling previews a choice and confirming activates it.

## Play

- **VR:** Grip a nearby toy to hold it, move or rotate your hand to arrange it,
  then release. Release a moving hand to throw/tumble the toy. Both hands can
  independently hold a toy. Each model is one rigid toy; skeletal posing is
  not implemented.
- **Desktop:** Open the chest with the screen button, or walk up to its latch
  and press E. Click a row to focus it; click the focused row to select it.
  W/S scroll, D enters/selects, A goes back, and E/Esc leaves an entered menu.
  WASD walks outside menus; drag the scene to look. Look at a nearby toy
  and press F to grab/drop, R to rotate, T to toss. Tab opens the shared watch.
  Backtick opens the shared visor. The optional screen browser provides the
  same selection and spawning flow.
- **Either wrist watch or the visor:** Open the Toybox, toggle gravity, choose the new-toy
  size, resize a held/latest toy, bring it back, put one away, or put all away.
  Gravity off freezes free toys so you can arrange a floating scene. A deliberate
  throw still glides with drag. Gravity on makes free toys fall again.
- Models start as **35 cm toys**. New-toy size cycles through 35 cm, 70 cm and
  actual authored size. Resize controls affect the held toy, otherwise the latest.
  The sidecar reports authored dimensions. Floor squares are 0.5 m.
- Up to **32 toys** are active at once. Other models load only on demand.
  Put toys away to free their geometry, materials and textures. The scene is
  session-only; reloading puts the toys away.

Physics uses floor contact, bounded throw velocity, drag, and conservative box
contacts between toys. This is a lightweight playroom, not detailed concave
mesh physics: contact bounds can be larger than the visible model, and fast
throws can pass through thin toys. There are no weapon firing or door-hinge
behaviors. Character rigs are preserved in imported files, without IK or
animation playback in the Toybox. Actual Quest ergonomics need headset testing.

## Kenney — 228 imported models

All four packs were downloaded from their creator on **2026-10-15**. Their
original `License.txt` files explicitly identify the model content as **CC0**.
Keep these files with redistributed packs. We credit **Kenney / kenney.nl**
in the experience even though these licenses do not require credit.

| Collection | Models | Original creator page |
| --- | ---: | --- |
| Furniture Kit 2.0 | 140 | https://kenney.nl/assets/furniture-kit |
| Blaster Kit 2.1 | 40 | https://kenney.nl/assets/blaster-kit |
| Mini Dungeon 2.0 | 30 | https://kenney.nl/assets/mini-dungeon |
| Blocky Characters 2.0 | 18 | https://kenney.nl/assets/blocky-characters |

The creator webpage counts can differ from the number of GLB files in a pack;
the table counts the actual imported models. Pack textures remain alongside
their models. Furniture is primarily material-colored; the other packs include
local texture dependencies. No runtime access to kenney.nl or a CDN is needed.

`kenney/sources.json` records official archive URLs, versions and SHA-256 hashes.
`kenney/catalog.json` records each model's file, source, creator, license,
rigging and available animation names. The official logo comes from
https://kenney.nl/data/img/logo@2.png and is used for creator attribution;
it is separate from the model packs' CC0 license. This project is independent
and is not represented as endorsed by Kenney.

To reproduce the import, download the exact archives listed in `sources.json`,
expand each into `.tmp/kenney/<pack-id>/`, then run:

```sh
node scripts/import-kenney.mjs
```

The script copies the web-ready model folders and licenses, validates local
dependencies, and regenerates the catalog. It does not modify the GLB models.

## Reuse in games

Use a file directly in an A-Frame experience (Vite copies the whole directory
to the production build, preserving stable paths):

```html
<a-entity gltf-model="url(/assets/models/kenney/mini-dungeon/weapon-sword.glb)"
          position="1 0 -2"></a-entity>
```

Kenney GLBs preserve authored units and origins. The Toybox centers and
resizes an independent instance for play; it does not rewrite the original.
Keep each model's texture folder when copying it elsewhere. The screen
browser's **Model file** link downloads the source file, so associated textures
must be copied too for packs with external images.

## Original blockouts — 14 models

The original set includes pistol, rifle, sword, axe, person, skeleton, table,
chair, door with frame, wall, floor slab, pillar, crate and barrel. These use
the repository's **BSD-2-Clause** license; keep `LICENSE.txt` with redistributed
assets. Character models in this set are static and unrigged. Existing meshes
embedded inside Pistols at Dawn have not been migrated into this catalog.

`starter/*.gltf` contains portable, self-contained snapshots, including colors
and the license notice. `catalog.js` holds editable procedural recipes using
metres, +Y up, and degrees for rotations. Characters, chairs and gun barrels
face -Z. For procedural reuse:

```js
import '../../common/model-library.js';
```

```html
<a-entity library-model="chair" position="1 0 -2"></a-entity>
```

Or call `createModel(THREE, 'chair')` from `common/model-library.js`, and
`disposeModel(group)` when removing it. Each instance owns its resources and
uses one draw call per color. `modelToGltf(original)` from `common/model-gltf.js`
exports these recipes as glTF; regenerate the snapshot when editing a recipe.

Additional creator sources checked as CC0, not bundled: Quaternius
[Ultimate Monsters](https://quaternius.com/packs/ultimatemonsters.html) and
[Ultimate Animated Character Pack](https://quaternius.com/packs/ultimatedanimatedcharacter.html).
