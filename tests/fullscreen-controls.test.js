import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlMode = readFileSync(new URL('../common/control-mode.js', import.meta.url), 'utf8');

test('browser fullscreen retains desktop controls unless the renderer is truly presenting XR', () => {
  assert.match(controlMode, /this\.onEnterXr = this\.syncModeFromRenderer\.bind\(this\)/);
  assert.match(controlMode, /renderer && renderer\.xr && renderer\.xr\.isPresenting/);
  assert.match(controlMode, /this\.setMode\(presenting \? 'xr' : 'desktop'\)/);
});

// A bare window.requestAnimationFrame is not guaranteed to keep being
// serviced once a real immersive XRSession owns the frame loop, which could
// leave control-mode stuck reporting 'desktop' for an entire real VR
// session (see the duplicate/misaligned desktop hand bug this fixed).
// Detection now rides the same A-Frame/XR-aware tick loop every other
// component already depends on to keep working in real VR.
test('XR mode detection re-checks every tick instead of relying on a bare rAF', () => {
  assert.doesNotMatch(controlMode, /requestAnimationFrame\(function/);
  assert.match(controlMode, /tick: function \(\) \{\s*this\.syncModeFromRenderer\(\);\s*\}/);
});
