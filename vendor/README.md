# Vendored A-Frame

A checked-in copy of A-Frame, used instead of the `aframe.io` CDN. Still no
npm install, no build step — this is just a file in the repo.

## Why

- Some sandboxed dev/CI environments block `aframe.io` and its asset CDN
  outright, which breaks both local testing and the "does this even load"
  sanity check.
- The live site no longer depends on a third-party CDN being up.

## What's in here

```
vendor/aframe-1.6.0/
  aframe-v1.6.0.min.js                     the library itself
  fonts/Roboto-msdf.json                   default font used by every <a-text>
  fonts/Roboto-msdf.png                    (A-Frame fetches these at runtime, not bundled)
  controllers/hands/*.glb                  hand-controls' low-poly hand meshes
  controllers/oculus-hands/v4/*.glb        hand-tracking-controls'/hand-tracking-grab-controls'
                                            rigged low-poly hand meshes (modelStyle: 'mesh')
```

A-Frame doesn't bundle its default font or its controller/hand models —
several built-in components (`text`, `hand-controls`, `oculus-touch-controls`,
etc.) fetch assets like these from a CDN root at runtime, hardcoded to
`https://cdn.aframe.io/` unless overridden. Overriding is supported directly
by A-Frame: it reads `window.AFRAME_CDN_ROOT` if set, before falling back to
the real CDN (see `constants/index.js` in the A-Frame source). Every page
that loads A-Frame sets this **before** the A-Frame `<script>` tag:

```html
<script>window.AFRAME_CDN_ROOT = '../../vendor/aframe-1.6.0/';</script>
<script src="../../vendor/aframe-1.6.0/aframe-v1.6.0.min.js"></script>
```

Only the assets our demos actually use are vendored (default font,
low-poly hands, low-poly hand-tracking meshes). If a future primitive uses
something else CDN-backed — another font, a Vive/Windows Motion controller
model — fetch it the same way and add it under the matching path here (the
path after `AFRAME_CDN_ROOT` must match `cdn.aframe.io`'s layout exactly,
e.g. `controllers/hands/leftHandLow.glb`). `cdn.aframe.io` itself mirrors
[`aframevr/assets`](https://github.com/aframevr/assets) on GitHub, which is
a fine fallback source for a given path if `cdn.aframe.io` is ever
unreachable from wherever you're fetching from — that's where the
`oculus-hands/v4/*.glb` files above came from.

## Bumping the A-Frame version

1. `npm pack aframe@<version>` somewhere scratch, extract it, and copy
   `dist/aframe-v<version>.min.js` into a new `vendor/aframe-<version>/`
   folder.
2. Re-fetch the same set of asset paths (font + hand models) into that
   folder — they're stable across A-Frame versions but worth re-checking
   the source for `AFRAME_CDN_ROOT`-based URLs in case a version bump
   changed a filename.
3. Update the `<script>` tags in every `games/*/index.html` and
   `primitives/*/index.html` to point at the new folder.
4. Delete the old `vendor/aframe-<old-version>/` folder once nothing
   references it.
