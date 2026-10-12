# Targeting: one resolver for every verb

Guns, strikes, throws and parries all ask the same question: *given
this vague intent, which target do you mean?* Today there are three
separate answers:

- **Punch Pop**: a lock cone of 40° from gaze, range 2 m plus a swing
  bonus, and a 2 s memory of the last enemy you looked at
  (`punch-locomotion.updateRecentLookTarget`).
- **Pistols' overhand throw**: the gaze ray hits a point
  (`findLookTarget`, `games/pistols-at-dawn/js/core.js` ~1674).
- **`common/interaction-targeting.js`**: direct hit → priority → gaze →
  distance. That's for menus and grabs.

Keep `interaction-targeting` for "what will this button act on". Combat
gets its own resolver, because it runs continuously, it scores rather
than ranks, and it has to explain itself to a debug overlay.

## Shape

A `combat-targeting` system holds every live `combat-target`
(mutation-indexed, kept up to date as entities come and go, never by
querying the DOM each frame) and answers:

```js
resolve(profileName, { origin, direction, hand, exclude }) →
  { target, zone, aimPoint, score, candidates: [{ target, score, terms }] }
```

**Profiles** are data, one per verb, and tunable from the visor:

| profile | range | cone | gaze weight | notes |
|---|---|---|---|---|
| `gun` | 25 m | 35° | low | spread fire across targets |
| `strike` | 1.6 m | 60° | high | prefers current target (combos) |
| `throw` | 15 m | 25° | high | aim point, not just entity |
| `guard` | 1.2 m | 360° | none | candidates are *attacks*, not bodies |

**Score terms** (each logged in `terms` for the overlay):

- angle from the aim ray (shoulder→hand for guns, gaze for throws);
- distance;
- gaze angle now;
- recent gaze, Punch Pop's memory generalized: a decaying "looked at"
  value per target, so turning your head mid-swing doesn't lose the
  lock;
- **stickiness**: a bonus for the target this hand already has.
  Hysteresis stops autofire flicking between two equally good targets
  every frame;
- threat: an attack in progress ranks higher;
- **claimed**: a penalty for targets another hand or pending damage
  already covers, so two guns split a crowd instead of overkilling one;
- line of sight: budgeted raycasts, at most N per frame, cached per
  target for ~100 ms.

## Cost

Bullet heaven means many targets. Pre-cull with squared distance and a
cheap dot-product cone test before any scoring, and resolve each
profile at most once per hand per frame. The pure scorer takes plain
arrays, so it can be benchmarked in `node --test` with 500 fake
targets.

## Overlay

Debug channel `targeting`: each hand's cone; every candidate's score as
a small number on it; a line to the winner. That's what turns "it shot
the wrong guy" into a tuning change.
