import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/rainbow-hotel/index.html', import.meta.url), 'utf8');
const experience = readFileSync(new URL('../games/rainbow-hotel/js/hotel-experience.js', import.meta.url), 'utf8');
const architecture = readFileSync(new URL('../games/rainbow-hotel/js/hotel-architecture.js', import.meta.url), 'utf8');
const viteConfig = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');
const landing = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('the prototype is wired into the build and the landing page', () => {
  assert.match(viteConfig, /rainbowHotel: resolve\(root, 'games\/rainbow-hotel\/index\.html'\)/);
  assert.match(landing, /href="\/games\/rainbow-hotel\/"/);
  assert.match(page, /AFRAME_CDN_ROOT = '\.\.\/\.\.\/vendor\/aframe-1\.6\.0\/'/);
  assert.match(page, /src="\.\.\/\.\.\/vendor\/aframe-1\.6\.0\/aframe-v1\.6\.0\.min\.js"/);
});

test('lighting cannot betray the rise: ambient and directional only, no shadows', () => {
  // A point light near the shaft would shade the hallway's walls
  // differently at every height it passed through, which is the single
  // cue this whole design exists to withhold. Same for a shadow.
  assert.match(page, /light="type: ambient/);
  assert.match(page, /light="type: directional/);
  assert.doesNotMatch(page, /type: point/);
  assert.doesNotMatch(page, /type: spot/);
  assert.doesNotMatch(page, /castShadow: true/);
  assert.doesNotMatch(architecture, /type: point/);
  assert.doesNotMatch(architecture, /type: spot/);
  // The hallway's own lighting is an emissive surface, not a light.
  assert.match(architecture, /hotel-hallway-lamp/);
  assert.match(architecture, /hotel-hallway-sconce/);
});

test('the rise is driven by walked distance, never by a clock', () => {
  // A timed rise would keep climbing while the player stood still, and
  // would reach the far doorway out of step with them.
  assert.match(experience, /floorHeight \* state\.rise/);
  assert.match(experience, /hallwayProgress\(plan, x, z\)/);
  assert.doesNotMatch(experience, /setInterval/);
  assert.doesNotMatch(experience, /Date\.now\(\)/);
  // tick() must not feed the head's height back into the thing that
  // sets the head's height.
  assert.match(experience, /this\.step\(this\.headLocal\.x, this\.headLocal\.z\)/);
});

test('the player rig and the hallway are moved together, from one number', () => {
  assert.match(experience, /applyFloorY: function \(floorY\)[\s\S]*?hallway\.object3D\.position\.y = floorY;[\s\S]*?rigEl\.object3D\.position\.y = floorY;/);
});

test('the shared checkerboard and Guardian modules are reused, not re-implemented', () => {
  assert.match(architecture, /import '\.\.\/\.\.\/\.\.\/common\/checkerboard\.js'/);
  assert.match(experience, /from '\.\.\/\.\.\/\.\.\/common\/guardian-bounds\.js'/);
  assert.match(architecture, /checkerboard: 'color: ' \+ floor\.wall/);
  // No second copy of "make a canvas, fill two rects, tile it".
  assert.doesNotMatch(architecture, /fillRect\(0, 0, 64, 64\)[\s\S]{0,200}fillRect\(32, 32/);
});

test('the settings panel is built from the same list the runtime reads', () => {
  assert.match(experience, /export var TUNABLES/);
  assert.match(page, /TUNABLES\.forEach/);
  for (const key of ['floorHeight', 'baffles', 'laneWidth', 'stubDepth', 'passGap', 'doorWidth']) {
    assert.match(experience, new RegExp(`key: '${key}'`));
  }
  // Settings persist locally, which is how they can be set on the flat
  // page of a Quest and still be there after Enter VR.
  assert.match(experience, /localStorage\.setItem\(STORAGE_KEY/);
  assert.match(experience, /localStorage\.getItem\(STORAGE_KEY/);
});

test('the in-headset readout is on by default, and can be turned off for a real run', () => {
  // This started off, on the argument that the *windows* should be what
  // tells you which floor you are on, and a caption saying "Green, floor
  // 4" answers that for the player. It flipped after the first headset
  // session failed on something invisible from inside. The switch is
  // still there for a run where the windows have to do the talking.
  assert.match(experience, /debug: true/);
  assert.match(page, /id="debug"/);
  assert.match(experience, /syncReadout: function/);
  assert.match(experience, /removeAttribute\('hotel-readout'\)/);
});

test('the POC really does stop at walking: no interactions are wired up', () => {
  // Explicitly out of scope per the spec -- hand tracking, grabbing,
  // doors, anything to trigger. Checked against the scene markup alone,
  // since the flat page around it is allowed its own buttons.
  const scene = page.slice(page.indexOf('<a-scene'), page.indexOf('</a-scene>'));
  assert.ok(scene.length > 100, 'found the scene markup');
  for (const absent of ['hand-controls', 'laser-controls', 'raycaster', 'cursor', 'grab']) {
    assert.doesNotMatch(scene, new RegExp(absent), `${absent} should not be in the scene`);
  }
  // Controllers are the one exception, and only for the setup tools:
  // drawing the floor rectangle by hand, and the wrist menu that drives
  // it. Nothing in the hotel itself reacts to them, so the spec's "no
  // interactions" still holds where it was aimed.
  assert.match(scene, /hand-with-watch="hand: left"/);
  assert.match(scene, /oculus-touch-controls="hand: right; model: false"/);
  assert.doesNotMatch(scene, /oculus-touch-controls="[^"]*model: true/);
  assert.match(page, /setAttribute\('floor-calibration'/);
});

test('every setting is reachable from inside the headset, on the wrist', () => {
  // The HTML panel is unreachable the moment you press Enter VR, so
  // pointing someone in a headset at a tick box there is pointing them
  // at something they can neither see nor touch. This is the same
  // `hand-with-watch` primitive two other prototypes already use, not a
  // third hand-rolled menu.
  assert.match(page, /import '\.\.\/\.\.\/common\/watch-menu\.js'/);
  assert.match(page, /<template id="watch-menu-template">/);
  for (const value of ['toggle-hotel', 'toggle-edit', 'reset-floor', 'toggle-hand-floor', 'toggle-readout']) {
    assert.match(page, new RegExp(`menu-item="value: ${value};`), `${value} should be a menu row`);
  }
  // Both surfaces go through apply(), so touching one updates the other
  // rather than the two drifting apart.
  assert.match(page, /addEventListener\('menu-item-select'/);
  assert.match(page, /function syncMenuLabels/);
  assert.match(page, /apply\(\{ showHotel: !settings\.showHotel \}\)/);
});

test('the building is down until the floor has been fitted to a real Guardian', () => {
  // The hotel stands on a rectangle that has not yet been shown to land
  // inside anyone's actual boundary, and while the walls are up they hide
  // the only thing worth looking at, which is that rectangle on the floor
  // next to the boundary it is meant to fit. The geometry is withheld;
  // none of the code that builds it has gone anywhere.
  assert.match(experience, /showHotel: false/);
  assert.match(experience, /this\.settings\.showHotel \? buildHotel\(this\.rootEl, this\.plan\) : clearHotel\(this\.rootEl\)/);
  assert.match(experience, /import \{ buildHotel, buildSky \}/);
  assert.match(page, /id="showHotel"/);
  // Switching it off has to take down what is already standing, and
  // everything downstream has to survive there being no building.
  assert.match(experience, /function clearHotel/);
  assert.match(experience, /if \(this\.built && this\.built\.hallway\)/);
  assert.match(experience, /if \(!this\.plan \|\| !this\.built \|\| !this\.cameraEl\) return;/);
});

test('the floor rectangle can be redrawn by hand, from inside the headset', () => {
  const calibration = readFileSync(new URL('../games/rainbow-hotel/js/floor-calibration.js', import.meta.url), 'utf8');
  // The laser aims, hover swells the handle, and grip drags it.
  for (const event of ['gripdown', 'gripup']) {
    assert.match(calibration, new RegExp(event), `${event} should be handled`);
  }
  // Grip and nothing else. Starting an edit and resetting the floor used
  // to sit on the face buttons and the trigger, which are exactly what
  // the wrist menu activates its rows with -- so a trigger pull aimed at
  // a menu row would also throw away the floor behind it.
  for (const taken of ['abuttondown', 'bbuttondown', 'xbuttondown', 'ybuttondown', 'triggerdown']) {
    assert.doesNotMatch(calibration, new RegExp(`addEventListener\\('${taken}'`),
      `${taken} belongs to the menu now`);
  }
  assert.match(calibration, /hoverRadius/);
  assert.match(calibration, /handleRadius/);
  // -Z, explicitly. getWorldDirection hands back +Z for a plain Object3D
  // and has cost this repo an afternoon before.
  assert.match(calibration, /forward\.set\(0, 0, -1\)\.applyQuaternion\(quaternion\)/);
  assert.doesNotMatch(calibration, /\.getWorldDirection\(/);
  // Only a hand-dragged corner is saved. Persisting the automatic read
  // would make the next load mistake it for a correction and stop
  // following the Guardian at all.
  assert.match(calibration, /resetToAutomatic: function \(\)[\s\S]*?clearStoredCorners\(\);/);
  assert.match(calibration, /release: function \(\)[\s\S]*?writeStoredCorners\(this\.corners\);/);
});

test('a saved play-space size cannot silently outrank a real Guardian', () => {
  // The first headset test built against a guess and never noticed. One
  // of the ways that could happen: the settings panel writes every field
  // it holds to local storage, so once the play-space boxes had been
  // nudged on any device, the saved numbers vetoed the real boundary
  // from then on -- in a headset, with nothing saying so.
  assert.match(experience, /export function overrideActive/);
  assert.match(experience, /settings\.useOverride && \(settings\.safeX \|\| settings\.safeZ\)/);
  // Every decision point asks the same question, rather than each
  // re-deriving it from whether a size happens to be set.
  assert.doesNotMatch(experience, /settings\.safeX \|\| self\.settings\.safeZ/);
  assert.doesNotMatch(experience, /!this\.settings\.safeX && !this\.settings\.safeZ/);
  assert.match(page, /id="useOverride"/);
  // Turning it back off has to hand the play space back to what was
  // measured. That used to be three independently-derived answers at
  // three decision points, which is how they came apart in the first
  // place; there is now exactly one function that decides, and turning
  // the override off falls through it to the next source down.
  assert.match(experience, /chooseRect: function/);
  assert.match(experience, /if \(overrideActive\(this\.settings\)\)[\s\S]*?else if \(this\.settings\.useHandFloor && this\.handRect\)[\s\S]*?else if \(this\.guardianRect\)/);
  assert.doesNotMatch(experience, /else if \(guardian && guardian\.rect\)/);
});

test('a floor drawn by hand outranks the boundary read, but not a typed override', () => {
  // The hand-drawn rectangle is the only one a person has stood in the
  // room and confirmed is inside their actual boundary, so it beats the
  // read -- which is still the one that can be wrong silently. A typed
  // override still beats both, because somebody meant it.
  assert.match(experience, /useHandFloor: true/);
  assert.match(page, /id="useHandFloor"/);
  assert.match(experience, /addEventListener\('floor-calibration-changed'/);
  const calibration = readFileSync(new URL('../games/rainbow-hotel/js/floor-calibration.js', import.meta.url), 'utf8');
  // Four corners dragged by hand are never square, so the building is
  // laid out on the largest rectangle that fits *inside* the quad --
  // through the same fitting code the Guardian polygon goes through,
  // not a second copy that rounds the corners off differently.
  assert.match(calibration, /fitSafeRect\(this\.corners/);
  assert.match(calibration, /source = 'hand-drawn'/);
});

test('the boundary read reports itself instead of failing quietly', () => {
  const guardian = readFileSync(new URL('../common/guardian-bounds.js', import.meta.url), 'utf8');
  // Every stage that can bail has to leave a trace: whether the device
  // does immersive VR, whether bounded-floor was granted and why not,
  // how many points came back, whether the pose resolved, whether a
  // rectangle could be fitted, and what ended the poll.
  for (const field of ['xrSupported', 'spaceState', 'spaceError', 'rawPoints', 'rawExtent',
    'poseFailures', 'fitFailures', 'goodReads', 'finishedBecause', 'resets']) {
    assert.match(guardian, new RegExp(field), `diagnostics should carry ${field}`);
  }
  assert.match(guardian, /diagnostics: function/);
  // A rejected bounded-floor used to commit on the spot and publish the
  // fallback, which is indistinguishable from success downstream.
  assert.doesNotMatch(guardian, /self\.committed = true;\s*\n\s*self\.publish/);
  // There must always eventually be a publish, or anything waiting on
  // the boundary waits forever.
  assert.match(guardian, /settleMs/);
  assert.match(guardian, /outOfTime/);
});

test('recentring re-reads the boundary instead of leaving it stale', () => {
  const guardian = readFileSync(new URL('../common/guardian-bounds.js', import.meta.url), 'utf8');
  // Holding the Oculus button moves the origin of the space the scene
  // renders in. The polygon was converted into that space once and
  // nothing re-read it, so from then on the rectangle described where
  // the room used to be -- the building standing still while the player
  // and their walls moved out from under it. WebXR fires `reset` for
  // exactly this, and it was not being listened for.
  assert.match(guardian, /watchForRecentre: function/);
  assert.match(guardian, /addEventListener\('reset'/);
  assert.match(guardian, /if \(self\.committed\) self\.retry\(\)/);
  // It has to be watched *after* the read has settled, which is when
  // nothing else in the poll is still running.
  assert.match(guardian, /this\.watchForRecentre\(\);\s*\n\s*if \(this\.committed\) return this\.recheck\(\);/);
  // And the count survives the re-poll it triggers, or it always reads 0.
  assert.match(guardian, /resets: this\.diag \? this\.diag\.resets : 0/);
  assert.match(experience, /diagnostics\.resets/);
});

test('a reset listener is removed with the space it was on', () => {
  const guardian = readFileSync(new URL('../common/guardian-bounds.js', import.meta.url), 'utf8');
  // Re-polling asks for a *fresh* bounded-floor space. The first version
  // left the old space's listener live and added one more, so the next
  // real recentre fired on both and spawned two more -- it doubles. A
  // headset session reported "recentred x44" off about five button
  // presses, re-polling the boundary continuously the whole time.
  assert.match(guardian, /removeEventListener\('reset'/);
  assert.match(guardian, /retry: function \(\)[\s\S]*?this\.unwatchSpace\(this\.boundedSpace\);/);
  assert.match(guardian, /unwatchAll: function/);
  // Spaces are tracked with their handler, or the handler can't be
  // removed later.
  assert.match(guardian, /this\.watched\.push\(\{ space: space, handler: handler \}\)/);
});

test('the boundary is re-measured for as long as the session lasts', () => {
  const guardian = readFileSync(new URL('../common/guardian-bounds.js', import.meta.url), 'utf8');
  // Committing once and never looking again is what made every staleness
  // bug here invisible from inside a headset. Relying on the `reset`
  // event alone is not enough either: it assumes the headset announces
  // every way the origin can move, and the failure when it doesn't is
  // silent and total. So the settled rectangle keeps being measured.
  assert.match(guardian, /recheck: function/);
  assert.match(guardian, /recheckFrames/);
  // Republished only when it actually moved -- every publish rebuilds a
  // building, so noise would rebuild it a couple of times a second.
  assert.match(guardian, /if \(rectsAgree\(reading, this\.rect, this\.data\.driftTolerance\)\) return;/);
  assert.match(guardian, /this\.diag\.drifts\+\+/);
  assert.match(experience, /diagnostics\.drifts/);
});

test('the hand-drawn floor is compared to the read, not just drawn beside it', () => {
  const calibration = readFileSync(new URL('../games/rainbow-hotel/js/floor-calibration.js', import.meta.url), 'utf8');
  // Two blocks of numbers the reader has to subtract in their head is
  // not a measurement. Each part of the comparison accuses something
  // different: offset means a stale origin, a turn means the fitted
  // frame, a size difference means the fit or the inset.
  assert.match(calibration, /export function compareQuads/);
  assert.match(calibration, /export function quadHeading/);
  assert.match(experience, /floor\.versus\.offset/);
  assert.match(experience, /floor\.versus\.turn/);
  // Signs matter: "0.9m off" doesn't say which way, and which way is
  // exactly what separates the causes.
  assert.match(experience, /function signed/);
});

test('the in-headset readout and the boundary overlay are both reachable', () => {
  assert.match(experience, /export function describeBoundaryState/);
  assert.match(experience, /registerComponent\('boundary-overlay'/);
  // On by default now: a POC that cannot be debugged from inside the
  // headset is worse than one that shows too much.
  assert.match(experience, /debug: true/);
  assert.match(experience, /boundary-overlay/);
});

test('the building hangs off the play space instead of being converted into the scene', () => {
  const guardian = readFileSync(new URL('../common/guardian-bounds.js', import.meta.url), 'utf8');
  // Three headset sessions reported the hotel standing through a wall
  // and inside a couch. The matrix maths, the rectangle fit, the corner
  // convention and the building's 90-degree swing all check out in
  // isolation -- which left the one step none of them covers: converting
  // the boundary out of the headset's play-space coordinates into the
  // scene's, once, and building against the result.
  //
  // That conversion is gone. boundsGeometry is already in the bounded
  // space, so the rectangle is measured there and an anchor entity
  // carries the whole building, its transform being that space's live
  // pose. The rectangle lands on the real boundary by construction
  // rather than by arithmetic, and a recentre moves the anchor on the
  // next frame instead of stranding a building.
  assert.match(guardian, /registerComponent\('play-space-anchor'/);
  assert.match(guardian, /matrix\.fromArray\(pose\.transform\.matrix\)/);
  assert.match(guardian, /matrixAutoUpdate = false/);
  // The read itself must no longer need a pose, a frame, or a base space.
  assert.match(guardian, /readOnce: function \(\)/);
  assert.match(guardian, /var polygon = flattenPoints\(geometry\);/);
  // Nothing before the anchor touches a pose. The boundary read used to,
  // and that call is the conversion this change exists to delete.
  const anchorAt = guardian.indexOf("registerComponent('play-space-anchor'");
  assert.ok(anchorAt > 0, 'found the anchor component');
  assert.doesNotMatch(guardian.slice(0, anchorAt), /getPose/,
    'only the anchor should read a pose');
  // The building goes inside the anchor; the player rig does not, since
  // they move around within the play space.
  const scene = page.slice(page.indexOf('<a-scene'), page.indexOf('</a-scene>'));
  // play-space closes immediately after hotel-root, so the rig that
  // follows cannot be inside it.
  assert.match(scene, /<a-entity id="play-space" play-space-anchor>\s*<a-entity id="hotel-root"><\/a-entity>\s*<\/a-entity>/);
  assert.ok(scene.indexOf('id="player-rig"') > scene.indexOf('id="play-space"'),
    'the rig comes after the play space, not inside it');
  // A dropped pose keeps the last good transform rather than snapping
  // the building to the origin for a frame.
  assert.match(guardian, /if \(!pose \|\| !pose\.transform \|\| !pose\.transform\.matrix\)/);
});

test('the hand-drawn floor is stored in play-space coordinates too', () => {
  const calibration = readFileSync(new URL('../games/rainbow-hotel/js/floor-calibration.js', import.meta.url), 'utf8');
  // Otherwise the corners are in the render space while the boundary
  // they are being compared against is in the play space, and the
  // comparison measures the difference between two coordinate systems
  // rather than the error it is meant to find.
  assert.match(calibration, /querySelector\('#play-space'\)/);
  assert.match(calibration, /worldToLocal\(self\.worldPoint\)/);
  // The lasers stay in the render space, where the controllers are.
  assert.match(calibration, /this\.pointerRoot = document\.createElement/);
  assert.match(calibration, /worldFloorY: function/);
});
