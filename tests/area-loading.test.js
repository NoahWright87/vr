import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/pistols-at-dawn/index.html', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../games/pistols-at-dawn/js/world-town.js', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../games/pistols-at-dawn/js/world-menu.js', import.meta.url), 'utf8');
const ghostTown = readFileSync(new URL('../games/pistols-at-dawn/areas/ghost-town.html', import.meta.url), 'utf8');

test('destinations are lazy fragments instead of simultaneous scene entities', () => {
  for (const id of ['ghost-town', 'range', 'saloon', 'farm', 'stable']) {
    assert.match(loader, new RegExp(`fragment: 'areas/${id}\\.html'`));
  }
  assert.match(page, /<a-entity id="area-host" data-area-persistent><\/a-entity>/);
  assert.match(page, /id="carried-items" data-area-persistent/);
  assert.match(loader, /preservePlayerItems: function/);
  assert.doesNotMatch(page, /<a-entity (?:saloon-darts|farm|stable)>/);
});

test('Ghost Town is the startup hub with its two welcome gateways and ten building blockouts', () => {
  assert.match(loader, /this\.switchTo\('ghost-town'\)/);
  assert.match(loader, /id: 'ghost-town', label: 'Ghost Town', position: \{ x: 0, y: 0, z: 24 \}/);
  assert.match(page, /menu-item="value: teleport-ghost-town; label: Ghost Town"/);
  assert.equal((ghostTown.match(/class="ghost-town-welcome-gateway/g) || []).length, 2);
  assert.equal((ghostTown.match(/Welcome to Ghost Town!/g) || []).length, 2);
  assert.match(ghostTown, /class="ghost-town-welcome-gateway" position="0 0 20">/);
  assert.match(ghostTown, /class="ghost-town-welcome-gateway" position="0 0 -20" rotation="0 180 0">/);
  assert.equal((ghostTown.match(/class="ghost-town-building/g) || []).length, 10);
});

test('destination builders are absent from the eager script list', () => {
  for (const script of [
    'items-siege-weapons', 'world-saloon-bar', 'world-shooting-stall',
    'world-targets', 'world-saloon-darts', 'world-farm', 'world-stable',
  ]) {
    assert.doesNotMatch(page, new RegExp(`<script src="js/${script}\\.js"`));
    assert.match(loader, new RegExp(`js/${script}\\.js`));
  }
});

test('HUD visibility is exposed through the watch menu', () => {
  assert.match(page, /menu-item="value: toggle-hud; label: Hide HUD"/);
  assert.match(page, /id="player-hud"/);
  assert.match(menu, /PLAYER_HUD_VISIBLE = this\.hudVisible/);
  assert.match(page, /menu-item="value: toggle-performance; label: Show Performance"/);
});
