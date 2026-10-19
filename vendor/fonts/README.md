# Fonts

Two faces, each in two forms: a `.woff2` for anything drawn with the 2D
canvas (the HUD draws its slots that way — see `common/visor-hud.js`) and an
MSDF atlas (`*-msdf.json` + `*-msdf.png`) for A-Frame's `<a-text>`, which
cannot use a web font at all.

| Face | Use it for | Files | Licence |
|---|---|---|---|
| **B612** | Everything you read: numbers, labels, hints | `B612-Regular.woff2`, `B612-Bold.woff2`, `B612-{Regular,Bold}-msdf.*` | SIL OFL 1.1 (`B612-OFL.txt`) |
| **Wright Sans** | Headings and big moments only | `WrightSans-{Bold,Black}.woff2`, `WrightSans-Bold-msdf.*` | MIT, Noah Wright |

**B612** was commissioned by Airbus for cockpit displays: open shapes, an
unmistakable `I l 1` and `O 0`, and figures that are all the same width, so a
counter going from 11 to 10 does not shift sideways. It is the default for
anything a player reads at a glance. Source:
[polarsys/b612](https://github.com/polarsys/b612), via google/fonts.

**Wright Sans** is the site's own heading face. Its source of truth is the
`@noahwright/design` package (`src/styles/fonts/`); that package does not
export the font files, so the two weights the HUD uses are copied here. A
display face falls apart at small sizes in a headset, so keep it to titles.

## In a menu

Any crossbar menu takes them by name: `crossbar-menu="font: b612;
titleFont: wright"` (see `MENU_FONTS` in `common/menu-crossbar.js`), or
`setFont(body, title)` to change one live. Wright Sans has no `‹ ›`, so
under it a row's chevron falls back to B612.

## Using the atlases with `<a-text>`

```html
<a-text value="06/12" font="/vendor/fonts/B612-Bold-msdf.json" negate="false"></a-text>
```

Set `negate: false`. These atlases come from `msdf-bmfont-xml`, whose
field is not inverted the way A-Frame's bundled fonts are; with A-Frame's
default (`negate: true`) the text still renders, but heavier and with dark
fringes around each glyph.

## Regenerating

Characters baked: printable ASCII plus `°·×–—…’‘“”•←→↑↓‹›▸`. To add more, or
another weight:

```sh
# woff2 -> ttf, if starting from a woff2 (pip install fonttools brotli)
python -c "from fontTools.ttLib import TTFont; f=TTFont('In.woff2'); f.flavor=None; f.save('In.ttf')"
# ttf -> MSDF atlas (npm install msdf-bmfont-xml@2.8.0, outside the repo)
msdf-bmfont -f json -o Name-msdf -s 42 -r 4 -t msdf --pot --smart-size -i charset.txt In.ttf
```

Then rename the `.json` to match the `.png` (`Name-msdf.json`), since
A-Frame finds the image by swapping the extension, and minify it.
