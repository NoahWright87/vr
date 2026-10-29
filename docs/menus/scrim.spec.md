# Comfort scrim: spec

What exists. `common/comfort-scrim.js` is a scene system (`comfort-scrim`)
that every game with a visor gets (`common/visor-menu.js` imports it). It
draws a dark wash round the edges of your view, for two reasons: floating
menu text reads better against a bright or busy world, and darkening the
periphery cuts the optic flow that makes smooth locomotion sickening.

## Settings

The player's, saved in this browser (`localStorage` `vr.scrim`) and the same in
every game, under `Visor ▸ Scrim`. Every row previews while you scroll it, and
the scrim shows while you are in that submenu whatever it is set to, so you can
see what you are tuning.

| Setting | Values | Default |
| --- | --- | --- |
| Show | Never, In menus, When moving, Menus + moving, Always | When moving |
| Shape | Sides (left and right), Tunnel (all round) | Sides |
| Size | 5–90% of the way in from the edge of view | 35% |
| Darkness | 10–100% opacity where it is solid | 75% |
| Softness | 5–100% of the band that is a fade rather than solid | 70% |

- **In menus**: while a menu you have up is open — the visor, the watch, a panel
  projected from a prop (any registered menu with `closeBehavior: 'hide'`).
  Not a panel that simply stands in the room.
- **When moving**: while the player's rig (the camera's parent: everything that
  moves you except your own head) moves smoothly — the stick, smooth turning, a
  vehicle, desktop WASD. Over 0.35 m/s or 0.35 rad/s, under 25 m/s and 12 rad/s:
  a teleport or a snap turn is a one-frame jump with no flow to see, and does
  not count. Off a headset turning does not count (it is the mouse looking).
  Motion must stop for 250 ms before it fades (180 ms in, 500 ms out), so one
  still frame mid-walk does not flicker it.
- A scene that moves the rig without the player meant to notice — redirected
  walking in Expansive Spaces — sets `comfort-scrim="ignoreMotion: true"` on its
  `<a-scene>`.

## How it is drawn

- Screen space (`screenSpaceAll` from `menu-crossbar.js`), filling each eye's
  viewport: "the edge of your view" is the edge of the display on any headset,
  and the wash is at the same place in both eyes, as a vignette is. The mesh is
  stretched to the view's aspect every frame it is up.
- Symmetric by construction: one mesh, one profile (`scrimAlpha`, smoothstepped,
  clear inside `1 - size`). The old visor wash was one-sided per menu and came
  out solid toward the middle on one side; see below.
- Only the band is geometry: the clear middle is a hole (for a tunnel, the
  square inside the clear circle), so the centre of the view is never blended
  over. Hidden entirely when faded out.
- Drawn over the world (no depth test) and under the HUD and the visor menu
  (`OVERLAY_RENDER_ORDER - 50`).

## Related fixes

- `crossbar-menu`'s own `scrim` (a one-sided wash behind one menu, still
  available to any surface) gave both sides the same gradient: A-Frame caches a
  canvas texture by the canvas's `id`, and canvases without one share a single
  cache entry. Each side's canvas now has its own id. The visor no longer uses
  it.
- Locomotion's `comfortVignette` (a flat dark plane over the whole view while
  the left stick read over 0.12, which a drifting stick does) is off by default;
  the scrim replaces it.

Tests: `tests/comfort-scrim.test.js` (profile, symmetry, when it shows, motion
detection, settings).
