import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const page = readFileSync(new URL('../games/pistols-at-dawn/index.html', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../games/pistols-at-dawn/js/world-town.js', import.meta.url), 'utf8');
const menu = readFileSync(new URL('../games/pistols-at-dawn/js/world-menu.js', import.meta.url), 'utf8');
const ghostTown = readFileSync(new URL('../games/pistols-at-dawn/areas/ghost-town.html', import.meta.url), 'utf8');
const saloonInterior = readFileSync(new URL('../games/pistols-at-dawn/js/world-saloon-interior.js', import.meta.url), 'utf8');

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
  assert.match(loader, /rig\.object3D\.position\.set\(location\.position\.x, location\.position\.y, location\.position\.z\)/);
  assert.match(page, /menu-item="value: teleport-ghost-town; label: Ghost Town"/);
  assert.equal((ghostTown.match(/class="ghost-town-welcome-gateway/g) || []).length, 2);
  assert.equal((ghostTown.match(/Welcome to Ghost Town!/g) || []).length, 2);
  assert.match(ghostTown, /class="ghost-town-welcome-gateway" position="0 0 20">/);
  assert.match(ghostTown, /class="ghost-town-welcome-gateway" position="0 0 -20" rotation="0 180 0">/);
  assert.equal((ghostTown.match(/class="ghost-town-building/g) || []).length, 10);
});

test('the Saloon door uses the shared semantic controls to enter the Saloon', () => {
  assert.match(page, /src="\.\.\/\.\.\/common\/locomotion\.js"/);
  assert.match(page, /src="\.\.\/\.\.\/common\/desktop-controls\.js"/);
  assert.match(page, /gamepad-input="leftHand: #left-hand; rightHand: #right-hand"/);
  assert.match(page, /touch-controls="leftHand: #left-hand; rightHand: #right-hand/);
  assert.match(page, /desktop-controls="camera: #head-camera; leftHand: #left-hand; rightHand: #right-hand"/);
  assert.match(ghostTown, /class="ghost-town-building ghost-town-saloon"/);
  assert.match(ghostTown, /id="ghost-town-saloon-door"/);
  assert.match(ghostTown, /town-door="destination: saloon"/);
  assert.match(ghostTown, /desktopKey: E; desktopLabel: Enter Saloon/);
  assert.match(loader, /registerComponent\('town-door'/);
  assert.match(loader, /hub\.teleportTo\(this\.data\.destination, arrival\)/);
});

test('the expanded Saloon has a shared interior, return door, and dart lanes', () => {
  const saloon = readFileSync(new URL('../games/pistols-at-dawn/areas/saloon.html', import.meta.url), 'utf8');
  assert.match(saloon, /saloon-interior/);
  assert.match(loader, /js\/world-saloon-interior\.js/);
  assert.match(loader, /'saloon-entrance': \{ position: \{ x: -5\.7, y: 0, z: 12 \}, rotationY: 90 \}/);
  assert.match(loader, /teleportTo: function \(id, arrival\)/);
  assert.match(loader, /location\.arrivals\[this\.data\.arrival\]/);
  assert.match(saloonInterior, /SALOON_WIDTH = 16/);
  assert.match(saloonInterior, /addBottle/);
  assert.match(saloonInterior, /buildTables/);
  assert.match(saloonInterior, /buildPianoNook/);
  assert.match(saloonInterior, /id', 'saloon-exit-door'/);
  assert.match(saloonInterior, /destination: ghost-town; arrival: saloon-entrance/);
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
