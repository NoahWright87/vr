# Actions: the plan

Notes for whoever picks this up next (probably another LLM session).
The goal: **a VR game that makes you feel like John Wick without being
that talented.** Guns aim and fire themselves, hands that drift near an
attack block it, punches always land. Bullet-heaven and autobattler
thinking: take the precision away and the player becomes absurdly
powerful, which is the excuse to throw far more enemies at them.

Long term it looks something like Superhot: a limited number of
low-poly enemies, simple environments, much more physical movement. For
now everything is a **primitive, showcase or POC**. Enemies are
silhouette targets and peg-arm dummies until there are real assets.

Movement is a solved problem for this plan. Impossible spaces and
distorted motion live on `codex/impossible-spaces` and
`codex/expansive-spaces` and will merge when they're ready. This plan
covers **actions**: what your hands do and what happens because of it.

## File convention

- `<topic>.todo.md` is the future: decided-on work, the reasons behind
  it, and enough context to start cold.
- `<topic>.spec.md` is the present: what exists, how it behaves, where
  it lives. Write it when the first code for a topic lands, and keep it
  true. When a todo item is built, move its substance into the spec and
  delete it from the todo. Don't leave a "done" checklist behind.
- The root `TODO.md` still holds everything that isn't about actions.

## Principles (read before building any of it)

1. **Position is the input.** No action needs a button press or a hand
   pose. Controllers, hand tracking and desktop semantic hands all reduce
   to "where are the head and the two hands, over time". Buttons and
   poses can be optional extras, never requirements. Orientation (wrist
   rotation) is available, but treat it as a weak hint: hand tracking's
   wrist is noisy, and "point roughly at them" is supposed to be enough.
   Aim comes from the shoulder→hand ray, not from the wrist.

2. **Sense → resolve → sell.** Every action is three separable steps:
   - *Sense* the intent from motion (`intent.todo.md`, built on
     `motion-sense`).
   - *Resolve* it to a target (`targeting.todo.md`).
   - *Sell* the outcome so it looks earned (`virtual-hands.todo.md`,
     `feedback.todo.md`, the reactions in `dummies.todo.md`).
   Punch Pop built sense twice over and resolve partly; it never had a
   sell step, and that's most of why "auto-hit" felt arbitrary.

3. **The comfort budget: the faster you physically move, the more we
   may cheat.** Punch Pop's real failure: motion that wasn't a punch got
   read as one and slid the player while they stood still. Correct reads
   during a real punch, slide included, felt fine. So every cheat (virtual
   hand drift, view yaw, lunge) is paid for from a budget that real
   physical motion earns, and stillness earns nothing.
   See `comfort-budget.todo.md`.

4. **Cheat on the world's side first.** In order of preference: move
   the enemy (lean into the punch, flinch early), move the virtual hand,
   move the view. A dummy stepping into your fist costs nothing in
   comfort. Rotating the camera costs the most.

5. **Everything tunable live, everything visible.** Every number gets a
   visor row. Every subsystem gets a readout that shows its current
   settings and state in one screenshot-able sidecar, and a debug
   overlay that draws what it's thinking. The workflow is: Noah tries it
   in the headset, screenshots the sidecar, and says what felt wrong.
   See `debug-tuning.todo.md`.

6. **Pure cores, thin A-Frame shells.** Same pattern as
   `common/menu-model.js` and `common/play-space.js`: the logic is plain
   functions over plain numbers and vectors, tested with `node --test`.
   The A-Frame component only collects inputs and applies outputs.
   Motion classifiers are tested against **recorded real motion**,
   including negatives (standing still, looking around, turning, reaching
   for the visor), not only synthetic traces.

7. **One clock.** Every action component takes its dt from a shared
   action clock (`feedback.todo.md`) rather than raw `tick(time, dt)`, so
   hit-stop and bullet time can slow the world without slowing the
   player. Retrofitting this later is miserable, so do it from the first
   component.

8. **Bullet heaven means many enemies on a Quest 2.** Pool everything
   (no entity creation per shot or per hit), keep target queries cheap
   (squared distance pre-cull, budgeted raycasts), and draw debug
   overlays in one batched draw call.

9. **Shared code lives in `common/` as ES modules** and depends on
   nothing in `games/`. Pistols at Dawn stays as it is. It migrates onto
   this code *much* later. Lift ideas and formulas from it (the files
   say where), never its globals.

## The pieces, and the order to build them

Each step should end with something to try in the headset, a visor page
to tune it, and tests.

| # | Topic | File | Why this order |
|---|---|---|---|
| 0 | Motion sensing | `motion-sense.todo.md` | Everything reads it. Its *motion energy* signal is the comfort budget's currency. **Built** (`motion-sense.spec.md`). |
| 1 | Tuning & debug | `debug-tuning.todo.md` | Before there's much to tune, so every later piece gets rows, readouts and overlays for free. **Built** (`debug-tuning.spec.md`). |
| 2 | Targets & dummies | `dummies.todo.md` | Silhouettes first. Something to shoot at. **Silhouettes built** (`dummies.spec.md`). |
| 3 | Targeting | `targeting.todo.md` | One resolver for guns, punches, throws and parries. **Built** (`targeting.spec.md`). |
| 4 | Autofire | `autofire.todo.md` | Simplest full sense→resolve→sell loop, and the most immediately fun. **Built** (`autofire.spec.md`). |
| 5 | Comfort budget | `comfort-budget.todo.md` | Needed before anything moves the hand or view. **Built** (`comfort-budget.spec.md`). |
| 6 | Virtual hands | `virtual-hands.todo.md` | The tool for selling melee and blocks. **Built** (`virtual-hands.spec.md`). |
| 7 | Intent | `intent.todo.md` | Strike and guard classifiers, plus recording real motion. **Strikes built** (`melee.spec.md`). |
| 8 | Melee | `melee.todo.md` | On the peg dummy. **Built** (`melee.spec.md`). |
| 9 | Defense | `defense.todo.md` | Needs attacker dummies with telegraphed attacks. |
| 10 | Throwing | `throwing.todo.md` | Extraction from Pistols, generalized. |
| 11 | Feedback | `feedback.todo.md` | Parts of it (effect pools, the clock) are needed from step 4 onward; hit-stop and bullet time come here. **Clock, pools, haptics, sound built** (`feedback.spec.md`). |
| — | Physics | `physics.todo.md` | Long-term needs and options. No library yet. |

All of it is demonstrated in one showcase, `primitives/actions/`, the
way `primitives/menus/` is the Storybook for menus: stations laid out
against the real room with `play-space-station`. Planned stations:

- **Motion lab**: live motion-sense readout. Built (left).
- **Range**: silhouettes for autofire. Built (ahead).
- **Dummy**: peg-arm dummies for melee. Built (right).
- **Sparring**: an attacker dummy for defense.
- **Lane**: throwing.
- **Swarm**: the bullet-heaven stress test, N cheap walkers
  approaching, with the performance readout on.

## Glossary

- **Tracked hand**: where the controller or hand-tracking says the hand
  is. Truth, and the input.
- **Virtual hand**: what's drawn and what collides. Usually equal to the
  tracked hand. Assists may pull it away within the budget.
- **Ghost hand**: an optional translucent render of the tracked hand,
  shown when the two differ.
- **Body frame**: an estimated torso position and facing, derived from
  the head. There's no body tracking. See `motion-sense`.
- **Motion energy**: a 0–1 signal of how vigorously the player is
  physically moving right now. Earns the comfort budget.
- **Presented**: a hand held out away from the body. For a gun hand,
  that's what "on" means.
