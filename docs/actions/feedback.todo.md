# Feedback: selling the outcome

Everything that makes a hit read as a hit. Most of it is cheap. All of
it is what Punch Pop's auto-hit lacked.

## The action clock (do this first, from the first component)

A scene system, `action-clock`, owns `timeScale` and hit-stop:

```js
clock.dt(entity)       // the scaled dt this entity should integrate with
clock.hitStop(entity, ms)  // freeze one entity (and its children) briefly
clock.setTimeScale(s, rampMs)
```

- **Bullet time** slows enemies, projectiles and effects. It never
  slows the player's own hands, head or virtual hands, because in VR
  slowing the player's body is impossible and slowing its rendering is
  nauseating. So "the world is slow and I'm fast", which is exactly the
  John Wick and Superhot feeling.
- **Hit-stop**: freeze the *struck target* for ~40–80 ms on a heavy
  hit. It's not a global freeze, since the player's view and hands must
  stay live. A target-only freeze reads clearly and costs no comfort.
- What triggers bullet time (several attacks at once? a parry? a
  meter?) is a game-design question for later. The clock just has to
  exist so every action component already respects it.

## Effects pools

A shared `effect-pool` module. Entities (or better, instanced mesh
slots) are acquired from a free list, scaled from unit size, and
released, never created or destroyed per event. Pistols does this for
smoke, debris, sparks and liquid pools (`core.js` ~943–1000,
`core-substances.js` `acquirePoolEl`). Lift the pattern, not the code.
Needed for: muzzle flash, tracer, impact sparks, shards (the Superhot
death), shell casings, decals.

Use `THREE.InstancedMesh` per effect type where the count gets high
(shards, sparks). The root `TODO.md` already flags Pistols' droplets as
"a draw-call budget in disguise". Don't repeat that here. No per-shot
lights: a muzzle flash is an unlit additive sprite.

## Haptics

`common/haptics.js` has `pulseHaptics(handEl, intensity, ms)` and
handles both actuator APIs. Add a small named-pattern layer on top:
`shot`, `hit-light`, `hit-heavy`, `block`, `parry`, `kill`,
`threat-left/right`. Each is a short sequence of pulses, with one
global strength setting. Hand tracking has no haptics, so feedback
must never depend on them.

## Sound

Synthesized with Web Audio, as Pistols does (no assets). A small voice
pool so autofire can't spawn hundreds of nodes. Spatialised with
`PannerNode` for threats. Shot, thump, block clang, parry ring, shatter.

## The player being hit

A red edge flash drawn in clip space, using the technique Pistols'
vices vignette uses because WebXR has two per-eye projections
(`items-vices.js`). Haptics on both hands. Never shake or push the
camera.
