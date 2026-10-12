# Tuning, readouts and debug overlays

The workflow this exists for: Noah plays in the headset, opens the visor,
changes a number, feels the difference, screenshots the sidecar that
shows every current value, and says what felt wrong. Every later system
plugs in here, so build it early.

## Tunables registry

Today every page hand-writes its rows, value sync and commit handlers.
`common/visor-page.js` is a good example of how much boilerplate one
settings group takes (`LAYOUT`, `ACTIVATION`, `syncSettings`, three
event listeners). Replace that, for action systems, with a registry:

```js
defineTunables('motion', 'Motion', [
  { id: 'energyAttackMs', label: 'Rise', value: 60, min: 10, max: 400, step: 10, format: ms },
  ...
], function onChange(values) { ... });
```

- It generates a crossbar submenu per group (`kind: number/select/toggle`
  rows already exist in `common/menu-model.js`), wired to preview while
  scrolling and commit on back-out, the same as the visor's own settings.
- It produces a text summary of every value in the group for the
  sidecar (`info` on the submenu), so one screenshot captures a whole
  tuned setup.
- **Persists** to `localStorage` per page, wrapped in try/catch, with a
  "Reset group" row.
- **Exports**: a "Copy settings" row that writes JSON to the clipboard
  where allowed and always to `console.log`, plus a `?tune=<base64>` URL
  parameter that loads a setup. A tuned setup then travels as a link or
  a screenshot.
- **Presets / A-B**: a select row per group that swaps between two named
  snapshots, for flip-back-and-forth comparisons. This is the Punch Pop
  hit-assist cycle row, generalized.

The pure part (values, clamping, serialisation, summary text) belongs in
a module without A-Frame, tested like `menu-model`.

## Live readouts

**Finding:** the crossbar sidecar re-reads its `info` only when the menu
re-renders (`renderSidecar` in `common/menu-crossbar.js`, around line
1014). It's live for things that change as you scroll, but it can't
show a per-frame number like hand speed. Two options:

1. A `liveInfo: true` flag on a page item. The crossbar then calls
   `renderSidecar` at ~5 Hz while that item is focused. This is cheap,
   since it already skips unchanged text.
2. A separate head-locked HUD (what the motion lab does today, and
   what Punch Pop's Live Debug HUD did).

Do both. The sidecar suits "the numbers for the thing I'm tuning". The
HUD suits watching while playing with the menu closed. The HUD should be
one shared component (`debug-hud`) whose lines come from registered
providers (`registerReadout('motion', fn)`), toggled per provider from a
Debug submenu, updated at ~10 Hz, and placed low in view so it doesn't
cover the action.

## Debug drawing

A `debug-draw` system with an immediate-mode API, cleared every frame:

```js
debugDraw.line(a, b, color); debugDraw.sphere(c, r, color);
debugDraw.cone(apex, dir, angle, length, color); debugDraw.capsule(a, b, r, color);
```

- All of it goes into **one** `THREE.LineSegments` with a preallocated
  `BufferGeometry` (grow-only, `drawRange` per frame): one draw call
  whatever is drawn. Wireframe spheres and capsules are a few circles
  each.
- **Channels**, each toggled from the visor's Debug page: `hitboxes`,
  `targeting` (cones, candidate scores, the chosen target), `intent`
  (hand state labels, extension vectors), `assist` (tracked vs. virtual
  hand offset), `attacks` (strike volumes coloured by phase), `motion`
  (velocity vectors, torso point, facing). A channel that's off costs
  nothing: callers check `debugDraw.on('targeting')` before building
  geometry.
- World-space text labels are expensive in A-Frame (one SDF text mesh
  each). Cap the label count and recycle them from a pool.
- `common/obb-collider-visibility.js` is the existing precedent for
  showing colliders. Fold it in as the `hitboxes` channel's
  implementation, or retire it.

## Event log

The last ~12 action events (a strike committed, a target chosen and its
score, a hit, a block, a whiff and why) as a ring buffer, shown in a
Debug ▸ Log sidecar. "Why didn't that punch land?" should be answerable
from inside the headset, from a screenshot.

## Motion recording controls

In the visor: Record (last N seconds, rolling), Label (select from the
known gesture names plus "negative"), Save. See `intent.todo.md` for
where recordings go and how a headset gets them off the device.
