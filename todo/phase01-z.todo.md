# Phase 01-Z: the voice engine and the Voice Lab

**A standalone track.** It depends on nothing and nothing depends on
it. Start it any time, even before phase 01, and run it alongside
anything. Until it lands, characters just show text. Hooking it into
the game is a later job (phase 04).
**Design:** `cast.todo.md` ("The voice engine").

## Why this exists

VR work is slow to iterate on because headset testing doesn't happen
often. This is the opposite: a **non-VR web page** where you type a
line, pick a voice, drag sliders and hear the result immediately, then
tweak and play again, as often as you like, from a laptop or phone.
It's the fast-feedback corner of the project.

## Where it lives

`export-later/packages/voice/`, following the rules in
`export-later/README.md`: it imports nothing from the rest of the repo,
the repo uses only its public entry, and its demo page lives inside it.
It's headed for its own repo and npm package once it's stable.

Suggested layout:

```
export-later/packages/voice/
  package.json        name, "type": "module", "exports" → ./src/index.js, private for now
  README.md           what it is, the preset format, a usage example
  src/
    index.js          public entry: createVoice / speak / presets / banks
    text.js           text → units (letters or syllables), pauses, punctuation
    schedule.js       preset + seed + units → a timed list of notes (pure, deterministic)
    random.js         small seeded random-number generator (e.g. mulberry32) + string hash
    player.js         Web Audio playback of a schedule
    banks/synth.js    built-in synthesized "vowel blip" bank, so it works with no recordings
  test/
    *.test.js         node --test: text splitting, schedule determinism, preset defaults
  demo/
    index.html        the Voice Lab page
    lab.js
```

## The engine

1. **Text → units.** Normalize text and split it into letters
   (Animalese-style) *or* syllables. Make that a preset setting so the
   lab can compare them. Punctuation adds pauses. `?` rises at the
   end, `!` gets emphasis. Unknown characters are skipped, never thrown
   on.
2. **Units → schedule (pure).** A preset plus a seed plus the units
   gives a list of `{ time, duration, sound, pitch, gain }` notes.
   **Deterministic:** the same preset, seed and text always give the
   same schedule. The seed comes from a character id (and optionally
   the line), so a character always sounds like itself. This is the
   part most worth unit-testing.
3. **Playback.** Web Audio: decode the bank's sounds once, then play
   each note as a sound source with `playbackRate`/`detune` and a short
   volume ramp so there are no clicks. Supports `stop()` and a callback
   per unit (`onUnit(index, text)`), so a speech bubble can reveal text
   as it's spoken and a mouth can flap later. An `AudioContext` passed
   in from outside is allowed, since the game will want to share its
   own. Audio only starts after a user gesture (a click on the page;
   entering VR in the game).
4. **Sound banks.** The interface is just "a named set of short sounds"
   (URLs or `AudioBuffer`s, keyed by unit or vowel group). Ship a
   **built-in synthesized bank** (oscillators through vowel-ish
   bandpass filters, rendered to buffers) so the lab makes sound from
   the very first run with no recordings at all. Recorded banks (your
   own voice, see `cast.todo.md`) plug in through the same interface
   later, and as game assets they don't live in this package.
5. **Presets are plain JSON.** Bank, letters/syllables, base pitch,
   pitch spread, speed, unit length, gap, question rise, exclamation
   emphasis, volume, seed. Every field has a default, so `{}` is a
   valid preset. Add a `randomPreset(seed)` for procedural characters.

## The Voice Lab page

- **A text box** with a few starter lines, including a `{name}`
  placeholder filled from a "player name" field, to check that names
  sound right.
- **Starter presets** in a dropdown, such as a gruff sheriff, a squeaky
  tourist, a drawling announcer and a nervous greenhorn.
- **A slider for every preset field**, with live replay. Settings
  apply the next time you press play, or re-play automatically when a
  slider is released.
- **Play / stop**, "new seed", and "random character" (`randomPreset`).
- **A/B**: two preset slots and a toggle, to compare tweaks.
- **Copy / paste preset JSON**, plus a saved-presets list in
  `localStorage` (wrapped in try/catch, works without storage).
- **A bank picker**: synth for now, recorded banks later.
- The text being revealed as it's spoken (from `onUnit`).
- Works with mouse and keyboard and on a phone. Plain HTML/CSS/JS is
  fine, no framework needed.
- **Optional extra:** a recorder that walks you through recording each
  sound in a bank with the microphone, plays them back and exports
  them. It's the quickest path from "I want to try my own voice" to
  hearing it. Do it once the rest works.

## Touches outside the package (the only ones allowed)

- `vite.config.js`: add the demo page to `build.rolldownOptions.input`
  (e.g. `voiceLab: resolve(root, 'export-later/packages/voice/demo/index.html')`).
- A link to the Voice Lab from the site. The landing page links
  primitives from `src/App.jsx` / `src/SiteChrome.jsx`.

Nothing in `games/` or `common/` changes in this phase.

## Done when

- `npm test` runs the package's tests: text splitting (letters and
  syllables, punctuation, unknown characters), schedule determinism
  (same input gives an identical schedule, different seed gives a
  different one), and preset defaults (`{}` works).
- Playwright opens the Voice Lab from `npm run dev` and from the built
  `dist/`, changes a slider, presses play, and checks real audio came
  out. One way: render the same schedule through an
  `OfflineAudioContext` from the page and check the result isn't
  silent and is about the expected length. Don't just check that the
  page loaded.
- `export-later/packages/voice/` imports nothing from outside itself
  (worth a test that reads the source files and fails on any import
  path that climbs out of the package).
- The package README documents the preset format and how to use it.
- Recorded as needing ears: which starter presets sound good, letters
  vs syllables, how the synth bank sounds compared with a recorded one.
