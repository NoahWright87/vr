# The cast and their voices

## Characters

Challengers are ghost actors and tourists at the attraction, and each
one is defined by a quirk. A character is data:

- name and title (a pun), and their wanted poster
- outfit (wardrobe items, see `wardrobe.todo.md`)
- duelist settings (`dueling.todo.md`): draw speed, accuracy, tell,
  nerve, quirk
- signature card(s) they unlock (`deck.todo.md`)
- voice preset (below)

Quirk examples:
- the cheat who turns on eight
- the drunk who can't aim straight
- the show-off who only shoots hats
- the one who insists on loading a cannon by hand

There's also an **announcer**: the voice of the shtick. They read out
"Pistols... at DAWN... DOWNTOWN!", count paces, call false starts and
shout trick names. Who it is (the undertaker? the town crier?) is
still open.

## Procedural characters

If characters are data, a **seed** can make one: random name parts,
outfit, duelist settings and a voice preset. Good for endless bounties
and filler tourists in town. Story characters stay handwritten.

## The voice engine: Animal Crossing style

Animal Crossing's "Animalese" isn't speech generation. It reads the
text a letter or syllable at a time, plays a tiny sound for each one,
and varies pitch and speed per character. This suits us:

- **Runs from text, live, in the browser.** Web Audio sample playback
  with `playbackRate`/`detune`. A few hundred lines, no network, no
  per-line cost.
- **Deterministic.** A preset (which sound set, base pitch, pitch
  spread, speed, rising on `?`, pauses on punctuation) plus a seed
  from the character id means the same line always sounds the same
  for that character.
- **Says anything**, including the player's name from their profile
  (`phase01-c`) and procedural characters' names.
- **The sound set can be recorded in your own voice.** Pitched and
  sped up per character, it won't sound like you, so one person can
  voice a whole town.
- Show text in a speech bubble or banner alongside, so the words are
  always readable.
- Audio in a browser needs a user gesture to start. Entering VR counts
  as one.

## Recorded lines for key moments

Catchphrases and the announcer's big lines are worth real voiceover,
layered on top of the gibberish. To make one performer sound like
several people, use **speech-to-speech voice changing**: you act the
line (accent, timing) and the tool swaps the voice. Known options at
planning time (check what's current):

- **ElevenLabs Voice Changer**: easiest, lots of stock voices.
- **RVC**: open source, runs locally, more tinkering.
- **Voicemod**: real-time, more novelty.

Use stock voices or ones you have rights to, check commercial terms if
this ever goes public, and don't imitate real people.

## When

The voice engine is a system, not polish, and it doesn't depend on
anything else. Proposed as a parallel track in phase 04, when the
first cast needs it. Recording lines and picking sounds is polish
(phase 05+).
