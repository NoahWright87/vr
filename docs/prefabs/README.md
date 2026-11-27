# Prefabs: the plan

Notes for whoever picks this up next (probably another LLM session).
The goal: **a library of usable objects that every game can drop in.**
How you hold a gun, which way it fires, what a cannonball weighs and
how many hands it takes: worked out once, in data, and never again in a
game.

It started with a screenshot. The menu showcase's SMG was being held
wrongly, with the bullets leaving from the back. The cause was never one
wrong number. Nothing said what a model's *forward* or its *grip* was, so
each demo guessed by eye: a hand-tuned `rotY`, `pos` and `muzzle` per gun
in `primitives/menus/demo-shooter.js`, plus a separate `heldPosition` in
the page. (The guess was wrong: the Blaster Kit models already face -Z,
and the demo turned the rifle and SMG round 180°.) The 3D Model Toybox
had a similar gap: 228 models, but they were *only* models.

## What a prefab is

Everything that is true of an object in every game that uses it:

- its **model**, and the **fit** that puts it in the prefab frame
  (-Z forward, +Y up, metres, origin at the best pivot);
- its **mass**;
- **interaction points**: where hands go on it, which hands, how many at
  once, and in what pose;
- **emitters**: where things come out (muzzle flash, shells, exhaust);
- **attachment sockets**: where other prefabs fit (rail, muzzle, magazine);
- free-form **stats** that nothing here interprets.

What *happens* when you use it (what a gun fires, what a rocket does when
it dies) is a game's business, by default wired up to sensible prefabs a
game can override. That is the StarCraft 2 editor's model: this Gun fires
this Rocket, whose death spawns this Explosion. See `wiring.todo.md`.

If a game wants the same M16 as another game, they share the prefab. If
several games share a universe, they share the stats. A game that wants
the M16 to fire plasma balls changes one entry in its own bindings.

## File convention

Same as `docs/actions/`:

- `<topic>.spec.md` is the present: what exists, where it lives, how it
  behaves. Keep it true.
- `<topic>.todo.md` is decided-on future work with the reasons behind it.
  When something is built, move its substance into the spec and delete it
  from the todo. Don't leave a done-checklist behind.

| Topic | Spec | Todo |
|---|---|---|
| The prefab format, component and data | `prefabs.spec.md` | `prefabs.todo.md` |
| Hand poses as data | `hand-poses.spec.md` | `hand-poses.todo.md` |
| The workshop editor and the copy-out loop | `workshop.spec.md` | `workshop.todo.md` |
| Hands actually holding a prefab (one hand, two, locked, steering) | | `holding.todo.md` |
| Weight, strength and reach | | `weight.todo.md` |
| Defaults, bindings and overrides | | `wiring.todo.md` |

## Principles

1. **Data, not code.** A prefab is JSON. A game never contains a number
   that says how to hold a thing. If one does, it belongs in the prefab.

2. **Define each thing once, in the frame it is used in.** Everything is in
   the prefab frame: -Z forward, +Y up, metres. Fix a model that faces the
   wrong way in `fit`, never in the game that uses it.

3. **Hands are placed in the hand model's own frame.** An occupant says
   where the hand .glb's origin and axes go (fingers -Z, palm -Y, thumb -X
   on the right hand). The left hand of an `either` point is the right hand
   mirrored across the prefab's X = 0 plane, unless it has its own. The
   left hand model is an exact mirror of the right, so one pose serves both.

4. **Edit on a normal screen, test in the headset.** The workshop is a
   desktop page. Authoring hand placements with a thumbstick would be
   miserable, and everything should be reachable on a laptop anyway (see
   `TODO.md` ▸ Desktop semantic hands). The headset is for feel.

5. **The copy-out loop is the product.** Noah edits, presses *Copy changed
   JSON*, pastes it to Claude, and Claude commits it
   (`scripts/apply-prefab-export.mjs`). If that loop is clumsy the whole
   workshop is useless, so keep it one click and keep the output small:
   only what changed, each changed entry whole.

6. **Pure cores, thin shells.** `common/prefab-core.js` and
   `common/hand-pose-core.js` are plain functions with tests. The A-Frame
   component, the bone driver and the workshop page are thin layers on top.

7. **Don't test feel with a script.** A contact test that "checks the
   barrel is ahead of the palm" would pass and fail for the wrong reasons
   across every kind of object. Correctness here is visual: the workshop
   shows the real hand on the real object. What *is* tested is the data's
   shape, the maths, the export loop and the workshop's real mouse paths.

## Build order

1. **Done:** the format, the pose data and bone driver, the `prefab`
   component, the workshop with the copy-out loop, seed prefabs for the
   shooter demo's guns and grenade.
2. Move the shooter demo onto prefabs (`holding.todo.md`), which is where
   the original screenshot bug gets fixed for good.
3. Hands actually holding prefabs, one hand and then two (`holding.todo.md`).
4. Weight, strength and reach, with the Toybox strength slider
   (`weight.todo.md`).
5. Defaults, bindings and the Toybox override menu (`wiring.todo.md`).
6. The rest of the catalog, and migrating Pistols at Dawn.
