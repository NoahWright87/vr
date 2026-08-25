import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const controlMode = readFileSync(new URL('../common/control-mode.js', import.meta.url), 'utf8');

test('browser fullscreen retains desktop controls unless the renderer is truly presenting XR', () => {
  assert.match(controlMode, /this\.onEnterXr = this\.syncModeFromRenderer\.bind\(this\)/);
  assert.match(controlMode, /renderer && renderer\.xr && renderer\.xr\.isPresenting/);
  assert.match(controlMode, /self\.setMode\(presenting \? 'xr' : 'desktop'\)/);
});
