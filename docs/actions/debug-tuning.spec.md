# Tuning, readouts and debug overlays: what exists

What's next is in `debug-tuning.todo.md`.

## Tunables: `common/tunables.js`

A system declares its tunable values once:

```js
import { defineTunables } from '../common/tunables.js';
var tune = defineTunables('gun', 'Gun', [
  { key: 'rate', label: 'Rate', value: 4, min: 1, max: 20, step: 1, unit: '/s' },
  { key: 'present', label: 'Present', value: 0.55, min: 20, max: 100, step: 5, unit: '%', scale: 100 },
  { key: 'aim', label: 'Aim', kind: 'select', value: 'soft', options: [{ value: 'soft', label: 'Soft' }, ...] },
  { key: 'tracers', label: 'Tracers', kind: 'toggle', value: true },
], function onChange(values, key) { ... }, { info: function () { return 'live readout'; } });

tune.values.rate   // read it wherever it's used
```

- Values are stored in the system's units. `scale` shows them in menu
  units (`0.55` shown as `55%`). Numbers clamp and snap to `step` in
  menu units.
- `tune.menuItem()` is a crossbar submenu: one row per value, plus
  `Defaults`. Number and select rows **preview** while scrolled and
  **commit** on back-out. The sidecar shows `info` (if given, re-read
  live) above every current value with its unit, so one screenshot
  holds a whole setup.
- **Persistence:** committed values are saved per page under
  `tunables:<pathname>:<group>`, changed values only.
- **Links:** `?tune=<base64url JSON>` overrides saved values on load.
  `exportAllTunables()` returns `{ data, url }`, and `copyAllTunables()`
  prints both to the console and tries the clipboard.
- `tuningMenuItem()` is a `Tuning` submenu holding every group defined
  on the page, plus `Copy settings` and `Reset all`.
- Visor rows fit **14 characters** (label plus value). Keep labels short.
- Defining the same id twice returns the existing group. A second
  `onChange` is added as an extra listener.
- The model (clamp, scale, format, summary, changed-only export, URL
  encoding) is plain functions, tested by `tests/tunables.test.js`.

**Groups so far:** `motion` (defined by `common/motion-sense.js`
itself, applied to every `motion-sense` on the page).

## Debug draw: `common/debug-draw.js`

A scene system with immediate-mode drawing, for the current frame only:

```js
var dd = sceneEl.systems['debug-draw'];
if (dd.on('targeting')) dd.cone(apex, dir, angleRad, length, '#ff0');
// line(a, b, c), sphere(c, r, c), capsule(a, b, r, c), cone(...), cross(p, size, c), circle(c, r, u, w, c)
```

- All of it goes into one preallocated `THREE.LineSegments` (doubling
  when full, never rebuilt per frame) with vertex colours: **one draw
  call**, drawn over everything with no depth test.
- The first draw of a new frame clears the previous frame's lines,
  whichever system ticks first. A frame with no draws is cleared in the
  system's tick.
- **Channels** (`DEBUG_CHANNELS`): `hitboxes`, `targeting`, `motion`,
  `assist`, `intent`, `attacks`. `on(channel)` is the gate, and
  callers check it before building any geometry. Toggles persist in
  `localStorage` (`debug-draw:channels`) and emit
  `debug-channel-changed` on the scene.
- The shape writers (`writeSphere`, `writeCapsule`, `writeCone`, ...)
  are pure and tested by `tests/debug-draw.test.js`, including that
  each uses exactly the vertex count `VERTS` reserves for it.

**What draws so far:** `motion` (`motion-sense`) draws a cross for the
torso point, a facing line, each shoulder→hand aim line (green while
presented) and each hand's head-relative velocity (10 cm per m/s).

## Debug HUD: `common/debug-hud.js`

- `registerReadout(id, label, fn)`: anything enabled is shown together
  as one text block hanging off the active camera, low and slightly
  left, refreshed at 10 Hz. The text entity is only updated when the
  text changes. Toggles persist in `localStorage` (`debug-hud:readouts`).
- `logAction(text)` writes to a 12-line ring buffer of action events,
  timestamped in seconds since load. It's shown by the built-in `log`
  readout and by Debug ▸ Log.
- **Readouts so far:** `log`, and `motion` (`describeMotion`).

## The Debug submenu: `common/action-debug.js`

`debugMenuItem()` is Debug ▸ HUD (a toggle per readout), Draw (a
toggle per channel), and Log (an info row whose sidecar updates live).
`tuningMenuItem()` is re-exported from here.

## Live sidecars: `liveInfo`

`crossbar-menu` (`common/menu-crossbar.js`) re-reads the sidecar at
5 Hz while the menu is open, when the item supplying the info has
`liveInfo: true`. Otherwise it's only re-read when the menu redraws. A
tunables group with an `info` option sets this automatically.
