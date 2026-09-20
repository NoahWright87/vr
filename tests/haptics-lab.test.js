import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const page = await readFile(new URL('../games/haptics-lab/index.html', import.meta.url), 'utf8');
const viteConfig = await readFile(new URL('../vite.config.js', import.meta.url), 'utf8');

test('Haptics Lab is a built experience using the shared hands and watch', () => {
  assert.match(viteConfig, /hapticsLab: resolve\(root, 'games\/haptics-lab\/index\.html'\)/);
  assert.match(page, /src="\.\.\/\.\.\/common\/watch-menu\.js"/);
  assert.match(page, /hand-with-watch="hand: left"\s+semantic-hand="hand: left/);
  assert.match(page, /hand-with-watch="hand: right"\s+semantic-hand="hand: right/);
});

test('Haptics Lab exposes every controller and intensity combination', () => {
  for (const hand of ['left', 'right']) {
    for (const level of ['low', 'medium', 'high']) {
      assert.match(page, new RegExp('menu-item="value: haptic-' + hand + '-' + level));
    }
  }
  assert.match(page, /watch\.triggerHaptics\(intensity, 250\)/);
  assert.match(page, /haptics-pulse-result/);
});
